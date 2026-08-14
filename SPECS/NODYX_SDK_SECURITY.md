# Modèle de sécurité des extensions Nodyx

Statut : **normatif, écrit avant l'implémentation.** Accompagne `NODYX_SDK_CDC.md` (architecture) et `NODYX_SDK_REFERENCE.md` (contrat développeur).
Portée : le code tiers installé sur une instance Nodyx, sa distribution, et ce qui l'entoure.

Ce document existe parce qu'une place de marché change la nature du problème. Tant qu'un widget est du code qu'on a écrit ou lu, l'installer est une décision technique. Le jour où c'est le travail d'un inconnu, installé en un clic, c'est une décision de confiance, et une décision de confiance doit reposer sur des frontières, pas sur des intentions.

---

## 1. Ce qui existe aujourd'hui, et pourquoi on le remplace

Le chargement actuel des widgets installés injecte le JavaScript tiers dans le document principal, par balise `<script>` servie depuis l'origine de l'instance. Le Shadow DOM du Web Component isole **les styles**, pas le code.

Conséquence mesurée, pas supposée : le jeton de session est présent dans la charge SSR de chaque page pour un utilisateur connecté. Un widget installé peut donc lire la session de tout visiteur connecté qui charge la page d'accueil, l'owner compris, appeler l'API en son nom, et réécrire la page.

Ce niveau de confiance est cohérent avec « j'installe mon propre code ». Il est incompatible avec « j'installe le code d'un inconnu depuis un magasin ». **Le bac à sable n'est pas un durcissement du SDK, c'est sa condition d'existence.**

---

## 2. Garanties, et non garanties

Une liste de garanties n'a de valeur que si la liste des non garanties est écrite avec la même franchise.

### 2.1 Ce que la plateforme garantit

| G | Garantie |
|---|---|
| G1 | Une extension ne peut pas lire la session, les cookies ni le stockage local de l'instance. |
| G2 | Une extension ne peut pas lire ni modifier le DOM de la page Nodyx, ni celui d'une autre extension. |
| G3 | Une extension ne peut appeler l'API Nodyx qu'à travers des lectures cadrées, avec les droits de l'utilisateur courant, jamais élevés. |
| G4 | Une extension ne peut joindre aucun service réseau qu'elle n'a pas déclaré et que l'admin n'a pas accepté. |
| G5 | Le navigateur du visiteur n'émet aucune requête vers un tiers du fait d'une extension. |
| G6 | Une extension ne voit jamais un secret d'instance, même quand il est utilisé pour ses propres appels. |
| G7 | Une extension ne peut pas consommer sans limite le stockage, la base, le réseau ou le processeur. |
| G8 | Une extension ne peut pas exécuter de code sur le serveur, créer de table, ni ajouter de migration. |
| G9 | Aucune extension ne se met à jour toute seule, et tout changement de capacité est montré avant d'être appliqué. |
| G10 | Une surface d'extension est visuellement identifiée comme telle par l'hôte, de façon non falsifiable (§4.9). |

### 2.2 Ce que la plateforme ne garantit pas

| N | Non garantie | Traitement |
|---|---|---|
| N1 | Que le code d'une extension soit correct, ou que son auteur soit honnête. | Revue au registre, permissions visibles, révocation. |
| N2 | Qu'une extension autorisée à joindre un hôte n'y envoie pas des données qu'elle a le droit de lire. Une liste blanche borne la destination, pas l'intention. | Chemins et méthodes déclarés, journalisation, revue, minimisation des permissions. |
| N3 | Qu'un défaut du navigateur ne casse pas l'isolation. Nous dépendons de la frontière d'origine du navigateur. | C'est un choix assumé : une frontière maintenue par les éditeurs de navigateurs vaut mieux qu'un interpréteur maison. |
| N4 | Qu'une extension ne dessine pas une interface trompeuse **dans son propre cadre**. | Marqueur d'hôte non falsifiable, dialogues sensibles rendus par l'hôte, interdiction explicite de demander un mot de passe, revue. |
| N5 | Qu'un administrateur qui installe délibérément une extension hostile soit protégé de lui même. | L'admin est la racine de confiance de son instance. Le rôle du système est de l'informer, pas de le contredire. |
| N6 | Que les données d'une extension soient chiffrées au repos indépendamment de la base. | Elles vivent dans PostgreSQL, protégées comme le reste de l'instance. |

---

## 3. Biens, adversaires, hypothèses

**Biens à protéger**, par ordre de gravité : la session et le compte des membres, le contenu privé (messages, courriels, données de profil), l'intégrité de l'instance (base, fichiers, configuration), les secrets d'instance (clés d'API, jetons), la disponibilité, et la vie privée du visiteur, y compris vis-à-vis de nous.

**Adversaires considérés** :

| A | Adversaire | Capacité |
|---|---|---|
| A1 | Auteur d'extension malveillant | publie un paquet crédible au registre |
| A2 | Auteur honnête compromis | pousse une mise à jour hostile sur une extension déjà installée et appréciée |
| A3 | Extension négligente | pas d'intention, mais une XSS, une fuite ou une boucle infinie |
| A4 | Membre malveillant de l'instance | utilise l'interface d'une extension pour atteindre ce qu'il n'a pas le droit de voir |
| A5 | Tiers réseau | contrôle un service que l'extension appelle, ou le DNS qui le résout |
| A6 | Attaquant externe | envoie un lien piégé à un administrateur |

**Hypothèses de confiance** : le navigateur applique correctement l'isolation d'origine et les drapeaux d'iframe ; l'administrateur d'instance est la racine de confiance ; le serveur de l'instance n'est pas déjà compromis ; les mainteneurs du registre officiel sont honnêtes, et leur compromission est traitée en §8.

---

## 4. Les frontières, une par une

```
                     ┌─────────────────────────────────────────┐
   navigateur        │  page Nodyx (origine de l'instance)      │
                     │  session, DOM, stockage local            │
                     │  ┌───────────────────────────────────┐   │
                     │  │ iframe, origine OPAQUE            │   │
                     │  │ code de l'extension               │   │
                     │  │      ▲  port privé (MessagePort)  │   │
                     │  └──────┼────────────────────────────┘   │
                     └─────────┼──────────────────────────────-─┘
                               │ ext_token, jamais le cookie
                     ┌─────────▼───────────────────────────────┐
   serveur           │  routes /extensions/*  (core)           │
                     │  storage · core:read · proxy réseau     │
                     │  secrets (jamais renvoyés)              │
                     └─────────┬───────────────────────────────┘
                               │ liste blanche, IP validée
                     ┌─────────▼───────────────────────────────┐
   internet          │  service tiers déclaré                  │
                     └─────────────────────────────────────────┘
```

### 4.1 La frame

`sandbox="allow-scripts"` et **rien d'autre**. Pas de `allow-same-origin`, ce qui place le document en origine opaque : cookies, `localStorage` et `sessionStorage` inaccessibles, DOM parent inaccessible. Pas de `allow-top-navigation`, `allow-popups`, `allow-modals`, `allow-forms`, `allow-downloads`.

Politique de sécurité de contenu servie avec le document de frame, avec l'origine écrite en clair, puisque `'self'` ne résout rien dans une origine opaque :

```
default-src 'none'; script-src 'nonce-<n>' <origine>; style-src 'nonce-<n>' <origine>;
style-src-attr 'unsafe-inline'; img-src <origine> data: blob:; media-src <origine> blob:;
connect-src <origine>; frame-src 'none'; form-action 'none'; base-uri 'none'
```

`frame-src 'none'` : pas d'iframe imbriquée. C'est aussi ce qui rend impossible l'embarquement d'un lecteur tiers, limite assumée de la v1. Le déverrouillage prévu en P3 ne l'affaiblit pas : c'est l'hôte qui pose l'iframe du fournisseur, hors du bac à sable, depuis une liste livrée avec Nodyx. L'extension demande, elle n'obtient jamais le droit d'encadrer elle même.

**Cette politique est posée en en-tête ET en balise `meta` dans le document.** Vérifié sur notre production le 2026-08-14 : le proxy pose la politique du site en mode `set`, donc il **remplace** celle de l'application, y compris sur les réponses d'API. Un en-tête seul serait effacé et la frame hériterait d'une politique permissive, ce qui rouvrirait le réseau sortant direct et annulerait la garantie G5. Une balise `meta` n'est pas réécrite par un proxy, et quand deux politiques coexistent le navigateur applique leur intersection, donc la plus stricte gagne.

Règle générale, valable au delà de ce cas : **une frontière de sécurité ne doit jamais dépendre d'un en-tête qu'un intermédiaire peut réécrire.** Un produit auto-hébergé tourne derrière le proxy de son administrateur, pas derrière le nôtre.

L'isolation elle même ne dépend pas de la CSP : elle vient de l'origine opaque portée par l'attribut `sandbox`, que rien d'externe ne peut modifier. La CSP est la défense en profondeur, et c'est elle qui ferme le réseau direct.

**Ajouter un drapeau de bac à sable est un changement de modèle de sécurité**, pas un réglage. Toute demande passe par une révision de ce document.

### 4.2 Le canal

Dans une origine opaque, `event.origin` vaut `"null"` et ne prouve rien. Filtrer à la main serait fragile, donc on ne filtre pas : **l'hôte n'envoie qu'un seul message sur `window`**, celui d'amorçage, qui transfère un `MessagePort`. Tout le reste passe par ce port privé, propre à cette frame et à cette session. Une autre frame n'a rien à usurper, il n'y a pas d'adresse publique à viser.

Sur ce message unique, l'hôte vérifie `event.source === iframe.contentWindow`. Après l'amorçage, tout message reçu sur `window` est ignoré et journalisé.

Le protocole est versionné (`p`) et corrélé (`id`). Un identifiant inconnu, déjà consommé, ou reçu avant la fin de la poignée de main est rejeté.

### 4.3 Le jeton

`ext_token`, JWT court signé par le core, lié à tout ce qui doit l'être :

```jsonc
{ "iss": "<origine>", "aud": "nodyx-extension", "ins": "<instance>",
  "ext": "<extension>", "sur": "<surface>", "sub": "<user|null>",
  "prm": [ /* accordées, pas demandées */ ], "jti": "...", "iat": ..., "exp": ... }
```

Chaque claim ferme un rejeu : une autre instance, une autre extension, une autre surface, un autre utilisateur. Durée 10 minutes, renouvellement **à la demande de la frame**, l'hôte re-frappant le jeton auprès du core avec la session réelle.

Les routes `/api/v1/extensions/:id/*` acceptent ce jeton, acceptent `Origin: null`, et **n'acceptent jamais le cookie de session ni le jeton utilisateur**. `Origin: null` n'est pas une authentification : c'est une conséquence du bac à sable, que n'importe qui peut produire.

Le jeton ne transite que par le port privé. Jamais dans une URL, un `src`, un référent, un journal, un message d'erreur. Un `jti` est révoqué immédiatement à la désactivation, la désinstallation, ou le retrait d'une permission.

### 4.4 Le proxy réseau

Ce n'est pas un `fetch` générique derrière une liste blanche, c'est une porte bornée par ce que le manifeste déclare et que l'admin a accepté. Contrôles, dans l'ordre :

1. hôte, **méthode** et **préfixe de chemin** vérifiés contre l'accord ; port implicite du schéma, un port explicite non déclaré est refusé
2. résolution DNS, validation de **l'adresse obtenue**, puis connexion **à cette adresse**. Vérifier le nom avant de résoudre ne protège de rien : le rebinding DNS est l'attaque de référence.

   Le refus n'est pas uniforme, et ce n'est pas un relâchement (révisé le 2026-08-14) : **une instance en intranet est un usage normal, pas une anomalie.** Réseau privé, déclarable et accordé sur consentement explicite et distinct de l'admin, qui est la racine de confiance de son instance. Boucle locale et lien local (`127.0.0.0/8`, `::1`, `localhost`, `169.254.0.0/16`, donc les métadonnées d'hébergeur), refusés en toute circonstance y compris avec l'accord de l'admin, parce qu'ils visent la machine de l'instance elle même, sa base, son cache et son API interne. Une variable d'environnement dédiée lève la restriction sur une instance de développement, jamais en production. Restent refusés partout : multicast, diffusion, plages réservées, adresses mappées, écritures exotiques d'IP
3. 3 redirections au maximum, **chacune revalidée intégralement**, adresse comprise
4. secrets injectés **selon une recette que le serveur possède** : l'extension nomme le secret, elle ne choisit ni l'en-tête ni sa destination. Sans cette règle, une extension demanderait `X-Peu-Importe: <secret>` vers un hôte qu'elle contrôle
5. en-têtes filtrés à l'aller (liste blanche courte) et au retour (`Set-Cookie` et apparentés retirés)
6. réponse plafonnée : taille, délai, type de contenu, **ratio de décompression** (10 Ko qui deviennent 10 Go est un déni de service)
7. débit plafonné par extension et par utilisateur, journalisation par extension

### 4.5 Le stockage

Cloisonné par extension, par portée, par utilisateur. Aucune extension ne peut nommer l'espace d'une autre : la clé d'extension vient du jeton, pas de la requête.

**Règle des deux axes** : la capacité de l'extension et les droits de l'utilisateur sont deux dimensions distinctes, et le droit effectif est leur **intersection**. Une extension qui détient `storage.instance.write` n'écrit pas parce qu'un membre a ouvert son interface. Une capacité accordée à l'installation n'est jamais une élévation de privilège pour l'utilisateur courant.

Un quota en octets ne suffit pas : sans limites fines, une extension épuise le processeur et la base sans jamais approcher son mégaoctet. Longueur de clé, taille de valeur, nombre de clés, profondeur JSON et fréquence d'écriture sont plafonnés (valeurs en `NODYX_SDK_REFERENCE.md` §9). Dépassement : erreur nette, jamais de purge silencieuse.

### 4.6 Le paquet

À l'installation : manifeste validé contre son JSON Schema, permission inconnue **refusée** et non ignorée, identifiant réservé refusé, `default_locale` incomplet refusé, `api` absent refusé.

À l'extraction : chemins aplatis, `../` refusé, chemin absolu refusé, **lien symbolique refusé**, liste blanche d'extensions de fichiers, plafonds de taille, de nombre de fichiers, de profondeur et de ratio de décompression. Le type de contenu servi est déterminé par le serveur depuis l'extension de fichier, jamais deviné depuis le contenu, avec `X-Content-Type-Options: nosniff` et `Cross-Origin-Resource-Policy: same-origin`.

Les assets sont servis sous `/api/v1/extensions/:id/:version/assets/*`. **La version est dans le chemin** : une mise à jour invalide le cache d'elle même, et une frame ouverte ne peut pas mélanger deux générations de code.

La route publique actuelle `/api/v1/widget-assets/:id/:file` disparaît avec P0-A. Le JavaScript d'une extension n'est jamais chargeable comme script de la page hôte.

### 4.7 Ce qui s'affiche hors du bac à sable

C'est l'angle mort classique. L'icône et l'aperçu d'une extension sont affichés par la page d'administration et par le magasin, donc **sur l'origine principale, hors de toute frame**.

Un SVG n'est pas une image : il peut porter `<script>`, des attributs `on*`, des `<foreignObject>`, des références externes. Sans traitement, l'icône devient une XSS sur la page d'administration, indépendamment de toute la §4.1.

Règle : tout SVG est **assaini à l'installation**, réécrit vers un sous ensemble sûr, et servi avec `image/svg+xml`, `nosniff` et `Content-Security-Policy: default-src 'none'`. Un SVG qui ne survit pas à l'assainissement fait échouer l'installation, il n'est pas silencieusement vidé.

Même vigilance pour toute chaîne du manifeste rendue dans l'administration : elle est du texte, jamais du HTML.

### 4.8 Le magasin et le lien d'installation

Le magasin ne pousse jamais rien. Le flux ne s'inverse pas : la fiche redirige vers l'administration de l'instance, l'admin voit les permissions, et **c'est l'instance qui télécharge**.

Le lien d'installation est une surface d'attaque à part entière : un lien fabriqué avec `src=<registre_de_l_attaquant>`, envoyé à un owner, installerait du code arbitraire en un clic (adversaire A6). Trois contrôles :

- `src` validé contre la **liste des registres configurés dans l'instance**, jamais suivi tel quel. Un registre inconnu est refusé, pas proposé à l'ajout.
- le lien **ne fait que pré-remplir un écran**. L'installation est un `POST` authentifié, protégé contre le CSRF, avec confirmation explicite.
- l'écran nomme la provenance en clair.

Chaîne de confiance de la distribution, trois maillons à ne pas confondre :

```
clé publique du registre (livrée avec l'instance, pas récupérée depuis le registre)
   signe →  index.json  (versions, permissions, sha256 de chaque paquet)
            référence →  sha256 du paquet
                         vérifie →  paquet .nyx téléchargé
```

Le `sha256` prouve l'intégrité du téléchargement, **pas l'authenticité** : si l'index est compromis, un hash cohérent avec un paquet hostile l'est tout autant. C'est la signature de l'index qui porte l'authenticité. Une version publiée est **immuable**, sans quoi un hash épinglé ne veut plus rien dire.

### 4.9 L'administration, et le marqueur d'origine

Deux écrans portent la sécurité côté humain.

**L'écran de permissions**, à l'installation, en langage clair, orienté « ce que ça peut toucher » plutôt que « ce que ça fait ». Il s'affiche même pour une extension sans permission : la même porte pour tout le monde.

**Le diff de capacités**, à la mise à jour. Pas seulement les permissions : les surfaces ajoutées et les routes nouvelles comptent, parce qu'une extension qui passe de widget à application complète a changé de profil de risque. Aucune mise à jour automatique, jamais.

**Le marqueur d'origine** (G10) répond à la non garantie N4. Une surface d'extension est identifiée par l'hôte, **à l'extérieur de la frame**, donc non falsifiable par l'extension : un liseré discret et le nom de l'extension. Un membre doit pouvoir distinguer ce que dit Nodyx de ce que dit une extension. C'est ce qui rend une fausse demande de mot de passe visible pour ce qu'elle est, et c'est pourquoi les dialogues sensibles sont rendus par l'hôte, jamais dans la frame.

---

## 5. Responsabilités de l'auteur d'extension

Le bac à sable protège Nodyx de votre extension. **Il ne protège pas votre extension d'elle même**, ni vos utilisateurs de vos propres erreurs.

| Vous devez | Pourquoi |
|---|---|
| `textContent`, jamais `innerHTML`, avec une valeur de configuration ou une réponse réseau | une XSS dans votre frame reste une XSS pour l'utilisateur qui vous fait confiance |
| Ne jamais demander un mot de passe, un code, ni un moyen de paiement | Nodyx ne le demande jamais dans une extension, une extension qui le fait est hostile par définition |
| Demander le minimum de permissions | chaque ligne est affichée avant l'installation et à chaque mise à jour |
| Annoncer clairement ce que vous stockez et ce que vous envoyez | la description est lue, la revue vérifie qu'elle correspond au code |
| Ne pas embarquer de traceur, de mesure d'audience, de télémétrie | rejet immédiat au registre, sans exception |
| Traiter le cas visiteur (`nodyx.user === null`) | les vues publiques sont vues par des gens sans compte |
| Nettoyer dans `unmount`, suspendre hors écran | une extension qui fuit dégrade toute la page |
| Ne pas dépendre des variables CSS internes de Nodyx | elles ne sont pas un contrat, seuls les jetons `--nodyx-*` le sont |
| Publier vos sources et une licence OSI | exigé au registre officiel |

---

## 6. Responsabilités de l'administrateur d'instance

- Lire l'écran de permissions. Une extension d'affichage qui demande le réseau mérite une question.
- Lire le diff de capacités à chaque mise à jour. C'est le moment précis où une extension honnête peut devenir hostile (adversaire A2).
- N'ajouter un registre tiers qu'en connaissance de cause : c'est étendre sa racine de confiance.
- Traiter un secret d'instance (clé d'API) comme un secret : il est utilisé pour l'extension, il ne lui est jamais montré, mais il reste engagé par elle.
- Désactiver plutôt que désinstaller en cas de doute : la désactivation coupe l'exécution et révoque les jetons, sans détruire les données des membres.

---

## 7. Critères de revue au registre officiel

Refus systématique : permission sans usage repérable dans le code, code volontairement illisible ou empaqueté sans sources, collecte de données personnelles non annoncée, appel vers un service de mesure d'audience, SVG porteur de script, identifiant réservé, licence absente ou non OSI, absence de dépôt public.

Examen manuel obligatoire : toute extension demandant `network`, `secrets`, `storage.instance.write` ou `core`, et toute mise à jour qui **ajoute** une capacité.

Le registre officiel est le **niveau 2** du modèle de liberté à deux étages : une instance installe ce qu'elle veut par fichier, le registre, lui, est modéré.

---

## 8. Révocation et incident

| Situation | Réponse |
|---|---|
| Extension hostile découverte | retrait de l'index, marquage de la version dans l'index (`revoked`), avertissement affiché dans l'administration des instances qui l'ont installée |
| Auteur compromis | même chose, plus gel des publications sous cette identité |
| Registre compromis | rotation de la clé publique, livrée par mise à jour de Nodyx, jamais par le registre lui même |
| Défaut du bac à sable côté navigateur | interrupteur global de désactivation des extensions, indépendant de la désinstallation, activable sans redéploiement |

L'instance vérifie l'index à intervalle régulier pour **signaler** une révocation. Elle ne désinstalle jamais toute seule : la décision reste à l'admin, mais elle est informée.

Divulgation responsable : les failles concernant le bac à sable, le proxy ou la chaîne de distribution suivent `SECURITY.md` du dépôt. Une faille dans une extension tierce se signale au registre, qui contacte l'auteur et retire au besoin.

---

## 9. Preuve, et porte d'entrée

Ce modèle ne vaut que prouvé. Le catalogue d'attaques est en `NODYX_SDK_CDC.md` §14, sous forme d'une extension hostile en fixture, exécutée en CI : DOM et fenêtres, navigation, messagerie (forge, rejeu, port d'une autre extension), jeton (rejeu croisé instance, extension, surface, expiration), réseau (rebinding DNS, RFC1918, `::1`, redirections, exfiltration de secret par en-tête, bombe de décompression), stockage (quotas, limites fines, espace d'autrui), paquet (zip slip, lien symbolique, 100 000 fichiers, MIME menti, SVG actif).

**Porte d'entrée, non négociable : aucune capacité réseau d'extension n'existe tant que les tests de confinement ne sont pas verts.** Le proxy est lui même une capacité de sécurité, il ne se pose pas sur un bac à sable non prouvé.

---

## 10. Risques résiduels acceptés

- **Exfiltration par un hôte autorisé** (N2). Une extension autorisée à joindre un service peut y encoder ce qu'elle a le droit de lire. Bornée par la minimisation des permissions, les chemins déclarés, la journalisation et la revue. Non éliminable sans interdire le réseau.
- **Dépendance à l'isolation du navigateur** (N3). Assumée : une frontière maintenue par les éditeurs de navigateurs est plus solide qu'un interpréteur maison, et l'interrupteur global de §8 est le plan de repli.
- **Interface trompeuse dans le cadre** (N4). Réduite par le marqueur d'origine, les dialogues rendus par l'hôte et la revue, pas supprimée.
- **Administrateur qui s'auto-piège** (N5). Hors périmètre : l'admin est la racine de confiance de son instance. Le système l'informe, il ne le contredit pas.
