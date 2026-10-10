#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc « l'installeur ne casse ni ne perd de données ».
#
#  Défauts corrigés le 03/10/2026, chacun rejoué ici :
#   - .env écrit sans délimiteurs : dotenv coupait au premier « # » (un mot de
#     passe SMTP « abc#123 » devenait « abc », un nom « … #1 » perdait la fin) ;
#   - mot de passe admin passé en argument (visible de tous via `ps`) dans un
#     JSON concaténé à la main, cassé par un « " » ou un « \ » ;
#   - JSON de l'annuaire concaténé à la main, cassé par un « " » dans le nom ;
#   - pg_dropcluster sur un PostgreSQL existant aux données rangées ailleurs
#     que l'emplacement par défaut ;
#   - `sudo -u postgres` alors que sudo n'est ni installé ni garanti.
#  Le vrai dotenv du core (même version) relit chaque valeur.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

# dotenv : celui du core s'il est installé, sinon la même version, à part.
DOTENV_VER="$(node -p "require('$ROOT/nodyx-core/package.json').dependencies.dotenv")"
if [[ -f "$ROOT/nodyx-core/node_modules/dotenv/package.json" ]]; then DOTENV="$ROOT/nodyx-core/node_modules/dotenv"
else npm install --silent --no-audit --no-fund --prefix "$W/dotenv" "dotenv@$DOTENV_VER" >/dev/null 2>&1; DOTENV="$W/dotenv/node_modules/dotenv"; fi

extract() { awk -v f="$2() {" '$0 == f {p=1} p {print} p && $0 == "}" {exit}' "$1"; }
extract "$INSTALL" _env_quote            > "$W/q.install"
extract "$TUNNEL"  _env_quote            > "$W/q.tunnel"
extract "$INSTALL" _nodyx_directory_json > "$W/dir.fn"
extract "$INSTALL" _pg_datadir           > "$W/pg.fn"

PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

echo "── .env : chaque valeur relue À L'IDENTIQUE par dotenv $DOTENV_VER"
check "_env_quote présente et identique dans les deux installeurs" '[[ -s "$W/q.install" ]] && cmp -s "$W/q.install" "$W/q.tunnel"'
VALS=('abc#123' 'Les Vieux Looters #1' "L'Atelier" 'dit "bonjour"' 'a$b$HOME' 'c:\chemin\x' '  espaces  ' 'émoji 🎮' "mix #\"'\$" 'motdepasse\n' 'a=b=c' '#debut' 'fin#')
# shellcheck source=/dev/null
. "$W/q.install"
: > "$W/env"; i=0
for v in "${VALS[@]}"; do printf 'K%d=%s\n' "$i" "$(_env_quote "$v")" >> "$W/env"; i=$((i+1)); done
printf '%s\0' "${VALS[@]}" > "$W/expected"
GOT="$(node -e "
  const d = require('$DOTENV'), fs = require('fs')
  const parsed = d.parse(fs.readFileSync('$W/env'))
  const exp = fs.readFileSync('$W/expected', 'utf8').split('\0').slice(0, -1)
  const bad = exp.map((v, i) => [v, parsed['K' + i]]).filter(([a, b]) => a !== b)
  console.log(bad.length ? JSON.stringify(bad) : 'ok')")"
check "${#VALS[@]} valeurs piégées (#, ', \", \$, \\, espaces, émojis) relues à l'identique" '[[ "$GOT" == ok ]]'
_env_quote "x\`y'z" >/dev/null; c=$?
check "valeur contenant ' ET \` : refusée (jamais écrite de travers)" '[[ $c -ne 0 ]]'
check "install.sh : chaque champ libre du .env passe par _env_quote" '! grep -qE "^(NODYX_COMMUNITY_(NAME|DESCRIPTION|LANGUAGE|COUNTRY)|SMTP_(HOST|USER|PASS|FROM))=\\$\\{" "$INSTALL"'
check "install_tunnel.sh : idem (nom et langue)" '! grep -qE "^NODYX_COMMUNITY_(NAME|LANGUAGE)=\\$\\{" "$TUNNEL"'

echo "── compte admin : JSON exact, mot de passe jamais en argument"
PWD_PIEGE='p"a\ss'"'"'w#rd$x`y'
for f in "$INSTALL" "$TUNNEL"; do
  snippet="$(grep -oE "node -e 'process.stdout.write\(JSON.stringify\(\{username: process.env.NX_U[^']*'" "$f" | head -1 | sed -E "s/^node -e '//; s/'$//")"
  GOT="$(NX_U=admin NX_E=a@b.c NX_P="$PWD_PIEGE" node -e "$snippet" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).password===process.argv[1]?'ok':'KO '+s))" "$PWD_PIEGE")"
  check "$(basename "$f") : mot de passe piégé transmis à l'identique" '[[ "$GOT" == ok ]]'
  # Aucun « -d » (corps en argument, donc visible via ps) autour d'un appel à auth/register.
  GOT="$(grep -nB2 -A6 'auth/register' "$f" | grep -E -- "(^|[[:space:]])-d[[:space:]]" | grep -v 'data-binary')"
  check "$(basename "$f") : le corps de l'inscription ne passe plus en argument de curl (-d)" '[[ -z "$GOT" ]]'
done

echo "── annuaire : JSON exact"
GOT="$(COMMUNITY_NAME='Le "Club" de l'"'"'Ouest' COMMUNITY_SLUG=club COMMUNITY_LANG=fr NODYX_VERSION=2.12.0 bash -c "$(cat "$W/dir.fn"); _nodyx_directory_json https://club.example.org" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.name==='Le \"Club\" de l\\'Ouest'&&j.url==='https://club.example.org'?'ok':'KO '+s)})")"
check "nom avec guillemets et apostrophe : JSON valide et exact" '[[ "$GOT" == ok ]]'
check "plus de JSON d'annuaire concaténé à la main" '! grep -qE "\\\\\"name\\\\\": +\\\\\"\\$\\{COMMUNITY_NAME\\}" "$INSTALL"'

echo "── PostgreSQL : jamais supprimer un dossier de données existant"
mkdir -p "$W/bin" "$W/pgdata/custom" "$W/pgdata/vide"; touch "$W/pgdata/custom/PG_VERSION"
printf '#!/bin/bash\necho "$PGDIR"\n' > "$W/bin/pg_conftool"; chmod +x "$W/bin/pg_conftool"
pgd() { GOT="$(PATH="$W/bin:$PATH" PGDIR="$1" bash -c "$(cat "$W/pg.fn"); _pg_datadir 16")"; }
pgd "$W/pgdata/custom"; check "dossier configuré ailleurs : c'est LUI qui est examiné" '[[ "$GOT" == "$W/pgdata/custom" ]]'
pgd "";                 check "rien de configuré : emplacement standard" '[[ "$GOT" == /var/lib/postgresql/16/main ]]'
L_DIR="$(grep -nF '_PG_DATADIR="$(_pg_datadir' "$INSTALL" | head -1 | cut -d: -f1)"
L_CHK="$(grep -nF 'if [[ -d "$_PG_DATADIR" && -n "$(ls -A "$_PG_DATADIR"' "$INSTALL" | head -1 | cut -d: -f1)"
L_DROP="$(grep -nE '^ +pg_dropcluster ' "$INSTALL" | head -1 | cut -d: -f1)"
GOT="dossier:$L_DIR contrôle:$L_CHK pg_dropcluster:$L_DROP"
check "pg_dropcluster vient APRÈS le contrôle du dossier configuré, dans sa branche « vide »" '[[ -n "$L_DIR" && -n "$L_CHK" && -n "$L_DROP" && $L_DIR -lt $L_CHK && $L_CHK -lt $L_DROP && $((L_DROP - L_CHK)) -le 4 ]]'

echo "── sudo (issue #784 : absent d'une Debian 13 minimale, l'installation s'arrêtait à PostgreSQL)"
# Deux règles simples, sans analyseur de shell :
#  1. aucun « sudo -u » nulle part, même dans un message (runuser fait pareil
#     et existe toujours : util-linux, priorité required) ;
#  2. aucun sudo en position de COMMANDE (début de ligne, après $( | && || ; then if !).
#     Un message qui conseille « sudo nodyx-update » reste permis.
for f in "$INSTALL" "$TUNNEL" "$ROOT/uninstall.sh" "$ROOT"/scripts/install/*.sh; do
  GOT="$(grep -nE 'sudo -u ' "$f" | grep -vE '^[0-9]+:[[:space:]]*#')"
  check "$(basename "$f") : aucun « sudo -u » (runuser à la place)" '[[ -z "$GOT" ]]'
  GOT="$(grep -nE '(^|\$\(|[|;&!]|\bthen|\bif|\bdo|\belse)[[:space:]]*sudo[[:space:]]' "$f" \
    | grep -vE '^[0-9]+:[[:space:]]*(#|T_(EN|FR)\[|echo |printf |warn |info |die |ok |skip |_hc_|_pass |_warn |_fail )')"
  check "$(basename "$f") : aucun sudo exécuté" '[[ -z "$GOT" ]]'
done

echo "── Debian minimale : outils absents tant que les paquets ne sont pas installés"
# Debian 13 netinst sans « utilitaires standard » : ni sudo (#784), ni openssl,
# ni psmisc (fuser). L'ordre des opérations doit en tenir compte.
ligne() { grep -nF -- "$2" "$1" | head -1 | cut -d: -f1; }
for f in "$INSTALL" "$TUNNEL"; do
  N="$(basename "$f")"
  # D'après le contenu : install.sh installe $_SYS_PKGS, le tunnel une liste en ligne.
  APT="$(ligne "$f" 'apt-get install -y -q $_SYS_PKGS')"
  [[ -n "$APT" ]] || APT="$(grep -nE '^  fonts-dejavu-core \\$' "$f" | head -1 | cut -d: -f1)"
  SSL="$(ligne "$f" 'command -v openssl >/dev/null || die')"
  GEN="$(grep -nE '^[A-Z_]+=\$\(gen_(pass|secret)\)' "$f" | head -1 | cut -d: -f1)"
  GOT="paquets:$APT openssl vérifié:$SSL 1er secret:$GEN"
  check "$N : secrets générés APRÈS l'installation des paquets (openssl), présence vérifiée" '[[ -n "$APT" && -n "$SSL" && -n "$GEN" && $APT -lt $SSL && $SSL -lt $GEN ]]'
  GOT="$(grep -nF 'pkg_install_failed' "$f" | grep -c die)"
  check "$N : un échec d'apt s'annonce clairement (plus d'arrêt muet)" '[[ $GOT -ge 1 ]]'
done
# Exécution réelle de la section (paquets → openssl → secrets), avec un PATH
# minimal : openssl présent, openssl ABSENT, apt en échec.
mkdir -p "$W/min-avec" "$W/min-sans"
for d in min-avec min-sans; do
  for b in tr head cat; do ln -sf "$(command -v "$b")" "$W/$d/$b"; done
  printf '#!/bin/bash\n[[ -n "$APT_ECHEC" && "$*" == *install* ]] && exit 100\nexit 0\n' > "$W/$d/apt-get"; chmod +x "$W/$d/apt-get"
done
ln -sf "$(command -v openssl)" "$W/min-avec/openssl"
block() { awk -v a="$2" -v b="$3" 'index($0, a) == 1 {p=1} p {print} p && index($0, b) == 1 {exit}' "$1"; }
section() { # <installeur> <dossier PATH> <APT_ECHEC>
  local deb
  # D'après le CONTENU, pas le nom (une copie de main s'appelle autrement).
  if grep -qF 'step "$(t step_install_deps)"' "$1"; then deb='step "$(t step_install_deps)"'; else deb='step "$(t step_packages)"'; fi
  GOT="$(env -i PATH="$W/$2" APT_ECHEC="$3" /bin/bash -c "set -euo pipefail
    t() { printf '%s' \"\$1\"; }; step() { :; }; ok() { :; }; info() { :; }; warn() { :; }
    die() { echo \"DIE \$*\"; exit 1; }
    $(grep -E '^gen_(secret|pass)\(\)' "$1")
    $(block "$1" "$deb" 'INTERNAL_API_SECRET=$(gen_secret)')
    echo \"SECRETS jwt=\${#JWT_SECRET} db=\${#DB_PASSWORD} interne=\${#INTERNAL_API_SECRET}\"" 2>&1)"; CODE=$?
}
for f in "$INSTALL" "$TUNNEL"; do
  N="$(basename "$f")"
  section "$f" min-avec ""
  check "$N : openssl présent : secrets générés (64 hex, mot de passe non vide)" '[[ $CODE -eq 0 && "$GOT" == *"SECRETS jwt=64"* && "$GOT" != *"db=0"* && "$GOT" == *"interne=64"* ]]'
  section "$f" min-sans ""
  check "$N : openssl ABSENT : arrêt clair, aucun secret vide" '[[ $CODE -ne 0 && "$GOT" == *"DIE openssl_missing"* && "$GOT" != *SECRETS* ]]'
  section "$f" min-avec 1
  check "$N : apt en échec : arrêt clair avant tout secret" '[[ $CODE -ne 0 && "$GOT" == *"DIE pkg_install_failed"* && "$GOT" != *SECRETS* ]]'
done
PS="$(ligne "$INSTALL" 'apt-get install -y -q psmisc')"
FU="$(grep -nE '^[[:space:]]+fuser -k' "$INSTALL" | head -1 | cut -d: -f1)"
GOT="psmisc:$PS fuser:$FU"
check "install_tunnel.sh : sans curl, pas de fausse alerte « HTTPS en panne »" 'grep -qF "elif command -v curl >/dev/null && ! curl -fsS" "$TUNNEL"'
check "install.sh : psmisc installé avant fuser (sinon « libérer les ports » ne faisait rien)" '[[ -n "$PS" && -n "$FU" && $PS -lt $FU ]]'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
