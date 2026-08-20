#!/usr/bin/env bash
# Retire la route du tunnel WebSocket. C'est le retour arriere de premier niveau.
#
# La route est retrouvee par son CONTENU (hote + destination), jamais par un
# index note quelque part : entre la pose et l'annulation, une autre operation a
# pu decaler les routes, et supprimer l'index 16 par habitude reviendrait a
# supprimer le joker `*.nodyx.org` dont depend chaque instance tunnelisee.
set -euo pipefail

API="${CADDY_API:-http://localhost:2019}"
HOTE=tunnel.nodyx.org
CIBLE=127.0.0.1:7002

INDEX=$(curl -sf -m 15 "$API/config/apps/http/servers/srv1/routes" | python3 -c "
import json, sys
routes = json.load(sys.stdin)
trouves = []
for i, r in enumerate(routes):
    hotes = {h for m in r.get('match', []) for h in m.get('host', [])}
    dests = set()
    def creuser(o):
        if isinstance(o, dict):
            for u in o.get('upstreams', []) or []: dests.add(u.get('dial',''))
            for v in o.values(): creuser(v)
        elif isinstance(o, list):
            for v in o: creuser(v)
    creuser(r)
    if '$HOTE' in hotes and '$CIBLE' in dests:
        trouves.append(i)
if len(trouves) == 0:
    sys.exit('ABSENTE')
if len(trouves) > 1:
    sys.exit('MULTIPLE')
print(trouves[0])
") || {
  case "$?" in
    *) echo "  Rien a annuler : aucune route unique pour $HOTE -> $CIBLE." >&2
       echo "  Inspecter a la main : curl -s $API/config/apps/http/servers/srv1/routes | python3 -m json.tool" >&2
       exit 1 ;;
  esac
}

echo "  Route trouvee a l'index $INDEX ($HOTE -> $CIBLE)"
curl -sf -X DELETE "$API/config/apps/http/servers/srv1/routes/$INDEX" \
  && echo "  Retiree." \
  || { echo "  ECHEC de la suppression, configuration intacte" >&2; exit 1; }

echo
"$(dirname "$0")/verifier.sh" || true
