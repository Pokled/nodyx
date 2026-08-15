# CDC, le premier contact avec Nodyx

Statut : **DIFFÉRÉ par Jonathan le 2026-08-15.** Constats et mesures conservés, décisions NON prises.
Déclencheur de réouverture : quand la passe UX et responsive sera faite, et quand la démo et l'annuaire
cesseront d'être creux (cf §1.2, c'est la vraie raison du report).
Date : 2026-08-14, révision 2 le 2026-08-15
Auteur : session Nodyx
Préalable au code (règle maison : CDC formel avant tout module critique)

---

## 0. Ce que ce document tranche

| # | Question | Décision proposée |
|---|---|---|
| D1 | Que sert `nodyx.org` à un inconnu ? | **La vitrine du projet**, pas une communauté. Le contenu existe déjà sur `start.nodyx.org`, il change d'adresse. |
| D2 | Où va la communauté actuelle ? | Sur son **propre sous-domaine**, comme les 23 autres instances de l'annuaire. Le vaisseau amiral cesse d'être confondu avec le projet. |
| D3 | Les liens existants vers `nodyx.org/forum/...` ? | **Redirections permanentes**, sans exception. Ils sont partagés sur Discord, indexés, et collés dans des messages depuis des mois. |
| D4 | Comment toucher au routage sans tuer la prod ? | **Par l'API d'administration Caddy uniquement.** Jamais un `reload`, jamais le Caddyfile disque. Voir §5.2, c'est la partie dangereuse de ce CDC. |
| D5 | Un formulaire web où l'admin saisit ses identifiants SSH ? | **REFUSÉ, définitivement.** Motifs en §4.1. Ce n'est pas une question de moyens, c'est une question de nature. |
| D6 | Alors comment installe-t-on « en deux clics » ? | **`cloud-init` d'abord** (meilleur rapport effet sur effort), puis la commande engendrée, puis les catalogues d'auto-hébergement. Aucun secret ne transite par nous. |
| D7 | Et la belle interface qui suit l'installation ? | **Dans le client de bureau, jamais sur le web.** Sur la machine de l'admin, sa clé SSH ne bouge pas. C'est la différence entre un outil qui agit pour lui et un site à qui il confie ses clés. |
| D8 | Un dépôt Git par application ? | **Non, monodépôt.** Workflows de publication séparés, déclenchés sur étiquette. Motifs en §6.1. |
| D9 | Quel client, dans quel ordre ? | La PWA **existe déjà et est complète** : rendre son installation visible. Puis l'APK par TWA. Le bureau en dernier. |
| D10 | Le frontend soudé à une instance à la compilation ? | **À délier.** Prérequis de tout client, et gain d'exploitation immédiat : un build au lieu de quatre. |

**Le banc d'essai qui valide tout ce document :** un inconnu qui tape `nodyx.org` doit, en moins de trente secondes, comprendre ce qu'est Nodyx et repartir par l'une des deux sorties, rejoindre une communauté ou héberger la sienne. Si le document ne produit pas ça, il est faux.

---

## 0.1 Réponses de Jonathan, 2026-08-15

| Question | Réponse |
|---|---|
| Sous-domaine de l'instance amirale | `hub.nodyx.org` convient, **mais la question de fond est rouverte**, voir ci-dessous |
| Langues de la vitrine | Toutes, avec des drapeaux en SVG (jamais en emoji, cf `ChannelIcon`) |
| Instances hors ligne dans l'annuaire | À revoir. « On n'a pas de véritables instances, et notre annuaire actuel est MOCHE » |
| Bascule franche ou cohabitation | Reporté |

**Ce qui remet en cause D1 et D2.** Jonathan précise que `nodyx.org` n'est pas son forum
personnel posé par accident sur le domaine principal : c'est **une zone d'information
communautaire pour tout Nodyx, « un peu l'instance de tout le monde »**. Et
`start.nodyx.org` n'est qu'une vitrine statique, sans aucune interaction.

Si la confusion entre le projet et cette instance est un **choix assumé** et non un
défaut, l'échange d'adresses de §3 perd l'essentiel de sa justification. La décision D1
n'est donc PAS prise, et ce document ne doit pas être appliqué tel quel.

Une option moins risquée avait émergé et reste sur la table : ne rien déménager, et
servir sur `nodyx.org` la vitrine au visiteur non connecté, le forum au membre connecté.
Aucune redirection, aucun creux de référencement, aucune session cassée, et surtout
aucune intervention sur Caddy.

**Décision du 2026-08-15 : on passe d'abord sur le responsive, les défauts d'UX et les
clients. Le reste attendra.**

---

## 1. Déclencheur

Deux constats de Jonathan, le 2026-08-14.

Le premier : « quand l'utilisateur va vouloir utiliser Nodyx pour la première fois, il va tomber sur nodyx.org, et ce n'est pas parlant du tout ».

Le second, plus profond : « les gens ont l'habitude de Discord et de vouloir se créer un serveur. Mais là, nous c'est du self-hosted ». Le geste que le public connaît, créer un serveur en deux clics, n'existe pas chez nous. C'est structurel, pas un manque d'ergonomie.

### 1.1 État réel, vérifié le 2026-08-14

Le diagnostic n'est **pas** qu'il manque une porte d'entrée. Elle existe, elle est derrière la maison.

| Adresse | Ce qu'elle sert aujourd'hui | Ce qu'elle devrait servir |
|---|---|---|
| `nodyx.org` | « Nodyx, Hub Communautaire », **une communauté** | La vitrine du projet |
| `start.nodyx.org` | « Nodyx, Your community. Your server. Forever. », **la vitrine** | Redirection vers `nodyx.org` |
| `nodyx.org/discover` | « Découvrir le réseau Nodyx », l'annuaire | Inchangé, mais atteignable depuis la vitrine |
| `nodyx.dev` | La documentation | Inchangé |

Le domaine que Jonathan communique, celui que les gens retiennent et tapent, tombe donc sur son forum à lui. La présentation du projet vit sur un sous-domaine que personne ne devinera.

**L'annuaire, lui, fonctionne déjà.** Table `directory_instances` : 23 instances enregistrées, 4 vues en ligne dans les quinze dernières minutes. Routes `GET /directory`, `/directory/search`, `/directory/blocklist`. Colonnes disponibles : `slug`, `name`, `description`, `url`, `language`, `country`, `theme`, `members`, `online`, `version`, `status`.

Il ne manque donc ni données ni page. Il manque **un chemin depuis la porte**.

---

### 1.2 Ce qui est creux aujourd'hui, mesuré le 2026-08-14

C'est la vraie raison du report : les trois choses « utiles » qu'une vitrine mettrait en
avant sont vides.

| Brique | Mesure | Conséquence |
|---|---|---|
| Démo `demo.nodyx.org` | **4 utilisateurs, 2 sujets, 2 messages** | Y envoyer un curieux prouve l'inverse de ce qu'on veut |
| Annuaire | **23 instances dont 21 à nous**, 2 tierces | Afficher « 23 communautés » est démenti au premier clic |
| Langues | fr et en à 100%, **de, es, pt-PT, ru, vi à 21%** | Sept drapeaux dont cinq mènent à une interface à moitié traduite |

Aucune vitrine ne peut s'appuyer là-dessus. Ce qui est réel et solide, c'est le
**logiciel** : v2.12, forum, chat, vocal avec SFU, 4525 clés d'interface, une PWA
complète, des installeurs durcis. Peupler la démo est le préalable à tout le reste.

## 2. Le parcours cible

Un seul entonnoir, deux sorties. C'est le cœur du document : ces deux problèmes n'en sont qu'un.

```
                        nodyx.org  (vitrine)
                              │
              ┌───────────────┴───────────────┐
              │                               │
      « Rejoindre une                 « Héberger la
        communauté »                    mienne »
              │                               │
        /discover                        nodyx.dev
     23 instances, filtres          + cloud-init, commande
     langue / thème / taille           engendrée, catalogues
```

La vitrine ne vend pas un produit, elle **oriente**. Un visiteur qui ne sait pas encore ce qu'il veut doit pouvoir lire trois phrases et choisir.

### 2.1 Ce que la sortie « rejoindre » exige

L'annuaire existe mais n'a jamais été pensé comme première impression. Exigences :

- Aucune instance hors ligne mise en avant. Un visiteur qui clique sur une communauté morte est perdu pour de bon. Le champ `online` et la fraîcheur de `last_seen` existent déjà, ils doivent trier.
- Filtrage par **langue** en premier, avant le thème. Une communauté dans une langue qu'on ne lit pas est inutile quelle que soit sa qualité.
- Le nombre de membres visible mais **jamais classant par défaut**. Classer par taille fabrique un effet de concentration, c'est exactement ce que le projet refuse.
- Une instance dans l'annuaire est **modérée**, au sens de la liberté à deux niveaux du projet : au niveau 1 l'instance est libre de ses règles, au niveau 2 l'annuaire choisit ce qu'il référence.

### 2.2 Ce que la sortie « héberger » exige

Elle doit être honnête sur le fait qu'un serveur est nécessaire, sans que ce soit décourageant. La formulation compte : ce n'est pas « c'est compliqué », c'est « c'est chez vous ».

Trois niveaux d'entrée, du plus simple au plus libre, détaillés en §4.

---

## 3. Le déménagement de l'instance amirale

### 3.1 Décision

`nodyx.org` sert la vitrine. La communauté actuelle part sur un sous-domaine dédié, au même titre que `sleemstudio.nodyx.org` ou `vieuxlooters.nodyx.org`.

Nom à trancher par Jonathan. `hub.nodyx.org` est cohérent avec le titre actuel (« Hub Communautaire »).

### 3.2 Ce que ça coûte, sans enjoliver

**Les liens partagés.** Des mois de liens vers `nodyx.org/forum/...` circulent sur Discord, dans des messages, dans des favoris. Ils doivent tous continuer de fonctionner. Redirection permanente de `nodyx.org/forum/*`, `/chat/*`, `/users/*` et des autres chemins d'instance vers le nouveau sous-domaine.

**Le référencement.** Une redirection 301 transmet l'autorité acquise, mais la transition prend des semaines et il y aura un creux. C'est le prix, il faut le savoir avant et non le découvrir après.

**Les instances tierces.** Certaines pointent leur annuaire vers `nodyx.org/api/directory`. Cette route doit rester servie à l'ancienne adresse, ou être redirigée proprement, sinon on casse 23 instances d'un coup. **À vérifier avant toute bascule.**

**Les jetons et les sessions.** Les sessions Redis sont liées à un domaine côté navigateur. Un changement de domaine déconnecte tout le monde. Ce n'est pas grave mais ça doit être annoncé, pas subi.

---

## 4. L'installation, et ce qu'on refuse

### 4.1 Ce que l'on ne fera pas, et pourquoi

L'idée initiale, un formulaire web où le futur admin saisit les identifiants de son VPS pour que le site s'y connecte et lance `install.sh`, est **refusée**.

Trois motifs, dans l'ordre de gravité :

1. **Ça fait de `nodyx.org` la cible la plus rentable du réseau.** Compromettre un serveur donnerait le contrôle des VPS de tous les administrateurs qui ont utilisé le formulaire. Le rapport bénéfice sur risque pour un attaquant devient sans commune mesure avec tout le reste.

2. **Ça contredit l'engagement fondateur.** « Nodyx doit vivre sans nodyx.org ». Un parcours d'installation qui passe obligatoirement par nos serveurs fabrique exactement la dépendance que le projet existe pour supprimer.

3. **Ça a la forme d'une page d'hameçonnage, et ça éduque mal.** On apprendrait aux utilisateurs qu'il est normal de saisir un mot de passe SSH root dans un site web. La prochaine page qui le leur demandera ne sera pas la nôtre.

Ce refus n'est pas une contrainte de moyens. Même avec une équipe et un budget, ça resterait la mauvaise architecture.

### 4.2 Niveau 1, `cloud-init` : le meilleur rapport effet sur effort

Hetzner, DigitalOcean, Vultr et Scaleway acceptent tous un fichier `user-data` au moment de la création de la machine.

On publie un YAML. L'administrateur le colle dans la console de **son** fournisseur en créant son VPS. La machine installe Nodyx toute seule au premier démarrage. Aucun secret ne nous approche, et on est très près du geste « deux clics » que le public connaît.

Livrables : le YAML, une page qui l'explique avec des captures par fournisseur, et un test réel sur au moins deux hébergeurs.

### 4.3 Niveau 2, la commande engendrée

Une page où l'admin choisit son domaine et ses options, et qui produit une ligne de commande personnalisée, à coller dans son propre terminal. C'est le motif de Tailscale, Coolify et Docker. Zéro identifiant en transit, et ça peut être très beau.

C'est aussi l'occasion de rendre `install.sh` moins intimidant : il a déjà des étapes nommées et des contrôles de santé, il lui manque une sortie soignée.

### 4.4 Niveau 3, les catalogues d'auto-hébergement

YunoHost, Umbrel, CasaOS, Cosmos, et les places de marché des hébergeurs existent précisément pour le public visé : des gens qui veulent héberger sans être administrateurs système. Un paquet YunoHost, c'est une installation en un clic, réelle.

Chantier plus long, à ouvrir quand les niveaux 1 et 2 tournent.

### 4.5 L'interface qui suit l'installation

Le souhait est bon, l'endroit était faux. Il appartient au **client de bureau** (§6), où la clé SSH de l'admin ne quitte jamais sa machine.

Et il donne au client de bureau sa première vraie raison d'exister : un `.exe` qui ouvre `nodyx.org` n'apporte rien que la PWA ne fasse déjà, un `.exe` qui installe et administre un serveur est une capacité que le navigateur ne peut pas offrir.

---

## 5. Contraintes techniques dures

### 5.1 Le frontend est soudé à une instance à la compilation

```ts
import { PUBLIC_API_URL } from '$env/static/public'
```

`$env/static/public` est **statique** : l'URL de l'instance est cuite dans le bundle. C'est la raison pour laquelle quatre builds séparés du même frontend tournent aujourd'hui.

Conséquences : aucun client générique n'est possible tant que ce n'est pas délié, et une TWA Android resterait liée à un seul domaine.

Gain indépendant du client, et immédiat : **un seul build au lieu de quatre**, donc un déploiement bien plus court.

Chantier à part entière, à ne pas sous-estimer : `api.ts`, le contournement SSR, le socket, la CSP, et le branding par instance aujourd'hui figé au build.

### 5.2 Caddy en production, la partie dangereuse

La configuration vivante ne vient **pas** de `/etc/caddy/Caddyfile` mais de `/var/lib/caddy/.config/caddy/autosave.json`.

Un `systemctl reload caddy`, un `caddy reload` ou un `install_tunnel.sh --repair` bascule Caddy sur le fichier disque et **fait tomber le HTTPS de nodyx.org instantanément**.

Toute modification de routage de ce CDC passe donc par l'API d'administration sur `localhost:2019`, avec export préalable de la configuration vivante et vérification après coup. Ce point n'est pas une précaution de style, c'est la condition de survie de la bascule.

### 5.3 Ce qui existe déjà et qu'il ne faut pas réécrire

| Brique | État vérifié le 2026-08-14 |
|---|---|
| PWA | `manifest.json` complet (`standalone`, 9 tailles d'icônes, 3 raccourcis), `service-worker.ts` de 307 lignes gérant `install`, `activate`, `fetch`, `push`, `notificationclick` |
| Annuaire | 23 instances, 3 routes, filtres langue et thème disponibles en base |
| Installeurs | `install.sh` et `install_tunnel.sh`, durcis, avec étapes nommées |
| Publication de binaires | `release-sfu.yml`, déclenchement manuel, artefacts attachés à une release |

**Nodyx est déjà une application installable.** Ce qui manque n'est pas la PWA, c'est un bouton qui le dise.

---

## 6. Les clients

### 6.1 Un seul dépôt

Décision : monodépôt, workflows de publication séparés.

Motifs : les binaires doivent apparaître **sur le dépôt principal**, sinon l'objectif est manqué ; le client de bureau emballe le build frontend et suivrait mal dans un dépôt distinct ; le `VERSION` racine est source unique et le client doit porter le même numéro que le serveur ; l'attention et les contributeurs se diluent sur cinq dépôts.

La crainte légitime, alourdir la CI de chaque PR, se règle par un **workflow séparé déclenché sur étiquette**, exactement comme `release-sfu.yml` aujourd'hui. `nodyx-desktop` ne doit pas entrer dans la matrice `check-satellites`, qui suppose une application SvelteKit.

### 6.2 Ordre proposé

1. **Rendre l'installation de la PWA visible.** Une soirée, aucun risque, répond à la majorité des demandes.
2. **Playwright avec la cible WebKit.** Aucun outil de test navigateur n'existe aujourd'hui, seulement Vitest. Prérequis double : les visiteurs iPhone, où tous les navigateurs sont du WebKit, et le futur client Linux, car Tauri y utilise WebKitGTK.
3. **APK par TWA.** Meilleur rapport effet sur effort, mais lié à un domaine tant que §5.1 n'est pas fait.
4. **Bureau par Tauri.** Fournit `.exe`, `.msi`, `.deb`, `.AppImage` depuis une seule base : le bouton Windows et le bouton Linux sont **le même travail**.

### 6.3 Deux vérités à ne pas découvrir en route

**La signature Windows n'est pas du travail, c'est de l'argent et de la paperasse.** Depuis 2023 la clé privée doit vivre dans du matériel ou un service de signature. Un certificat OV ne fait pas disparaître l'avertissement SmartScreen tant que le binaire n'a pas de réputation. Recommandation : publier d'abord un `.exe` **non signé**, clairement étiqueté, et n'acheter un certificat que si les téléchargements le justifient.

**L'AGPL et l'App Store sont en conflit connu.** La distribution iOS passera par la PWA quelle que soit la technologie retenue. Ça ne coûte rien à assumer, mais il ne faut promettre à personne une application iOS.

---

## 7. Ordre d'exécution proposé

| Rang | Chantier | Nature | Risque |
|---|---|---|---|
| 1 | Bouton d'installation de la PWA | Frontend, une soirée | Nul |
| 2 | Bascule `nodyx.org` vers la vitrine, déménagement de l'instance | **Configuration Caddy**, redirections | **Élevé**, cf §5.2 |
| 3 | `cloud-init` publié et testé sur deux hébergeurs | Ops, documentation | Faible |
| 4 | Playwright et WebKit | Tests | Nul |
| 5 | Choix de l'instance à l'exécution | Frontend, structurant | Moyen |
| 6 | APK par TWA | Packaging | Faible |
| 7 | Bureau par Tauri | Packaging, CI | Moyen |

Les rangs 1, 3 et 4 sont indépendants et peuvent avancer dans n'importe quel ordre. Le rang 2 est le plus rentable pour l'utilisateur et le plus dangereux pour la production : il mérite sa propre fenêtre, à froid, jamais en fin de soirée.

---

## 8. Questions ouvertes pour Jonathan

1. Quel sous-domaine pour l'instance amirale ? `hub.nodyx.org` ?
2. La vitrine reste-t-elle en anglais seul, ou passe-t-elle en FR et EN comme le reste ? La règle i18n s'applique dès la première ligne de code.
3. L'annuaire doit-il afficher les instances hors ligne, grisées, ou les masquer ?
4. Accepte-t-on le creux de référencement de la bascule, ou préfère-t-on servir la vitrine à la racine **sans** déménager le forum dans un premier temps, en acceptant une cohabitation transitoire ?
