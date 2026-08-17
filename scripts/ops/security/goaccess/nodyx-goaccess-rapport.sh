#!/usr/bin/env bash
# Regenere le rapport GoAccess a partir du journal d'acces du coeur.
#
# SORTIE EN JSON, PAS EN HTML. Le rapport HTML de GoAccess se rend entierement
# en JavaScript et utilise `new Function`, que la CSP d'Olympus interdit
# (`script-src 'self' 'unsafe-inline'`, sans `unsafe-eval`). Resultat mesure :
# 6052 caracteres rendus sans CSP, ZERO avec celle de production — page blanche.
#
# Plutot qu'affaiblir la CSP d'une page qui affiche des adresses de visiteurs, on
# laisse GoAccess faire ce qu'il fait le mieux — l'agregation — et Olympus rend
# avec ses propres composants. Aucun `eval`, aucune CSP a toucher, et un rendu
# coherent avec le reste du hub.
#
# Le mode --real-time-html est ecarte pour une autre raison : il ouvre un serveur
# WebSocket qu'il faudrait proxifier dans Caddy, dont la configuration vivante ne
# doit pas etre rechargee (cf CLAUDE.md).
set -euo pipefail

JOURNAL=/home/nodyx/.pm2/logs/nodyx-core-out.log
SORTIE=/var/lib/nodyx-goaccess/rapport.json
TAMPON=$(mktemp /tmp/goaccess-acces.XXXXXX)
trap 'rm -f "$TAMPON"' EXIT

# On ne garde que les lignes d'acces au format attendu. Les autres lignes du
# journal (demarrage, erreurs applicatives) ne sont pas des requetes.
grep '"msg":"access"' "$JOURNAL" 2>/dev/null | grep '"log_date"' > "$TAMPON" || true

if [ ! -s "$TAMPON" ]; then
  echo "aucune ligne d'acces exploitable, rapport inchange"
  exit 0
fi

TMP="${SORTIE%.json}.tmp.json"
goaccess "$TAMPON" -p /etc/goaccess/nodyx.conf -o "$TMP"
# Remplacement atomique : le hub ne doit jamais lire un fichier a moitie ecrit.
mv -f "$TMP" "$SORTIE"
# Le hub tourne en `nodyx` et doit pouvoir le lire.
chown root:nodyx "$SORTIE"
chmod 640 "$SORTIE"
echo "rapport regenere : $(wc -l < "$TAMPON") requetes, $(wc -c < "$SORTIE") octets"
