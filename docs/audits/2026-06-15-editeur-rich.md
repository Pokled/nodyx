# Audit de l'éditeur riche Nodyx

Date : 2026-06-15
Périmètre : NodyxEditor (TipTap/ProseMirror) + cycle édition / sauvegarde / sanitizer / réédition / rendu public.
Objectif : trouver les vraies causes, pas poser des pansements. Établir une base saine.

---

## 1. Résumé exécutif

La majorité des "contenus qui disparaissent à la réédition" (vidéos, colonnes, et probablement le code) viennent d'**une seule cause racine** :

> Les blocs personnalisés de l'éditeur s'identifient au rechargement via des attributs `data-*`, mais le sanitizer backend ne conserve sur un `<div>` que `class` (+ `data-align`, `data-type`). Les marqueurs `data-*` sont donc supprimés à la sauvegarde, et l'éditeur ne reconnaît plus ses propres blocs quand il reparse le HTML stocké. Leur contenu est alors aplati ou perdu.

Le rendu public, lui, repose sur les **classes CSS** (qui survivent), d'où l'asymétrie trompeuse : **« ça s'affiche bien une fois publié, mais ça casse dès qu'on réédite »**.

Un deuxième problème, indépendant, est un **manque de modèle d'interaction** sur les blocs (impossible de sélectionner / éditer / régénérer / supprimer proprement un sommaire, une vidéo, une image).

---

## 2. Le cycle de vie du contenu

```
[Éditeur ProseMirror]
   │  getHTML()  (sérialise les nœuds → HTML)
   ▼
[<input hidden name="content">]
   │  POST  ?/editPost | ?/reply
   ▼
[Backend  sanitize()  (forums.ts)]   ← filtre balises + attributs
   │
   ▼
[PostgreSQL]
   │  GET thread → post.content
   ▼
[initialContent → new Editor({ content })]
   │  ProseMirror.parse(HTML)        ← REPARSE : le point de rupture
   ▼
[Édition] → onUpdate → getHTML → (reboucle)

Rendu public :  {@html post.content}  dans  <div class="nodyx-prose">
```

Détail mécanique important : `new Editor({ content })` **ne déclenche pas** `onUpdate`. Donc tant que l'auteur n'a rien tapé, le champ caché contient encore le HTML d'origine intact. **Mais à la première frappe**, `onUpdate` pose `html = getHTML()` (la version déjà aplatie par le parse). C'est à ce moment que les dégâts sont gravés en base. D'où le « parfois » : tout dépend de si l'auteur a touché la zone abîmée.

---

## 3. Cause racine #1 (MAJEURE) — parse sur marqueurs volatils

Audit nœud par nœud, vérifié par aller-retour réel à travers le sanitizer :

| Nœud | parseHTML actuel | Marqueur conservé par le sanitizer ? | État |
|---|---|---|---|
| `nodyxTwoCols` | `div[data-two-cols]` | NON — `data-two-cols` supprimé | **CASSÉ** |
| `nodyxColumn` | `div[data-col]` | NON — `data-col` supprimé | **CASSÉ** |
| `youtube` | `div[data-youtube-video] iframe` | NON — `data-youtube-video` supprimé | **Corrigé** (fallback iframe nu, PR #87) |
| `tocBox` | `div.toc` | OUI — `class` conservé | OK |
| `nodyxAudio` | `nodyx-audio-player` | OUI — balise + attrs whitelistés | OK |
| `nodyxTrack` | `nodyx-track[src]` | OUI | OK |
| `image` | `img[src]` + `data-align` | OUI — `class`, `data-align` conservés | OK |
| headings `id` | `id` sur h2/h3/h4 | OUI | OK |
| `codeBlockLowlight` | `pre` / `code` | OUI — aller-retour prouvé propre | OK côté sanitizer |

Preuve (contenu relu après sanitizer) :
```
<div class="nodyx-two-cols"><div class="nodyx-col">…   ← data-two-cols / data-col DISPARUS
<div><iframe src="…/embed/…">…</iframe></div>          ← data-youtube-video DISPARU
<pre><code class="language-javascript">const x = 1;</code></pre>   ← code INTACT
```

### Le principe de correction (la base saine)

> **Un nœud de bloc doit parser sur le marqueur qui survit à l'aller-retour, c'est-à-dire sa CLASSE CSS** (toujours préservée par le sanitizer), jamais sur un attribut `data-*` volatil.

Application :
- `nodyxTwoCols` → parseHTML `div.nodyx-two-cols`
- `nodyxColumn` → parseHTML `div.nodyx-col`
- `youtube` → déjà fait (reparse l'iframe nu)
- garder ce principe pour tout futur nœud de bloc.

Aucune modification du backend (SANCTUAIRE) nécessaire. La correction backend (autoriser les `data-*`) serait plus fragile : chaque nouveau nœud imposerait une mise à jour du sanitizer.

---

## 4. #4 « le texte en code disparaît » — très probablement collatéral de #1

Le sanitizer est **prouvé innocent** : code inline, bloc de code, langage connu, langage inconnu, sans langage — tout survit intact à l'aller-retour.

Hypothèse forte : quand un bloc structurel adjacent (colonnes, vidéo) échoue au reparse et se fait aplatir, la **récupération de ProseMirror** peut emporter ou fusionner le contenu voisin, dont un bloc de code. Corriger #1 devrait résoudre l'essentiel des cas « parfois ». À confirmer avec une repro précise (code inline ou bloc ? à la réouverture ou en tapant ?).

---

## 5. Cause racine #2 — pas de modèle d'interaction sur les blocs

Les blocs structurels (sommaire, vidéo, image, colonnes, audio) n'ont aucune affordance : impossible de les sélectionner comme une unité, de les éditer, de les régénérer, de les supprimer d'un geste clair. Tout se fait au clavier à l'aveugle (backspace hasardeux), d'où la fragilité ressentie.

Les étiquettes de « scaffolding » ajoutées en première intention étaient **cosmétiques** : elles nomment le bloc sans donner de quoi agir dessus. À remplacer par une vraie **barre de contrôle contextuelle** (modèle Notion / Google Docs) :

- Sommaire : Régénérer (reconstruire depuis les titres actuels) + Supprimer
- Vidéo / Image : Remplacer + Supprimer (+ plus tard, poignées de redimensionnement sur l'image)
- Colonnes / Audio : Supprimer, etc.

---

## 6. Observations mineures

- L'image stocke des classes Tailwind (`float-left mr-4`…) dans `class` en plus de `data-align`. Le rendu public s'appuie sur `data-align` ; ces classes Tailwind sont probablement purgées du bundle public (classes mortes). Redondance à nettoyer un jour.
- `TextAlign` est configuré sur `image` : doublon potentiel avec l'attribut `data-align` propre à l'image.
- La protection « contenu gravé à la première frappe » (section 2) signifie qu'un correctif du reparse profite immédiatement, sans migration de données : les contenus stockés sont sains, c'est leur relecture qui était cassée.

---

## 7. Plan de reconstruction (ordonné)

**Phase 1 — Robustesse du round-trip (la base, faible risque)**
- Parser tous les nœuds de bloc sur leur classe (`nodyxTwoCols`, `nodyxColumn`). YouTube déjà fait.
- Documenter le principe « parse sur ce qui survit au sanitizer » dans le composant.
- Ajouter un test de non-régression (fixture HTML sanitizée → parse → getHTML stable).

**Phase 2 — Modèle d'interaction des blocs**
- Barre de contrôle contextuelle au survol / à la sélection d'un bloc.
- Retirer les étiquettes nues du scaffolding (les fondre dans la barre).

**Phase 3 — Redimensionnement d'image** (poignées de scale), après le modèle d'interaction.

**Phase 4 — #4 code** : confirmer le résiduel avec une repro après Phase 1.

---

## 8. Déjà livré (PR #87)

- Remplacement d'image réel (capture de la sélection à l'ouverture du menu).
- YouTube robuste au round-trip (reparse de l'iframe nu).
- `tocBox` étanche (`content: paragraph+`, plus d'aspiration d'image).
- Scaffolding visuel (à retravailler en Phase 2).
