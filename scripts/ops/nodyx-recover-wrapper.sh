#!/usr/bin/env bash
# ─── Lanceur global : sudo nodyx-recover [--list|--reset X|--promote X] ───────
#
#   sudo install -m 755 scripts/ops/nodyx-recover-wrapper.sh /usr/local/bin/nodyx-recover
#
# Reprendre la main sur une instance quand tout est perdu (mot de passe + email).
# Le point d'ancrage de confiance = l'accès à cette machine. Aucune auth en ligne.
#
# Par défaut : instance principale (/var/www/nexus). Pour une autre instance :
#   NODYX_DIR=/opt/sleemstudio sudo -E nodyx-recover
set -euo pipefail
DIR="${NODYX_DIR:-/var/www/nexus}/nodyx-core"
[ -d "$DIR" ] || { echo "Instance introuvable : $DIR" >&2; exit 1; }
cd "$DIR"
exec npm run --silent recover -- "$@"
