#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc des binaires téléchargés par install.sh et exécutés en root
#  (nodyx-turn, nodyx-sfud, nodyx-relay).
#
#  Avant le 04/10/2026, seul « c'est un ELF » était vérifié : une publication
#  remplacée sur GitHub aurait été installée en root sans que rien ne le voie.
#  Désormais chaque fichier a son empreinte SHA-256 épinglée dans install.sh.
#
#  Avec NODYX_TEST_GITHUB=1 (la CI), les empreintes épinglées sont aussi
#  comparées à celles que GitHub publie pour chaque fichier : une publication
#  remplacée ou une empreinte mal recopiée fait échouer le banc.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin" "$W/srv"
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

awk '/^declare -A NODYX_BIN_SHA256=\(/ {p=1} p {print} p && $0 == ")" {exit}' "$INSTALL" > "$W/pins"
awk '$0 == "_nodyx_fetch_bin() {" {p=1} p {print} p && $0 == "}" {exit}' "$INSTALL" > "$W/fetch"
check "table des empreintes trouvée" '[[ -s "$W/pins" ]]'
check "_nodyx_fetch_bin trouvée" '[[ -s "$W/fetch" ]]'

# Faux GitHub : sert ./srv/<version>/<fichier>, journalise chaque appel.
cat > "$W/bin/curl" <<'EOF'
#!/bin/bash
url=""; out=""
while [[ $# -gt 0 ]]; do case "$1" in -o) out="$2"; shift 2 ;; http*) url="$1"; shift ;; *) shift ;; esac; done
echo "$url" >> "$SRV/../appels"
f="$SRV/${url#https://github.com/Pokled/nodyx/releases/download/}"
[[ -f "$f" ]] || exit 22
cp "$f" "$out"
EOF
chmod +x "$W/bin/curl"

# fetch <version> <fichier> : appelle la vraie fonction, avec une empreinte de test ajoutée.
fetch() {
  : > "$W/appels"; rm -f "$W/dest"
  GOT="$(PATH="$W/bin:$PATH" SRV="$W/srv" bash -c "set -euo pipefail
    t() { printf '%s' \"\$1\"; }; warn() { echo \"WARN \$*\"; }
    $(cat "$W/pins")
    NODYX_BIN_SHA256[test-v1/outil-linux-amd64]=$(printf 'binaire-officiel' | sha256sum | cut -d' ' -f1)
    $(cat "$W/fetch")
    _nodyx_fetch_bin '$1' '$2' '$W/dest' && _rc=0 || _rc=\$?
    echo \"code=\$_rc\"" 2>&1)"
}

TMP_AVANT="$(find /tmp -maxdepth 1 -name "nodyx-bin.*" 2>/dev/null | wc -l)"
echo "── _nodyx_fetch_bin"
mkdir -p "$W/srv/test-v1"
printf 'binaire-officiel' > "$W/srv/test-v1/outil-linux-amd64"
fetch test-v1 outil-linux-amd64
check "fichier conforme : installé, exécutable" '[[ "$GOT" == *"code=0"* && -x "$W/dest" ]] && [[ "$(cat "$W/dest")" == binaire-officiel ]]'
printf 'binaire-PIÉGÉ' > "$W/srv/test-v1/outil-linux-amd64"
fetch test-v1 outil-linux-amd64
check "fichier altéré : REFUSÉ, rien d'installé" '[[ "$GOT" == *"code=3"* && "$GOT" == *bin_checksum_bad* && ! -e "$W/dest" ]]'
fetch test-v9 outil-linux-amd64
check "version sans empreinte : refusée SANS même télécharger" '[[ "$GOT" == *"code=2"* && ! -s "$W/appels" && ! -e "$W/dest" ]]'
fetch test-v1 absent-linux-amd64
check "aucune empreinte pour ce fichier : refusé" '[[ "$GOT" == *"code=2"* ]]'
NODYX_PIN_TMP="$(printf 'x' | sha256sum | cut -d' ' -f1)"
sed -i "s#^)\$#  [test-v1/absent-linux-amd64]=$NODYX_PIN_TMP\n)#" "$W/pins"
fetch test-v1 absent-linux-amd64
check "téléchargement impossible : code 1, rien d'installé" '[[ "$GOT" == *"code=1"* && ! -e "$W/dest" ]]'
check "aucun fichier temporaire laissé dans /tmp par les échecs" '[[ "$(find /tmp -maxdepth 1 -name "nodyx-bin.*" 2>/dev/null | wc -l)" -eq "$TMP_AVANT" ]]'

echo "── chaque binaire téléchargé par install.sh a son empreinte"
turn_v="$(grep -oE '_TURN_VERSION="[^"]+"' "$INSTALL" | head -1 | cut -d'"' -f2)"
sfu_v="$(grep -oE '_SFU_VERSION="[^"]+"' "$INSTALL" | head -1 | cut -d'"' -f2)"
relay_v="$(grep -oE '^NODYX_RELAY_VERSION="[^"]+"' "$INSTALL" | cut -d'"' -f2)"
check "versions lues dans install.sh" '[[ -n "$turn_v" && -n "$sfu_v" && -n "$relay_v" ]]'
for arch in amd64 arm64; do
  for key in "$turn_v/nexus-turn-linux-$arch" "$sfu_v/nodyx-sfud-linux-$arch" "$relay_v/nodyx-relay-linux-$arch"; do
    check "empreinte épinglée : $key" 'grep -qE "^  \[$key\]=[0-9a-f]{64}$" "$W/pins"'
  done
done
check "plus aucun téléchargement vérifié seulement par « c'est un ELF »" '! grep -qE "file \"\\\$_(TURN|SFU|RELAY)_TMP\"" "$INSTALL"'
N_APPELS="$(grep -cF '_nodyx_fetch_bin "$' "$INSTALL")"; N_RC="$(grep -cF '&& _rc=0 || _rc=$?' "$INSTALL")"
GOT="appels=$N_APPELS captures=$N_RC"
check "les 4 téléchargements passent par _nodyx_fetch_bin (sans faire sauter set -e)" '[[ $N_APPELS -eq 4 && $N_RC -eq 3 ]]'

if [[ "${NODYX_TEST_GITHUB:-0}" == 1 ]]; then
  echo "── empreintes épinglées == empreintes publiées par GitHub"
  auth=(); [[ -n "${GITHUB_TOKEN:-}" ]] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  while IFS='=' read -r key sum; do
    key="${key#  [}"; key="${key%]}"; ver="${key%%/*}"; asset="${key#*/}"
    gh_sum="$(command curl -fsSL "${auth[@]}" "https://api.github.com/repos/Pokled/nodyx/releases/tags/$ver" \
      | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const a=JSON.parse(s).assets.find(x=>x.name===process.argv[1]);console.log(a&&a.digest?a.digest.replace('sha256:',''):'absent')})" "$asset")"
    GOT="$gh_sum"
    check "GitHub confirme $key" '[[ "$gh_sum" == "$sum" ]]'
  done < <(awk '/^declare -A NODYX_BIN_SHA256=\(/ {p=1} p {print} p && $0 == ")" {exit}' "$INSTALL" | grep -E '^  \[[^]]+\]=[0-9a-f]{64}$')
fi

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
