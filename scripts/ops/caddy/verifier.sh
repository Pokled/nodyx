#!/usr/bin/env bash
# Dit si le domaine va bien, en comparant a un releve pris AVANT la modification.
#
# On ne verifie pas que tout repond 200 : `code.nodyx.org` redirige vers une
# authentification, un hote peut legitimement repondre 302 ou 401. Comparer a
# l'etat d'avant est la seule mesure qui distingue « c'etait deja comme ca » de
# « je viens de le casser ».
#
#   verifier.sh --releve   enregistre l'etat courant comme reference
#   verifier.sh            compare l'etat courant a la reference
set -euo pipefail

REF="${REF:-/var/backups/nodyx/caddy/releve.txt}"
MODE="${1:-}"

HOTES=(
  nodyx.org
  nodyx.dev
  olympus.nodyx.org
  demo.nodyx.org
  sleemstudio.nodyx.org
  vieuxlooters.nodyx.org
  start.nodyx.org
  library.nodyx.org
  extensions.nodyx.org
  code.nodyx.org
  signet.nodyx.org
  nexusnode.app
)

mesurer() {
  for h in "${HOTES[@]}"; do
    code=$(curl -s -o /dev/null -w '%{http_code}' -m 12 "https://$h/" 2>/dev/null || echo 000)
    echo "https  $h $code"
  done
  # Le relais historique : une instance tunnelisee sur trois continents en depend.
  for p in 7443 7001 3478; do
    if timeout 5 bash -c "</dev/tcp/127.0.0.1/$p" 2>/dev/null; then
      echo "port   127.0.0.1:$p ouvert"
    else
      echo "port   127.0.0.1:$p FERME"
    fi
  done
  # L'API d'administration : sans elle, plus aucun retour arriere n'est possible.
  if curl -sf -o /dev/null -m 8 "${CADDY_API:-http://localhost:2019}/config/"; then
    echo "admin  localhost:2019 repond"
  else
    echo "admin  localhost:2019 MUET"
  fi
}

if [ "$MODE" = "--releve" ]; then
  mkdir -p "$(dirname "$REF")"
  mesurer > "$REF"
  echo "Releve de reference ecrit dans $REF :"
  sed 's/^/  /' "$REF"
  exit 0
fi

if [ ! -f "$REF" ]; then
  echo "Aucun releve de reference. Lancez d'abord : $0 --releve" >&2
  exit 1
fi

MAINTENANT=$(mktemp)
mesurer > "$MAINTENANT"

ECARTS=0
while read -r type cible avant; do
  apres=$(awk -v c="$cible" '$2==c {print $3}' "$MAINTENANT")
  if [ "$avant" = "$apres" ]; then
    printf '  ok        %-28s %s\n' "$cible" "$apres"
  else
    printf '  ECART     %-28s %s -> %s\n' "$cible" "$avant" "$apres"
    ECARTS=$((ECARTS+1))
  fi
done < "$REF"
rm -f "$MAINTENANT"

echo
if [ "$ECARTS" -eq 0 ]; then
  echo "VERDICT : rien n'a bouge ($(wc -l < "$REF") controles)"
  exit 0
fi
echo "VERDICT : $ECARTS ECART(S) - faire machine arriere :"
echo "  $(dirname "$0")/annuler-route-tunnel.sh"
exit 1
