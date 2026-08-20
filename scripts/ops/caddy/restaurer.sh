#!/usr/bin/env bash
# Remet Caddy dans l'etat decrit par une sauvegarde.
#
# Par defaut, ne restaure QUE le tableau de routes de srv1, c'est-a-dire tout ce
# que nos manipulations touchent. C'est volontairement etroit : l'operation la
# plus sure est celle qui ne peut pas atteindre ce qu'on ne voulait pas changer.
#
# `--complet` recharge la configuration ENTIERE. A n'employer que si la premiere
# forme n'a pas suffi, et en connaissant ce piege :
#
#   La configuration vivante de cette production ne contient AUCUN bloc `admin`.
#   Caddy ecoute donc sur l'endpoint par defaut (localhost:2019) de maniere
#   implicite. Un `POST /load` remplace la configuration entiere, bloc `admin`
#   compris : recharger une sauvegarde qui n'en a pas laisse l'endpoint par
#   defaut, donc le meme. Recharger une sauvegarde qui en aurait un DIFFERENT
#   deplacerait l'API d'administration, et le prochain retour arriere n'aurait
#   plus de porte par ou passer.
#
# Le script verifie ce point avant d'agir plutot que de faire confiance.
set -euo pipefail

FICHIER="${1:-}"
MODE="${2:-}"
API="${CADDY_API:-http://localhost:2019}"

if [ -z "$FICHIER" ] || [ ! -f "$FICHIER" ]; then
  echo "usage : $0 <sauvegarde.json> [--complet]" >&2
  echo "        sauvegardes disponibles :" >&2
  ls -1t /var/backups/nodyx/caddy/live-*.json 2>/dev/null | head -5 | sed 's/^/          /' >&2
  exit 1
fi

# Une sauvegarde illisible ou tronquee doit etre rejetee AVANT d'avoir touche
# quoi que ce soit, pas au milieu de la restauration.
python3 - "$FICHIER" "$MODE" <<'PY'
import json, sys
chemin, mode = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(chemin))
except Exception as e:
    sys.exit(f"  sauvegarde illisible : {e}")

try:
    routes = d["apps"]["http"]["servers"]["srv1"]["routes"]
except KeyError as e:
    sys.exit(f"  sauvegarde incomplete, cle absente : {e}")

if not routes:
    sys.exit("  sauvegarde sans aucune route : restauration refusee")

hotes = sorted({h for r in routes for m in r.get("match", []) for h in m.get("host", [])})
print(f"  {len(routes)} routes, {len(hotes)} hotes")
print(f"  dont : {', '.join(hotes[:6])}{' ...' if len(hotes) > 6 else ''}")

if mode == "--complet":
    admin = d.get("admin")
    if admin is None:
        print("  bloc admin : absent, l'endpoint par defaut sera conserve (localhost:2019)")
    else:
        ecoute = admin.get("listen", "(defaut)")
        print(f"  bloc admin : PRESENT, ecoute {ecoute}")
        if "2019" not in str(ecoute):
            sys.exit("  ARRET : cette sauvegarde deplacerait l'API d'administration.\n"
                     "         Le prochain retour arriere n'aurait plus de porte.")
PY

echo
if [ "$MODE" = "--complet" ]; then
  echo "--- restauration COMPLETE (POST /load) ---"
  read -rp "  Recharger la configuration entiere ? tapez 'complet' : " r
  [ "$r" = "complet" ] || { echo "  annule"; exit 1; }
  curl -sf -X POST "$API/load" -H 'Content-Type: application/json' \
       --data-binary "@$FICHIER" \
    && echo "  recharge" \
    || { echo "  ECHEC : la configuration en cours est intacte (Caddy valide avant d'appliquer)" >&2; exit 1; }
else
  echo "--- restauration des routes de srv1 (PUT, chirurgical) ---"
  python3 -c "
import json,sys
d=json.load(open('$FICHIER'))
json.dump(d['apps']['http']['servers']['srv1']['routes'], open('/tmp/.caddy-routes.$$','w'))
"
  curl -sf -X PATCH "$API/config/apps/http/servers/srv1/routes" \
       -H 'Content-Type: application/json' \
       --data-binary "@/tmp/.caddy-routes.$$" \
    && echo "  routes restaurees" \
    || { echo "  ECHEC : configuration en cours intacte" >&2; rm -f "/tmp/.caddy-routes.$$"; exit 1; }
  rm -f "/tmp/.caddy-routes.$$"
fi

echo
echo "Verifier maintenant : $(dirname "$0")/verifier.sh"
