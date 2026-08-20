#!/usr/bin/env bash
# Pose la route qui expose la porte WebSocket du relais en HTTPS.
#
#   instance -> Cloudflare -> Caddy :443 tunnel.nodyx.org/tunnel -> 127.0.0.1:7002
#
# Deux precautions structurent ce script :
#
# 1. La route est inseree JUSTE AVANT le joker `*.nodyx.org`, pas en tete. En
#    tete, un filtre mal ecrit capterait le trafic de tous les hotes nommes. A
#    cette position, il ne peut au pire capter que ce qui serait alle au joker.
#
# 2. Rien ne se fait sans sauvegarde fraiche. `autosave.json` est reecrit par
#    Caddy juste apres la modification : sans copie prealable, l'etat d'avant
#    n'existe plus nulle part.
set -euo pipefail

API="${CADDY_API:-http://localhost:2019}"
HOTE=tunnel.nodyx.org
CIBLE=127.0.0.1:7002
SAUVE="${CADDY_SAUVE:-/var/backups/nodyx/caddy}"
ICI="$(cd "$(dirname "$0")" && pwd)"

echo "=== 0. la route est-elle deja posee ? ==="
# Avant toute chose, y compris la sauvegarde : un second passage prendrait
# sinon une photo de l'etat deja modifie et la deposerait parmi les points de
# retour, ou elle serait prise pour l'etat d'avant.
DEJA=$(curl -sf -m 15 "$API/config/apps/http/servers/srv1/routes" | python3 -c "
import json, sys
routes = json.load(sys.stdin)
for r in routes:
    hotes = {h for m in r.get('match', []) for h in m.get('host', [])}
    if '$HOTE' in hotes:
        print('oui'); break
else:
    print('non')
")
if [ "$DEJA" = "oui" ]; then
  echo "  Une route $HOTE existe deja. Rien a faire."
  echo "  Pour la retirer : $ICI/annuler-route-tunnel.sh"
  exit 0
fi
echo "  non, on peut poser"

echo
echo "=== 1. sauvegarde prealable ==="
"$ICI/sauvegarder.sh" "$SAUVE"

echo
echo "=== 2. releve de reference du domaine ==="
"$ICI/verifier.sh" --releve

echo
echo "=== 3. position d'insertion ==="
INDEX=$(curl -sf -m 15 "$API/config/apps/http/servers/srv1/routes" | python3 -c "
import json, sys
routes = json.load(sys.stdin)
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
        sys.exit('DEJA_POSEE : la route existe deja, rien a faire.\n                 Pour la retirer : annuler-route-tunnel.sh')
# juste avant le joker qui sert les instances tunnelisees
for i, r in enumerate(routes):
    hotes = {h for m in r.get('match', []) for h in m.get('host', [])}
    if '*.nodyx.org' in hotes:
        print(i); break
else:
    sys.exit('JOKER_INTROUVABLE : aucune route *.nodyx.org.\n             La configuration n\\'est pas celle attendue, on ne touche a rien.')
")
echo "  joker *.nodyx.org a l'index $INDEX, insertion a cette position"

cat > /tmp/.route-tunnel.$$ <<JSON
{
  "match": [{ "host": ["$HOTE"], "path": ["/tunnel*"] }],
  "handle": [{ "handler": "reverse_proxy", "upstreams": [{ "dial": "$CIBLE" }] }],
  "terminal": true
}
JSON

echo
echo "=== 4. pose ==="
# PUT sur un index INSERE, il ne remplace pas. Caddy valide la configuration
# entiere avant de l'appliquer : un refus laisse la production intacte.
curl -sf -X PUT "$API/config/apps/http/servers/srv1/routes/$INDEX" \
     -H 'Content-Type: application/json' \
     --data-binary "@/tmp/.route-tunnel.$$" \
  && echo "  posee" \
  || { echo "  REFUSEE par Caddy, configuration en cours intacte" >&2; rm -f "/tmp/.route-tunnel.$$"; exit 1; }
rm -f "/tmp/.route-tunnel.$$"

echo
echo "=== 5. verification ==="
sleep 2
"$ICI/verifier.sh" || {
  echo
  echo "!!! ECART DETECTE, annulation automatique !!!" >&2
  "$ICI/annuler-route-tunnel.sh"
  exit 1
}

echo
echo "Pour annuler : $ICI/annuler-route-tunnel.sh"
