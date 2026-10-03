#!/usr/bin/env bash
# Variables (GOT, H1, M…) lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc du Caddyfile d'install.sh (scripts/install/caddyfile.sh), avec un VRAI
#  Caddy : le Caddyfile généré est validé tel quel, puis ses fragments
#  d'en-têtes tournent devant un faux core qui renvoie ce qu'il reçoit.
#
#  Ce qui est prouvé : quoi que le visiteur écrive dans X-Forwarded-For,
#  X-Real-IP ou CF-Connecting-IP, le core ne reçoit que l'IP calculée par
#  Caddy. En mode relais, CF-Connecting-IP n'est cru que venant du tunnel
#  local (127.0.0.1), jamais d'une autre machine.
#
#  Usage : bash scripts/tests/caddyfile.test.sh [ip-non-locale]
#  (l'IP non locale sert au cas « autre machine » ; par défaut, la première
#  adresse IPv4 de la machine qui n'est pas 127.x)
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../install/caddyfile.sh
. "${CADDYFILE_LIB:-$ROOT/scripts/install/caddyfile.sh}"

command -v caddy >/dev/null || { echo "caddy introuvable : banc impossible"; exit 1; }
command -v node  >/dev/null || { echo "node introuvable : banc impossible"; exit 1; }
OTHER_IP="${1:-$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -vE '^(127\.|$)' | grep -E '^[0-9.]+$' | head -1)}"

W="$(mktemp -d)"; PIDS=()
cleanup() { for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null; done; wait 2>/dev/null; rm -rf "$W"; }
trap cleanup EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

# Faux core : renvoie les en-têtes d'IP qu'il reçoit.
cat > "$W/echo.js" <<'EOF'
require('http').createServer((q, r) => r.end(JSON.stringify({
  xff: q.headers['x-forwarded-for'] ?? null, xri: q.headers['x-real-ip'] ?? null, cf: q.headers['cf-connecting-ip'] ?? null,
}))).listen(18181, '127.0.0.1')
EOF
node "$W/echo.js" & PIDS+=($!)

# Le Caddyfile généré, rendu exécutable en test : pas de certificat, pas
# d'API d'admin, le faux core à la place du vrai, un port haut à la place du
# site. Les fragments d'en-têtes, eux, restent EXACTEMENT ceux générés.
testable() {
  sed -e 's#127\.0\.0\.1:3000#127.0.0.1:18181#; s#127\.0\.0\.1:4173#127.0.0.1:18181#' \
      -e "s#^$2 {#$3 {#" \
      -e 's#^    servers {#    admin off\n    auto_https off\n    servers {#' "$1"
}

run_caddy() { # <fichier>
  caddy run --config "$1" --adapter caddyfile >"$1.log" 2>&1 & PIDS+=($!)
  for _ in $(seq 1 40); do curl -s -o /dev/null "http://${2:-127.0.0.1}:18190/api/x" 2>/dev/null && return 0; sleep 0.25; done
  echo "  Caddy n'a pas démarré :"; tail -5 "$1.log"; return 1
}

FORGED=(-H 'X-Forwarded-For: 6.6.6.6' -H 'X-Real-IP: 7.7.7.7' -H 'CF-Connecting-IP: 8.8.8.8')

echo "── domaine direct"
nodyx_caddyfile direct communaute.example.org > "$W/direct"
check "le Caddyfile généré est valide (caddy validate)" 'caddy validate --config "$W/direct" --adapter caddyfile >/dev/null 2>&1'
check "plus aucun « header_up -X-Forwarded-For »" '! nodyx_caddyfile_needs_ip_fix "$W/direct"'
check "HSTS présent" 'grep -q Strict-Transport-Security "$W/direct"'
testable "$W/direct" communaute.example.org ":18190" > "$W/direct.t"
if run_caddy "$W/direct.t"; then
  GOT="$(curl -s "${FORGED[@]}" http://127.0.0.1:18190/api/x)"
  check "API : en-têtes forgés écrasés par l'IP réelle, CF retiré" '[[ "$GOT" == "{\"xff\":\"127.0.0.1\",\"xri\":\"127.0.0.1\",\"cf\":null}" ]]'
  GOT="$(curl -s "${FORGED[@]}" http://127.0.0.1:18190/une-page)"
  check "frontend : même traitement" '[[ "$GOT" == "{\"xff\":\"127.0.0.1\",\"xri\":\"127.0.0.1\",\"cf\":null}" ]]'
  if [[ -n "$OTHER_IP" ]]; then
    GOT="$(curl -s "${FORGED[@]}" "http://$OTHER_IP:18190/api/x" 2>/dev/null)"
    check "depuis une autre adresse ($OTHER_IP) : c'est elle qui est transmise" '[[ "$GOT" == "{\"xff\":\"$OTHER_IP\",\"xri\":\"$OTHER_IP\",\"cf\":null}" ]]'
  fi
  kill "${PIDS[-1]}" 2>/dev/null; wait "${PIDS[-1]}" 2>/dev/null
fi

echo "── relais"
nodyx_caddyfile relay "" > "$W/relay"
check "le Caddyfile généré est valide (caddy validate)" 'caddy validate --config "$W/relay" --adapter caddyfile >/dev/null 2>&1'
check "pas de HSTS en relais" '! grep -q Strict-Transport-Security "$W/relay"'
testable "$W/relay" ":80" ":18190" > "$W/relay.t"
if run_caddy "$W/relay.t"; then
  GOT="$(curl -s -H 'CF-Connecting-IP: 203.0.113.9' -H 'X-Forwarded-For: 6.6.6.6' http://127.0.0.1:18190/api/x)"
  check "via le tunnel (127.0.0.1) : l'IP Cloudflare devient l'IP du visiteur" '[[ "$GOT" == "{\"xff\":\"203.0.113.9\",\"xri\":\"203.0.113.9\",\"cf\":null}" ]]'
  if [[ -n "$OTHER_IP" ]]; then
    GOT="$(curl -s -H 'CF-Connecting-IP: 203.0.113.9' "http://$OTHER_IP:18190/api/x" 2>/dev/null)"
    check "depuis une autre machine : CF-Connecting-IP forgé IGNORÉ" '[[ "$GOT" == "{\"xff\":\"$OTHER_IP\",\"xri\":\"$OTHER_IP\",\"cf\":null}" ]]'
  fi
fi

echo "── reconnaissance d'un Caddyfile existant"
check "le Caddyfile généré est reconnu comme celui de Nodyx" 'nodyx_caddyfile_is_ours "$W/direct" communaute.example.org'
printf '\nautre-site.example.com {\n  respond "ok"\n}\n' >> "$W/direct"
check "avec un autre site : il n'est PLUS reconnu (pas de réécriture)" '! nodyx_caddyfile_is_ours "$W/direct" communaute.example.org'
printf 'x {\n  reverse_proxy 127.0.0.1:3000 {\n    header_up -X-Forwarded-For\n  }\n}\n' > "$W/ancien"
check "l'ancien réglage est détecté" 'nodyx_caddyfile_needs_ip_fix "$W/ancien"'

echo "── migration d'une installation existante"
# Une installation faite avec l'ANCIEN install.sh : .env sans secret interne et
# lisible par tous, ecosystem au format exact de l'ancien installeur, Caddyfile
# avec l'ancien « header_up -X-Forwarded-For ».
old_install() { # <dossier> <direct|relay>
  mkdir -p "$1/nodyx-core" "$1/nodyx-frontend"
  printf 'JWT_SECRET=x\nFRONTEND_URL=https://communaute.example.org\n' > "$1/nodyx-core/.env"; chmod 644 "$1/nodyx-core/.env"
  echo 'PUBLIC_API_URL=x' > "$1/nodyx-frontend/.env"
  cat > "$1/ecosystem.config.js" <<'ECO'
module.exports = {
  apps: [
    {
      name: 'nodyx-core',
      script: 'dist/index.js',
      cwd: '/opt/nodyx/nodyx-core',
      watch: false,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'nodyx-frontend',
      script: 'build/index.js',
      cwd: '/opt/nodyx/nodyx-frontend',
      watch: false,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production', PORT: '4173', HOST: '127.0.0.1', ORIGIN: 'https://communaute.example.org', PRIVATE_API_SSR_URL: 'http://127.0.0.1:3000/api/v1' },
    },
  ],
}
ECO
  chmod 644 "$1/ecosystem.config.js"
  nodyx_caddyfile "$2" communaute.example.org | sed 's#^        import client_ip$#        header_up -X-Forwarded-For#' > "$1/Caddyfile"
}
migrate() { NODYX_CADDYFILE="$1/Caddyfile" NODYX_CADDY_RELOAD=true NODYX_LANG=fr nodyx_migrate_client_ip "$1" 2>&1; }

M="$W/mig1"; old_install "$M" direct
check "l'installation simulée porte bien l'ancien réglage" 'nodyx_caddyfile_needs_ip_fix "$M/Caddyfile"'
GOT="$(migrate "$M")"
check "secret interne ajouté au .env" '[[ $(grep -c "^INTERNAL_API_SECRET=[0-9a-f]\{64\}$" "$M/nodyx-core/.env") -eq 1 ]]'
check "ecosystem : le frontend reçoit le MÊME secret, l'en-tête d'IP et sa profondeur" 'node -e "const a=require(process.argv[1]).apps.find(x=>x.name===\"nodyx-frontend\").env; process.exit(a.INTERNAL_API_SECRET===process.argv[2]&&a.ADDRESS_HEADER===\"x-forwarded-for\"&&a.XFF_DEPTH===\"1\"?0:1)" "$M/ecosystem.config.js" "$(grep "^INTERNAL_API_SECRET=" "$M/nodyx-core/.env" | cut -d= -f2)"'
check "Caddyfile corrigé, validé, et l'ancien sauvegardé" '! nodyx_caddyfile_needs_ip_fix "$M/Caddyfile" && caddy validate --config "$M/Caddyfile" --adapter caddyfile >/dev/null 2>&1 && ls "$M"/Caddyfile.avant-ip-visiteur-* >/dev/null 2>&1'
check "fichiers de secrets plus lisibles par les autres" '[[ "$(stat -c %A "$M/nodyx-core/.env" | cut -c8-10)" == "---" && "$(stat -c %A "$M/ecosystem.config.js" | cut -c8-10)" == "---" ]]'
H1="$(md5sum "$M/nodyx-core/.env" "$M/ecosystem.config.js" "$M/Caddyfile" | md5sum)"
GOT="$(migrate "$M")"
check "relancer la migration ne change plus rien (idempotente)" '[[ "$(md5sum "$M/nodyx-core/.env" "$M/ecosystem.config.js" "$M/Caddyfile" | md5sum)" == "$H1" && $(ls "$M"/Caddyfile.avant-ip-visiteur-* | wc -l) -eq 1 ]]'

M="$W/mig2"; old_install "$M" relay
GOT="$(migrate "$M")"
check "mode relais : migré vers le Caddyfile relais (tunnel seul cru)" 'grep -q "trusted_proxies static 127.0.0.1/8" "$M/Caddyfile" && ! nodyx_caddyfile_needs_ip_fix "$M/Caddyfile"'

M="$W/mig3"; old_install "$M" direct
printf '\nautre-site.example.com {\n  respond "ok"\n}\n' >> "$M/Caddyfile"; H1="$(md5sum < "$M/Caddyfile")"
GOT="$(migrate "$M")"
check "autre site présent : Caddyfile INTACT et marche à suivre affichée" '[[ "$(md5sum < "$M/Caddyfile")" == "$H1" ]] && grep -q "header_up X-Forwarded-For {client_ip}" <<<"$GOT"'

M="$W/mig4"; old_install "$M" direct
sed -i "s#PRIVATE_API_SSR_URL: 'http://127.0.0.1:3000/api/v1' },#PRIVATE_API_SSR_URL: 'http://127.0.0.1:3000/api/v1', AUTRE: 'x' },#" "$M/ecosystem.config.js"; H1="$(md5sum < "$M/ecosystem.config.js")"
GOT="$(migrate "$M")"
check "ecosystem de forme inattendue : laissé INTACT, consigne affichée" '[[ "$(md5sum < "$M/ecosystem.config.js")" == "$H1" ]] && grep -q "forme inattendue" <<<"$GOT" && [[ ! -e "$M/ecosystem.config.js.avant-ip-visiteur" ]]'

echo "── modèles d'install.sh (installation neuve)"
GOT=""
# Le VRAI modèle d'ecosystem.config.js d'install.sh, extrait et rempli.
# Comparaison de texte exacte (pas d'expression régulière) de la ligne d'ouverture.
heredoc() { awk -v start="$2" -v end="$3" '$0 == start {f=1; next} f && $0 == end {exit} f' "$ROOT/install.sh" > "$1"; }
heredoc "$W/eco.tpl" 'cat > "${NODYX_DIR}/ecosystem.config.js" <<PM2' 'PM2'
NODYX_DIR=/opt/nodyx DOMAIN=communaute.example.org _PM2_CORE_MEM=512M _PM2_FRONT_MEM=512M INTERNAL_API_SECRET=abc123 \
  envsubst < "$W/eco.tpl" > "$W/eco.js" 2>/dev/null || eval "cat <<__E__
$(cat "$W/eco.tpl")
__E__" > "$W/eco.js"
check "modèle d'ecosystem trouvé dans install.sh" '[[ -s "$W/eco.tpl" ]]'
check "ecosystem neuf : le frontend reçoit secret, en-tête d'IP et profondeur" 'node -e "const a=require(process.argv[1]).apps.find(x=>x.name===\"nodyx-frontend\").env; process.exit(a.INTERNAL_API_SECRET===\"abc123\"&&a.ADDRESS_HEADER===\"x-forwarded-for\"&&a.XFF_DEPTH===\"1\"?0:1)" "$W/eco.js"'
heredoc "$W/env.tpl" 'cat > "${NODYX_DIR}/nodyx-core/.env" <<COREENV' 'COREENV'
check ".env neuf du core : contient INTERNAL_API_SECRET" 'grep -q "^INTERNAL_API_SECRET=\${INTERNAL_API_SECRET}$" "$W/env.tpl"'
check "install.sh ne contient plus l'ancien réglage" '! grep -qE "^[[:space:]]*header_up[[:space:]]+-X-Forwarded-For" "$ROOT/install.sh"'
check "install.sh protège les fichiers de secrets (chmod 600)" 'grep -q "^chmod 600 \"\${NODYX_DIR}/ecosystem.config.js\" \"\${NODYX_DIR}/nodyx-core/.env\"" "$ROOT/install.sh"'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
