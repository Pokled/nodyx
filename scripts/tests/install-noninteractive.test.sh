#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034,SC2016
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc du mode non interactif et des secrets en argument (install.sh,
#  install_tunnel.sh), 04/10/2026. Défauts corrigés :
#   - sans terminal, la relance `</dev/tty` tuait l'installeur (cron, Ansible,
#     nodyx-update par ssh sans -t), --yes ou pas ;
#   - --admin-password ignoré : prompt_secret_confirm redemandait toujours ;
#   - mode réseau, SMTP : toujours demandés, aucune option pour y répondre ;
#   - champs « optionnels » obligatoires (un défaut vide était ignoré) ;
#   - mot de passe et jeton du tunnel lisibles par tous via ps, et le jeton
#     restait dans la ligne de commande de cloudflared tant qu'il tournait ;
#   - tunnel : _confirm affichait « %s → oui (--yes) ».
#  Les blocs et fonctions sont extraits tels quels et EXÉCUTÉS ; `setsid`
#  garantit qu'aucun terminal n'est joignable.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }
fn() { awk -v f="$2() {" -v g="$2() { #" '$0 == f || index($0, g) == 1 {p=1} p {print} p && $0 == "}" {exit}' "$1"; }
# block <fichier> <début de la 1re ligne> <début de la dernière ligne>
block() { awk -v a="$2" -v b="$3" 'index($0, a) == 1 {p=1} p {print} p && index($0, b) == 1 {exit}' "$1"; }
command -v setsid >/dev/null || { echo "setsid introuvable"; exit 1; }
SANS_TTY="$W/pas-de-terminal"   # chemin qui n'existe pas : _NODYX_TTY
COMMUN='info() { echo "INFO $*"; }; ok() { echo "OK $*"; }; warn() { echo "WARN $*"; }
die() { echo "DIE $*"; exit 1; }; BOLD=""; RESET=""; CYAN=""; YELLOW=""; RED=""; GREEN=""'
# t de test : renvoie la clé, puis ses arguments (on vérifie QUEL message part).
T_CLE='t() { local k="$1"; shift; printf "%s" "$k"; (( $# )) && printf " [%s]" "$@"; return 0; }'

for INST in "$INSTALL" "$TUNNEL"; do
  N="$(basename "$INST")"
  echo "── $N : relance sans terminal"
  mkdir -p "$W/bin-$N"
  printf '#!/bin/bash\necho "curl $*" >> "%s/telechargements"\nwhile [[ $# -gt 0 ]]; do [[ "$1" == -o ]] && { echo "echo RELANCE-OK" > "$2"; }; shift; done\n' "$W" > "$W/bin-$N/curl"
  chmod +x "$W/bin-$N/curl"
  { block "$INST" 'if [[ ! -t 0' 'fi'; echo 'echo SUITE-OK'; } > "$W/relance-$N.sh"
  check "$N : bloc de relance extrait" 'grep -q "exec bash" "$W/relance-$N.sh"'
  : > "$W/telechargements"
  GOT="$(PATH="$W/bin-$N:$PATH" setsid -w bash "$W/relance-$N.sh" </dev/null 2>&1)"
  check "$N : lancé depuis un FICHIER sans terminal (cron, nodyx-update) : continue, rien téléchargé" '[[ "$GOT" == *SUITE-OK* && ! -s "$W/telechargements" ]]'
  : > "$W/telechargements"
  GOT="$(PATH="$W/bin-$N:$PATH" setsid -w bash -c "cat '$W/relance-$N.sh' | bash" </dev/null 2>&1)"
  check "$N : lu depuis un PIPE sans terminal : se relance quand même (entrée vide)" '[[ "$GOT" == *RELANCE-OK* ]]'

  echo "── $N : questions"
  if [[ "$N" == install.sh ]]; then
    FONCTIONS="$(fn "$INST" _tty_needed; fn "$INST" _confirm; fn "$INST" prompt; fn "$INST" prompt_secret)"
  else
    FONCTIONS="$(fn "$INST" _tty_needed; fn "$INST" _confirm; fn "$INST" prompt; fn "$INST" prompt_secret)"
  fi
  # q <tty> <--yes> <code> : joue les fonctions sans terminal joignable.
  q() {
    GOT="$(timeout 20 setsid -w bash -c "set -euo pipefail; $COMMUN; $T_CLE
      _NODYX_TTY='$1'; _HAS_TTY=false; { : <\"\$_NODYX_TTY\"; } 2>/dev/null && _HAS_TTY=true
      _AUTO_YES=$2
      $FONCTIONS
      $3
      echo FIN" </dev/null 2>&1)"; CODE=$?
  }
  q "$SANS_TTY" true 'prompt LANGUE "Langue" "fr"; prompt PAYS "Pays" ""; echo "=$LANGUE=$PAYS="'
  check "$N : --yes sans terminal : les défauts sont pris (même vides)" '[[ "$GOT" == *"=fr=="* && "$GOT" == *FIN* ]]'
  q "$SANS_TTY" true 'prompt NOM "Nom de la communauté"'
  check "$N : --yes sans terminal, question SANS défaut : arrêt propre qui la nomme" '[[ $CODE -ne 0 && "$GOT" == *"DIE no_tty_question [Nom de la communauté]"* ]]'
  q "$SANS_TTY" false '_confirm "Lancer ?"'
  check "$N : confirmation sans terminal ni --yes : arrêt propre, pas une erreur de bash" '[[ $CODE -ne 0 && "$GOT" == *"DIE no_tty_question [Lancer ?]"* ]]'
  q "$SANS_TTY" false 'prompt_secret JETON "Jeton"'
  check "$N : secret sans terminal : arrêt propre" '[[ $CODE -ne 0 && "$GOT" == *"DIE no_tty_question [Jeton]"* ]]'
  # Chaque question rouvre le terminal : un fichier de réponses repart donc de sa
  # 1re ligne à chaque lecture. Une seule question par essai.
  printf '\n' > "$W/tty-$N"
  q "$W/tty-$N" false 'prompt PAYS "Pays (optionnel)" ""; echo "=$PAYS="'
  check "$N : en terminal, Entrée sur un champ optionnel l'accepte vide" '[[ "$GOT" == *"=="* && "$GOT" == *FIN* ]]'
  printf 'Les Joyeux\n' > "$W/tty-$N"
  q "$W/tty-$N" false 'prompt NOM "Nom"; echo "=$NOM="'
  check "$N : en terminal, la réponse est lue sur le terminal" '[[ "$GOT" == *"=Les Joyeux="* ]]'
done

echo "── install.sh : mot de passe fourni"
PSC="$(fn "$INSTALL" _tty_needed; fn "$INSTALL" prompt_secret_confirm)"
psc() { # <valeur préremplie>
  GOT="$(setsid -w bash -c "set -euo pipefail; $COMMUN; $T_CLE
    _NODYX_TTY='$SANS_TTY'; _HAS_TTY=false; _AUTO_YES=true; $PSC
    ADMIN_PASSWORD='$1'; prompt_secret_confirm ADMIN_PASSWORD 'Mot de passe' 8; echo \"FIN=\$ADMIN_PASSWORD\"" </dev/null 2>&1)"; CODE=$?
}
psc "MotDePasse1"
check "fourni (fichier, variable ou option) : gardé, plus jamais redemandé" '[[ "$GOT" == *"FIN=MotDePasse1"* ]]'
psc "court"
check "fourni mais trop court : refusé" '[[ $CODE -ne 0 && "$GOT" == *secret_preset_too_short* ]]'

echo "── secrets : fichier, variable, argument"
SEC_I="$(block "$INSTALL" '# ── Secrets hors de la ligne de commande' 'unset NODYX_ADMIN_PASSWORD')"
SEC_T="$(fn "$TUNNEL" _secret_from_file; block "$TUNNEL" 'if [[ -n "$ADMIN_PASS_FILE" ]]; then' '[[ -n "$_SECRET_ARGV" ]]')"
check "blocs extraits" '[[ -n "$SEC_I" && -n "$SEC_T" ]]'
printf 'Fichier-Secret1\n' > "$W/mdp"; chmod 600 "$W/mdp"
sec_i() { # <variables…> : joue le bloc d'install.sh, affiche la valeur retenue et l'environnement restant
  GOT="$(env "$@" bash -c "set -euo pipefail; $COMMUN; $T_CLE
    _ARG_ADMIN_PASS=\${ARGV_PASS:-}; _ARG_ADMIN_PASS_FILE=\${PASS_FILE:-}; _ARG_ADMIN_PASS_ARGV=\${PASS_ARGV:-false}
    $SEC_I
    echo \"RETENU=\$_ARG_ADMIN_PASS\"; env | grep -c '^NODYX_ADMIN_PASSWORD=' || true" 2>&1)"; CODE=$?
}
sec_i PASS_FILE="$W/mdp"
check "install.sh : --admin-password-file lu (fin de ligne retirée)" '[[ "$GOT" == *"RETENU=Fichier-Secret1"* ]]'
sec_i NODYX_ADMIN_PASSWORD=Variable-Secret1
check "install.sh : NODYX_ADMIN_PASSWORD lu PUIS retiré de l'environnement" '[[ "$GOT" == *"RETENU=Variable-Secret1"* && "$(tail -1 <<<"$GOT")" == 0 ]]'
sec_i ARGV_PASS=Argument-Secret1 PASS_ARGV=true
check "install.sh : --admin-password accepté mais signalé" '[[ "$GOT" == *"RETENU=Argument-Secret1"* && "$GOT" == *"WARN admin_pass_argv_warn"* ]]'
sec_i PASS_FILE="$W/absent"
check "install.sh : fichier illisible : refus" '[[ $CODE -ne 0 && "$GOT" == *admin_pass_file_unreadable* ]]'
printf 'eyJjeton-du-fichier\n' > "$W/jeton"
GOT="$(env NODYX_ADMIN_PASSWORD=Variable-Secret1 bash -c "set -euo pipefail; $COMMUN; $T_CLE
  ADMIN_PASS_FLAG=''; ADMIN_PASS_FILE=''; TUNNEL_TOKEN_FLAG=''; TUNNEL_TOKEN_FILE='$W/jeton'; _SECRET_ARGV=''
  $SEC_T
  echo \"MDP=\$ADMIN_PASS_FLAG JETON=\$TUNNEL_TOKEN_FLAG\"; env | grep -c '^NODYX_' || true" 2>&1)"
check "tunnel : jeton par fichier, mot de passe par variable, variables retirées" '[[ "$GOT" == *"MDP=Variable-Secret1 JETON=eyJjeton-du-fichier"* && "$(tail -1 <<<"$GOT")" == 0 ]]'
check "tunnel : --tunnel-token et --admin-password signalés" 'grep -qF "_SECRET_ARGV+=\" --tunnel-token\"" "$TUNNEL" && grep -qF "_SECRET_ARGV+=\" --admin-password\"" "$TUNNEL"'

echo "── install.sh : mode réseau, SMTP"
NET="$(fn "$INSTALL" _tty_needed; block "$INSTALL" 'case "$_ARG_NETWORK" in' 'NET_MODE="${NET_MODE:-2}"')"
net() { # <--network> <--domain> <--yes>
  GOT="$(setsid -w bash -c "set -euo pipefail; $COMMUN; $T_CLE
    _NODYX_TTY='$SANS_TTY'; _HAS_TTY=false; _ARG_NETWORK='$1'; _ARG_DOMAIN='$2'; _AUTO_YES=$3
    $NET
    echo \"MODE=\$NET_MODE\"" </dev/null 2>&1)"; CODE=$?
}
check "bloc du mode réseau extrait" '[[ "$NET" == *_ARG_NETWORK* ]]'
net "" ma-commu.fr false;  check "--domain seul : mode direct, sans question" '[[ "$GOT" == *MODE=1* ]]'
net sslip "" false;        check "--network=sslip" '[[ "$GOT" == *MODE=3* ]]'
net "" "" true;            check "--yes : relais (le défaut)" '[[ "$GOT" == *MODE=2* ]]'
net "" "" false;           check "ni option ni --yes, sans terminal : arrêt propre" '[[ $CODE -ne 0 && "$GOT" == *no_tty_question* ]]'
net relay ma-commu.fr true; check "--network=relay avec --domain : incohérent, refusé" '[[ $CODE -ne 0 && "$GOT" == *network_domain_conflict* ]]'
net wifi "" true;          check "--network inconnu : refusé" '[[ $CODE -ne 0 && "$GOT" == *network_invalid* ]]'
SMTP="$(fn "$INSTALL" _tty_needed; block "$INSTALL" 'want_smtp=""' 'want_smtp="${want_smtp:-n}"')"
GOT="$(setsid -w bash -c "set -euo pipefail; $COMMUN; $T_CLE; _NODYX_TTY='$SANS_TTY'; _HAS_TTY=false; _AUTO_YES=true
  $SMTP
  echo \"SMTP=\$want_smtp\"" </dev/null 2>&1)"
check "SMTP avec --yes : plus tard (administration), sans question" '[[ "$GOT" == *SMTP=n* ]]'

echo "── chaque question lit le terminal, jamais l'entrée standard"
for INST in "$INSTALL" "$TUNNEL"; do
  GOT="$(grep -n 'read -r' "$INST" | grep -vE '_NODYX_TTY|-u "\$_fd"|while IFS= read|while read|IFS= read -r _(ARG_ADMIN_PASS|v) <|<<<|^[0-9]+:[[:space:]]*#')"
  check "$(basename "$INST") : aucune lecture hors terminal" '[[ -z "$GOT" ]]'
done
GOT="$(grep -n 'want_subdomain' "$INSTALL" | head -5)"
check "inscription à l'annuaire : réponse stricte (« non » n'inscrit plus)" 'grep -qF "_confirm \"\$(t sub_enable_q" "$INSTALL"'

echo "── tunnel : t() formate ses arguments"
GOT="$(bash -c "declare -A T_EN T_FR; T_FR[confirm_auto_yes]='%s → oui (--yes)'; NODYX_LANG=fr
  $(fn "$TUNNEL" t); t confirm_auto_yes 'Continuer ?'" 2>&1)"
check "« Continuer ? → oui (--yes) », plus « %s → oui »" '[[ "$GOT" == "Continuer ? → oui (--yes)" ]]'

echo "── tunnel : jeton Cloudflare hors de la ligne de commande"
CF="$(fn "$TUNNEL" _nodyx_write_cloudflared_unit; fn "$TUNNEL" _nodyx_migrate_cloudflared_token)"
TOK="eyJhIjoiYWJjZGVmIiwidCI6IjEyMzQiLCJzIjoiWFlaIn0="
cf() { GOT="$(NODYX_TEST_ROOT="$1" bash -c "set -euo pipefail; $CF; $2" 2>&1)"; CODE=$?; }
R="$W/cf-neuf"; cf "$R" "_nodyx_write_cloudflared_unit '$TOK'"
U="$R/etc/systemd/system/cloudflared.service"; E="$R/etc/cloudflared/tunnel.env"
check "unité écrite SANS le jeton, jeton dans tunnel.env en 600" '[[ -f "$U" ]] && ! grep -q "$TOK" "$U" && grep -qx "EnvironmentFile=/etc/cloudflared/tunnel.env" "$U" && [[ "$(stat -c %a "$E")" == 600 ]] && grep -qx "TUNNEL_TOKEN=$TOK" "$E"'
check "la commande lancée ne porte aucun jeton" 'grep -E "^ExecStart=" "$U" | grep -qE "cloudflared --no-autoupdate tunnel run$"'
R="$W/cf-piege"; cf "$R" "_nodyx_write_cloudflared_unit \$'abc\nExecStartPre=/bin/sh -c id'"
check "jeton avec retour à la ligne ou espace : refusé, rien écrit" '[[ $CODE -ne 0 && ! -e "$R/etc/cloudflared/tunnel.env" ]]'
R="$W/cf-ancien"; mkdir -p "$R/etc/systemd/system"
printf '[Unit]\nDescription=cloudflared\n\n[Service]\nTimeoutStartSec=15\nType=notify\nExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run --token %s\nRestart=on-failure\n' "$TOK" > "$R/etc/systemd/system/cloudflared.service"
cf "$R" "_nodyx_migrate_cloudflared_token && echo migre"
check "unité de « cloudflared service install » : migrée, jeton sorti de la commande" '[[ "$GOT" == *migre* ]] && ! grep -q "$TOK" "$R/etc/systemd/system/cloudflared.service" && grep -qx "TUNNEL_TOKEN=$TOK" "$R/etc/cloudflared/tunnel.env"'
H="$(cat "$R/etc/systemd/system/cloudflared.service" "$R/etc/cloudflared/tunnel.env" | md5sum)"
cf "$R" "_nodyx_migrate_cloudflared_token && echo migre || echo rien"
check "déjà migrée : rien n'est touché" '[[ "$GOT" == *rien* && "$(cat "$R/etc/systemd/system/cloudflared.service" "$R/etc/cloudflared/tunnel.env" | md5sum)" == "$H" ]]'
check "la mise à jour appelle la migration" 'grep -q "if _nodyx_migrate_cloudflared_token; then" "$TUNNEL"'
if command -v cloudflared >/dev/null; then
  # Vrai cloudflared : le jeton de tunnel.env lui parvient bien (un jeton
  # invalide est REJETÉ comme jeton, au lieu de « aucun tunnel indiqué »).
  GOT="$(set -a; . "$W/cf-neuf/etc/cloudflared/tunnel.env"; set +a; TUNNEL_TOKEN=invalide timeout 10 cloudflared --no-autoupdate tunnel run 2>&1 | tail -2)"
  check "vrai cloudflared : lit le jeton depuis TUNNEL_TOKEN" '[[ "$GOT" == *"token is not valid"* ]]'
else
  echo "  (cloudflared absent : vérification avec le vrai binaire sautée)"
fi

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
