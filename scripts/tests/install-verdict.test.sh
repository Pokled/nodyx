#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034,SC2016
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc du verdict de fin d'installation (install.sh, install_tunnel.sh).
#
#  Avant le 04/10/2026, le bilan de santé comptait ses erreurs puis les
#  ignorait : bannière verte « INSTANCE ONLINE » et code de sortie 0 même avec
#  un service à terre. Une automatisation (Ansible, CI) croyait à un succès.
#  Le vocal (nodyx-sfud) n'était jamais contrôlé, même installé.
#  Les blocs sont extraits tels quels et EXÉCUTÉS.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }
# depuis <fichier> <début de ligne> : de la DERNIÈRE ligne qui commence ainsi jusqu'à la fin.
depuis() { local n; n="$(grep -n -F -- "$2" "$1" | tail -1 | cut -d: -f1)"; [[ -n "$n" ]] && tail -n +"$n" "$1"; }
block() { awk -v a="$2" -v b="$3" 'index($0, a) == 1 {p=1} p {print} p && index($0, b) == 1 {exit}' "$1"; }
COMMUN='info() { echo "INFO $*"; }; ok() { echo "OK $*"; }; warn() { echo "WARN $*"; }
t() { local k="$1"; shift; printf "%s" "$k"; (( $# )) && printf " [%s]" "$@"; return 0; }
RED="<rouge>"; GREEN="<vert>"; YELLOW=""; CYAN=""; BOLD=""; RESET=""'

echo "── install.sh : la fin suit le verdict du bilan"
FIN_I="$(depuis "$INSTALL" '# ── Score final')"
check "fin d'installation extraite" '[[ "$FIN_I" == *"HC_TOTAL="* ]]'
fin_i() { # <erreurs> <avertissements>
  GOT="$(bash -c "$COMMUN
    HC_PASS=9; HC_FAIL=$1; HC_WARN=$2; RELAY_MODE=false; NODYX_SUBDOMAIN=''; DOMAIN=commu.example.org
    ADMIN_USERNAME=admin; ADMIN_EMAIL=a@b.c; PUBLIC_IP=203.0.113.1; NODYX_VERSION=2.12.0
    NODYX_DIR=/opt/nodyx; DB_NAME=nodyx; CREDS_FILE=/root/c; RELAY_SERVER=''
    $FIN_I
    echo FIN-NORMALE" 2>&1)"; CODE=$?
}
fin_i 1 0
check "1 erreur : code de sortie NON nul" '[[ $CODE -ne 0 ]]'
check "1 erreur : bannière d'erreur, en rouge, jamais « en ligne »" '[[ "$GOT" == *"<rouge>"*banner_errors* && "$GOT" != *banner_online* ]]'
check "1 erreur : le message dit combien et renvoie vers nodyx-doctor" '[[ "$GOT" == *"install_errors_exit [1]"* ]]'
check "1 erreur : le récapitulatif (adresse, identifiants) reste affiché" '[[ "$GOT" == *summ_creds_arrow* && "$GOT" == *"https://commu.example.org"* ]]'
fin_i 0 2
check "avertissements seuls (DNS qui se propage) : code 0, bannière « en ligne »" '[[ $CODE -eq 0 && "$GOT" == *banner_online* && "$GOT" == *FIN-NORMALE* && "$GOT" != *banner_errors* ]]'
fin_i 0 0
check "tout vert : code 0, bannière « en ligne »" '[[ $CODE -eq 0 && "$GOT" == *banner_online* ]]'

echo "── install.sh : le vocal est contrôlé"
SVC="$(block "$INSTALL" '_HC_SVCS="postgresql' 'done')"
mkdir -p "$W/bin"; printf '#!/bin/bash\n[[ "$*" == *nodyx-sfud* ]] && exit 3\nexit 0\n' > "$W/bin/systemctl"; chmod +x "$W/bin/systemctl"
svc() { GOT="$(PATH="$W/bin:$PATH" bash -c "$COMMUN; HC_PASS=0; HC_FAIL=0
  _hc_pass() { echo \"PASS \$*\"; }; _hc_fail() { echo \"FAIL \$*\"; }
  RELAY_MODE=false; SKIP_TURN=false; _SFU_INSTALLED=$1
  $SVC" 2>&1)"; }
svc true
check "nodyx-sfud installé mais arrêté : signalé en erreur" '[[ "$GOT" == *"FAIL nodyx-sfud"* ]]'
svc false
check "nodyx-sfud non installé (--no-sfu) : pas contrôlé" '[[ "$GOT" != *nodyx-sfud* && "$GOT" == *"PASS caddy"* ]]'

echo "── install_tunnel.sh : la fin suit le verdict du bilan"
FIN_T="$(depuis "$TUNNEL" 'HC_TOTAL=$((HC_PASS')"
check "fin d'installation extraite" '[[ "$FIN_T" == *SUMMARY* ]]'
fin_t() { # <erreurs>
  GOT="$(bash -c "$COMMUN
    HC_PASS=9; HC_FAIL=$1; HC_WARN=0; TUNNEL_MODE=cf; DOMAIN=commu.example.org; ADMIN_USERNAME=admin
    ADMIN_EMAIL=a@b.c; CREDS_FILE=/root/c
    $FIN_T
    echo FIN-NORMALE" 2>&1)"; CODE=$?
}
fin_t 2
check "2 erreurs : code NON nul, titre d'erreur en rouge" '[[ $CODE -ne 0 && "$GOT" == *"<rouge>"*summary_title_errors* && "$GOT" == *"install_errors_exit [2]"* ]]'
fin_t 0
check "aucune erreur : code 0, titre habituel" '[[ $CODE -eq 0 && "$GOT" == *summary_title_cf* && "$GOT" == *FIN-NORMALE* ]]'

echo "── présentation"
for k in 'T_EN\[banner_online\]' 'T_FR\[banner_online\]' 'T_EN\[banner_errors\]' 'T_FR\[banner_errors\]'; do
  v="$(grep -oP "^${k}='\K[^']*" "$INSTALL")"; GOT="${#v} : $v"
  check "bannière ${k//\\/} : largeur du cadre (64)" '[[ ${#v} -eq 64 ]]'
done
for k in 'T_EN\[summary_title_errors\]' 'T_FR\[summary_title_errors\]'; do
  v="$(grep -oP "^${k}='\K[^']*" "$TUNNEL")"; GOT="${#v}"
  check "titre ${k//\\/} : largeur du cadre tunnel (41)" '[[ ${#v} -eq 41 ]]'
done
GOT="$(grep -n 'journalctl -u nodyx-core' "$INSTALL")"
check "plus de conseil « journalctl -u nodyx-core » (c'est une app PM2)" '[[ -z "$GOT" ]]'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
