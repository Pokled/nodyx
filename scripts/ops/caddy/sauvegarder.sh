#!/usr/bin/env bash
# Photographie l'etat de Caddy AVANT toute modification.
#
# Deux fichiers, parce qu'ils peuvent diverger :
#   - la configuration VIVANTE, lue par l'API d'administration ;
#   - `autosave.json`, que Caddy restaure au demarrage. Il est REECRIT apres
#     chaque modification par l'API : sans cette copie, l'etat d'avant est perdu
#     des la premiere commande.
#
# La sauvegarde vit hors du depot : elle decrit l'infrastructure.
set -euo pipefail

DEST="${1:-/var/backups/nodyx/caddy}"
AUTOSAVE=/var/lib/caddy/.config/caddy/autosave.json
HORODATE="$(date -u +%Y-%m-%dT%H-%M-%SZ)"

mkdir -p "$DEST"
# La configuration ne contient aucun secret, mais elle decrit toute la topologie
# interne : chaque service, chaque port. Inutile de l'offrir en lecture a tout
# compte local. Defense en profondeur, elle ne coute rien.
chmod 700 "$DEST"

echo "--- configuration vivante ---"
if ! curl -sf -m 15 "${CADDY_API:-http://localhost:2019}/config/" > "$DEST/live-$HORODATE.json"; then
  echo "  ECHEC : l'API d'administration ne repond pas. On ne modifie RIEN." >&2
  exit 1
fi

# Une sauvegarde tronquee est pire que pas de sauvegarde : elle donne
# l'illusion d'un retour arriere possible.
python3 - "$DEST/live-$HORODATE.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
routes = d["apps"]["http"]["servers"]["srv1"]["routes"]
assert len(routes) > 0, "configuration sans route : sauvegarde refusee"
print(f"  {len(routes)} routes, {len(json.dumps(d))} octets")
PY

echo "--- autosave, restaure au demarrage ---"
if [ -f "$AUTOSAVE" ]; then
  cp -a "$AUTOSAVE" "$DEST/autosave-$HORODATE.json"
  echo "  copie ($(stat -c%s "$AUTOSAVE") octets)"
else
  echo "  ABSENT : Caddy repartirait du Caddyfile disque au prochain demarrage" >&2
fi

chmod 600 "$DEST/live-$HORODATE.json"
ln -sfn "live-$HORODATE.json" "$DEST/derniere-live.json"

# Le tout premier etat connu, ecrit UNE SEULE FOIS et jamais reecrit.
#
# « La sauvegarde la plus recente » est un mauvais point de retour : ce script
# tourne au debut de chaque pose, donc un second passage photographie l'etat
# DEJA modifie. Qui restaurerait la derniere sauvegarde en situation d'incident
# remettrait l'etat casse en croyant revenir en arriere.
#
# `etat-initial.json` est immuable : c'est vers lui qu'on revient quand plus
# rien d'autre n'est sur.
if [ ! -f "$DEST/etat-initial.json" ]; then
  cp -a "$DEST/live-$HORODATE.json" "$DEST/etat-initial.json"
  chmod 600 "$DEST/etat-initial.json"
  echo "  etat-initial.json cree (point de retour immuable)"
else
  echo "  etat-initial.json deja present, laisse intact ($(stat -c%s "$DEST/etat-initial.json") octets)"
fi
echo
echo "Sauvegarde : $DEST/live-$HORODATE.json"
echo "Restauration complete : $(dirname "$0")/restaurer.sh $DEST/live-$HORODATE.json"
