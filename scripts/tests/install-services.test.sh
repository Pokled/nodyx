#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc des services nodyx-relay-client et nodyx-turn d'install.sh.
#
#  Avant le 04/10/2026, le jeton de l'annuaire et le secret TURN étaient des
#  ARGUMENTS : lisibles par tout utilisateur via `ps`, et le jeton en clair dans
#  l'unité systemd (lisible par tous). La mise à jour recréait aussi le relais
#  sur relay.nodyx.org:7443, cassant les instances passées par wss://.
#  Les fonctions sont extraites telles quelles et jouées dans un faux /etc.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }
fn() { awk -v f="$1() {" -v g="$1() { #" '$0 == f || index($0, g) == 1 {p=1} p {print} p && $0 == "}" {exit}' "$INSTALL"; }
{ fn _nodyx_write_relay_unit; fn _nodyx_write_turn_unit; fn _nodyx_migrate_service_secrets; } > "$W/fns"
check "les trois fonctions sont dans install.sh" '[[ $(grep -c "^_nodyx_[a-z_]*() {" "$W/fns") -eq 3 ]]'

run() { # <racine> <code>
  GOT="$(NODYX_TEST_ROOT="$1" bash -c "set -euo pipefail; $(cat "$W/fns"); $2" 2>&1)"; CODE=$?
}
perm() { stat -c %a "$1"; }
TOK=f00dcafe1234567890abcdef

echo "── installation"
R="$W/neuf"; run "$R" "_nodyx_write_relay_unit wss://tunnel.nodyx.org/tunnel ma-commu $TOK"
U="$R/etc/systemd/system/nodyx-relay-client.service"; E="$R/etc/nodyx/relay.env"
check "relais : le jeton n'est PAS dans l'unité" '[[ -f "$U" ]] && ! grep -q "$TOK" "$U" && ! grep -q -- "--token" "$U"'
check "relais : jeton, serveur et slug dans relay.env, en 600" '[[ "$(perm "$E")" == 600 ]] && grep -qx "NODYX_RELAY_TOKEN=$TOK" "$E" && grep -qx "NODYX_RELAY_SERVER=wss://tunnel.nodyx.org/tunnel" "$E" && grep -qx "NODYX_RELAY_SLUG=ma-commu" "$E"'
check "relais : l'unité charge relay.env, serveur et slug par variables" 'grep -qx "EnvironmentFile=/etc/nodyx/relay.env" "$U" && grep -qF -- "--server \${NODYX_RELAY_SERVER} --slug \${NODYX_RELAY_SLUG}" "$U"'
run "$R" "_nodyx_write_turn_unit"
T="$R/etc/systemd/system/nodyx-turn.service"
check "TURN : plus rien en argument, tout vient de /etc/nodyx-turn.env" 'grep -qx "ExecStart=/usr/local/bin/nodyx-turn server" "$T" && ! grep -q -- "--secret" "$T" && grep -qx "EnvironmentFile=/etc/nodyx-turn.env" "$T"'

echo "── migration des installations existantes"
old_multi() { mkdir -p "$1/etc/systemd/system"; cat > "$1/etc/systemd/system/nodyx-relay-client.service" <<EOF
[Service]
ExecStart=/usr/local/bin/nodyx-relay client \\
  --server wss://tunnel.nodyx.org/tunnel \\
  --slug ma-commu \\
  --token $TOK \\
  --local-port 80
User=nodyx
EOF
}
R="$W/ancien1"; old_multi "$R"; run "$R" "_nodyx_migrate_service_secrets && echo migre"
check "ancienne unité multi-ligne : migrée, serveur wss:// CONSERVÉ" '[[ "$GOT" == *migre* ]] && grep -qx "NODYX_RELAY_SERVER=wss://tunnel.nodyx.org/tunnel" "$R/etc/nodyx/relay.env" && grep -qx "NODYX_RELAY_TOKEN=$TOK" "$R/etc/nodyx/relay.env" && ! grep -q "$TOK" "$R/etc/systemd/system/nodyx-relay-client.service"'

R="$W/ancien2"; mkdir -p "$R/etc/systemd/system"
printf '[Service]\nExecStart=/usr/local/bin/nodyx-relay client --server relay6.nodyx.org:7443 --slug autre --token %s --local-port 80\n' "$TOK" > "$R/etc/systemd/system/nodyx-relay-client.service"
run "$R" "_nodyx_migrate_service_secrets && echo migre"
check "ancienne unité sur une ligne (recréée par la mise à jour) : migrée" '[[ "$GOT" == *migre* ]] && grep -qx "NODYX_RELAY_SERVER=relay6.nodyx.org:7443" "$R/etc/nodyx/relay.env" && grep -qx "NODYX_RELAY_SLUG=autre" "$R/etc/nodyx/relay.env"'

R="$W/turn"; mkdir -p "$R/etc/systemd/system"; echo "TURN_SECRET=s3cr3t" > "$R/etc/nodyx-turn.env"
printf '[Service]\nEnvironmentFile=/etc/nodyx-turn.env\nExecStart=/usr/local/bin/nodyx-turn server \\\n  --secret ${TURN_SECRET}\n' > "$R/etc/systemd/system/nodyx-turn.service"
run "$R" "_nodyx_migrate_service_secrets && echo migre"
check "ancienne unité TURN : réécrite sans --secret" '[[ "$GOT" == *migre* ]] && ! grep -q -- "--secret" "$R/etc/systemd/system/nodyx-turn.service"'

R="$W/turn-sans-env"; mkdir -p "$R/etc/systemd/system"
printf '[Service]\nExecStart=/usr/local/bin/nodyx-turn server --secret abc\n' > "$R/etc/systemd/system/nodyx-turn.service"
run "$R" "_nodyx_migrate_service_secrets && echo migre || echo rien"
check "TURN sans /etc/nodyx-turn.env : NON réécrit (il perdrait sa configuration)" '[[ "$GOT" == *rien* ]] && grep -q -- "--secret abc" "$R/etc/systemd/system/nodyx-turn.service"'

R="$W/deja"; run "$R" "_nodyx_write_relay_unit relay.nodyx.org:7443 ma-commu $TOK; _nodyx_write_turn_unit"
H="$(cat "$R"/etc/systemd/system/*.service "$R/etc/nodyx/relay.env" | md5sum)"
run "$R" "_nodyx_migrate_service_secrets && echo migre || echo rien"
check "déjà migré : rien n'est touché" '[[ "$GOT" == *rien* && "$(cat "$R"/etc/systemd/system/*.service "$R/etc/nodyx/relay.env" | md5sum)" == "$H" ]]'

echo "── install.sh"
GOT="$(grep -nE -- '--(token|secret) \$|--(token|secret) \\\$' "$INSTALL")"
check "plus aucun secret passé en argument d'un service" '[[ -z "$GOT" ]]'
check "la mise à jour appelle la migration" 'grep -q "if _nodyx_migrate_service_secrets; then" "$INSTALL"'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
