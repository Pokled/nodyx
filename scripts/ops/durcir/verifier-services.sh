#!/usr/bin/env bash
# Les services répondent-ils encore, vraiment ?
#
# Ce contrôle existe pour accompagner un changement d'adresse d'écoute. Regarder
# `ss` ne suffirait pas : un service peut écouter au bon endroit et n'être plus
# joignable par Caddy, ou répondre sur la page d'accueil pendant que son API est
# morte. On sonde donc ce que les visiteurs utilisent réellement.
#
#   verifier-services.sh --releve   enregistre l'état courant comme référence
#   verifier-services.sh            compare l'état courant à la référence
#
# La comparaison porte UNIQUEMENT sur les sondes fonctionnelles. Les adresses
# d'écoute sont affichées pour mémoire, jamais comparées : les changer est
# précisément le but, et les voir bouger n'est pas une panne.
set -euo pipefail

REF="${REF:-/var/backups/nodyx/durcir/releve-services.txt}"
MODE="${1:-}"

# hôte public                     chemin d'API testé
SITES=(
  "nodyx.org|/api/v1/instance/info"
  "demo.nodyx.org|/api/v1/instance/info"
  "sleemstudio.nodyx.org|/api/v1/instance/info"
  "vieuxlooters.nodyx.org|/api/v1/instance/info"
)

sonder() {
  for entree in "${SITES[@]}"; do
    hote="${entree%%|*}"
    api="${entree##*|}"
    c=$(curl -s -o /dev/null -w '%{http_code}' -m 12 "https://$hote/" 2>/dev/null || echo 000)
    echo "site   $hote $c"
    a=$(curl -s -o /dev/null -w '%{http_code}' -m 12 "https://$hote$api" 2>/dev/null || echo 000)
    echo "api    $hote$api $a"
  done

  # Le temps réel passe par un autre chemin que l'API : une poignée de main
  # Socket.IO échouerait sans que les sondes précédentes s'en aperçoivent.
  s=$(curl -s -o /dev/null -w '%{http_code}' -m 12 \
        'https://nodyx.org/socket.io/?EIO=4&transport=polling' 2>/dev/null || echo 000)
  echo "socket nodyx.org/socket.io $s"

  # Le tunnel traverse Caddy puis le relais : il tombe pour d'autres raisons que
  # les sites servis localement, donc il se surveille à part.
  t=$(curl -s -o /dev/null -w '%{http_code}' -m 12 https://waazaa.nodyx.org/ 2>/dev/null || echo 000)
  echo "tunnel waazaa.nodyx.org $t"
}

adresses() {
  echo "  adresses d'écoute (pour mémoire, non comparées) :"
  ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' \
    | grep -E ':(3000|3001|3002|3003|3099|3100)$' | sort | sed 's/^/    /'
}

if [ "$MODE" = "--releve" ]; then
  mkdir -p "$(dirname "$REF")"
  sonder > "$REF"
  chmod 600 "$REF"
  echo "Relevé de référence écrit dans $REF :"
  sed 's/^/  /' "$REF"
  echo
  adresses
  exit 0
fi

if [ ! -f "$REF" ]; then
  echo "Aucun relevé de référence. Lancez d'abord : $0 --releve" >&2
  exit 1
fi

MAINTENANT=$(mktemp)
sonder > "$MAINTENANT"

ECARTS=0
while read -r type cible avant; do
  apres=$(awk -v c="$cible" '$2==c {print $3}' "$MAINTENANT")
  if [ "$avant" = "$apres" ]; then
    printf '  ok        %-6s %-44s %s\n' "$type" "$cible" "$apres"
  else
    printf '  ECART     %-6s %-44s %s -> %s\n' "$type" "$cible" "$avant" "$apres"
    ECARTS=$((ECARTS + 1))
  fi
done < "$REF"
rm -f "$MAINTENANT"

echo
adresses
echo
if [ "$ECARTS" -eq 0 ]; then
  echo "VERDICT : rien n'a bougé ($(wc -l < "$REF") sondes)"
  exit 0
fi
echo "VERDICT : $ECARTS ECART(S)"
exit 1
