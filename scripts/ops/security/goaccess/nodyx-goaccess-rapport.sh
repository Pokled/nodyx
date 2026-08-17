#!/usr/bin/env bash
# Regenere le rapport GoAccess a partir du journal d'acces du coeur.
#
# Pourquoi pas le mode --real-time-html de GoAccess : il ouvre un serveur
# WebSocket sur un port dedie, qu'il faudrait proxifier dans Caddy. Or la
# configuration Caddy vivante de cette machine vient de `autosave.json`, et un
# rechargement fait tomber le HTTPS de nodyx.org (cf CLAUDE.md). Une
# regeneration periodique donne 95 % du benefice pour 0 % du risque.
set -euo pipefail

JOURNAL=/home/nodyx/.pm2/logs/nodyx-core-out.log
SORTIE=/var/lib/nodyx-goaccess/rapport.html
TAMPON=$(mktemp /tmp/goaccess-acces.XXXXXX)
trap 'rm -f "$TAMPON"' EXIT

# On ne garde que les lignes d'acces au format attendu. Les autres lignes du
# journal (demarrage, erreurs applicatives) ne sont pas des requetes.
grep '"msg":"access"' "$JOURNAL" 2>/dev/null | grep '"log_date"' > "$TAMPON" || true

if [ ! -s "$TAMPON" ]; then
  echo "aucune ligne d'acces exploitable, rapport inchange"
  exit 0
fi

TMP_HTML="${SORTIE%.html}.tmp.html"
goaccess "$TAMPON" -p /etc/goaccess/nodyx.conf -o "$TMP_HTML"
# Remplacement atomique : le hub ne doit jamais lire un fichier a moitie ecrit.
mv -f "$TMP_HTML" "$SORTIE"
# Le hub tourne en `nodyx` et doit pouvoir le lire.
chown root:nodyx "$SORTIE"
chmod 640 "$SORTIE"
echo "rapport regenere : $(wc -l < "$TAMPON") requetes, $(wc -c < "$SORTIE") octets"
