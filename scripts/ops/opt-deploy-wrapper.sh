#!/usr/bin/env bash
# ─── Lanceur à installer en /opt/deploy-all.sh ───────────────────────────────
#
#   sudo install -m 755 scripts/ops/opt-deploy-wrapper.sh /opt/deploy-all.sh
#
# Pourquoi un lanceur séparé plutôt qu'un lien symbolique vers le dépôt :
# bash lit un script au fur et à mesure de son exécution. Si le fichier en
# cours d'exécution est réécrit par un `git pull` qu'il lance lui-même, la
# suite est lue dans le nouveau contenu, à un décalage arbitraire. Ce lanceur
# vit HORS du dépôt, fait le pull, puis passe la main par `exec` : le script
# métier est donc lu une seule fois, déjà à jour.
set -euo pipefail

REPO=/var/www/nexus
git config --global --add safe.directory "$REPO" 2>/dev/null || true

cd "$REPO"
git pull --ff-only

exec bash "$REPO/scripts/deploy-all.sh" "$@"
