#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc des confirmations d'install.sh.
#
#  Avant le 03/10/2026, `_confirm` prenait tout ce qui n'était pas exactement
#  « n » pour un OUI : répondre « non » à « Démarrer l'installation ? » lançait
#  l'installation (pare-feu, Caddyfile, base…). Et Entrée, face à un nginx ou un
#  Apache en place, l'ARRÊTAIT et le DÉSACTIVAIT.
#
#  _confirm et la lecture des sites Caddy sont extraits tels quels d'install.sh.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
. "$ROOT/scripts/install/caddyfile.sh"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT

extract() { awk -v f="$2() {" '$0 == f || index($0, f " #") == 1 {p=1} p {print} p && $0 == "}" {exit}' "$1"; }
extract "$INSTALL" _confirm > "$W/confirm.fn"
extract "$INSTALL" _nodyx_caddy_other_sites > "$W/sites.fn"

PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

# answer <réponses (\n entre deux)> <défaut> [auto-yes] : code de retour de _confirm.
answer() {
  printf '%b' "$1" > "$W/tty"
  GOT="$(bash -c "
    t() { printf '%s' \"\$1\"; }; info() { :; }; warn() { echo \"WARN \$*\"; }; BOLD=''; RESET=''
    _AUTO_YES=${3:-false}; _NODYX_TTY='$W/tty'
    $(cat "$W/confirm.fn")
    _confirm 'Démarrer ?' $2; echo \"code:\$?\"" 2>&1)"
}

echo "── _confirm"
check "_confirm trouvée dans install.sh" '[[ -s "$W/confirm.fn" ]]'
for r in non no n N 'N ' NON; do
  answer "$r\n" y; check "« $r » (défaut oui) = NON" '[[ "$GOT" == *"code:1" ]]'
done
for r in oui o y yes OUI; do
  answer "$r\n" n; check "« $r » (défaut non) = OUI" '[[ "$GOT" == *"code:0" ]]'
done
answer "\n" y;  check "Entrée, défaut oui = OUI" '[[ "$GOT" == *"code:0" ]]'
answer "\n" n;  check "Entrée, défaut non = NON" '[[ "$GOT" == *"code:1" ]]'
answer "peut-être\nnon\n" y; check "réponse incomprise : la question est REPOSÉE, puis « non » = NON" '[[ "$GOT" == *"confirm_invalid"* && "$GOT" == *"code:1" ]]'
answer "" y;    check "fin d'entrée (aucune réponse) = NON" '[[ "$GOT" == *"code:1" ]]'
answer "" n true; check "--yes = OUI sans rien lire" '[[ "$GOT" == *"code:0" ]]'

echo "── conflit de ports avec un serveur web"
check "Entrée = annuler (3), jamais « arrêter et désactiver »" 'grep -qF "_port_choice=\"\${_port_choice:-3}\"" "$INSTALL"'

echo "── Caddyfile : autres sites détectés avant de commencer"
check "_nodyx_caddy_other_sites trouvée dans install.sh" '[[ -s "$W/sites.fn" ]]'
others() { GOT="$(bash -c "$(cat "$W/sites.fn"); _nodyx_caddy_other_sites '$1' '$2'")"; }
printf ':80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n' > "$W/stock"
others "$W/stock" communaute.example.org;   check "Caddyfile d'origine du paquet (:80) : aucun autre site" '[[ -z "$GOT" ]]'
nodyx_caddyfile direct communaute.example.org > "$W/nodyx"
others "$W/nodyx" communaute.example.org;   check "Caddyfile de Nodyx (même domaine, réinstallation) : aucun autre site" '[[ -z "$GOT" ]]'
cat "$W/nodyx" > "$W/mix"; printf '\n# un commentaire {\nblog.example.com, http://www.example.com {\n  handle {\n    respond "ok"\n  }\n}\n' >> "$W/mix"
others "$W/mix" communaute.example.org;     check "autres sites (y compris plusieurs adresses sur une ligne) : tous listés" '[[ "$GOT" == "blog.example.com http://www.example.com " ]]'
lib="$(nodyx_caddy_sites "$W/mix" | grep -vxE ':80|communaute\.example\.org' | tr '\n' ' ')"
check "même lecture que la bibliothèque (scripts/install/caddyfile.sh)" '[[ "$GOT" == "$lib" ]]'
others "$W/absent" communaute.example.org;  check "pas de Caddyfile : rien" '[[ -z "$GOT" ]]'
check "--yes ne peut pas décider de couper d'autres sites" 'grep -qF "\$_AUTO_YES && die \"\$(t caddy_other_sites_yes)\"" "$INSTALL"'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
