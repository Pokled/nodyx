#!/usr/bin/env bash
# Restreint le serveur interne de Caddy (srv0) au loopback.
#
# `srv0` écoute sur `:3099` et mandate vers `localhost:3000`. C'est une entrée
# interne : aucune route publique n'y mène et aucune connexion ne l'atteint. Rien
# ne justifie qu'il accepte des connexions du monde entier, même si `ufw` les
# bloque aujourd'hui. Une règle de pare-feu est une ligne de défense, pas deux.
#
#   caddy-srv0-loopback.sh            restreint au loopback
#   caddy-srv0-loopback.sh --annuler  rouvre sur toutes les interfaces
#
# Le retour arrière est symétrique et tient dans la même commande, parce qu'un
# changement d'adresse d'écoute n'a que deux états.
set -euo pipefail

API="${CADDY_API:-http://localhost:2019}"
ICI="$(cd "$(dirname "$0")" && pwd)"
CADDY_OPS="$(cd "$ICI/../caddy" && pwd)"
LOOPBACK='["127.0.0.1:3099"]'
PARTOUT='[":3099"]'

ACTUEL=$(curl -sf -m 15 "$API/config/apps/http/servers/srv0/listen") || {
  echo "  L'API d'administration ne repond pas. On ne touche a rien." >&2
  exit 1
}
echo "  ecoute actuelle : $ACTUEL"

if [ "${1:-}" = "--annuler" ]; then
  VOULU="$PARTOUT"; QUOI="rouverture sur toutes les interfaces"
else
  VOULU="$LOOPBACK"; QUOI="restriction au loopback"
fi

if [ "$(echo "$ACTUEL" | tr -d ' ')" = "$(echo "$VOULU" | tr -d ' ')" ]; then
  echo "  Deja dans cet etat. Rien a faire."
  exit 0
fi

echo
echo "=== sauvegarde prealable ==="
"$CADDY_OPS/sauvegarder.sh" >/dev/null && echo "  faite"

echo
echo "=== $QUOI ==="
# Caddy valide la configuration entiere avant de l'appliquer : un refus laisse
# la production intacte, listeners compris.
curl -sf -X PATCH "$API/config/apps/http/servers/srv0/listen" \
     -H 'Content-Type: application/json' -d "$VOULU" \
  && echo "  appliquee" \
  || { echo "  REFUSEE par Caddy, configuration en cours intacte" >&2; exit 1; }

sleep 2
echo "  nouvelle ecoute : $(curl -sf -m 10 "$API/config/apps/http/servers/srv0/listen")"
ss -ltn 2>/dev/null | awk 'NR>1 {print $4}' | grep ':3099$' | sed 's/^/  socket : /'

echo
echo "=== verification ==="
"$ICI/verifier-services.sh" || {
  echo
  echo "!!! ECART DETECTE, retour arriere automatique !!!" >&2
  curl -sf -X PATCH "$API/config/apps/http/servers/srv0/listen" \
       -H 'Content-Type: application/json' -d "$ACTUEL" && echo "  etat precedent retabli" >&2
  exit 1
}

echo
echo "Pour revenir en arriere : $0 --annuler"
