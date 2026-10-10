#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034,SC2016
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc de l'accès de secours (04/10/2026).
#
#  Avant : le mot de passe admin restait en clair dans
#  /root/nodyx-credentials.txt (et dans toutes les sauvegardes de /root), alors
#  que l'administrateur l'a choisi lui-même. L'outil de secours `nodyx-recover`
#  existait dans le core mais n'était installé nulle part, et `npm run recover`
#  plantait (ts-node 10 avec TypeScript 7).
#  Les fonctions et blocs sont extraits tels quels et EXÉCUTÉS.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
PKG="${CORE_PACKAGE_JSON:-$ROOT/nodyx-core/package.json}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }
fn() { awk -v f="$2() {" -v g="$2() { #" '$0 == f || index($0, g) == 1 {p=1} p {print} p && $0 == "}" {exit}' "$1"; }
block() { awk -v a="$2" -v b="$3" 'index($0, a) == 1 {p=1} p {print} p && index($0, b) == 1 {exit}' "$1"; }

echo "── nodyx-recover"
fn "$INSTALL" _nodyx_write_recover_script > "$W/r.i"; fn "$TUNNEL" _nodyx_write_recover_script > "$W/r.t"
check "même générateur dans les deux installeurs" '[[ -s "$W/r.i" ]] && cmp -s "$W/r.i" "$W/r.t"'
mkdir -p "$W/opt/nodyx/nodyx-core" "$W/bin"
printf '#!/bin/bash\necho "node $* (dans $PWD)"\n' > "$W/bin/node"; chmod +x "$W/bin/node"
bash -c "$(cat "$W/r.i"); _nodyx_write_recover_script '$W/nodyx-recover' '$W/opt/nodyx'"
check "lanceur écrit, exécutable, syntaxe valide" '[[ -x "$W/nodyx-recover" ]] && bash -n "$W/nodyx-recover"'
check "refuse sans root" 'grep -qF "[[ \$EUID -eq 0 ]] ||" "$W/nodyx-recover"'
# Joué sans la garde root : il doit lancer la version COMPILÉE, dans le bon dossier.
GOT="$(PATH="$W/bin:$PATH" bash <(sed 's/^\[\[ \$EUID -eq 0 \]\] ||.*$/:/' "$W/nodyx-recover") --reset admin 2>&1)"
check "lance dist/scripts/recover.js, depuis <instance>/nodyx-core, arguments transmis" '[[ "$GOT" == "node dist/scripts/recover.js --reset admin (dans $W/opt/nodyx/nodyx-core)" ]]'
check "installé à l'installation ET à chaque mise à jour (install.sh)" '[[ $(grep -c "_nodyx_write_recover_script /usr/local/bin/nodyx-recover" "$INSTALL") -eq 2 ]]'
check "installé à l'installation ET à chaque mise à jour (tunnel)" '[[ $(grep -c "_nodyx_write_recover_script /usr/local/bin/nodyx-recover" "$TUNNEL") -eq 2 ]]'
GOT="$(node -p "require('$PKG').scripts.recover")"
check "npm run recover : version compilée (ts-node plante avec TypeScript 7)" '[[ "$GOT" == "node dist/scripts/recover.js" ]]'

echo "── mot de passe admin hors du fichier d'identifiants"
for INST in "$INSTALL" "$TUNNEL"; do
  N="$(basename "$INST")"
  GOT="$(grep -n 'Admin password   :' "$INST")"
  check "$N : le fichier d'identifiants ne reçoit plus \${ADMIN_PASSWORD}" '! grep -qF "Admin password   : \${ADMIN_PASSWORD}" "$INST" && grep -qF "sudo nodyx-recover --reset" "$INST"'
  AV="$(block "$INST" "  if grep -qE '^Admin password   : [^(]'" '  fi' | sed "s#/root/nodyx-credentials.txt#$W/creds-$N#g")"
  avert() { GOT="$(bash -c "warn() { echo \"WARN \$*\"; }; t() { printf '%s' \"\$1\"; }; $AV" 2>&1)"; }
  printf 'Admin username   : admin\nAdmin password   : MotDePasse1\n' > "$W/creds-$N"; cp "$W/creds-$N" "$W/avant-$N"
  avert
  check "$N : ancien fichier avec le mot de passe : signalé à la mise à jour" '[[ "$GOT" == *creds_password_kept* ]]'
  check "$N : ... mais jamais modifié d'office" 'cmp -s "$W/creds-$N" "$W/avant-$N"'
  printf 'Admin password   : (non conservé : celui choisi à l installation.)\n' > "$W/creds-$N"
  avert
  check "$N : nouveau fichier : aucun avertissement" '[[ -z "$GOT" ]]'
done

if [[ -f /opt/demo/nodyx-core/dist/scripts/recover.js ]] && [[ $EUID -eq 0 ]]; then
  echo "── vrai outil, sur une instance réelle (lecture seule : --list)"
  GOT="$(cd /opt/demo/nodyx-core && timeout 60 runuser -u nodyx -- node dist/scripts/recover.js --list 2>&1 | grep -c 'owner')"
  check "dist/scripts/recover.js --list répond (instance demo)" '[[ "$GOT" -ge 1 ]]'
fi

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
