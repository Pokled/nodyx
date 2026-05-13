# Release process — Nodyx

Source unique de vérité : le fichier **`VERSION`** à la racine du repo. Tout le reste (les 2 `package.json`, le code TS via `nodyx-core/src/utils/version.ts`, les installeurs `install.sh` et `install_tunnel.sh`, le `nodyx-update` généré) le lit ou s'y synchronise.

## Pour releaser

```bash
# 1. Sync les 3 fichiers de version
./scripts/bump-version.sh 2.6.0

# 2. (Optionnel) Éditer CHANGELOG.md pour décrire la release
$EDITOR CHANGELOG.md

# 3. Commit + tag + push
git commit -am "chore(release): bump v2.6.0"
git tag v2.6.0
git push --follow-tags
```

## Pourquoi cette discipline

Avant v2.5.0, 5 sources de vérité de version coexistaient et dérivaient les unes des autres : `package.json` (2.1.0), hardcode `install.sh` (2.2.0), hardcode `install_tunnel.sh` (1.1.0), fallback dans le code TS (`'1.8.0'`), et `NODYX_VERSION` du `.env` figé à l'install initiale (1.8.1 en prod nodyx.org). Les users voyaient "Mise à jour disponible v1.8.1 → v2.4.0" alors que leur instance tournait déjà v2.4. Voir le commit `134f692` pour le détail.

## Ce que le script fait

`scripts/bump-version.sh X.Y.Z` :
1. Valide le format semver
2. Écrit `VERSION` (1 ligne)
3. Met à jour `nodyx-core/package.json` et `nodyx-frontend/package.json`
4. Si `CHANGELOG.md` a une section `[Unreleased]`, insère une entrée `[X.Y.Z] — YYYY-MM-DD` dessous (à compléter manuellement)
5. Affiche un récap + les commandes à lancer ensuite

## Ce que le script NE fait PAS

- Pas de `git commit` automatique (volontaire — on veut une revue manuelle de la diff)
- Pas de `git tag` automatique (idem)
- Pas de `git push` automatique
- Pas de mise à jour de la prod (deploy manuel)

## Comportement runtime côté code

`nodyx-core/src/utils/version.ts` lit `VERSION` au boot via `fs.readFileSync`. Fallback `package.json` puis `'unknown'`. Aucune lecture de `process.env.NODYX_VERSION` — la ligne du `.env` reste pour les outils externes uniquement.

## Comportement runtime côté installeurs

`install.sh` et `install_tunnel.sh` résolvent la version cible en cascade :
1. Fichier `VERSION` à côté du script (mode `bash install.sh` après `git clone`)
2. `https://raw.githubusercontent.com/Pokled/Nodyx/main/VERSION` (mode `curl | bash`)
3. GitHub API `releases/latest` `tag_name` (fallback si raw down ou pas de VERSION sur main)
4. `"unknown"` (échec total, l'installeur continue mais dégradé)

Après `git clone`, `install.sh` re-vérifie avec `VERSION` du repo cloné, qui prend la priorité absolue (garantit cohérence avec ce que le code lira au boot).
