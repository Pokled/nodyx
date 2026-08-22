#!/usr/bin/env bash
# Retablit l'ancien CSP statique de Caddy, celui qui portait unsafe-inline.
#
# Les valeurs ci-dessous sont EXACTEMENT celles qui etaient en place avant
# poser-csp-nonce.sh, capturees depuis la configuration vivante. Elles ne
# dependent d'aucune sauvegarde : ce script fonctionne seul, meme longtemps
# apres coup.
#
# nodyx.org porte une regle en plus (worker-src) que les trois autres hotes
# n'ont pas : conserve tel quel, PAS uniformise.
set -euo pipefail

API="${CADDY_API:-http://localhost:2019}"
ICI="$(cd "$(dirname "$0")" && pwd)"

CSP_STANDARD="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com https://player.twitch.tv; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' wss: https:; frame-src 'self' https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.openstreetmap.org https://player.twitch.tv https://www.twitch.tv https://geo.dailymotion.com https://clips.twitch.tv https://w.soundcloud.com https://open.spotify.com; object-src 'none'; base-uri 'self'; form-action 'self';"

CSP_NODYX_ORG="default-src 'self'; script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com https://player.twitch.tv; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' wss: https:; frame-src 'self' https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com https://player.vimeo.com https://www.openstreetmap.org https://player.twitch.tv https://www.twitch.tv https://geo.dailymotion.com https://clips.twitch.tv https://w.soundcloud.com https://open.spotify.com; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self';"

# hote -> valeur CSP a restaurer
declare -A CSP=(
  [sleemstudio.nodyx.org]="$CSP_STANDARD"
  [demo.nodyx.org]="$CSP_STANDARD"
  [vieuxlooters.nodyx.org]="$CSP_STANDARD"
  [nodyx.org]="$CSP_NODYX_ORG"
)

# Retrouve le chemin JSON du bloc `response.set` (SANS le CSP, puisqu'il vient
# d'etre retire) pour un hote, quel que soit l'index de sa route.
chemin_set_pour() {
  local hote="$1"
  curl -sf -m 15 "$API/config/apps/http/servers/srv1/routes" | python3 -c "
import json, sys
routes = json.load(sys.stdin)
hote = '$hote'
for i, r in enumerate(routes):
    hotes = {h for m in r.get('match', []) for h in m.get('host', [])}
    if hote not in hotes: continue
    for hi, h in enumerate(r.get('handle', [])):
        if h.get('handler') != 'subroute': continue
        for j, sr in enumerate(h.get('routes', [])):
            for hhi, hh in enumerate(sr.get('handle', [])):
                # Identifie le bon bloc par la presence de HSTS, pose par le
                # meme handler que le CSP retire.
                if hh.get('handler') == 'headers' and 'Strict-Transport-Security' in (hh.get('response') or {}).get('set', {}):
                    print(f'apps/http/servers/srv1/routes/{i}/handle/{hi}/routes/{j}/handle/{hhi}/response/set')
                    sys.exit(0)
sys.exit(1)
"
}

ECHEC=0
for h in "${!CSP[@]}"; do
  CHEMIN=$(chemin_set_pour "$h") || { echo "  $h : bloc d'en-tetes introuvable" >&2; ECHEC=1; continue; }
  VALEUR=$(python3 -c "import json,sys; print(json.dumps([sys.argv[1]]))" "${CSP[$h]}")
  curl -sf -X PUT "$API/config/$CHEMIN/Content-Security-Policy" \
       -H 'Content-Type: application/json' -d "$VALEUR" \
    && echo "  $h : CSP statique retabli" \
    || { echo "  $h : ECHEC de la restauration" >&2; ECHEC=1; }
done

echo
"$ICI/verifier.sh" || true
exit $ECHEC
