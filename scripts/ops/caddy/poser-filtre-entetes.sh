#!/usr/bin/env bash
# Empêche un inconnu de se faire passer pour quelqu'un d'autre.
#
# # Le défaut que ceci corrige
#
# Le VPS accepte les connexions directes sur 443 : `ufw` autorise
# `443 ALLOW IN Anywhere`, et rien n'oblige à passer par Cloudflare. Or Caddy
# transmettait les en-têtes de transfert TELS QUELS, quelle que soit leur
# provenance. Comme le pair TCP vu par les applications est toujours Caddy
# lui-même, donc du loopback, donc de confiance, l'en-tête était cru sur parole.
#
# Conséquences mesurées le 2026-08-20, depuis Internet et non en théorie :
#
#   - le bannissement anti-force-brute du relais devient inopérant, il suffit de
#     changer de `CF-Connecting-IP` à chaque tentative ;
#   - la limitation de débit de TOUTE l'API devient inopérante de la même façon :
#     une adresse fabriquée mais routable obtient son propre seau Redis.
#
# # La parade
#
# Une route en tête de liste, NON terminale, qui retire les en-têtes de transfert
# quand la source n'est pas l'une des nôtres. Caddy repose ensuite lui-même un
# `X-Forwarded-For` contenant le VRAI pair, donc l'usurpateur est désigné par sa
# propre adresse.
#
# Les plages de confiance sont lues depuis `client_ip.rs` et non recopiées : le
# relais et Caddy doivent avoir une seule notion de « nos propres portes ».
set -euo pipefail

API="${CADDY_API:-http://localhost:2019}"
SAUVE="${CADDY_SAUVE:-/var/backups/nodyx/caddy}"
ICI="$(cd "$(dirname "$0")" && pwd)"
TEMOIN=CF-Connecting-IP

echo "=== 0. le filtre est-il deja pose ? ==="
DEJA=$(curl -sf -m 15 "$API/config/apps/http/servers/srv1/routes" | python3 -c "
import json, sys
for r in json.load(sys.stdin):
    for h in r.get('handle', []):
        if h.get('handler') == 'headers':
            if '$TEMOIN' in (h.get('request', {}).get('delete') or []):
                print('oui'); raise SystemExit
print('non')
")
if [ "$DEJA" = "oui" ]; then
  echo "  Le filtre existe deja. Rien a faire."
  echo "  Pour le retirer : $ICI/annuler-filtre-entetes.sh"
  exit 0
fi
echo "  non, on peut poser"

echo
echo "=== 1. plages de confiance, lues depuis le Rust ==="
PLAGES=$(python3 "$ICI/plages-de-confiance.py") || {
  echo "  Lecture impossible, on ne pose RIEN." >&2
  echo "  Une liste tronquee ferait correspondre le filtre a TOUT le trafic," >&2
  echo "  Cloudflare compris, et plus aucun visiteur ne serait identifie." >&2
  exit 1
}
echo "  $(echo "$PLAGES" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') plages"

echo
echo "=== 2. sauvegarde prealable ==="
"$ICI/sauvegarder.sh" "$SAUVE"

echo
echo "=== 3. releves de reference ==="
"$ICI/verifier.sh" --releve > /dev/null && echo "  domaine : releve pris"
"$ICI/verifier-identification.sh" | tail -1 | sed 's/^/  identification avant : /'

echo
echo "=== 4. pose, en tete de liste et NON terminale ==="
python3 - "$PLAGES" > /tmp/.filtre-entetes.$$ <<'PY'
import json, sys
plages = json.loads(sys.argv[1])
json.dump({
    # « la source n'est PAS des notres »
    "match": [{"not": [{"remote_ip": {"ranges": plages}}]}],
    "handle": [{
        "handler": "headers",
        "request": {"delete": [
            "CF-Connecting-IP", "X-Forwarded-For", "X-Real-IP",
            "True-Client-IP", "CF-IPCountry",
        ]},
    }],
    # pas de "terminal" : la requete continue vers les routes suivantes, elle
    # est seulement debarrassee de ce qu'elle pretendait etre.
}, sys.stdout)
PY

curl -sf -X PUT "$API/config/apps/http/servers/srv1/routes/0" \
     -H 'Content-Type: application/json' \
     --data-binary "@/tmp/.filtre-entetes.$$" \
  && echo "  posee" \
  || { echo "  REFUSEE par Caddy, configuration en cours intacte" >&2; rm -f "/tmp/.filtre-entetes.$$"; exit 1; }
rm -f "/tmp/.filtre-entetes.$$"

echo
echo "=== 5. verification ==="
sleep 2
ECHEC=0
"$ICI/verifier.sh" | tail -2 | sed 's/^/  /' || ECHEC=1
"$ICI/verifier-identification.sh" | tail -1 | sed 's/^/  /' || ECHEC=1

if [ "$ECHEC" -ne 0 ]; then
  echo
  echo "!!! ECART DETECTE, annulation automatique !!!" >&2
  "$ICI/annuler-filtre-entetes.sh"
  exit 1
fi

echo
echo "Pour annuler : $ICI/annuler-filtre-entetes.sh"
