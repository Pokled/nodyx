#!/usr/bin/env bash
# Reconstruit le frontend de nodyx.org après une fusion de traductions (appelé par
# .github/workflows/i18n-deploy.yml) SANS toucher au dossier servi tant que la
# nouvelle version n'est pas prête. Même méthode que scripts/deploy-all.sh (#1066) :
#
#   - dépendances réinstallées seulement si package-lock.json ou la version de node
#     changent (même empreinte node_modules/.nodyx-deps que deploy-all : les deux
#     outils s'accordent, aucun ne refait le travail de l'autre) ;
#   - construction dans .builds/<date>-<commit>, à côté de build ;
#   - construction en échec ou incomplète : le site garde sa version, sortie en erreur ;
#   - sinon build devient un lien vers la nouvelle version, puis redémarrage.
#
# Avant (21/11) : `npm ci` vidait les dépendances du site en marche à chaque fois,
# puis `npm run build` écrivait dans le dossier servi (site en erreur pendant la
# construction) et remplaçait le lien build par un vrai dossier.
#
#   bash scripts/ops/i18n-deploy.sh [dossier-du-frontend]
#   NODYX_RESTART_CMD : la commande de redémarrage (le banc la remplace).
set -euo pipefail

dir="${1:-/var/www/nexus/nodyx-frontend}"
restart="${NODYX_RESTART_CMD:-sudo -u nodyx PM2_HOME=/home/nodyx/.pm2 pm2 restart nodyx-frontend --update-env}"
cd "$dir"

echo "── dépendances ──"
sum="$(cat package-lock.json; node -v)"
sum="$(printf '%s' "$sum" | sha256sum | cut -c1-64)"
if [ -d node_modules ] && [ "$(cat node_modules/.nodyx-deps 2>/dev/null)" = "$sum" ]; then
  echo "dépendances inchangées, npm ci évité"
else
  npm ci --no-audit --no-fund
  printf '%s' "$sum" > node_modules/.nodyx-deps
fi

commit="$(git -c safe.directory="$(dirname "$PWD")" rev-parse --short HEAD 2>/dev/null || echo local)"
rel=".builds/$(date +%Y%m%d-%H%M%S)-$commit"
echo "── construction à côté : $rel ──"
if ! NODYX_BUILD_OUT="$rel" npm run build || [ ! -f "$rel/index.js" ]; then
  rm -rf "${rel:?}"
  echo "✘ construction en échec : le site garde sa version actuelle" >&2
  exit 1
fi

echo "── bascule ──"
if [ -d build ] && [ ! -L build ]; then mv build ".builds/avant-liens-$(date +%Y%m%d-%H%M%S)"; fi
ln -sfn "$rel" build.next && mv -T build.next build
# On garde les trois versions les plus récentes : la neuve, celle qui tourne encore
# jusqu'au redémarrage, et une de secours.
ls -1dt .builds/*/ | tail -n +4 | xargs -r rm -rf

echo "── redémarrage ──"
bash -c "$restart"
echo "✔ nodyx.org sert $rel"
