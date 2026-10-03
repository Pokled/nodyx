# CDC : Le contenant (header, sidebars) et un vrai jour/nuit

> **Le juste milieu, dans les mots de Jonathan (19/09) : "un design de fou,
> mais qui reste parfait pour de petites machines."** L'ambition visuelle
> de ce CDC ne se négocie jamais contre le budget de performance posé plus
> bas, et le budget de performance ne sert jamais d'excuse pour un design
> timide. Les deux tiennent ensemble ou le chantier a raté son mandat.

## Contexte

Jonathan, le 18/09 : le header et les sidebars "font trop IA, pas assez logiciel".
Exemple précis, capturé en écran : le nom de communauté rendu en dégradé
violet vers cyan, texte transparent avec `background-clip: text`, en Space
Grotesk noir. Il veut un vrai mode jour/nuit, et une direction visuelle qui
reprend la structure éprouvée de Discord (rail d'instances, sidebar de
canaux, liste de membres) mais l'exécute très au-dessus : "je veux faire mieux apporter un nouveau paradigme de l'ui et ux / pas IA du tout, de la douceur un peu comme iPhone."

Rappel non négociable, dit deux fois dans la conversation : **Nodyx est
paramétrable à souhait**. Ce chantier ne doit pas remplacer la
personnalisation existante par un thème unique imposé, il doit l'étendre au
contenant comme elle existe déjà pour le contenu.

## Constat, vérifié dans le code réel

**Le contenant n'est pas un ensemble de composants.** Header, rail
d'instances, sidebar de canaux et sidebar de membres vivent tous les
quatre dans `nodyx-frontend/src/routes/+layout.svelte`, un fichier de
3047 lignes, état local partagé entre les quatre (`dropdownOpen`,
`langView`, `paletteOpen`, `panelCollapsed`...). Impossible de retoucher
l'un sans avoir les trois autres sous les yeux.

**Trois systèmes de variables CSS coexistent, et ce ne sont PAS trois
versions concurrentes de la même chose :**
- `--nx-*` (`nodyx-frontend/src/app.css:29-46`, 786 usages / 82 fichiers) :
  les couleurs de marque. C'est déjà, depuis la v2.9, la couche de
  personnalisation PAR INSTANCE (`instance_settings.theme_vars` +
  `theme_css`, un owner peut déjà retoucher ses accents). Le trou : elle ne
  définit que des accents (indigo/violet/cyan et leurs "glows"), aucun
  token de fond, de surface ou de texte. Un admin peut changer la couleur
  d'un bouton, pas faire passer son instance en clair.
- `--p-*` (`nodyx-frontend/src/lib/profileThemes.ts`, 138 usages / 5
  fichiers) : la personnalisation DE LA PAGE DE PROFIL, par membre. Six
  presets, tous sombres. Bon système, mais qui ne concerne que le profil,
  pas le contenant.
- `--n*` (`nodyx-frontend/src/lib/components/homepage/GridRenderer.svelte`,
  340 usages / 12 fichiers) : la personnalisation des widgets de la page
  d'accueil, par admin. Sans rapport avec le contenant non plus.

**Aucun mécanisme de bascule jour/nuit n'existe.** Pas de `data-theme`, pas
de clé `localStorage`, pas de composant toggle. Environ 93 fichiers sur 196
utilisent des couleurs codées en dur (`#0d0d12`, `#374151`, `rgba(255,255,255,.03)`...)
qui ne réagiraient à rien même si on branchait un interrupteur demain.

**Un précédent interne qui a déjà marché**, à réutiliser plutôt qu'à
réinventer : la refonte de la sidebar et du dashboard admin (v2.8,
`nodyx-frontend/src/routes/admin/+layout.svelte`) est déjà sortie du
"style carnaval" vers une base zinc + un seul accent indigo, typographie
précise (13/11/10px), coins `rounded-md` discrets, hiérarchie par
opacité et poids plutôt que par la couleur. Aucun dégradé, aucun
glassmorphism gratuit. C'est la preuve que "sobre et pro" fonctionne déjà
dans cette base de code, pour cette même équipe de composants.

## Direction de design

**Le mandat, dans les mots de Jonathan (18/09) : "du jamais vu, si déjà vu
du cohérent, quelque chose d'utile mais de beau. Le design IA est banni."**
Concrètement : les références citées plus bas (Raycast, Linear...) sont un
étalon de qualité et de cohérence à égaler, pas un modèle à recopier trait
pour trait. Nodyx doit avoir sa propre identité reconnaissable, pas être
"Linear avec un logo différent". Ce qui est familier (la structure façon
Discord, un composant emprunté à Raycast) doit l'être par choix assumé et
cohérent avec le reste, jamais parce que c'était le premier résultat
plausible. Utile passe avant beau, mais aucune des deux ne se sacrifie à
l'autre : une interface belle qui cache l'information ou une interface
efficace mais laide sont deux échecs du même mandat.

Complément de Jonathan, en cherchant les mots justes : "de l'innovation,
mais pour aller vers l'utile, le pratique, pas de surcharge inutile, mais
du doux, du magnifique." Ça se règle en pratique par un principe simple :
**la retenue partout, l'éblouissement à quelques endroits choisis, jamais
partout à la fois.** Un élément qui n'aide ni à comprendre ni à agir se
retire, sans exception (c'est la "surcharge inutile"). Mais un ou deux
endroits précis de l'interface, la palette d'instances au clic, l'ouverture
d'un salon vocal, ont le droit d'être le moment qu'on montre à quelqu'un
pour lui donner envie d'essayer Nodyx. Stripe fait ça avec son paiement,
Linear avec sa palette de commandes : sobre presque partout, sauf à
l'endroit précis choisi pour rester en mémoire. On choisira ces endroits
ensemble avant de les construire, pas au fil de l'eau.

**Repérage : "quand on est quelque part, on le sait."** Vérifié dans le
code réel (`+layout.svelte:721-760`) : aujourd'hui, savoir où on se trouve
passe uniquement par un fil d'ariane en petit texte gris, aucune couleur,
aucune icône, rien à ressentir d'un coup d'œil, il faut le LIRE. Le mandat
de Jonathan est un repérage stratégique ET ludique : chaque grande section
(Forum, Chat, Wiki, Bibliothèque, Musique, Jardin...) porte une identité
visuelle propre et cohérente, reconnaissable dans la sidebar ET reprise
dans la page une fois qu'on y est, pas juste un mot dans un fil d'ariane.
Pas une couleur par section façon arc-en-ciel (ce serait de la surcharge),
mais un jeu cohérent d'icônes déjà en place (`ChannelIcon`) combiné à un
accent de teinte qui se déplace légèrement selon la zone, dans les bornes
de la palette de l'instance : venir du chat vers le wiki doit se sentir
avant même de lire le titre de la page.

**Structure : garder Discord.** Rail d'instances, sidebar de canaux, zone
de contenu, liste de membres : c'est un pattern éprouvé pour ce type
d'app, le refaire de zéro n'apporterait rien. Ce qui change, c'est
l'exécution visuelle, pas l'agencement.

**Exécution : prolonger la base admin (zinc + un accent), avec de la
douceur.** Concrètement :
- Zéro dégradé sur du texte, zéro `background-clip: text`. Le nom de
  communauté se lit en une couleur, pleine, à bon contraste.
- Ombres portées douces (grand flou, faible opacité, plusieurs couches),
  jamais de `box-shadow` dur à un seul niveau. C'est ce qui donne le
  "capitonné" façon iOS, pas la rondeur des coins à elle seule.
- Coins arrondis cohérents et modérés (même famille de rayon partout dans
  le contenant, pas un mélange de `rounded-md` et `rounded-2xl` au hasard).
- Une seule couleur d'accent à la fois à l'écran pour signaler l'état actif
  (page courante, canal sélectionné), le reste en niveaux de gris/zinc.
- Transitions douces sur les interactions qui le justifient (ouverture de
  panneau, changement de canal), en réutilisant les ressorts déjà en place
  dans l'app pour les réactions/indicateurs de frappe, pas une nouvelle
  bibliothèque d'animation.
- Densité assumée mais respirée : Discord tasse tout, on garde l'info dense
  mais on donne de l'air aux groupes (espacement entre sections de nav plutôt
  qu'entre chaque ligne).

Ce standard devient la référence à appliquer plus tard au reste de l'app
(forum, chat, admin déjà fait), mais **cette passe se limite au contenant.**

## Ce qu'on refuse de copier

Jonathan, le 19/09, en réaction directe : "mets-toi à la place d'un humain
qui ne veut pas d'un design humain [= attendu, déjà vu partout], qui veut
sortir du lot. Tout le monde en a plein le cul du design généré par moi
[l'IA] et toutes les autres IA. On casse tout, on innove."

Un point à trancher honnêtement, en tant qu'IA écrivant ce CDC : les
références citées ci-dessous (Linear, Raycast, Vercel) ne sont plus un
angle mort, elles sont devenues elles-mêmes un genre reconnaissable. Un
canevas presque noir, un seul accent indigo ou violet, de l'Inter partout,
des bordures fines : en 2026 ce look a un nom dans les cercles design
("Linear-core"), et l'imiter au trait, même bien fait, resterait une forme
de conformité, juste à un autre troupeau que celui des templates IA. Le
CDC amplifie donc son propre mandat :

- **On garde le métier, pas le costume.** Les leçons de la section
  précédente (tokens sémantiques, physique du mouvement, séparation
  mécanisme/habillage, cible tactile invisible plus grande que le geste
  visible) sont des techniques, elles n'ont pas de couleur. On les
  applique à une identité qui n'emprunte ni la palette indigo/violet ni
  la police par défaut de tout le monde.
- **Constat gênant à assumer** : l'accent actuel de Nodyx
  (`--nx-accent-2-soft` → `--nx-cyan-soft`, le dégradé violet-cyan sur le
  logo entouré au tout début de cette conversation) EST littéralement la
  combinaison identifiée plus haut dans ce CDC comme la signature du
  "generic AI SaaS". Casser le moule commence par ne pas garder cette
  paire de teintes comme palette de départ proposée à un nouvel admin.
- **Chercher la différenciation dans ce que Nodyx EST, pas dans ce qui se
  fait ailleurs.** La plupart des outils qui inspirent ce CDC sont des
  produits SaaS centralisés sans histoire propre à raconter visuellement,
  d'où leur convergence entre eux. Nodyx a une substance concrète et rare
  (décentralisé, maillage P2P, une instance qu'on possède vraiment,
  "le réseau, c'est les gens") que peu de logiciels peuvent revendiquer
  honnêtement. Un vrai chantier d'exploration, à mener avant de figer une
  identité : est-ce que le rail d'instances peut évoquer un maillage réel
  plutôt qu'une colonne d'icônes générique, sans tomber dans la
  décoration gratuite déjà interdite plus haut ? Est-ce qu'une typographie
  moins vue que l'Inter/Space Grotesk de tous les autres peut porter la
  même lisibilité ? Ce sont des pistes à explorer et juger sur maquette,
  pas des décisions prises ici.
- **Le contenu et les gens restent le vrai spectacle.** La plupart des
  clones de Discord décorent leur chrome pour compenser un manque
  d'identité. Le pari inverse, un contenant qui s'efface presque partout
  (retenue, section précédente) pour que les avatars, les voix actives, le
  contenu réel des membres soient ce qu'on remarque, est en soi un choix
  qui va à contre-courant du reste du marché, sans ajouter une ligne de
  décoration.

Ce que ce CDC NE fait PAS : promettre une esthétique jamais vue en un seul
document théorique. La vraie différenciation se juge sur maquette, pas sur
une liste d'intentions. La section suivante donne les références utilisées
pour le niveau d'exigence technique (comment une ombre, un rayon, un
minutage de mouvement se construisent bien), pas comme modèle à décalquer.

## Liste noire : ce qui disparaît du CSS

Demande explicite de Jonathan (19/09) : "toutes les choses utilisées en
CSS par l'IA doivent disparaître." Les tells du "design généré" sont
documentés, cités dans les mêmes termes par les designers eux-mêmes et par
un outillage dédié (`avoid-ai-design`, un skill qui audite exactement ça).
Vérifiés un par un contre le code réel de Nodyx, pas recopiés en aveugle :

**Confirmés présents dans Nodyx aujourd'hui, à supprimer :**
- Dégradé de texte via `background-clip: text` sur le logo
  (`+layout.svelte:875,884`) : LE tell le plus cité de tous.
- `font-family: 'Space Grotesk'` sur le même logo : nommé explicitement
  dans la recherche comme une "police distinctive" devenue elle-même un
  réflexe IA à force d'être reprise partout.
- Le dégradé violet → cyan (`--nx-accent-2-soft` → `--nx-cyan-soft`) :
  déjà traité plus haut, la paire de teintes la plus citée de toutes.
- Fonds et bordures `rgba(255,255,255,.03)` à `.08` (8 occurrences dans le
  seul header) : le glassmorphism réflexe, "flou = premium" sans raison
  fonctionnelle. Une bordure ou un fond a le droit d'exister, mais doit
  venir d'un token `--nx-*` avec une valeur choisie, pas d'une transparence
  de gris tapée à la volée.
- `bg-indigo-600` comme accent de marque (`admin/+layout.svelte:113`) :
  indigo/violet est, avec le bleu Tailwind par défaut, l'accent le plus
  cité comme "choix par défaut d'une IA qui n'a pas réfléchi à une couleur
  de marque". Un vrai accent de marque se choisit, ne se prend pas dans la
  palette Tailwind de base.

**À vérifier composant par composant, pas encore confirmés partout mais
sur la liste de contrôle :**
- Toute carte ou bloc `rounded-2xl shadow-lg` appliqué de façon uniforme
  sans raison de hiérarchie.
- Icônes/CTA géométriques répétitifs (flèche systématique après un bouton,
  icône dans un carré arrondi) et emoji utilisés comme puces de
  fonctionnalité.
- Toute animation `fade-in` identique répétée sur tous les éléments sans
  distinction de fréquence d'usage (contredit la règle de Rauno citée plus
  haut).
- Texte gris clair sur fond blanc ou inversement : au-delà du "ça fait
  IA", c'est un vrai échec d'accessibilité (contraste WCAG), donc une
  raison de le bannir même sans le lien avec l'esthétique.

**Point à trancher honnêtement, pas à balayer** : la base zinc + indigo de
la refonte admin v2.8, citée plus haut comme précédent qui a marché, utilise
elle-même une palette "shadcn zinc" et un accent indigo, deux éléments que
la même recherche identifie comme des valeurs par défaut trop communes.
Ce n'est pas disqualifiant (l'exécution soignée de l'admin la rend déjà
largement au-dessus du lot), mais ça veut dire qu'on ne la prolonge pas
telle quelle sans y retravailler au moins l'accent, pour ne pas construire
le nouveau contenant sur la même base générique que ce qu'on est en train
de bannir ailleurs.

## Références visuelles

Recherché sur demande de Jonathan ("il nous faut des références, ce que les
gens veulent"), pas des agences de com mais des produits réels, documentés,
que les développeurs eux-mêmes citent en 2026 comme le contraire du "généré
par IA". Le fil commun : canevas presque noir, un seul accent de teinte,
typographie discrète, hiérarchie par des liserés fins plutôt que par des
ombres dures.

- **Raycast** : "canevas quasi noir, marches d'élévation à peine visibles,
  un seul accent chaud qui porte l'identité de marque, typographie
  discrète en Inter. Les composants se définissent moins par des ombres
  que par des bordures fines (1px), des liserés internes en surbrillance,
  et le traitement 'touche de clavier' qui fait qu'une carte semble
  enfoncée et tactile plutôt que flottante." C'est très exactement le
  "capitonné" que vise ce CDC, en plus précis qu'une simple ombre floue.
- **Linear** : même famille (canevas sombre, accent unique, Inter,
  bordures fines), la référence déjà citée dans la refonte admin v2.8 de
  Nodyx. On continue dans cette lignée plutôt que d'en ouvrir une nouvelle.
- **Arc** (navigateur) et **Vercel/Geist** : même dialecte visuel partagé
  par les outils les plus aimés des développeurs en ce moment, pas un
  hasard de mode.
- **Concurrence directe, à regarder sans complexe** : Stoat (ex-Revolt) est
  cité comme l'alternative à Discord la plus proche en usabilité tout en
  étant "faite bien" ; Rocket.Chat pour son interface "professionnelle,
  propre, façon Slack". Deux captures d'écran à comparer honnêtement à ce
  qu'on va produire.
- **Rauno Freiberg** (staff design engineer chez Vercel, créateur de
  `cmdk`, la librairie derrière la plupart des palettes de commandes du
  web actuel) et **Emil Kowalski** (créateur de Sonner et Vaul, connu pour
  ses animations à ressort qui donnent du poids et de l'inertie à une
  interface plutôt qu'une simple durée). Les deux tiennent ensemble
  [learn-ui.com](https://learn-ui.com), un livre interactif gratuit sur le
  design engineering (gestes, mouvement, composants, métier), et l'essai de
  Rauno [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design)
  donne des règles précises et directement applicables, pas des adjectifs :
  une interaction fréquente (une palette de commandes ouverte des centaines
  de fois par jour, exactement le cas de celle déjà dans Nodyx) doit
  apparaître net, sans fondu décoratif ; une action réversible réagit dès
  qu'on commence le geste, une action destructrice attend qu'il soit
  terminé ; une animation en cours s'interrompt pour suivre un nouveau
  geste plutôt que de forcer une attente.
- **Steve Schoger** (co-auteur de *Refactoring UI* avec Adam Wathan,
  créateur de Tailwind) : le versant "utile avant beau" de la même
  exigence, des techniques concrètes (contraste, ombres, espacement) sur
  des avant/après réels, pas de la théorie.
- **À éviter comme boussole** : les circuits de récompenses type Awwwards
  couronnent le plus souvent des sites-vitrines expérimentaux (le "Site of
  the Year" en cours est une planète 3D en WebGL), l'exact inverse du
  mandat "utile avant beau" de ce CDC. Bons pour l'audace visuelle, pas
  pour un logiciel qu'on utilise huit heures par jour.

Le diagnostic du "ça fait IA" a lui-même une explication documentée :
un outil d'IA générative converge statistiquement vers la moyenne de ce
qu'il a vu (sidebar + cartes + coins arrondis), pas vers quelque chose de
spécifique au produit. Une interface qui a un vrai parti pris se
reconnaît, et se paierait "30 à 50 % plus cher" qu'un produit qui a l'air
d'un template, selon les mêmes retours d'agences. Notre étalon de sortie
n'est donc pas "est-ce que c'est joli", c'est "est-ce qu'on reconnaîtrait
Nodyx à l'écran sans le logo".

## Ce qu'on a regardé dans leur code réel, pas juste leur discours

Demande de Jonathan : ne pas s'arrêter aux noms et aux essais, aller voir
ce que Rauno et Emil ont concrètement construit et s'en rapprocher. Leurs
sites perso restent volontairement nus (texte, liens, une seule colonne :
la sobriété qu'ils prêchent, appliquée à eux-mêmes en premier), donc le
vrai matériau est dans le CSS source de leurs librairies. Ce sont des
valeurs réelles, extraites de leur code, pas une interprétation :

**Sonner (Emil Kowalski), le vocabulaire d'une notification qui a l'air
faite à la main :**
- Rayons de coin en famille cohérente et petite : `4px` (boutons), `6px`
  (barre de progression), `8px` (le composant lui-même). Jamais un mélange
  arbitraire, une échelle à 3 crans qui se resserre pour les éléments
  imbriqués.
- Une seule formule d'ombre, appliquée partout : `0 4px 12px rgba(0,0,0,.1)`,
  discrète, jamais un `box-shadow` dur.
- Chaque état (succès, info, alerte, erreur) est une famille HSL complète et
  cohérente : fond, texte, bordure, déclinée séparément en clair et en
  sombre, jamais une seule couleur qu'on assombrit approximativement au
  runtime. C'est exactement le principe des tokens `--nx-*` posé plus haut
  dans ce CDC, confirmé par un exemple qui tourne en production sur des
  millions de sites.
- Le mouvement suit la règle de fréquence de Rauno : `400ms` pour
  l'apparition (transform + opacity ensemble, jamais l'un après l'autre),
  `200ms` pour une sortie ou un ajustement fin, `100ms` pour un simple
  changement d'opacité au survol. Rien de plus lent que 500ms nulle part.

**Vaul (aussi Emil Kowalski), le tiroir mobile qui donne l'impression
d'avoir du poids :**
- Une seule courbe d'accélération dans tout le composant :
  `cubic-bezier(0.32, 0.72, 0, 1)`, une décélération franche en fin de
  course plutôt qu'un `ease` générique. C'est cette courbe précise qui
  donne la sensation de poids physique, pas la durée.
- La poignée de tir fait `32px` sur `5px`, mais sa zone cliquable réelle
  est un carré de `44px`, la cible tactile recommandée, invisible mais
  présente. Le geste visible et le geste possible ne sont pas la même
  taille.

**cmdk (Rauno Freiberg), la leçon la plus importante n'est pas visuelle :**
cmdk n'a délibérément AUCUN style par défaut. C'est un composant
"headless" : il gère le clavier, le filtrage, l'accessibilité, et laisse
l'habillage entièrement à qui l'utilise. C'est exactement la séparation
que ce CDC propose pour `--nx-*` : construire le mécanisme (comportement,
structure, accessibilité) indépendamment de l'habillage (les tokens), pour
que changer l'un ne casse jamais l'autre.

## Architecture technique : étendre `--nx-*`, pas le remplacer

`--nx-*` est déjà la couche que l'admin personnalise. On ne crée pas un
quatrième système : on lui ajoute les tokens sémantiques qui lui manquent,
chacun avec une valeur claire ET une valeur sombre :

```
--nx-bg            fond de page
--nx-surface       fond des panneaux (sidebar, cartes, menus)
--nx-surface-raised fond des éléments au-dessus (popovers, modales)
--nx-border         bordures/séparateurs
--nx-text           texte principal
--nx-text-muted     texte secondaire
--nx-text-faint     texte tertiaire (métadonnées, timestamps)
```

(noms indicatifs, à affiner en implémentation ; les accents `--nx-accent-*`
existants ne bougent pas.)

**Le jour/nuit n'est pas un thème séparé, c'est un objectif sur la palette
de l'instance.** Un membre qui bascule en clair doit toujours voir les
couleurs de SA communauté (l'accent choisi par son admin), juste rendues
en clair plutôt qu'en sombre. Mécanique proposée :
- `data-theme="light"` ou `"dark"` sur `<html>`, par défaut résolu depuis
  `prefers-color-scheme`, mémorisé en `localStorage`, aucune surcharge
  serveur nécessaire au premier rendu (pas de flash à corriger après coup).
- Chaque token `--nx-*` a sa définition sous les deux valeurs de
  `data-theme` : jamais une couleur définie une seule fois hors de ces deux
  branches, sinon elle ne bascule pas et casse le mode clair en silence.
- **Pas de bouton permanent dans le header.** Recherché sur ce point
  précis : les sites qui font autorité sur le sujet (Gmail, Facebook,
  Bluesky) rangent le choix de thème dans les réglages, pas dans une icône
  fixe qui mange de la place pour une action rare. Le contrôle vit dans
  `/settings`, à côté des autres préférences déjà là (son, langue). S'il
  s'exprime en deux états plutôt que trois ("système" / "l'inverse du
  système"), c'est plus honnête qu'un choix clair/sombre/système qui
  change le bouton sans que la page ne bouge visiblement pour l'utilisateur.
  Le sombre reste la valeur par défaut à l'installation : environ 80 % des
  gens l'utilisent déjà par préférence système, le clair est l'exception à
  bien traiter, pas le cas central à optimiser.
- L'admin ne choisit PAS séparément un jeu clair et un jeu sombre : il
  choisit un accent et éventuellement une intensité, le clair et le sombre
  en dérivent tous les deux automatiquement (calcul de contraste, pas deux
  configurations à maintenir en double). Détail de calcul à trancher en
  implémentation, pas dans ce CDC.
- `--p-*` (profil membre) et `--n*` (widgets homepage) restent inchangés et
  indépendants. Aucune fusion : ils répondent à un besoin différent
  (personnalisation fine d'un membre sur SA page, ou d'un admin sur UN
  widget), le contenant répond à "quelle identité visuelle pour toute
  l'instance, en clair ou en sombre".

## Responsive et i18n : pas un rattrapage, une contrainte dès le départ

Demande explicite de Jonathan : y penser "au cas où", c'est-à-dire dès la
conception, pas en correctif après coup. Les deux ne sont pas des chantiers
à ouvrir, ce sont des règles déjà en place dans ce projet à ne pas perdre
en route pendant un redesign.

- **i18n** : `feedback_i18n_obligatoire` s'applique ici comme partout
  ailleurs dans Nodyx, sans exception pour "c'est juste un redesign visuel".
  Tout nouveau texte introduit par les composants extraits (`Header.svelte`,
  les sidebars) passe par `tFn('clé')`, ajouté à `fr.json` ET `en.json` dans
  la même PR. Les CI gates existants (`i18n:check`, `i18n:ts:check`) doivent
  rester verts, ils ne se désactivent pas parce que "c'est temporaire, le
  temps de finir le design".
- **Responsive** : le contenant a déjà un traitement mobile distinct
  (`+layout.svelte`, classes `lg:hidden` / `hidden lg:flex` sur le header,
  drawer de sidebar, barre de navigation basse), fruit de plusieurs passes
  de correctifs déjà livrées (v1.0 UI responsive, puis plusieurs correctifs
  ciblés). L'extraction en composants ne doit RIEN régresser de ça : chaque
  composant sorti de `+layout.svelte` emporte son comportement mobile actuel
  avec lui, testé sur les mêmes points de rupture qu'aujourd'hui avant
  d'ajouter le nouveau visuel par-dessus. Les deux principes de la section
  précédente (l'éblouissement ciblé, le repérage par identité de section)
  doivent aussi avoir une version mobile pensée, pas juste survivre en étant
  coupés faute de place.

## Ce que j'ajouterais, à ta place

Jonathan a demandé directement, pas une confirmation de ce qui précède :
ce que moi, Claude, je poserais en plus sur ce CDC. Cinq choses, chacune
parce qu'un manque précis me gênait en le relisant.

**1. Un budget de performance, parce que "doux" a un coût réel.** Ce CDC
parle beaucoup d'ombres, de flou léger, de transitions. Rien nulle part ne
dit que ça doit rester fluide sur le matériel modeste que Nodyx promet de
respecter (`project_promesse_zero_port` : zéro port ouvert, auto-hébergé,
Raspberry Pi cité comme cible réelle plusieurs fois dans ce projet). Un
contenant magnifique qui rame sur le téléphone ou le Pi d'un
auto-hébergeur trahit exactement la promesse que Nodyx tient déjà. Règle
concrète à ajouter : les animations du contenant n'animent que `transform`
et `opacity` (compositing GPU, jamais `box-shadow`/`filter` animés en
boucle), et le rendu est testé sur un appareil réellement modeste, pas
seulement la machine de dev.

**2. L'accessibilité comme contrainte du système de tokens, pas comme
case à cocher après coup.** Un admin va bientôt choisir sa propre teinte
d'accent pour tout son contenant. Rien dans ce CDC n'empêche un admin de
choisir une couleur qui devient illisible une fois dérivée en clair. La
fonction de dérivation clair/sombre déjà prévue doit avoir un plancher de
contraste (WCAG AA minimum, calculé, pas espéré) qu'aucune personnalisation
ne peut franchir, plus des états de focus clavier visibles et cohérents
sur les quatre composants extraits, plus le respect de
`prefers-reduced-motion` pour toutes les transitions "douces" décrites
plus haut. Nodyx a déjà ce réflexe ailleurs (l'effet Matrix du thème
d'instance respecte déjà `prefers-reduced-motion`) : l'étendre au
contenant n'est pas un nouveau chantier, c'est appliquer une règle qui
existe déjà.

**3. Une proposition concrète, pas juste "à explorer", pour un moment
d'éblouissement.** Le CDC en reste à l'intention. En voici une réelle,
à juger et jeter si elle ne plaît pas : le rail d'instances connaît déjà
les instances fédérées de l'annuaire (`networkInstances`, déjà chargé
côté serveur). Un survol ou un clic entre deux instances qui se
connaissent pourrait dessiner un tracé bref et discret entre leurs icônes,
pas un effet gratuit mais la visualisation d'un fait réel : ces instances
se parlent vraiment via le protocole de fédération. C'est le genre de
détail qui vient de ce que Nodyx EST (décentralisé, en réseau) plutôt que
d'une bibliothèque d'animation générique.

**4. Valider sur un usage réel, pas sur un coup d'œil.** "Vérifié sur
vieuxlooters" ne doit pas vouloir dire "je regarde et ça me plaît". Nodyx a
déjà la culture de la recette à deux utilisateurs réels sur d'autres
chantiers (Activités communautaires notamment). Je propose la même chose
ici : deux ou trois membres réels de Vieux Looters, à qui on demande
d'accomplir une tâche ordinaire (rejoindre un canal, retrouver un fil)
dans le nouveau contenant, sans qu'on leur dise ce qui a changé. S'ils
mettent plus de temps qu'avant ou cherchent un bouton disparu, ce n'est
pas beau, c'est un défaut de conception, peu importe à quel point ça
brille.

**5. Un interrupteur d'urgence.** Header et sidebars vivent dans le
fichier le plus consulté du frontend, sur des instances en production
avec de vraies communautés dessus. Nodyx a déjà ce réflexe ailleurs
(`OCTOGUARD_ENABLED`, kill-switch immédiat sans redéploiement). Je
propose la même logique ici : le nouveau contenant reste basculable vers
l'ancien par une variable d'environnement le temps que la confiance
s'installe, retirée une fois le nouveau contenant éprouvé sur toutes les
instances, pas une dette permanente.

## Périmètre de cette première passe

**Ordre corrigé le 19/09.** Jonathan a arrêté une première tentative de
plan qui posait les tokens clair/sombre AVANT tout choix visuel réel :
construire la plomberie d'une bascule jour/nuit pour une identité qui
n'existe pas encore revenait à formaliser en variables réutilisables
partout l'ancien design qu'on vient de démonter dans tout ce CDC. L'ordre
correct part du concret (un header réel, jugeable à l'œil) vers l'abstrait
(le système de tokens qui le généralise), jamais l'inverse.

**Dans le périmètre, dans cet ordre :**
1. **Prototyper le header en vrai**, en sombre uniquement (le mode par
   défaut, 80% des usages), avec de vrais choix assumés : une couleur
   d'accent qui n'est ni violet ni cyan ni indigo-600, une typographie qui
   n'est pas Space Grotesk, la structure de repérage posée plus haut.
   Jonathan regarde et réagit avant que quoi que ce soit soit figé.
   **Garde-fou ajouté le 19/09** : même à ce stade, aucune couleur codée en
   dur. Les valeurs passent déjà par des variables `--nx-*` avec une valeur
   par défaut fixe, jamais par un hex ou une classe Tailwind directe. Ça ne
   coûte rien de plus à écrire, et ça évite une deuxième passe de
   réécriture le jour où l'admin doit pouvoir les changer. Chaque
   fonctionnalité déjà présente dans le header (déclencheur de palette de
   commandes, sélecteur de langue, badges notifications/DM, pastille admin
   conditionnelle au rôle, menu utilisateur avec barre XP/statut/profil/
   déconnexion, fil d'ariane, comportement responsive) doit exister à
   l'identique ou en mieux, jamais en moins, dans le prototype.
2. Une fois la direction validée, extraire header, rail d'instances,
   sidebar de canaux et sidebar de membres de `+layout.svelte` en
   composants séparés (prérequis mécanique : on ne peut pas redessiner
   proprement un bloc de 3000 lignes couplé, mais ça n'a de sens qu'une
   fois qu'on sait CE qu'on extrait).
3. Formaliser les choix visuels validés en tokens sémantiques `--nx-*`
   (clair + sombre) et construire le mécanisme de bascule : le token
   encode une décision déjà prise, il ne la précède jamais.
4. Redessiner rail d'instances, sidebar de canaux et sidebar de membres
   avec la même direction que le header déjà validé.
5. Étendre l'écran de thème d'instance existant (`/admin`, thème déjà
   présent depuis la v2.9) pour piloter les nouveaux tokens, pas en créer
   un nouveau à côté.

**Hors périmètre, explicitement reporté :**
- Les ~89 autres fichiers qui codent leurs couleurs en dur (forum, chat,
  DMs, wiki...) : ils continueront de s'afficher en sombre fixe tant qu'ils
  n'ont pas été migrés, module par module, dans des passes suivantes.
- Toute refonte de `--p-*` ou `--n*`.
- Le calcul exact clair↔sombre à partir d'un seul accent (algorithme de
  contraste) : posé comme principe ici, tranché en implémentation.

## Terrain de test

Chaque lot (prototype du header, puis extraction, puis tokens, puis
sidebars) est déployé et vérifié sur `vieuxlooters.nodyx.org` (checkout
séparé, `/opt/vieuxlooters`) avant `nodyx.org`. Décision de Jonathan le
18/09.

## Critères de sortie

- Header et sidebars sont des composants Svelte séparés, testables
  indépendamment, plus un seul fichier de 3000 lignes.
- Bascule clair/sombre fonctionnelle sur le contenant, persistée, sans
  flash au chargement, chaque instance gardant sa propre identité de
  couleur dans les deux modes.
- Zéro dégradé de texte, zéro couleur codée en dur dans les quatre
  composants du contenant : tout passe par `--nx-*`.
- Un admin qui a déjà personnalisé son accent (thème d'instance v2.9) voit
  ce même accent appliqué au nouveau contenant sans reconfiguration.
- Validé visuellement sur vieuxlooters avant tout déploiement sur
  nodyx.org.
- Les CI gates i18n restent vertes, aucune chaîne en dur ajoutée par les
  nouveaux composants.
- Comportement mobile (drawer, barre basse, points de rupture) testé et
  au moins équivalent à l'existant sur les quatre composants extraits.
- Chaque fonctionnalité du header et des sidebars actuels (palette de
  commandes, langue, notifications, DM, admin, menu utilisateur, fil
  d'ariane...) fonctionne à l'identique ou en mieux après migration,
  vérifié une par une, pas juste "ça a l'air pareil".
