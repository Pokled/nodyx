#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc du pare-feu des installeurs : ne JAMAIS enfermer l'administrateur dehors.
#
#  Avant le 03/10/2026, install.sh et install_tunnel.sh n'ouvraient que le port
#  22 avant d'activer UFW : un serveur dont SSH écoute ailleurs devenait
#  injoignable pour son propre administrateur. install.sh effaçait en plus
#  toutes les règles existantes (`ufw --force reset`).
#
#  Les fonctions sont extraites telles quelles des deux installeurs et jouées
#  contre des doublures (ss, systemctl, sshd, ufw avec un état : actif ou non,
#  liste des règles). PATH hermétique : rien ne touche au vrai pare-feu.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
BIN="$W/bin"; mkdir -p "$BIN"
for t in bash awk sed grep sort cat date head tr mkdir rm touch basename cut; do p="$(command -v "$t")" && ln -s "$p" "$BIN/$t"; done

cat > "$W/shim" <<'SHIM'
#!/bin/bash
name="$(basename "$0")"
echo "$name $*" >> "$FW/log"
case "$name" in
  ss)
    if [[ " $* " == *" state established "* ]]; then printf '%b' "${SS_EST:-}"; else printf '%b' "${SS_LISTEN:-}"; fi ;;
  systemctl)
    case "$*" in
      "is-active --quiet ssh.socket") [[ "${SOCKET_ACTIVE:-0}" == 1 ]]; exit $? ;;
      "show ssh.socket -p Listen")    printf '%b' "${SOCKET_LISTEN:-}" ;;
    esac ;;
  sshd) [[ -n "${SSHD_PORT:-}" ]] && printf 'port %s\naddressfamily any\n' "$SSHD_PORT" ;;
  ufw)
    state="$(cat "$FW/state")"
    case "$1" in
      status)  echo "Status: $state" ;;
      show)    echo "Added user rules (see 'ufw status' for running firewall):"; cat "$FW/rules" ;;
      allow)   [[ " ${UFW_FAIL_ALLOW:-} " == *" $2 "* ]] && exit 1
               echo "ufw allow $2${3:+ $3 '$4'}" >> "$FW/rules" ;;
      default) echo "$2 $3" >> "$FW/defaults" ;;
      --force) case "$2" in enable) echo active > "$FW/state" ;; reset) : > "$FW/rules"; echo reset >> "$FW/defaults" ;; esac ;;
    esac ;;
esac
exit 0
SHIM
chmod +x "$W/shim"
for c in ss systemctl sshd ufw; do ln -s "$W/shim" "$BIN/$c"; done

# Extraction d'une fonction d'un installeur, telle quelle.
extract() { awk -v f="$2() {" '$0 == f {p=1} p {print} p && $0 == "}" {exit}' "$1"; }
extract "$INSTALL" _nodyx_ssh_ports > "$W/ports.install"
extract "$TUNNEL"  _nodyx_ssh_ports > "$W/ports.tunnel"
extract "$INSTALL" _nodyx_firewall  > "$W/fw.install"
# Le bloc pare-feu d'install_tunnel.sh est en ligne : on l'emballe dans une fonction.
{ echo '_tunnel_fw() {'; awk '$0 == "_ssh_ports=\"$(_nodyx_ssh_ports)\"" {p=1} /^# Pangolin Method B/ {exit} p' "$TUNNEL"; echo '}'; } > "$W/fw.tunnel"

PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

# run <code> : exécute le code dans un environnement neuf (pare-feu simulé inactif).
run() {
  FW="$W/fw-$RANDOM"; mkdir -p "$FW"; echo "${UFW_STATE:-inactive}" > "$FW/state"
  printf '%b' "${UFW_RULES:-}" > "$FW/rules"; : > "$FW/defaults"; : > "$FW/log"
  GOT="$(env -i PATH="$BIN" FW="$FW" SS_LISTEN="${SS_LISTEN:-}" SS_EST="${SS_EST:-}" SOCKET_ACTIVE="${SOCKET_ACTIVE:-0}" \
    SOCKET_LISTEN="${SOCKET_LISTEN:-}" SSHD_PORT="${SSHD_PORT:-}" UFW_FAIL_ALLOW="${UFW_FAIL_ALLOW:-}" ${SSH_CONNECTION:+SSH_CONNECTION="$SSH_CONNECTION"} \
    bash -c "set -euo pipefail
      t() { printf '%s' \"\$1\"; }; ok() { echo \"OK \$*\"; }; info() { echo \"INFO \$*\"; }; warn() { echo \"WARN \$*\"; }
      $(cat "$W/ports.install"); $(cat "$W/fw.install"); $(cat "$W/fw.tunnel")
      $1" 2>&1)"; CODE=$?
}
ufw_log()  { grep '^ufw ' "$FW/log"; }
rule_has() { grep -qE "^ufw allow $1( |\$)" "$FW/rules"; }
line_of()  { grep -nE "$1" "$FW/log" | head -1 | cut -d: -f1; }

LISTEN_2222='LISTEN 0 128 0.0.0.0:2222 0.0.0.0:* users:(("sshd",pid=1,fd=3))\nLISTEN 0 128 [::]:2222 [::]:* users:(("sshd",pid=1,fd=4))\n'
LISTEN_SOCKET='LISTEN 0 4096 0.0.0.0:22 0.0.0.0:* users:(("systemd",pid=1,fd=165))\n'

echo "── les deux installeurs portent la MÊME détection"
check "_nodyx_ssh_ports trouvée dans install.sh" '[[ -s "$W/ports.install" ]]'
check "copies identiques dans install.sh et install_tunnel.sh" 'cmp -s "$W/ports.install" "$W/ports.tunnel"'
check "plus aucun « ufw --force reset » dans install.sh" '! grep -qE "^[^#]*ufw --force reset" "$INSTALL"'

echo "── détection du port SSH"
SS_LISTEN="$LISTEN_2222" SSHD_PORT=2222 run '_nodyx_ssh_ports'
check "sshd sur 2222 (IPv4 et IPv6) : 2222, une seule fois" '[[ $CODE -eq 0 && "$GOT" == "2222" ]]'
SS_LISTEN="$LISTEN_SOCKET" SOCKET_ACTIVE=1 SOCKET_LISTEN='Listen=0.0.0.0:22 (Stream)\nListen=[::]:22 (Stream)\n' run '_nodyx_ssh_ports'
check "Ubuntu 24.04 (ssh.socket, sshd n'écoute pas lui-même) : 22" '[[ $CODE -eq 0 && "$GOT" == "22" ]]'
SS_LISTEN="$LISTEN_2222" SOCKET_ACTIVE=0 SOCKET_LISTEN='Listen=0.0.0.0:22 (Stream)\n' SSHD_PORT=2222 run '_nodyx_ssh_ports'
check "ssh.socket installé mais INACTIF : son 22 n'est pas retenu" '[[ "$GOT" == "2222" ]]'
SS_EST='0 0 10.0.0.2:2200 203.0.113.5:51000 users:(("sshd",pid=7,fd=4))\n' run '_nodyx_ssh_ports'
check "session SSH établie sur 2200 : retenue" '[[ "$GOT" == "2200" ]]'
SSH_CONNECTION='203.0.113.5 51000 10.0.0.2 2022' run '_nodyx_ssh_ports'
check "connexion en cours (SSH_CONNECTION) sur 2022 : retenue" '[[ "$GOT" == "2022" ]]'
run '_nodyx_ssh_ports; echo "fin:$?"'
check "rien trouvé : sortie vide SANS faire échouer le script (set -euo pipefail)" '[[ $CODE -eq 0 && "$GOT" == "fin:0" ]]'

echo "── install.sh : _nodyx_firewall"
SS_LISTEN="$LISTEN_2222" run '_nodyx_firewall false false true'
check "SSH sur 2222 : autorisé, PUIS pare-feu activé" '[[ $CODE -eq 0 ]] && rule_has 2222/tcp && [[ $(line_of "allow 2222/tcp") -lt $(line_of "force enable") ]]'
check "jamais de reset ; politique par défaut posée (pare-feu inactif avant)" '! grep -q reset "$FW/defaults" && grep -q "deny incoming" "$FW/defaults"'
check "ports web, TURN et SFU ajoutés, marqués Nodyx" 'rule_has 443/tcp && rule_has 3478/udp && rule_has 40000:40999/tcp && grep -q "comment .Nodyx" "$FW/rules"'
UFW_STATE=active UFW_RULES='ufw allow from 192.0.2.10 to any port 5432 proto tcp\n' SS_LISTEN="$LISTEN_2222" run '_nodyx_firewall false false false'
check "pare-feu déjà actif : règles de l'admin CONSERVÉES, politique intacte" '[[ $CODE -eq 0 ]] && grep -q "192.0.2.10" "$FW/rules" && [[ ! -s "$FW/defaults" ]] && rule_has 2222/tcp'
run '_nodyx_firewall false false false'
check "aucun port SSH trouvé : RIEN n'est touché, l'admin est prévenu" '[[ $CODE -ne 0 ]] && [[ -z "$(ufw_log | grep -vE "^ufw status")" ]] && grep -q ufw_no_ssh_port <<<"$GOT"'
UFW_FAIL_ALLOW=2222/tcp SS_LISTEN="$LISTEN_2222" run '_nodyx_firewall false false false'
check "la règle SSH ne passe pas : pare-feu NON activé" '[[ $CODE -ne 0 ]] && ! grep -q "force enable" "$FW/log" && grep -q ufw_ssh_rule_missing <<<"$GOT"'
SS_LISTEN="$LISTEN_2222" run '_nodyx_firewall true false false'
check "mode relais : SSH seulement, aucun port web" '[[ $CODE -eq 0 ]] && rule_has 2222/tcp && ! rule_has 443/tcp'

echo "── install_tunnel.sh : bloc pare-feu"
SS_LISTEN="$LISTEN_2222" run '_tunnel_fw'
check "SSH sur 2222 : autorisé, PUIS pare-feu activé" 'rule_has 2222/tcp && [[ $(line_of "allow 2222/tcp") -lt $(line_of "force enable") ]] && ! rule_has 22/tcp'
run '_tunnel_fw'
check "aucun port SSH trouvé : pare-feu NON activé" '! grep -q "force enable" "$FW/log" && grep -q "Could not find the port SSH" <<<"$GOT"'
UFW_STATE=active SS_LISTEN="$LISTEN_2222" run '_tunnel_fw'
check "pare-feu déjà actif : rien n'est modifié" '[[ -z "$(ufw_log | grep -vE "^ufw status")" ]]'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
