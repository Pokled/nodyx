#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Compilation « à côté » pour les mises à jour (04/10/2026).
#
#  Avant, `install.sh --upgrade` tuait tout processus sur les ports 3000/4173
#  (fuser -k), PUIS réinstallait les dépendances et compilait dans le dossier
#  servi : pendant ce temps le site répondait des erreurs 500, et une
#  compilation ratée le laissait à terre.
#
#  Désormais chaque application est compilée dans un dossier de travail, avec
#  ses propres dépendances, pendant que l'ancienne version continue de servir.
#  On ne bascule qu'une fois TOUT compilé ; un échec ne touche à rien.
#  Chargé par install.sh et install_tunnel.sh (mise à jour), testé par
#  scripts/tests/install-update.test.sh.
# ═══════════════════════════════════════════════════════════════════════════════

# nodyx_build_aside <dossier de l'appli> <sortie : dist|build> <dossier de travail>
# Copie la source (sans node_modules, ancienne sortie ni données vivantes), installe les
# dépendances et compile DANS le dossier de travail. L'appli en service n'est
# pas touchée. Code 0 seulement si la sortie ET les dépendances existent.
nodyx_build_aside() {
  local app="$1" out="$2" work="$3"
  [[ -d "$app" && -n "$out" && -n "$work" ]] || return 2
  mkdir -p "$work" || return 1
  # Jamais les données vivantes : uploads/ et backups/ du core pèsent des
  # gigaoctets (1,1 Go sur nodyx.org) et n'ont rien à faire dans une compilation.
  tar -C "$app" --exclude=./node_modules --exclude="./$out" --exclude=./.svelte-kit \
      --exclude=./uploads --exclude=./backups --exclude=./test-results --exclude=./playwright \
      -cf - . \
    | tar -C "$work" -xf - || return 1
  ( cd "$work" && npm ci --no-fund --no-audit --silent && npm run build ) || return 1
  [[ -d "$work/$out" && -d "$work/node_modules" ]]
}

# nodyx_swap_outputs <dossier de l'appli> <sortie> <dossier de travail>
# Remplace la sortie et node_modules de l'appli par ceux du dossier de travail
# (mv : même système de fichiers, instantané). Les anciens sont rangés dans le
# dossier de travail (<nom>.precedent). Tout ou rien : si un déplacement
# échoue, ce qui a déjà basculé est remis en place.
nodyx_swap_outputs() {
  local app="$1" out="$2" work="$3" d
  [[ -d "$app" && -n "$out" && -d "$work" ]] || return 2
  [[ -d "$work/node_modules" && -d "$work/$out" ]] || return 1
  for d in node_modules "$out"; do
    if [[ -e "$app/$d" ]] && ! mv "$app/$d" "$work/$d.precedent"; then
      nodyx_swap_back "$app" "$out" "$work"; return 1
    fi
    if ! mv "$work/$d" "$app/$d"; then
      nodyx_swap_back "$app" "$out" "$work"; return 1
    fi
  done
}

# nodyx_swap_back <dossier de l'appli> <sortie> <dossier de travail>
# Annule nodyx_swap_outputs : remet en place les <nom>.precedent.
nodyx_swap_back() {
  local app="$1" out="$2" work="$3" d
  for d in node_modules "$out"; do
    [[ -e "$work/$d.precedent" ]] || continue
    if [[ -e "$app/$d" ]]; then rm -rf "$work/$d.rejete"; mv "$app/$d" "$work/$d.rejete" || return 1; fi
    mv "$work/$d.precedent" "$app/$d" || return 1
  done
}

# nodyx_work_dir <dossier nodyx> <nom> : un dossier de travail sur le MÊME
# système de fichiers que l'installation (mv instantané), hors du dépôt git.
nodyx_work_dir() {
  mktemp -d "$(dirname "$1")/.nodyx-maj-$2.XXXXXX"
}

# nodyx_purge_stale_work <dossier nodyx> : efface les dossiers de travail laissés
# par une mise à jour interrompue (Ctrl-C, coupure SSH) : des centaines de Mo et
# une copie des .env. À appeler SOUS le verrou de mise à jour seulement.
nodyx_purge_stale_work() {
  local d
  for d in "$(dirname "$1")"/.nodyx-maj-core.* "$(dirname "$1")"/.nodyx-maj-frontend.*; do
    [[ -d "$d" ]] && rm -rf -- "$d"
  done
  return 0
}
