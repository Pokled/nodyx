#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc du Caddyfile d'install_tunnel.sh (_render_caddyfile, extraite telle
#  quelle) avec un VRAI Caddy, pour chaque mode de tunnel.
#
#  Mesuré le 04/10/2026 : sans trusted_proxies_strict, Caddy lisait
#  X-Forwarded-For par la GAUCHE (la partie écrite par le visiteur), et un
#  CF-Connecting-IP forgé arrivait intact au core, qui le lit en premier. En
#  Pangolin ou derrière un autre proxy, chaque visiteur choisissait son IP.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
command -v caddy >/dev/null || { echo "caddy introuvable : banc impossible"; exit 1; }
W="$(mktemp -d)"; PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

# La fonction contient un Caddyfile (lignes « } » en colonne 0) : sa vraie fin
# est le « } » qui suit « return 0 ».
awk '$0 == "_render_caddyfile() {" {p=1} p {print} p && prev == "  return 0" && $0 == "}" {exit} {prev=$0}' "$TUNNEL" > "$W/render.fn"
check "_render_caddyfile trouvée dans install_tunnel.sh" '[[ -s "$W/render.fn" ]]'
# Garde-fou : sans NODYX_CADDY_DIR, la fonction écrirait dans le VRAI
# /etc/caddy/Caddyfile de la machine qui lance le banc. On refuse.
grep -q 'NODYX_CADDY_DIR' "$W/render.fn" || { echo "  ✘ _render_caddyfile n'accepte pas NODYX_CADDY_DIR : banc REFUSÉ (il écrirait dans /etc/caddy)"; exit 1; }

cat > "$W/echo.js" <<'EOF'
require('http').createServer((q, r) => r.end(JSON.stringify({
  xff: q.headers['x-forwarded-for'] ?? null, cf: q.headers['cf-connecting-ip'] ?? null,
}))).listen(18381, '127.0.0.1')
EOF
node "$W/echo.js" & PIDS+=($!)
for _ in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:18381/ && break; sleep 0.25; done

# render <mode> : Caddyfile généré par la vraie fonction, dans un dossier à part.
render() {
  mkdir -p "$W/$1"
  GOT="$(NODYX_CADDY_DIR="$W/$1" TUNNEL_MODE="$1" bash -c "$(cat "$W/render.fn"); _render_caddyfile && echo rendu" 2>&1)"
}
# Rendu exécutable en test : faux core, port haut, pas d'API d'admin. Les
# réglages d'IP (trusted_proxies, client_ip_headers, header_up) restent tels quels.
run() { # <mode>
  sed -e 's#127\.0\.0\.1:3000#127.0.0.1:18381#; s#127\.0\.0\.1:4173#127.0.0.1:18381#' \
      -e 's#^:80 {#:18390 {#' -e 's#^    bind .*#    bind 127.0.0.1#' \
      -e 's#^    servers {#    admin off\n    servers {#' "$W/$1/Caddyfile" > "$W/$1/test"
  caddy run --config "$W/$1/test" --adapter caddyfile > "$W/$1/log" 2>&1 & PIDS+=($!)
  for _ in $(seq 1 40); do curl -sf -o /dev/null http://127.0.0.1:18390/api/x && return 0; sleep 0.25; done
  echo "  Caddy n'a pas démarré :"; tail -5 "$W/$1/log"; return 1
}
stop() { kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null; }
ask() { GOT="$(curl -s "$@" http://127.0.0.1:18390/api/x)"; }

for mode in cf pangolin none; do
  echo "── mode $mode"
  render "$mode"
  check "Caddyfile rendu et validé par caddy" '[[ "$GOT" == *rendu* && -s "$W/$mode/Caddyfile" ]]'
  run "$mode" || continue
  ask -H 'CF-Connecting-IP: 8.8.8.8' -H 'X-Forwarded-For: 6.6.6.6, 203.0.113.9'
  if [[ "$mode" == cf ]]; then
    check "IP Cloudflare retenue, X-Forwarded-For forgé ignoré, CF retiré avant le core" '[[ "$GOT" == "{\"xff\":\"8.8.8.8\",\"cf\":null}" ]]'
    ask -H 'X-Forwarded-For: 6.6.6.6'
    check "sans CF-Connecting-IP : un X-Forwarded-For forgé n'est PAS cru" '[[ "$GOT" == "{\"xff\":\"127.0.0.1\",\"cf\":null}" ]]'
  else
    check "X-Forwarded-For lu par la DROITE (vraie IP), CF forgé retiré" '[[ "$GOT" == "{\"xff\":\"203.0.113.9\",\"cf\":null}" ]]'
  fi
  stop
done

echo "── installation neuve et mise à jour"
check "le core reçoit un secret interne (.env)" 'grep -q "^INTERNAL_API_SECRET=\${INTERNAL_API_SECRET}$" "$TUNNEL"'
check "le frontend reçoit secret, en-tête d'IP et profondeur (ecosystem)" 'grep -qF "INTERNAL_API_SECRET: '"'"'\${INTERNAL_API_SECRET}'"'"', ADDRESS_HEADER: '"'"'x-forwarded-for'"'"', XFF_DEPTH: '"'"'1'"'"'" "$TUNNEL"'
check "fichiers de secrets en 600" 'grep -qF "chmod 600 \"\${NODYX_DIR}/ecosystem.config.js\"" "$TUNNEL"'
check "--upgrade/--repair et nodyx-update appellent la migration partagée" '[[ $(grep -c "nodyx_migrate_client_ip" "$TUNNEL") -ge 2 ]]'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
