# Page d'accueil : une grille, deux polarités

Cahier des charges, 29/10/2026. Statut : **D1, D2, D4 tranchées par Jonathan le 29/10** (voir §5) ;
D3, D5, D6 ouvertes.
Suite du chantier « continuité thème clair/sombre » (feed, membres, forum, wiki, agenda, tâches
migrés le 29/10, PR #859 à #896) et de `SPECS/NODYX_APPARENCE_CDC.md`.

## 1. La demande

> « La personnalisation de la page d'accueil va être importante. Il faudrait la doter d'une
> inversion de contraste. Rien que le grid builder (thème) et la perso à la volée : va falloir
> vachement réfléchir. » (Jonathan, 29/10)

Toutes les pages migrées suivent le thème clair/sombre du visiteur et les réglages de
l'Apparence. L'accueil, lui, est **dessiné par l'admin**, dans une seule polarité. Le visiteur qui
bascule de thème doit retrouver la même page, lisible, avec la même identité.

## 2. État des lieux (mesuré le 29/10)

### 2.1 Six sources de couleur empilées

| # | Source | Où | Réglée par |
|---|---|---|---|
| 1 | Thème de la grille (`GridTheme` : fond, cartes, bordures, textes, accents, ombre) | `homepage_grid.theme`, variables `--n*` posées par `GridRenderer` | l'admin, onglet Thème du Grid Builder (avec préréglages) |
| 2 | « Suivre l'ambiance » (`follow_ambiance`) | `ambiancePalette()` dans `lib/shellTheme.ts` | l'écran Apparence |
| 3 | Fond propre à une rangée (`row.bg_override`) | `GridRenderer.svelte` | l'admin, par rangée |
| 4 | Couleurs choisies dans un widget : bannière d'annonce (`color`), vitrine d'articles et Twitch (`accent_color`), voile du bandeau (`overlay_opacity`) | `plugins/*.ts`, `widgetSchemas.ts` | l'admin, par widget |
| 5 | Couleurs codées en dur dans les 10 widgets intégrés : environ 250 (texte sur image, dégradés, couleurs de marque des réseaux) et 25 dans `GridRenderer` (outils d'édition) | `homepage/widgets/*.svelte` | personne |
| 6 | Widgets d'extensions tierces (iframe isolée) | `ExtensionSurface` | l'extension |

### 2.2 Les grilles réelles ne sont pas toutes conçues dans la même polarité

| Instance | Fond de grille | Texte principal | Polarité conçue |
|---|---|---|---|
| nodyx.org | `#05050a` | clair | sombre |
| demo | `#05050a` | clair | sombre |
| sleemstudio | `#080d09` | `#eafff0` | sombre (vert) |
| vieuxlooters | `#e6e6e6` | sombre | **claire** |

Captures du 29/10, haut et bas, clair et sombre :
- nodyx.org en thème clair : l'accueil reste **entièrement sombre**, identique au mode sombre.
- vieuxlooters en thème clair : sa feuille réglée à 49 % laisse passer le papier peint rose, et le
  sous-titre « Notre roster du moment » devient presque invisible. En thème sombre, sa grille claire
  se retrouve posée sur une feuille sombre.

### 2.3 Défauts déjà présents

- **D-a. La grille masque les réglages de zone de l'Apparence.** `.gr-root` peint `var(--nb)`
  opaque par-dessus `main` : image de feuille masquée, opacité doublée. C'est le défaut corrigé
  par #895 pour les autres pages. `/` n'est pas dans `SHEET_THEMED`.
- **D-b. « Suivre l'ambiance » est sombre dans les deux modes.** `ambiancePalette()` appelle
  `deriveShellVars(…, true)`. Volontaire à l'époque (la feuille restait sombre), plus maintenant.
- **D-c. Les extensions de l'accueil ne reçoivent aucun thème.** `ExtensionSurface` est appelé
  sans `theme` (objet vide) : un widget tiers ignore l'accent, et ignore le mode.

## 3. Principe : une grille, deux polarités

L'admin dessine sa grille **une fois**, dans la polarité de son choix. Nodyx en déduit la
contrepartie pour l'autre mode, par **inversion de contraste** : on retourne la luminosité de
chaque couleur en gardant sa teinte et sa saturation. Le rose reste rose, le vert reste vert,
le fond sombre devient clair et le texte clair devient foncé.

```
polarité conçue P  (déduite du fond et du texte de la grille)
mode du visiteur M (thème clair/sombre)
M = P  -> la grille telle que dessinée
M != P -> la contre-palette, calculée (et retouchable par l'admin, D3)
```

### 3.1 Ce qui s'inverse, ce qui ne s'inverse jamais

| S'inverse | Ne s'inverse jamais |
|---|---|
| fond, cartes, bordures, textes principal et secondaire de la grille | les images (bannière, couvertures, avatars) |
| fond de rangée (`bg_override`) | le texte **posé sur une image** : toujours en jetons sombres (`.nx-on-dark`, introduit par #896) |
| couleurs de texte choisies dans un widget | les couleurs de marque (Discord, Twitch, GitHub…) |
| | l'ombre (une ombre reste sombre, son intensité baisse en clair) |

Les **accents** (principal, accent, liens) ne s'inversent pas : ils gardent leur teinte et ne sont
ajustés en luminosité que si nécessaire pour atteindre 4,5:1 sur le nouveau fond (`ensureContrast`
existe déjà dans `lib/shellTheme.ts`).

### 3.2 L'algorithme (proposition)

Pour chaque couleur de la palette, en OKLCH (`rgbToOklch` / `oklchToHex` existent déjà) :

1. **Neutres et quasi-neutres** (fonds, textes, bordures) : luminosité inversée, chroma et teinte
   conservés. Pas un simple `L' = 1 - L` : il donnait `#05050a` -> `#d7d7e1` (gris terne) et
   `#e6e6e6` -> `#010101` (noir absolu). Un fond d'interface sombre tourne autour de L = 0,15, un
   clair autour de 0,97 : la courbe **échange ces repères** (affine par morceaux par (0 ; 1),
   (0,15 ; 0,97), (0,97 ; 0,15), (1 ; 0)), et reste une involution exacte. Implémenté en P1
   (`invertLightness`).
2. **Couleurs translucides** (`rgba(255,255,255,.03)` en carte, `rgba(255,255,255,.08)` en
   bordure) : un voile clair sur fond sombre devient un voile sombre de même opacité sur fond clair.
3. **Accents** : teinte et chroma conservés, luminosité ajustée seulement si le contraste sur le
   nouveau fond tombe sous 4,5:1 (texte) ou 3:1 (bordure, élément graphique).
4. **Garde-fous mesurés, pas supposés** : après inversion, texte principal >= 7:1, texte secondaire
   >= 4,5:1, accent >= 4,5:1 sur le fond et sur les cartes. Une couleur qui échoue est corrigée par
   `ensureContrast`, jamais laissée telle quelle.
5. **Stable** : inverser deux fois redonne la palette d'origine (3/255 par canal au plus pour les
   neutres, testé). Limite connue : un vert très saturé n'existe pas en très sombre (gamut sRGB), sa
   saturation est rognée à l'aller ; sans effet visible sur un voile à 5 %.

Le calcul est **pur** (`lib/gridPolarity.ts`), fait côté client et côté SSR, sans aller-retour
serveur : basculer de thème est instantané.

### 3.3 La feuille et les réglages de zone

L'accueil rejoint `SHEET_THEMED`. Quand la grille **suit l'ambiance** ou n'a pas de fond propre, son
fond est **transparent** : la feuille et ses réglages de zone (opacité, image, flou) restent
visibles, comme sur les autres pages. Quand l'admin a donné un fond propre à sa grille, deux
lectures sont possibles : voir D2.

### 3.4 « Suivre l'ambiance » dans les deux modes

`ambiancePalette(theme, dark)` prend le mode en paramètre et renvoie la palette claire en thème
clair. La grille qui suit l'ambiance n'a alors rien à inverser : l'ambiance fournit déjà les deux
polarités.

### 3.5 Extensions tierces

L'hôte transmet au widget, à l'initialisation, le mode (`light` / `dark`) et les jetons de la
grille déjà résolus pour ce mode, puis un message de mise à jour quand le visiteur bascule de
thème. L'extension choisit d'en tenir compte : rien ne change pour une extension qui l'ignore.
Point d'attention : c'est une évolution du contrat du SDK, donc à versionner.

### 3.6 Dans le Grid Builder

- **Aperçu double** : la grille rendue côte à côte en clair et en sombre (ou un interrupteur
  d'aperçu), pour que l'admin voie ce que verront ses visiteurs dans l'autre mode.
- **Interrupteur « Adapter au thème du visiteur »** (inversion automatique), voir D1.
- **« Retoucher la version claire / sombre »** : l'admin peut corriger à la main une couleur de la
  contre-palette calculée, voir D3. Stockée à part (`theme.inverse`), jamais à la place de sa grille.

## 4. Phasage

| Phase | Contenu | Risque |
|---|---|---|
| P1 | `lib/gridPolarity.ts` : détection de polarité, inversion, garde-fous de contraste. Tests sur les palettes réelles des 4 instances et sur tous les préréglages. **Fait le 29/10 (34 tests).** | nul (fonction pure, rien n'est branché) |
| P2 | `GridRenderer` : palette selon le mode, fond transparent (D-a), `/` dans `SHEET_THEMED`, rangées. `ambiancePalette` dans les deux modes (D-b). | moyen : touche l'accueil de toutes les instances |
| P3 | Les 10 widgets : couleurs en dur sur les variables `--n*`, texte sur image en `.nx-on-dark`, couleurs de widget passées par l'inversion. | moyen |
| P4 | Grid Builder : aperçu double, interrupteur, retouche de la contre-palette. | faible |
| P5 | SDK : mode et jetons transmis aux extensions, message de bascule (D-c). | contrat public |

Chaque phase est une PR, vérifiée sur les 4 instances × 2 modes : recette-pages.mjs (feuille
thémée, rien d'opaque qui masque la feuille, captures en haut et en bas), et **contraste mesuré**
du texte de chaque widget sur son fond réel (pas seulement à l'œil).

## 5. Décisions

Tranchées le 29/10 : **D1 = toutes les grilles, existantes comprises. D2 = fond de grille avec
l'opacité de la feuille. D4 = visiteur d'abord (P1, P2, P3, puis P4, P5).**

- **D1. Inversion automatique activée par défaut ?** Proposition : oui pour toute grille, y compris
  existante. Aujourd'hui, une grille sombre affichée en thème clair est déjà « fausse » (la page reste
  noire au milieu d'un site clair) : l'inversion corrige plus qu'elle ne change. Alternative prudente :
  activée par défaut seulement pour une grille neuve, comme `follow_ambiance` (D6 du CDC Apparence).
- **D2. Une grille avec un fond propre masque-t-elle la feuille ?** Proposition : non. Le fond de
  la grille est appliqué **avec l'opacité de la feuille**, pour que l'effet verre et l'image de zone
  restent visibles. Alternative : la grille gagne (son fond opaque masque la feuille), et le Grid
  Builder le signale.
- **D3. Retouche manuelle de la contre-palette** : dès la P4, ou plus tard ?
- **D4. Ordre** : P1 à P3 d'abord (le visiteur voit le résultat), le Grid Builder ensuite ?
- **D5. Couleurs de marque des réseaux sociaux** : fixes dans les deux modes (proposition), ou
  monochromes en thème clair ?
- **D6. Extensions (P5)** : maintenant, ou au prochain chantier SDK ?
