# CDC : un seul endroit pour l'apparence d'une instance

> Jonathan, 29/09 : « on va éviter de se disperser. On a déjà une zone de
> personnalisation pour le frontpage, je n'ai pas envie que cela soit le
> foutoir. Il va falloir revoir l'ergonomie (ludicité), une UX pro et
> adéquate, faire ça très intelligemment. »

Suite directe de `NODYX_CONTENANT_DESIGN_CDC.md` (étape 5 : « étendre l'écran
de thème existant, pas en créer un nouveau à côté »). En vérifiant le code,
il s'avère qu'il n'y a pas UN écran de thème existant, il y en a plusieurs,
et c'est précisément le problème à régler avant d'en ajouter un.

## Constat, vérifié dans le code le 29/09

La personnalisation visuelle d'une instance vit aujourd'hui à **six endroits**,
stockée à **deux endroits différents**, et deux d'entre eux n'ont **aucun
écran** :

| Réglage | Où l'admin le règle | Où c'est stocké | Ce que ça pilote |
|---|---|---|---|
| Logo, bannière | Paramètres > Identité visuelle | `communities.logo_url/banner_url` | rail, en-tête d'accueil, papier peint du contenant |
| Fond de la liste des membres | Paramètres > Identité visuelle | `communities.sidebar_bg` | sidebar des membres |
| Thème de la page d'accueil | Grid Builder > onglet Thème | grille publiée (`theme`) | uniquement les widgets de l'accueil (`--n*`) |
| Thème d'instance | **aucun écran** (posé à la main en base) | `instance_settings.theme_vars` / `theme_css` | couleurs des pages (`--p-*`) |
| Effet d'instance (pluie Matrix) | **aucun écran** | `instance_settings.theme_effect` | fond animé |
| Contenant (accent, verre, papier peint) | **nulle part** : codé en dur dans `app.css` | aucun | header, rail, sidebars, feuille |

Et dans la navigation de l'admin :
- l'entrée **« Homepage » redirige vers le Grid Builder** : deux entrées pour le
  même écran ;
- **« Paramètres »** mélange l'identité visuelle (logo, bannière) avec la
  technique (SMTP, réseau P2P, statistiques) : un admin qui cherche « changer
  mon logo » n'a aucune raison de regarder à côté du serveur mail ;
- le Grid Builder a son propre accent, ses propres polices et son propre
  rayon de coins, **sans lien** avec le reste de l'instance : changer la
  couleur de sa communauté oblige à la changer à deux endroits, et rien ne
  prévient qu'il faut le faire.

Ajouter un septième endroit pour le contenant, c'est exactement le « foutoir »
à éviter.

## Le principe : un seul lieu, organisé par intention

**Un seul écran, « Apparence ».** Il est rangé selon ce que l'admin veut
faire, pas selon l'endroit où c'est stocké. L'admin ne doit jamais avoir à
savoir que le logo vit dans `communities` et l'accent dans `instance_settings`.

**Une cascade explicite, visible à l'écran :**

```
Identité  (qui on est : nom, logo, bannière)
   └── Ambiance  (comment on se sent : un accent, un décor, une intensité)
          ├── Contenant        hérite, toujours
          ├── Page d'accueil   hérite par défaut, peut s'en détacher
          └── Profils membres  base de leur thème, qu'ils peuvent surcharger
```

Changer l'accent une fois le propage partout où il n'a pas été volontairement
surchargé. C'est la règle qui tue la duplication, pas une consigne à
retenir.

## Révision du 29/09 : l'édition en direct devient l'entrée principale

Idée de Jonathan, le même jour : « quand l'admin est connecté, il peut éditer
le design en direct sur sa frontpage, avec un stylo qui apparaît dans les
zones éditables quand il passe la souris dessus », et un petit bouton stylo
collé au bouton Administration, « un bouton qui a deux zones de clic ».

Adoptée, parce qu'elle va plus loin que l'écran décrit plus bas : l'aperçu
le plus fidèle d'une instance, c'est l'instance elle-même. Plus d'écran à
part, plus d'aperçu à maintenir, plus de « où est-ce que ça se règle ? » :
on règle la chose là où on la voit. L'endroit unique devient le site.

**Le bouton à deux zones.** Le bouton Administration du header devient un
bouton scindé `[ Administration | stylo ]` : même hauteur, mêmes coins, un
séparateur fin. La zone stylo active le mode édition.

**Les stylos n'apparaissent qu'en mode édition, jamais en navigation
normale.** Des stylos surgissant à chaque survol dès que l'admin est
connecté l'empêcheraient de vivre sa propre communauté tranquillement :
c'est le « contraignant » à éviter. Un clic sur le stylo fait apparaître une
barre flottante discrète en bas de l'écran (« Mode édition · Annuler ·
Publier ») et rend les zones éditables au survol ; un second clic ou Échap
referme tout.

**Zones éditables en première version :**
- le logo (rail) ;
- le nom de la communauté (panneau), édité directement dans la page ;
- l'accent (la pastille de sélection), avec « les couleurs de ta bannière » ;
- le décor (le papier peint autour des plaques) : bannière, autre image ou
  aucun, et le curseur Sobre ↔ Immersif ;
- la liste des membres : son fond ;
- la page d'accueil : son stylo ouvre le Grid Builder existant. **Pas
  d'édition de la grille bloc par bloc en direct** : le Grid Builder fait
  2 600 lignes, le refaire en place coûterait des semaines pour peu de gain.

**Deux entrées, un seul moteur (décision de Jonathan, 29/09).** « Parfois
c'est mieux d'avoir une édition globale, et parfois on a envie d'éditer une
seule zone. » On garde donc les deux : l'écran Apparence décrit plus bas
pour l'édition globale, et le stylo en direct pour l'édition d'une zone. Ce
qui évite le foutoir, c'est qu'ils partagent LE MÊME brouillon côté serveur
(`theme_shell_draft`) : une retouche au stylo se retrouve dans l'écran
Apparence et inversement, et il n'y a qu'un seul « Publier ». Même stockage,
même endpoint, même plancher de contraste. Réservé au
grand écran (1024px et plus) dans cette première version, comme le
contenant flottant.

Les panneaux qui s'ouvrent depuis les stylos reprennent les contrôles de
l'écran Apparence décrit ci-dessous (mêmes composants, pas de doublon de code).

## L'écran « Apparence » (l'entrée globale)

Deux colonnes. À gauche, les réglages en **trois onglets** ; à droite, un
**aperçu vivant** du vrai contenant qui réagit à chaque geste, avant
enregistrement.

### Onglet 1 : Identité
- Nom affiché, logo, bannière. **Déplacés depuis Paramètres**, avec le même
  téléversement qu'aujourd'hui (rien à réécrire côté serveur).
- La bannière est présentée comme ce qu'elle est devenue : **le décor de toute
  l'instance** (papier peint du contenant), pas seulement l'en-tête de
  l'accueil. L'admin le voit dans l'aperçu à l'instant où il la change.

### Onglet 2 : Ambiance (le cœur du chantier)
- **Un seul accent.** Sélecteur de couleur, plus le moment ludique de l'écran :
  **« les couleurs de ta bannière »**, cinq pastilles extraites de l'image
  elle-même (calcul local dans le navigateur, aucun service externe). Un clic
  et l'instance prend les couleurs de son propre décor. C'est utile (un
  accent assorti à sa bannière, sans compétence en couleurs) et c'est le
  genre de détail qu'on montre à quelqu'un.
- **Le décor** : la bannière, une autre image, ou aucun décor (fond uni).
- **L'intensité**, UN curseur de « Sobre » à « Immersif ». Il pilote ensemble
  le flou du décor, sa luminosité et la transparence du verre. Trois
  réglages techniques qu'aucun admin n'a envie de doser un par un deviennent
  une seule intention.
- **Le mode par défaut** pour les visiteurs : sombre, clair ou celui du
  système. Chaque membre garde son propre choix.
- **Le fond de la liste des membres**, déplacé depuis Paramètres, et l'**effet
  d'instance** (pluie Matrix), qui gagne enfin un écran.

### Onglet 3 : Page d'accueil
- Pas un deuxième éditeur : un résumé (aperçu miniature de la grille publiée)
  et un bouton **« Ouvrir l'éditeur de la page d'accueil »** vers le Grid
  Builder, qui reste l'outil de mise en page.
- Dans le Grid Builder, l'onglet Thème gagne un interrupteur **« Suivre
  l'ambiance de l'instance »** : activé, l'accent de la grille vient de
  l'Ambiance ; désactivé, la grille garde ses couleurs propres, comme
  aujourd'hui. Activé par défaut pour une nouvelle instance ; **désactivé**
  pour une grille déjà personnalisée, pour ne rien changer en silence chez
  quelqu'un.

### L'aperçu vivant
- Une réduction du vrai contenant (rail, panneau, feuille, barre), rendue
  avec les mêmes variables que le site : ce qu'on voit est ce qu'on aura, pas
  une illustration.
- Une bascule clair/sombre **dans l'aperçu** : l'admin vérifie les deux modes
  sans toucher à sa propre préférence.
- Même logique que le Grid Builder, pour ne pas apprendre deux façons de
  faire : on modifie un **brouillon**, rien ne change pour les membres avant
  **« Publier »**, et **« Revenir à la version publiée »** annule tout.

## Garde-fous (non négociables)

- **Lisibilité garantie par le calcul, pas par la bonne volonté.** Les
  variantes claire et sombre de l'accent sont dérivées automatiquement, avec
  un plancher de contraste WCAG AA (4,5:1 pour le texte). Si l'admin choisit
  une couleur trop pâle pour le mode clair, la variante est assombrie juste
  assez, et l'aperçu le montre avec une ligne d'explication. Aucun réglage ne
  peut rendre une instance illisible.
- **Jamais de CSS libre** dans ce nouvel écran. Des valeurs typées et bornées
  (couleur hexadécimale, curseur 0 à 100, liste fermée de choix), validées
  côté serveur. `theme_css` existant reste en place pour qui l'utilise, mais
  n'est pas exposé ici.
- `prefers-reduced-transparency` et `prefers-reduced-motion` restent
  respectés quel que soit le réglage.
- Toute nouvelle chaîne est une clé i18n, `fr.json` ET `en.json`, dans la
  même PR (les 5 portes CI).

## La navigation de l'admin après le chantier

- Nouvelle entrée **Apparence**, en tête de la section Contenu.
- **« Homepage » disparaît** (c'était une redirection) ; « Grid Builder » est
  renommé **« Page d'accueil »**.
- **Paramètres** ne garde que la technique (statistiques, réseau P2P, SMTP,
  configuration). Son ancien bloc « Identité visuelle » renvoie vers
  Apparence pendant une version, le temps que les habitudes se déplacent.

## Technique

- **Stockage** : une clé `theme_shell` dans `instance_settings`, à côté de
  `theme_vars` et `theme_effect` (même famille, lue par la même requête dans
  `/instance/info`). **Aucune migration.** Format :
  `{ accent: "#rrggbb", backdrop: "banner"|"custom"|"none", backdrop_url?, intensity: 0..100, default_mode: "dark"|"light"|"system" }`.
- **Core** (sanctuaire, validé par Jonathan le 29/09) : `/instance/info`
  renvoie `theme_shell` ; nouvel endpoint `/admin/appearance` (brouillon + publication)
  (`adminOnly`) qui écrit Identité + Ambiance **en une seule transaction**
  (colonnes de `communities` + clés d'`instance_settings`), valeurs
  validées par schéma, erreurs avec `code` stable. `/admin/branding` reste
  en place, inchangé.
- **Frontend** : `lib/shellTheme.ts`, fonctions pures qui transforment
  `theme_shell` en variables `--nx-*` (clair et sombre), plancher de
  contraste compris, couvertes par Vitest. Le layout les applique ; en
  l'absence de réglage, les valeurs actuelles d'`app.css` restent le défaut.
- **Extraction des couleurs de la bannière** : dans le navigateur (canvas,
  quantification simple), fonction pure testée. Aucun appel externe.

## Phasage, chaque étape déployée et vérifiée sur vieuxlooters

1. **Core** : `theme_shell` dans `/instance/info` + `/admin/appearance` (brouillon + publication),
   tests Vitest (validation, transaction, droits).
2. **`shellTheme.ts`** : dérivation + plancher de contraste, tests ; le
   contenant lit enfin ses couleurs depuis l'instance au lieu d'`app.css`.
3. **L'écran Apparence** : les trois onglets, l'aperçu vivant, brouillon et
   publication.
4. **Le rangement** : déplacement de l'identité hors de Paramètres, nettoyage
   de la navigation, interrupteur « Suivre l'ambiance » dans le Grid Builder.

## Décisions à valider par Jonathan

- **D1.** Un seul écran « Apparence » à trois onglets (Identité, Ambiance,
  Page d'accueil), le Grid Builder restant l'éditeur de mise en page.
- **D2.** Un seul accent pour l'instance, dérivé automatiquement en clair et
  en sombre avec plancher de contraste (pas de réglage séparé par mode).
- **D3.** Un seul curseur « Sobre ↔ Immersif » au lieu de trois réglages
  techniques (flou, luminosité, transparence).
- **D4.** Les couleurs extraites de la bannière comme proposition d'accent.
- **D5.** Brouillon + « Publier », comme le Grid Builder.
- **D6.** Grille existante : l'interrupteur « Suivre l'ambiance » démarre
  désactivé, rien ne change sans action de l'admin.
- **D7.** Nettoyage de la navigation : suppression de « Homepage »,
  renommage du Grid Builder, identité sortie de Paramètres.
- **D8.** (révision du 29/09, validé) Deux entrées pour un seul brouillon : écran Apparence ET édition en direct ;
  bouton scindé Administration | stylo ; stylos visibles uniquement en mode
  édition ; pas d'édition de la grille d'accueil bloc par bloc.

---

# Partie 2 (30/09) : le stylo, la jonction avec le Grid Builder, les modules

> Jonathan, 30/09 : « Pourrais-tu en profiter pour améliorer la jonction
> Grid Builder et Apparence ? Je sais que c'est un travail monstrueux, mais
> on n'a pas le choix. Car après, on va même devoir s'attaquer aux
> différents modules (forum, wiki, chat, canvas, sondages...). Prends le
> temps. »

## Où on en est (livré sur vieuxlooters, branche feat/contenant-design)

Écran Apparence complet (ambiance + identité, un brouillon, un « Publier »),
thème Originel de confort par défaut, ambiances « univers » avec leur propre
décor, fonds Graphite / Assortis / Noir, « Suivre l'ambiance » dans le Grid
Builder, anciennes variables de marque des pages recalées sur l'ambiance.

## Constat, mesuré dans le code le 30/09

**La jonction Grid Builder / Apparence est encore bancale :**
- le panneau Thème du Grid Builder règle 6 couleurs, 2 fonds et bordures, la
  forme et la typographie, plus ses propres préréglages (émojis, dégradés
  violet-cyan) : quand la grille suit l'ambiance, ces couleurs sont
  silencieusement ignorées, alors que le panneau les montre toujours comme
  modifiables. L'admin règle un champ, rien ne bouge, sans explication ;
- deux systèmes de préréglages coexistent (ceux de la grille, ceux de
  l'Apparence), qui ne se connaissent pas ;
- **incohérence de publication** : dans le Grid Builder, enregistrer le
  thème le rend public IMMÉDIATEMENT (colonne `homepage_grid.theme`, pas de
  brouillon) ; seule la mise en page passe par « Publier ». L'Apparence, elle,
  passe tout par un brouillon ;
- une nouvelle grille ne suit pas l'ambiance par défaut.

**Les modules sont l'essentiel du travail restant :**

| Module | Fichiers | Couleurs codées en dur |
|---|---|---|
| Calendrier | 4 | 451 |
| Forum | 4 | 430 |
| Profils (`users`) | 6 | 324 |
| Messages privés | 2 | 286 |
| Chat | 1 | 181 |
| Tâches | 2 | 173 |
| Paramètres membre | 1 | 163 |
| Wiki | 4 | 117 |
| Fil d'actu | 1 | 111 |
| Bibliothèque | 2 | 104 |
| Canvas | 2 | 95 |
| Jardin | 1 | 88 |
| Musique | 3 | 65 |
| Découvrir | 1 | 48 |
| Notifications | 1 | 30 |
| Sondages | 1 | 18 |
| **Composants partagés** | (lib/components) | **~3 400** |

Environ 6 300 couleurs en dur au total. C'est ce qui empêche la feuille
centrale de passer en clair, et ce qui laisse des restes d'indigo sous
certaines ambiances.

## Volet A : un seul moteur d'apparence côté navigateur

Prérequis des deux autres volets. Aujourd'hui, le brouillon, l'historique
et la publication vivent DANS la page Apparence. Le stylo en direct ne peut
pas les réutiliser. On les sort dans un module unique
(`lib/appearanceDraft.ts`) : chargement, enregistrement automatique,
Annuler/Rétablir, publication, abandon. La page Apparence et le stylo
l'utilisent tous les deux : une retouche au stylo se voit dans l'écran
Apparence et inversement, par construction, pas par synchronisation.

## Volet B : le stylo en direct

- **Bouton scindé** `[ Administration | stylo ]` dans le header, pour les
  admins et le propriétaire seulement. Le stylo active le mode édition ; un
  second clic ou Échap le referme.
- **Barre flottante** en mode édition : état du brouillon, Annuler/Rétablir,
  « Ouvrir Apparence », Publier, Quitter.
- **Zones éditables** : rien en navigation normale. En mode édition, un
  liseré discret et une pastille stylo au survol ; un clic ouvre un panneau
  ancré à la zone, avec les MÊMES contrôles que l'écran Apparence :
  - le logo du rail → logo ;
  - la pastille de sélection (canaux) → couleur d'accent, couleurs de la
    bannière, ambiances ;
  - le décor (bords autour des plaques) → décor et intensité ;
  - la page d'accueil → « Suivre l'ambiance » et l'éditeur de mise en page.
- Grand écran seulement (1024 px et plus), comme le contenant flottant.
- Accessibilité : chaque zone est atteignable au clavier en mode édition,
  les panneaux se ferment à Échap et rendent le focus.

## Volet C : la jonction Grid Builder / Apparence

- **Une seule source de couleur quand la grille suit l'ambiance** : dans le
  panneau Thème, les champs de couleur et les préréglages de la grille sont
  remplacés par une carte « Couleurs : l'ambiance de l'instance », avec
  l'échantillon réel de l'ambiance publiée et un lien vers Apparence. Plus de
  champ affiché qui ne fait rien. « Personnaliser les couleurs de la grille »
  détache la grille et rend les champs.
- **La forme et la typographie restent à la grille** (arrondis, ombre,
  bordures, police) : l'ambiance ne les couvre pas, et ce sont des choix de
  mise en page.
- **Suivre l'ambiance par défaut pour une grille neuve** (une grille déjà
  personnalisée reste comme elle est, D6).
- **Onglet « Page d'accueil » de l'Apparence** : état réel (suit l'ambiance
  ou a ses propres couleurs), bascule en un clic, ouverture de l'éditeur.
- **Incohérence de publication** du thème de la grille : documentée ici,
  corrigée dans un second temps (le passer en brouillon touche le core et le
  flux du Grid Builder ; hors de cette passe pour ne pas tout mêler).

## Volet D : la méthode pour les modules (plan, pas encore de code)

1. **Des jetons de CONTENU**, pas seulement de contenant : `--nx-content-bg`,
   `-card`, `-card-hover`, `-text`, `-muted`, `-faint`, `-border`,
   `-accent`, `-accent-text`, `-danger`, `-success`... définis par l'ambiance
   en clair ET en sombre, dans lib/shellTheme.ts, testés comme le reste
   (plancher de contraste).
2. **Une table de correspondance** des couleurs en dur les plus fréquentes
   vers ces jetons (`bg-gray-900` → carte, `text-gray-400` → atténué,
   `text-indigo-400` → accent...), établie en mesurant les usages réels, pas
   en devinant.
3. **Un outil de migration assistée** : il propose les remplacements
   fichier par fichier ; chaque cas ambigu est tranché à la main.
4. **Un module par PR**, dans l'ordre d'usage (forum, chat, messages,
   profils, puis les autres), chacun vérifié par captures avant/après en
   sombre ET en clair, et par les détecteurs Playwright existants.
5. Quand tous les modules sont migrés : la feuille centrale suit enfin le
   mode clair, et une nouvelle porte CI interdit toute nouvelle couleur en
   dur dans les pages (même principe que les portes i18n : un cliquet).

## Ordre de réalisation

A (moteur partagé) → B (stylo) → C (jonction) → D (modules, un par un).
Chaque étape testée, déployée et vérifiée sur vieuxlooters, avec un point à
Jonathan entre deux.

---

# Partie 3 (30/09) : chaque zone a son propre style

> Jonathan, 30/09, après un premier essai du stylo : « après avoir modifié
> une zone (par exemple la sidebar de gauche), cela a modifié tout le
> template, cela n'a pas respecté une zone individuelle. » Puis : « je veux
> tout ! Une zone éditable, c'est comme si on en modifiait le CSS. Toutes
> les zones. »

## Ce qui n'allait pas

Le stylo du volet B ouvrait les réglages GLOBAUX depuis une zone : changer
la couleur « depuis la sidebar » changeait toute l'instance. Mauvaise
lecture de l'intention : une zone éditable doit avoir son propre style.

## Le modèle : un style par zone, typé, qui surcharge l'ambiance

Chaque zone peut porter un style propre, qui l'emporte sur l'ambiance
pour elle seule. Absent = la zone suit l'ambiance (comportement actuel).

**Pas de CSS libre**, par décision de sécurité (déjà posée en partie 1) : un
champ CSS libre casse une instance d'un point-virgule et ouvre la porte à
l'injection. À la place, TOUS les réglages visuels d'une feuille de style
pour une plaque, typés et bornés :

| Réglage | Valeur | Garde-fou |
|---|---|---|
| Couleur d'accent | #rrggbb | plancher de contraste sur le fond de la zone |
| Couleur du panneau | #rrggbb | textes recalculés (blanc cassé ou gris foncé) |
| Opacité du verre | 0 à 100 | aucun (0 = plein) |
| Flou du décor derrière | 0 à 40 px | coût GPU borné |
| Bordure | couleur + 0 à 3 px | |
| Arrondi | 0 à 32 px | |
| Ombre | 0 à 100 | |
| Image de fond | /uploads/, /ambiances/ ou https ; recadrage (x, y), zoom, voile 0 à 100 | mêmes règles d'adresse que le décor |
| Police | système, arrondie, serif, mono | liste fermée, polices locales |

**Zones** : rail, sidebar de canaux, barre du haut, liste des membres,
feuille de contenu. Les blocs de la page d'accueil viennent ensuite (ils
passent par le Grid Builder, qui a déjà une configuration par widget).

**Stockage** : `theme_shell.zones.<zone>` dans le même brouillon que
l'ambiance, même « Publier », validé par schéma strict côté core.

**Rendu** : chaque plaque porte `data-nx-zone` ; la feuille d'ambiance émet,
par zone stylée, les variables surchargées (`--nx-header-accent`,
`--nx-glass`, `--nx-text`...) sur ce seul sélecteur. Les calculs de
lisibilité sont les MÊMES que pour l'ambiance.

**Stylo** : le panneau d'une zone s'ouvre sur « Cette zone » ; un onglet
séparé, nommé « Toute l'instance », garde l'accès à l'ambiance globale ;
« Revenir à l'ambiance » efface le style de la zone.
