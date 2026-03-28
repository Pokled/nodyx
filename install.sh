#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Nodyx — Installeur one-click / One-click installer
#  Ubuntu 22.04 / 24.04  ·  Debian 11 / 12 / 13  ·  ARM64 supporté
#
#  ── Installation (recommandé) ───────────────────────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh | sudo bash
#
#  ── Mise à jour d'une instance existante ────────────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh | sudo bash -s -- --upgrade
#
#  ── Installation silencieuse (CI/CD, Ansible) ───────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh | sudo bash -s -- \
#      --domain=ma-communaute.fr  --name="Ma Communauté"  --slug=ma-communaute \
#      --admin-user=admin  --admin-email=admin@ma-communaute.fr \
#      --admin-password=MonMotDePasse  --yes
#
#  ── Autres options ──────────────────────────────────────────────────────────
#
#    wget -qO- https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh | sudo bash
#    git clone https://github.com/Pokled/Nodyx.git && cd Nodyx && sudo bash install.sh
#    sudo bash install.sh --help       (liste tous les flags)
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Auto-relaunch si stdin est un pipe (curl|bash) ────────────────────────────
# Les prompts interactifs (read) nécessitent un vrai terminal.
# Si stdin n'est pas un TTY (ex: curl|bash), on se télécharge dans /tmp et on relance.
if [[ ! -t 0 ]]; then
  _SELF=$(mktemp /tmp/nodyx_install_XXXXXX.sh)
  curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh -o "$_SELF" 2>/dev/null \
    || wget -qO "$_SELF" https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh
  exec bash "$_SELF" "$@" </dev/tty
fi

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }
banner() {
  [[ -t 1 ]] && clear 2>/dev/null || true
  echo -e "${BOLD}${CYAN}"
  cat <<'EOF'
  ███╗   ██╗ ██████╗ ██████╗ ██╗   ██╗██╗  ██╗
  ████╗  ██║██╔═══██╗██╔══██╗╚██╗ ██╔╝╚██╗██╔╝
  ██╔██╗ ██║██║   ██║██║  ██║ ╚████╔╝  ╚███╔╝
  ██║╚██╗██║██║   ██║██║  ██║ ██╔╝██╗  ██╔██╗
  ██║ ╚████║╚██████╔╝██████╔╝██╔╝  ██╗██╔╝ ██╗
  ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝ ╚═╝   ╚═╝╚═╝  ╚═╝
EOF
  echo -e "${RESET}"
  echo -e "  ${CYAN}$(printf '═%.0s' {1..52})${RESET}"
  echo -e "  ${CYAN}║${RESET}  ${BOLD}Node Installer v1.9${RESET}  ·  Forum · Chat · Voice  ${CYAN}  ║${RESET}"
  echo -e "  ${CYAN}║${RESET}  AGPL-3.0  ·  ${CYAN}github.com/Pokled/Nodyx${RESET}            ${CYAN}║${RESET}"
  echo -e "  ${CYAN}$(printf '═%.0s' {1..52})${RESET}"
  echo ""
  local _os; _os=$(grep -oP 'PRETTY_NAME="\K[^"]+' /etc/os-release 2>/dev/null || echo "Linux")
  local _arch; _arch=$(uname -m)
  local _ram; _ram=$(free -h 2>/dev/null | awk '/^Mem/{print $2}' || echo "?")
  local _disk; _disk=$(df -h / 2>/dev/null | awk 'NR==2{print $4}' || echo "?")
  echo -e "  ${CYAN}◈${RESET}  OS      ${BOLD}${_os}${RESET}"
  echo -e "  ${CYAN}◈${RESET}  Arch    ${BOLD}${_arch}${RESET}"
  echo -e "  ${CYAN}◈${RESET}  RAM     ${BOLD}${_ram}${RESET}"
  echo -e "  ${CYAN}◈${RESET}  Disk    ${BOLD}${_disk} disponibles${RESET}"
  echo ""
}

# ── Helpers ───────────────────────────────────────────────────────────────────
gen_secret()  { openssl rand -hex 32; }
gen_pass()    { openssl rand -base64 18 | tr -d '/+='; }
slugify()     { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g'; }

# Retourne 0 (true) si $1 > $2 en semver
version_gt() { [[ "$(printf '%s\n' "$1" "$2" | sort -V | tail -1)" == "$1" ]] && [[ "$1" != "$2" ]]; }

# Chemin rapide : mise à jour / réparation sans reconfiguration
_nodyx_upgrade() {
  local from_ver="$1" to_ver="$2" dir="$3"
  echo ""
  if [[ "$from_ver" != "$to_ver" ]]; then
    echo -e "${GREEN}${BOLD}  ━━━  Mise à jour Nodyx v${from_ver} → v${to_ver}  ━━━${RESET}"
  else
    echo -e "${CYAN}${BOLD}  ━━━  Réparation Nodyx v${from_ver}  ━━━${RESET}"
  fi
  echo ""

  # Garantir que l'utilisateur système 'nodyx' existe (peut manquer sur les anciennes installs)
  if ! id -u nodyx &>/dev/null; then
    info "Création de l'utilisateur système 'nodyx' (migration depuis root PM2)..."
    useradd -r -s /usr/sbin/nologin -m -d /home/nodyx nodyx
    ok "Utilisateur 'nodyx' créé"
  fi
  mkdir -p /home/nodyx/.pm2/logs
  chown -R nodyx:nodyx /home/nodyx/.pm2 2>/dev/null || true

  # pm2-logrotate si absent
  if ! pm2 list 2>/dev/null | grep -q 'pm2-logrotate'; then
    npm install -g pm2-logrotate --silent 2>/dev/null || true
    pm2 set pm2-logrotate:max_size 50M 2>/dev/null || true
    pm2 set pm2-logrotate:retain 7 2>/dev/null || true
  fi

  # Arrêter les anciens processus PM2 root (migration nexus-* → nodyx-*)
  for _old_proc in nexus-core nexus-frontend nodyx-core nodyx-frontend; do
    pm2 delete "$_old_proc" 2>/dev/null || true
  done
  # Libérer les ports même si les process appartiennent à un autre utilisateur
  for _port in 3000 4173; do
    fuser -k "${_port}/tcp" 2>/dev/null || true
  done

  info "Récupération du code..."
  git config --global --add safe.directory "$dir" 2>/dev/null || true
  git -C "$dir" pull --ff-only || die "git pull échoué. Vérifie ta connexion ou résous les conflits manuellement."
  ok "Code à jour"

  info "Rebuild backend (nodyx-core)..."
  cd "${dir}/nodyx-core"
  npm install --no-fund --no-audit --silent || die "npm install backend échoué."
  npm run build || die "Build backend échoué. Consulte les logs ci-dessus."
  ok "Backend compilé"

  info "Rebuild frontend (nodyx-frontend)..."
  cd "${dir}/nodyx-frontend"
  export NODE_OPTIONS="--max-old-space-size=1024"
  npm install --no-fund --no-audit --silent || die "npm install frontend échoué."
  npm run build || die "Build frontend échoué."
  unset NODE_OPTIONS
  ok "Frontend compilé"

  info "Redémarrage des services..."
  chown -R nodyx:nodyx "$dir" 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart "${dir}/ecosystem.config.js" --update-env 2>/dev/null \
    || runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 startOrRestart "${dir}/ecosystem.config.js" --update-env
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save

  _new_ver=$(node -p "require('${dir}/nodyx-core/package.json').version" 2>/dev/null || echo "$to_ver")
  echo ""
  echo -e "  ${GREEN}${BOLD}✔  Nodyx v${_new_ver} opérationnel${RESET}"
  echo ""
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null || true
  echo ""
}

# ── Rollback trap ─────────────────────────────────────────────────────────────
_INSTALL_COMPLETE=false
_ROLLBACK_STEPS=()

_rollback_register() { _ROLLBACK_STEPS+=("$1"); }

_nodyx_rollback() {
  local _ec=$?
  $_INSTALL_COMPLETE && return 0
  [[ ${#_ROLLBACK_STEPS[@]} -eq 0 && $_ec -eq 0 ]] && return 0
  echo ""
  echo -e "${RED}${BOLD}  ✘  Installation échouée (code: ${_ec}) — rollback en cours...${RESET}"
  for (( _ri=${#_ROLLBACK_STEPS[@]}-1; _ri>=0; _ri-- )); do
    info "  ↩ ${_ROLLBACK_STEPS[$_ri]%%#*}"
    eval "${_ROLLBACK_STEPS[$_ri]}" 2>/dev/null || true
  done
  echo ""
  echo -e "${YELLOW}  État partiel possible. Lance ${BOLD}sudo nodyx-doctor${RESET}${YELLOW} pour diagnostiquer.${RESET}"
  echo ""
}
trap '_nodyx_rollback' EXIT

# ── Auto-backup DB avant action destructive ───────────────────────────────────
_auto_backup_db() {
  local reason="${1:-pre-action}"
  [[ "${_DB_EXISTS:-false}" == "true" ]] || return 0
  local bak="/root/nodyx-db-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
  info "Sauvegarde automatique de la DB (${reason})..."
  if sudo -u postgres pg_dump nodyx 2>/dev/null | gzip > "$bak"; then
    local sz; sz=$(du -sh "$bak" 2>/dev/null | cut -f1 || echo "?")
    ok "Sauvegarde : ${BOLD}${bak}${RESET}  (${sz})"
    _rollback_register "warn 'Restaurer la DB si besoin : sudo gunzip -c ${bak} | sudo -u postgres psql nodyx'"
  else
    warn "Sauvegarde DB échouée (DB vide ou inaccessible) — on continue."
    rm -f "$bak"
  fi
}

# ── Version ────────────────────────────────────────────────────────────────────
NODYX_VERSION="1.9.4"
INSTALLER_VERSION="1.9.4"

# ── CLI flags ─────────────────────────────────────────────────────────────────
_FORCE_MODE=""        # upgrade | repair | reinstall | wipe (bypass detection menu)
_AUTO_YES=false       # --yes : passer toutes les confirmations
SKIP_TURN=false       # --no-turn
SKIP_SUBDOMAIN=false  # --no-subdomain
_ARG_DOMAIN=""  _ARG_SLUG=""  _ARG_NAME=""
_ARG_ADMIN_USER=""  _ARG_ADMIN_EMAIL=""  _ARG_ADMIN_PASS=""

for _arg in "$@"; do
  case "$_arg" in
    --upgrade)            _FORCE_MODE="upgrade"   ;;
    --repair)             _FORCE_MODE="repair"    ;;
    --reinstall)          _FORCE_MODE="reinstall" ;;
    --wipe)               _FORCE_MODE="wipe"      ;;
    --yes|-y)             _AUTO_YES=true           ;;
    --no-turn)            SKIP_TURN=true           ;;
    --no-subdomain)       SKIP_SUBDOMAIN=true      ;;
    --domain=*)           _ARG_DOMAIN="${_arg#*=}" ;;
    --slug=*)             _ARG_SLUG="${_arg#*=}"   ;;
    --name=*)             _ARG_NAME="${_arg#*=}"   ;;
    --admin-user=*)       _ARG_ADMIN_USER="${_arg#*=}"  ;;
    --admin-email=*)      _ARG_ADMIN_EMAIL="${_arg#*=}" ;;
    --admin-password=*)   _ARG_ADMIN_PASS="${_arg#*=}"  ;;
    --help|-h)
      echo ""
      echo "  Usage: bash install.sh [OPTIONS]"
      echo ""
      echo "  Modes (bypass du menu de détection) :"
      echo "    --upgrade          Mettre à jour l'instance existante (rebuild+restart)"
      echo "    --repair           Réparer sans reconfigurer (rebuild+restart)"
      echo "    --reinstall        Réinstaller en préservant la DB"
      echo "    --wipe             Réinstaller + effacer la DB (DANGER)"
      echo ""
      echo "  Configuration (évite les prompts) :"
      echo "    --domain=DOMAIN         Domaine de l'instance"
      echo "    --slug=SLUG             Identifiant de la communauté"
      echo "    --name=NAME             Nom de la communauté"
      echo "    --admin-user=USER       Nom d'utilisateur admin"
      echo "    --admin-email=EMAIL     Email admin"
      echo "    --admin-password=PASS   Mot de passe admin"
      echo ""
      echo "  Options :"
      echo "    --yes, -y          Répondre oui à toutes les confirmations"
      echo "    --no-turn          Ne pas installer nodyx-turn"
      echo "    --no-subdomain     Ne pas enregistrer le sous-domaine nodyx.org"
      echo "    --help             Afficher cette aide"
      echo ""
      exit 0 ;;
    --*) warn "Flag inconnu : ${_arg} (ignoré)" ;;
  esac
done

# Raccourci : --yes confirme automatiquement (remplace read -rp pour les confirmations)
_confirm() {
  # Usage: _confirm "message" [default=o]  → retourne 0 si oui, 1 si non
  local msg="$1" default="${2:-o}"
  if $_AUTO_YES; then info "${msg} → oui (--yes)"; return 0; fi
  read -rp "$(echo -e "  ${BOLD}${msg} [O/n]: ${RESET}")" _c </dev/tty
  _c="${_c:-$default}"
  [[ "${_c,,}" != "n" ]]
}

#
# TODO — Phase 6 (quand RHEL/Rocky/Alma sera ajouté) :
#   Refacto modulaire en install/ (apt vs dnf, firewall, package names).
#   Un seul install.sh entry point, des modules sourcés par fonction.
#   NE PAS FAIRE avant d'avoir un vrai cas d'usage RHEL à tester.

prompt() {
  local var="$1" msg="$2" default="${3:-}" val=''
  # Si la variable est déjà pré-remplie (via CLI arg), sauter le prompt
  local _preset="${!var:-}"
  if [[ -n "$_preset" ]]; then
    info "${msg}: ${BOLD}${_preset}${RESET}  ${CYAN}(pré-rempli)${RESET}"
    return
  fi
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg} [${default}]: ")" val </dev/tty
    val="${val:-$default}"
  else
    while [[ -z "$val" ]]; do
      read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val </dev/tty
    done
  fi
  printf -v "$var" '%s' "$val"
}

prompt_secret() {
  local var="$1" msg="$2" minlen="${3:-1}"
  local val=''
  while [[ ${#val} -lt $minlen ]]; do
    [[ -n "$val" ]] && echo -e "  ${YELLOW}⚠${RESET}  Mot de passe trop court (minimum ${minlen} caractères)."
    read -rsp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val </dev/tty
    echo
  done
  printf -v "$var" '%s' "$val"
}

prompt_secret_confirm() {
  local var="$1" msg="$2" minlen="${3:-1}"
  local val='' val2=''
  while true; do
    while [[ ${#val} -lt $minlen ]]; do
      [[ -n "$val" ]] && echo -e "  ${YELLOW}⚠${RESET}  Mot de passe trop court (minimum ${minlen} caractères)."
      read -rsp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val </dev/tty
      echo
    done
    read -rsp "$(echo -e "  ${CYAN}?${RESET} Confirmez le mot de passe: ")" val2 </dev/tty
    echo
    if [[ "$val" == "$val2" ]]; then
      break
    else
      echo -e "  ${RED}✘${RESET}  Les mots de passe ne correspondent pas. Réessayez."
      val=''; val2=''
    fi
  done
  printf -v "$var" '%s' "$val"
}

_STEP_N=0

step() {
  _STEP_N=$((_STEP_N + 1))
  local _num; printf -v _num '%02d' "$_STEP_N"
  echo ""
  echo -e "  ${BOLD}${CYAN}┌─ [${_num}] $(printf '─%.0s' {1..46})┐${RESET}"
  echo -e "  ${BOLD}${CYAN}│${RESET}  ${BOLD}$*${RESET}"
  echo -e "  ${BOLD}${CYAN}└$(printf '─%.0s' {1..52})┘${RESET}"
}

conf_section() {
  echo ""
  echo -e "  ${BOLD}${CYAN}◈  $1${RESET}"
  echo -e "  ${CYAN}$(printf '·%.0s' {1..52})${RESET}"
  echo ""
}

_HC_SPIN=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

# run_bg "label" cmd [args...] — exécute une commande en arrière-plan avec spinner animé
# Affiche le temps écoulé en temps réel. Dump les dernières lignes du log en cas d'erreur.
run_bg() {
  local label="$1"; shift
  local log; log=$(mktemp /tmp/nodyx_bg_XXXXXX.log)
  local pid si=0 elapsed=0 rc=0
  "$@" >"$log" 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    printf "\r  ${CYAN}%s${RESET}  %s  ${YELLOW}%ds${RESET}   " \
      "${_HC_SPIN[$((si % 10))]}" "$label" "$elapsed"
    si=$((si+1)); sleep 1; elapsed=$((elapsed+1))
  done
  wait "$pid" || rc=$?
  printf "\r\033[2K"
  if [[ $rc -ne 0 ]]; then
    echo -e "  ${RED}✘${RESET}  Échec : $label"
    echo -e "  ${YELLOW}── Dernières lignes ──────────────────────────────────────${RESET}"
    tail -25 "$log" | sed 's/^/     /'
    echo -e "  ${YELLOW}──────────────────────────────────────────────────────────${RESET}"
  fi
  rm -f "$log"
  return $rc
}

# ═══════════════════════════════════════════════════════════════════════════════
#  PREFLIGHT
# ═══════════════════════════════════════════════════════════════════════════════
banner

[[ $EUID -ne 0 ]] && die "Lance ce script en root : sudo bash install.sh"

# OS check
if ! grep -qiE 'ubuntu|debian' /etc/os-release 2>/dev/null; then
  die "OS non supporté. Utilise Ubuntu 22.04/24.04 ou Debian 11/12/13."
fi

# Architecture check — Rollup 4 (Vite 7) n'a pas de binaire natif pour ARM 32-bit
_ARCH=$(uname -m)
if [[ "$_ARCH" == "armv7l" || "$_ARCH" == "armv6l" ]]; then
  die "Architecture ARM 32-bit (${_ARCH}) non supportée.\n\
  Vite 7 / Rollup 4 nécessite un OS 64-bit.\n\
  Sur Raspberry Pi : active le mode 64-bit dans /boot/config.txt (arm_64bit=1)\n\
  ou installe Raspberry Pi OS 64-bit (recommandé pour Pi 3B+ et supérieur)."
fi

# Sur ARM64 : installer explicitement le binaire Rollup natif
# (npm optionalDependencies peut le rater dans certaines configs ARM)
if [[ "$_ARCH" == "aarch64" ]]; then
  info "Architecture ARM64 détectée — le binaire Rollup sera vérifié après npm install."
fi

# RAM check — auto-swap si insuffisant (ne pas juste avertir, corriger)
_RAM_FREE_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $7}' || echo 9999)
_SWAP_TOTAL_MB=$(free -m 2>/dev/null | awk '/^Swap/{print $2}' || echo 0)
if [[ "$_RAM_FREE_MB" -lt 512 ]]; then
  warn "RAM disponible : ${_RAM_FREE_MB} MB (recommandé : 512 MB+)"
  if [[ $(( _RAM_FREE_MB + _SWAP_TOTAL_MB )) -lt 512 ]]; then
    info "RAM + swap insuffisants — création automatique d'un swapfile 1 GB..."
    if [[ ! -f /swapfile ]]; then
      fallocate -l 1G /swapfile 2>/dev/null \
        || dd if=/dev/zero of=/swapfile bs=1M count=1024 status=none
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
      swapon /swapfile
      grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      ok "Swapfile 1 GB créé, activé et persistant (ajouté dans /etc/fstab)"
    else
      swapon /swapfile 2>/dev/null || true
      ok "Swapfile existant (/swapfile) activé"
    fi
  else
    ok "RAM faible (${_RAM_FREE_MB} MB) compensée par le swap (${_SWAP_TOTAL_MB} MB) — OK"
  fi
fi

# Disk check — npm + build = ~700 MB minimum
_DISK_FREE_MB=$(df -m /opt 2>/dev/null | awk 'NR==2{print $4}' || echo 9999)
if [[ "$_DISK_FREE_MB" -lt 1024 ]]; then
  warn "Espace disque faible sur /opt : ${_DISK_FREE_MB} MB (recommandé : 1 GB+)"
  _confirm "Continuer quand même ?" || die "Installation annulée — libère de l'espace et relance."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  DÉTECTION INTELLIGENTE — instance existante, ports, autres apps PM2
# ═══════════════════════════════════════════════════════════════════════════════
INSTALL_MODE="fresh"   # fresh | upgrade | repair | reinstall | wipe
_NODYX_CHECK_DIR="/opt/nodyx"

# ── 1. Instance Nodyx existante ──────────────────────────────────────────────
_INSTALLED_VERSION=""
_EXISTING=false
_DB_EXISTS=false
_DB_TABLE_COUNT=0
_EXISTING_MSGS=()

# Lire la version depuis package.json (sans démarrer le serveur)
if [[ -f "${_NODYX_CHECK_DIR}/nodyx-core/package.json" ]]; then
  _INSTALLED_VERSION=$(node -p "require('${_NODYX_CHECK_DIR}/nodyx-core/package.json').version" 2>/dev/null || true)
fi
# Fallback : interroger l'API si elle est en cours d'exécution
if [[ -z "$_INSTALLED_VERSION" ]]; then
  _INSTALLED_VERSION=$(curl -sf --max-time 3 http://localhost:3000/api/v1/instance/info 2>/dev/null \
    | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || true)
fi

# Processus PM2 actifs (user root)
if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -qE 'nodyx-core|nodyx-frontend'; then
  _EXISTING=true
  _EXISTING_MSGS+=("  ● Processus PM2 actifs (daemon root)")
fi
# Processus PM2 actifs (user nodyx)
if id -u nodyx &>/dev/null && runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null | grep -qE 'nodyx-core|nodyx-frontend'; then
  _EXISTING=true
  _EXISTING_MSGS+=("  ● Processus PM2 actifs (daemon nodyx)")
fi
# Répertoire d'installation
if [[ -d "$_NODYX_CHECK_DIR" ]]; then
  _EXISTING=true
  _EXISTING_MSGS+=("  ● Répertoire ${_NODYX_CHECK_DIR}${_INSTALLED_VERSION:+ (v${_INSTALLED_VERSION})}")
fi
# Base de données PostgreSQL
if command -v psql &>/dev/null \
   && sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='nodyx'" 2>/dev/null | grep -q 1; then
  _EXISTING=true
  _DB_EXISTS=true
  _DB_TABLE_COUNT=$(sudo -u postgres psql -d nodyx -tc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d ' \n' || echo 0)
  _EXISTING_MSGS+=("  ● Base de données PostgreSQL 'nodyx' (${_DB_TABLE_COUNT} tables)")
fi

if $_EXISTING; then
  echo ""

  # ── Titre contextuel selon la situation ──
  if [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$NODYX_VERSION" "$_INSTALLED_VERSION"; then
    echo -e "  ${GREEN}${BOLD}↑  Mise à jour disponible : v${_INSTALLED_VERSION} → v${NODYX_VERSION}${RESET}"
  elif [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$_INSTALLED_VERSION" "$NODYX_VERSION"; then
    echo -e "  ${RED}${BOLD}⚠  Régression détectée : version installée v${_INSTALLED_VERSION} > installeur v${NODYX_VERSION}${RESET}"
  elif [[ -n "$_INSTALLED_VERSION" ]]; then
    echo -e "  ${CYAN}${BOLD}≡  Instance Nodyx v${_INSTALLED_VERSION} déjà installée sur ce serveur${RESET}"
  else
    echo -e "  ${YELLOW}${BOLD}⚠  Une installation Nodyx semble déjà présente${RESET}"
  fi
  echo ""
  for _msg in "${_EXISTING_MSGS[@]}"; do echo -e "  ${YELLOW}${_msg}${RESET}"; done
  echo ""

  # ── Menu adapté à la situation ──
  _cancel_opt=2
  if [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$NODYX_VERSION" "$_INSTALLED_VERSION"; then
    # MISE À JOUR disponible
    _cancel_opt=$($_DB_EXISTS && echo 4 || echo 3)
    echo -e "  ${BOLD}Que souhaites-tu faire ?${RESET}"
    echo -e "  ${GREEN}[1]${RESET} ${BOLD}Mettre à jour vers v${NODYX_VERSION}${RESET} — données et config préservées ${GREEN}(recommandé)${RESET}"
    echo -e "  ${CYAN}[2]${RESET} Réinstaller complètement — reconfigurer tout, données DB préservées"
    if $_DB_EXISTS; then
      echo -e "  ${RED}[3]${RESET} Réinitialiser ${RED}(DANGER)${RESET} — reconfigurer + ${RED}EFFACER la base de données${RESET}"
      echo -e "  ${YELLOW}[4]${RESET} Annuler"
    else
      echo -e "  ${YELLOW}[3]${RESET} Annuler"
    fi
    echo ""
    read -rp "$(echo -e "  ${BOLD}Choix [1-${_cancel_opt}] (défaut: 1): ${RESET}")" _det_choice </dev/tty
    _det_choice="${_det_choice:-1}"
    case "$_det_choice" in
      1) INSTALL_MODE="upgrade"   ;;
      2) INSTALL_MODE="reinstall" ;;
      3) $_DB_EXISTS && INSTALL_MODE="wipe" || die "Installation annulée." ;;
      4) die "Installation annulée." ;;
      *) die "Choix invalide — installation annulée." ;;
    esac

  elif [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$_INSTALLED_VERSION" "$NODYX_VERSION"; then
    # RÉGRESSION (installé > installeur)
    echo -e "  ${BOLD}Que souhaites-tu faire ?${RESET}"
    echo -e "  ${CYAN}[1]${RESET} Réparer l'installation actuelle — rebuild + restart, sans changer de version"
    echo -e "  ${RED}[2]${RESET} Forcer la réinstallation en v${NODYX_VERSION} ${RED}(rétrogradation — déconseillé)${RESET}"
    echo -e "  ${YELLOW}[3]${RESET} Annuler ${YELLOW}(recommandé)${RESET}"
    echo ""
    read -rp "$(echo -e "  ${BOLD}Choix [1-3] (défaut: 3): ${RESET}")" _det_choice </dev/tty
    _det_choice="${_det_choice:-3}"
    case "$_det_choice" in
      1) INSTALL_MODE="repair"    ;;
      2) INSTALL_MODE="reinstall" ;;
      *) die "Installation annulée." ;;
    esac

  else
    # MÊME VERSION ou version inconnue
    _cancel_opt=$($_DB_EXISTS && echo 4 || echo 3)
    echo -e "  ${BOLD}Que souhaites-tu faire ?${RESET}"
    echo -e "  ${CYAN}[1]${RESET} Réparer — rebuild + restart sans reconfigurer"
    echo -e "  ${CYAN}[2]${RESET} Réinstaller complètement — reconfigurer tout, données DB préservées"
    if $_DB_EXISTS; then
      echo -e "  ${RED}[3]${RESET} Réinitialiser ${RED}(DANGER)${RESET} — reconfigurer + ${RED}EFFACER la base de données${RESET}"
      echo -e "  ${YELLOW}[4]${RESET} Annuler"
    else
      echo -e "  ${YELLOW}[3]${RESET} Annuler"
    fi
    echo ""
    read -rp "$(echo -e "  ${BOLD}Choix [1-${_cancel_opt}] (défaut: ${_cancel_opt}): ${RESET}")" _det_choice </dev/tty
    _det_choice="${_det_choice:-${_cancel_opt}}"
    case "$_det_choice" in
      1) INSTALL_MODE="repair"    ;;
      2) INSTALL_MODE="reinstall" ;;
      3) $_DB_EXISTS && INSTALL_MODE="wipe" || die "Installation annulée." ;;
      4) die "Installation annulée." ;;
      *) die "Choix invalide — installation annulée." ;;
    esac
  fi

  # ── Chemin rapide upgrade/repair : pas de reconfiguration interactive ──
  if [[ "$INSTALL_MODE" == "upgrade" || "$INSTALL_MODE" == "repair" ]]; then
    _nodyx_upgrade "${_INSTALLED_VERSION:-?}" "$NODYX_VERSION" "$_NODYX_CHECK_DIR"
    _INSTALL_COMPLETE=true
    exit 0
  fi

  [[ "$INSTALL_MODE" == "wipe" ]]      && warn "⚠  La base de données 'nodyx' sera entièrement effacée !"
  [[ "$INSTALL_MODE" == "reinstall" ]] && warn "Réinstallation — données DB préservées, toute la config sera régénérée."
  echo ""
fi

# ── 2. Conflits de ports ─────────────────────────────────────────────────────
_check_port()    { ss -tlnp "sport = :$1" 2>/dev/null | grep -q LISTEN; }
_get_port_proc() { ss -tlnp "sport = :$1" 2>/dev/null | grep -oP 'users:\(\("\K[^"]+' | head -1 || echo ""; }

# Port conflict detection — tableau associatif remplacé par deux listes parallèles
# (compatibilité bash 4.x/5.x ARM, évite l'erreur set -u sur declare -A vide)
_PORT_BLOCKER_SVCS=()   # noms de services bloquants
_PORT_BLOCKER_PORTS=()  # ports correspondants (même index)
_PORT_CADDY_FOUND=false

_pb_add() {
  local svc="$1" port="$2"
  local i
  for i in "${!_PORT_BLOCKER_SVCS[@]}"; do
    if [[ "${_PORT_BLOCKER_SVCS[$i]}" == "$svc" ]]; then
      _PORT_BLOCKER_PORTS[$i]+="${port} "
      return
    fi
  done
  _PORT_BLOCKER_SVCS+=("$svc")
  _PORT_BLOCKER_PORTS+=("${port} ")
}

for _port in 80 443 3000 4173; do
  if _check_port "$_port"; then
    _proc=$(_get_port_proc "$_port")
    _proc_base="${_proc%%:*}"   # nginx:master → nginx
    case "$_proc_base" in
      caddy)
        if [[ "$_port" == "80" || "$_port" == "443" ]]; then
          _PORT_CADDY_FOUND=true
        else
          _pb_add "caddy" "$_port"
        fi ;;
      nginx|apache2|httpd)
        _pb_add "$_proc_base" "$_port" ;;
      "")
        _proc_fb=$(lsof -ti ":${_port}" 2>/dev/null | xargs -I{} ps -p {} -o comm= 2>/dev/null | head -1 || true)
        _pb_add "${_proc_fb:-inconnu}" "$_port"
        ;;
      *)
        _pb_add "$_proc_base" "$_port" ;;
    esac
  fi
done

$_PORT_CADDY_FOUND && info "Caddy déjà présent sur 80/443 — il sera reconfiguré automatiquement."

if [[ ${#_PORT_BLOCKER_SVCS[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${YELLOW}${BOLD}⚠  Services en conflit avec les ports requis par Nodyx :${RESET}"
  for _i in "${!_PORT_BLOCKER_SVCS[@]}"; do
    echo -e "  ${YELLOW}  ● ${BOLD}${_PORT_BLOCKER_SVCS[$_i]}${RESET}${YELLOW} → port(s) ${_PORT_BLOCKER_PORTS[$_i]}${RESET}"
  done
  echo ""

  # Services connus qu'on peut arrêter proprement
  _stoppable=()
  for _svc in "${_PORT_BLOCKER_SVCS[@]}"; do
    if [[ "$_svc" =~ ^(nginx|apache2|httpd)$ ]] && systemctl is-active --quiet "$_svc" 2>/dev/null; then
      _stoppable+=("$_svc")
    fi
  done

  if [[ ${#_stoppable[@]} -gt 0 ]]; then
    echo -e "  ${BOLD}Options :${RESET}"
    echo -e "  ${GREEN}[1]${RESET} Arrêter et désactiver ${BOLD}${_stoppable[*]}${RESET} — libère les ports ${GREEN}(recommandé)${RESET}"
    echo -e "  ${CYAN}[2]${RESET} Continuer sans arrêter — risque de conflit au démarrage de Caddy"
    echo -e "  ${YELLOW}[3]${RESET} Annuler"
    echo ""
    read -rp "$(echo -e "  ${BOLD}Choix [1-3] (défaut: 1): ${RESET}")" _port_choice </dev/tty
    _port_choice="${_port_choice:-1}"
    case "$_port_choice" in
      1)
        for _svc in "${_stoppable[@]}"; do
          systemctl stop    "$_svc" 2>/dev/null || true
          systemctl disable "$_svc" 2>/dev/null || true
          ok "${_svc} arrêté et désactivé"
        done ;;
      2) warn "Services laissés en place — Caddy pourrait échouer à démarrer sur 80/443." ;;
      *) die "Installation annulée — résous les conflits de ports et relance." ;;
    esac
  else
    echo -e "  ${YELLOW}Arrête les services concernés manuellement puis relance l'installation.${RESET}"
    read -rp "$(echo -e "  ${BOLD}Continuer quand même ? [o/N]: ${RESET}")" _port_force </dev/tty
    [[ "${_port_force,,}" != "o" ]] && die "Installation annulée."
  fi
fi

# ── 3. Autres processus PM2 ──────────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  _other_pm2=$(pm2 list --no-color 2>/dev/null \
    | awk '/│/ && (/ online / || / stopped / || / errored /) && !/nodyx-core|nodyx-frontend/ {
        for(i=1;i<=NF;i++) if($i!~/^[│┼]$/ && $i~/^[a-zA-Z0-9]/) {print $i; break}
      }' | grep -v '^$' || true)
  if [[ -n "$_other_pm2" ]]; then
    echo ""
    echo -e "  ${CYAN}${BOLD}ℹ  D'autres applications PM2 tournent sur ce serveur :${RESET}"
    while IFS= read -r _proc; do echo -e "  ${CYAN}  ● ${_proc}${RESET}"; done <<< "$_other_pm2"
    echo ""
    echo -e "  ${CYAN}→ Elles ne seront PAS modifiées. Seuls 'nodyx-core' et 'nodyx-frontend' sont gérés.${RESET}"
    echo ""
    _confirm "Continuer ?" || die "Installation annulée."
  fi
fi

# Bootstrap curl (needed before the main package install step)
if ! command -v curl &>/dev/null; then
  apt-get install -y -q curl >/dev/null 2>&1 || true
fi

# Detect external IP
step "Détection de l'IP publique"
PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org || curl -s --max-time 5 https://ifconfig.me || true)
if [[ -z "$PUBLIC_IP" ]]; then
  warn "Impossible de détecter l'IP publique automatiquement."
  prompt PUBLIC_IP "IP publique de ce serveur"
else
  ok "IP publique : ${BOLD}$PUBLIC_IP${RESET}"
fi

# ── _FORCE_MODE bypass : si flag CLI, court-circuiter le menu de détection ──
if [[ -n "$_FORCE_MODE" ]]; then
  INSTALL_MODE="$_FORCE_MODE"
  info "Mode forcé via CLI : ${BOLD}${INSTALL_MODE}${RESET}"
  if [[ "$INSTALL_MODE" == "upgrade" || "$INSTALL_MODE" == "repair" ]]; then
    [[ -d "$_NODYX_CHECK_DIR" ]] || die "Aucune installation trouvée dans ${_NODYX_CHECK_DIR} — impossible de ${INSTALL_MODE}."
    _installed_ver=$(node -p "require('${_NODYX_CHECK_DIR}/nodyx-core/package.json').version" 2>/dev/null || echo "?")
    _nodyx_upgrade "$_installed_ver" "$NODYX_VERSION" "$_NODYX_CHECK_DIR"
    _INSTALL_COMPLETE=true
    exit 0
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  VÉRIFICATION DE LA CONNECTIVITÉ RÉSEAU
# ═══════════════════════════════════════════════════════════════════════════════
step "Vérification de la connectivité réseau"

_NET_FAIL=false
_net_check() {
  local label="$1" url="$2"
  if curl -sf --max-time 7 --head "$url" >/dev/null 2>&1 \
  || curl -sf --max-time 7       "$url" >/dev/null 2>&1; then
    ok "  ${label}"
  else
    warn "  ${label}  ${YELLOW}← non joignable${RESET}"
    _NET_FAIL=true
  fi
}
_net_check "GitHub"              "https://api.github.com"
_net_check "npm registry"        "https://registry.npmjs.org"
_net_check "nodesource.com"      "https://deb.nodesource.com"
_net_check "Caddy packages"      "https://dl.cloudsmith.io/public/caddy/stable"
_net_check "nodyx.org directory" "https://nodyx.org"

if $_NET_FAIL; then
  echo ""
  warn "Certaines dépendances réseau sont injoignables."
  warn "L'installation risque d'échouer à l'étape npm install ou apt-get."
  _confirm "Continuer quand même ?" \
    || die "Corrige la connectivité réseau (pare-feu ? DNS ?) et relance."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION — questions interactives
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de ton instance"
echo ""

# Pré-remplissage depuis les CLI args (prompt() sautera les vars déjà définies)
[[ -n "$_ARG_NAME" ]]        && COMMUNITY_NAME="$_ARG_NAME"
[[ -n "$_ARG_SLUG" ]]        && COMMUNITY_SLUG="$_ARG_SLUG"
[[ -n "$_ARG_ADMIN_USER" ]]  && ADMIN_USERNAME="$_ARG_ADMIN_USER"
[[ -n "$_ARG_ADMIN_EMAIL" ]] && ADMIN_EMAIL="$_ARG_ADMIN_EMAIL"
[[ -n "$_ARG_ADMIN_PASS" ]]  && ADMIN_PASSWORD="$_ARG_ADMIN_PASS"
[[ -n "$_ARG_DOMAIN" ]]      && DOMAIN="$_ARG_DOMAIN"

conf_section "01  Identité de la communauté"
prompt   COMMUNITY_NAME  "Nom de la communauté (ex: Linux France)"
COMMUNITY_SLUG_DEFAULT=$(slugify "$COMMUNITY_NAME")
prompt   COMMUNITY_SLUG  "Identifiant unique (slug)" "$COMMUNITY_SLUG_DEFAULT"
COMMUNITY_SLUG=$(slugify "$COMMUNITY_SLUG")
if [[ ${#COMMUNITY_SLUG} -lt 3 ]]; then
  die "Le slug est trop court après sanitisation (min 3 caractères). Choisis un nom plus long."
fi
prompt   COMMUNITY_LANG  "Langue principale (fr/en/de/es/it/pt)" "fr"
prompt   COMMUNITY_DESC    "Description courte (optionnel)" ""
prompt   COMMUNITY_COUNTRY "Pays (ex: FR, BE, CH) — optionnel" ""

conf_section "02  Mode de connexion réseau"
echo -e "  ${BOLD}Choisis comment ton instance sera accessible depuis Internet :${RESET}"
echo -e "  ┌─ ${BOLD}[1] Domaine personnel${RESET}  — tu as un domaine (ex: moncommunaute.fr) et les ports 80/443 sont ouverts"
echo -e "  ├─ ${BOLD}[2] Nodyx Relay${RESET}         — ${GREEN}recommandé${RESET} — aucun port à ouvrir, aucun domaine requis (RPi, box, ...)"
echo -e "  └─ ${BOLD}[3] sslip.io auto${RESET}       — domaine gratuit automatique, ports 80/443 ouverts requis"
echo ""
read -rp "$(echo -e "  ${CYAN}?${RESET} Choix [1/2/3] (défaut: 2 — Nodyx Relay): ")" NET_MODE
NET_MODE="${NET_MODE:-2}"

RELAY_MODE=false
DOMAIN_IS_AUTO=false

case "$NET_MODE" in
  1)
    prompt DOMAIN "Domaine de l'instance (ex: moncommunaute.fr)"
    ;;
  2)
    RELAY_MODE=true
    DOMAIN="${COMMUNITY_SLUG}.nodyx.org"
    ok "Mode Nodyx Relay — URL : ${BOLD}https://${DOMAIN}${RESET}"
    info "Aucun port à ouvrir. Le tunnel sera établi vers relay.nodyx.org."
    ;;
  3|*)
    DOMAIN="${PUBLIC_IP//./-}.sslip.io"
    DOMAIN_IS_AUTO=true
    ok "Domaine automatique : ${BOLD}${DOMAIN}${RESET}"
    info "sslip.io résout automatiquement vers ${PUBLIC_IP} — certificat HTTPS géré par Caddy."
    ;;
esac

conf_section "03  Compte administrateur"
prompt        ADMIN_USERNAME "Nom d'utilisateur admin"
prompt        ADMIN_EMAIL    "Email admin"
prompt_secret_confirm ADMIN_PASSWORD "Mot de passe admin (min 8 caractères)" 8

conf_section "04  Configuration email (SMTP)"
echo -e "  Vérification de compte, reset de mot de passe, notifications."
echo -e "  Compatible avec ${BOLD}Resend, Gmail, Mailgun, OVH${RESET} ou tout serveur SMTP."
echo ""
read -rp "$(echo -e "  ${CYAN}?${RESET} Configurer le SMTP maintenant ? [o/N]: ")" want_smtp </dev/tty
want_smtp="${want_smtp:-n}"

SMTP_HOST=""
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""

if [[ "${want_smtp,,}" == "o" ]]; then
  prompt   SMTP_HOST   "Hôte SMTP (ex: smtp.resend.com)"
  prompt   SMTP_PORT   "Port SMTP" "587"
  read -rp "$(echo -e "  ${CYAN}?${RESET} TLS forcé (port 465) ? [o/N]: ")" _smtp_tls </dev/tty
  [[ "${_smtp_tls,,}" == "o" ]] && SMTP_SECURE="true" && SMTP_PORT="465"
  prompt   SMTP_USER   "Utilisateur SMTP (ex: resend ou user@domain.com)"
  prompt_secret SMTP_PASS "Mot de passe / clé SMTP" 1
  prompt   SMTP_FROM   "Adresse expéditeur (ex: noreply@moncommunaute.fr)"
  ok "SMTP configuré (${SMTP_HOST}:${SMTP_PORT})"
else
  info "SMTP ignoré — les emails seront désactivés. Configurable plus tard dans nodyx-core/.env"
fi

# ── DNS pre-check (Let's Encrypt échouera si DNS ne pointe pas ici) ─────────
if ! $RELAY_MODE && ! $DOMAIN_IS_AUTO && [[ -n "${DOMAIN:-}" ]]; then
  info "Vérification DNS de ${BOLD}${DOMAIN}${RESET}..."
  _dns_ip=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -z "$_dns_ip" ]]; then
    echo ""
    warn "DNS ${BOLD}${DOMAIN}${RESET} — non résolu (domaine non configuré ou propagation en cours)."
    warn "Let's Encrypt ne pourra pas générer de certificat TLS."
    echo -e "  ${CYAN}→ Configure ton enregistrement A : ${BOLD}${DOMAIN}${RESET}${CYAN} → ${PUBLIC_IP}${RESET}"
    _confirm "Continuer quand même ?" \
      || die "Configure le DNS d'abord : ${DOMAIN} → ${PUBLIC_IP}, puis relance."
  elif [[ "$_dns_ip" != "$PUBLIC_IP" ]]; then
    echo ""
    warn "DNS ${BOLD}${DOMAIN}${RESET} → ${RED}${_dns_ip}${RESET}  (IP de ce serveur : ${PUBLIC_IP})"
    warn "Mismatch ! Let's Encrypt va échouer — Caddy ne peut pas valider le domaine."
    echo -e "  ${CYAN}→ Mets à jour l'enregistrement A chez ton registrar.${RESET}"
    _confirm "Continuer quand même ?" \
      || die "Corrige le DNS (${DOMAIN} doit pointer vers ${PUBLIC_IP}) puis relance."
  else
    ok "DNS ${DOMAIN} → ${_dns_ip}  ✔"
  fi
fi

echo ""
echo -e "  ${BOLD}${CYAN}┌──────────────────────────────────────────────────┐${RESET}"
echo -e "  ${BOLD}${CYAN}│              Récapitulatif                       │${RESET}"
echo -e "  ${BOLD}${CYAN}├──────────────────────────────────────────────────┤${RESET}"
echo -e "  ${CYAN}│${RESET}  Domaine    : ${BOLD}${DOMAIN}${RESET}$(${DOMAIN_IS_AUTO} && echo " ${CYAN}(sslip.io auto)${RESET}" || true)"
echo -e "  ${CYAN}│${RESET}  Communauté : ${BOLD}${COMMUNITY_NAME}${RESET} (slug: ${COMMUNITY_SLUG})"
echo -e "  ${CYAN}│${RESET}  Langue     : ${BOLD}${COMMUNITY_LANG}${RESET}"
echo -e "  ${CYAN}│${RESET}  Admin      : ${BOLD}${ADMIN_USERNAME}${RESET} <${ADMIN_EMAIL}>"
echo -e "  ${CYAN}│${RESET}  Mode       : ${BOLD}${INSTALL_MODE}${RESET}"
if [[ -n "$SMTP_HOST" ]]; then
echo -e "  ${CYAN}│${RESET}  SMTP       : ${BOLD}${SMTP_HOST}:${SMTP_PORT}${RESET} (from: ${SMTP_FROM})"
else
echo -e "  ${CYAN}│${RESET}  SMTP       : ${YELLOW}non configuré${RESET}"
fi
echo -e "  ${BOLD}${CYAN}└──────────────────────────────────────────────────┘${RESET}"
echo ""
_confirm "Lancer l'installation ?" || die "Installation annulée."

# ═══════════════════════════════════════════════════════════════════════════════
#  GENERATED SECRETS
# ═══════════════════════════════════════════════════════════════════════════════
DB_NAME="nodyx"
DB_USER="nodyx_user"
DB_PASSWORD=$(gen_pass)
JWT_SECRET=$(gen_secret)
TURN_SECRET=$(gen_secret)
NODYX_DIR="/opt/nodyx"
REPO_URL="https://github.com/Pokled/Nodyx.git"

# ═══════════════════════════════════════════════════════════════════════════════
#  SYSTEM PACKAGES
# ═══════════════════════════════════════════════════════════════════════════════
step "Installation des dépendances système"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
# git first — needed to clone the repo, and most VPS images don't ship with it
apt-get install -y -q git 2>/dev/null
_SYS_PKGS="curl wget gnupg2 ca-certificates lsb-release openssl ufw build-essential postgresql postgresql-contrib redis-server"
# shellcheck disable=SC2086
apt-get install -y -q $_SYS_PKGS 2>/dev/null
ok "Paquets système installés"

# Node.js 20 LTS
_NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//;s/\..*//' || echo 0)
if ! command -v node &>/dev/null || [[ "$_NODE_MAJOR" -lt 20 ]]; then
  info "Installation de Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -q nodejs >/dev/null 2>&1
  ok "Node.js $(node -v) installé"
else
  ok "Node.js $(node -v) déjà présent"
fi

# Caddy
if ! command -v caddy &>/dev/null; then
  info "Installation de Caddy..."
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -q && apt-get install -y -q caddy >/dev/null 2>&1
  ok "Caddy $(caddy version | head -1) installé"
else
  ok "Caddy $(caddy version | head -1) déjà présent"
fi

# PM2
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 --silent
  ok "PM2 installé"
else
  ok "PM2 déjà présent"
fi

# PM2 log-rotate
if ! pm2 list 2>/dev/null | grep -q 'pm2-logrotate'; then
  npm install -g pm2-logrotate --silent 2>/dev/null || true
  pm2 set pm2-logrotate:max_size 50M 2>/dev/null || true
  pm2 set pm2-logrotate:retain 7 2>/dev/null || true
  ok "pm2-logrotate configuré (50M, 7 jours)"
fi

# ── Création de l'utilisateur système 'nodyx' ────────────────────────────────
step "Création de l'utilisateur système"
if ! id -u nodyx &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -m -d /home/nodyx nodyx
  ok "Utilisateur système 'nodyx' créé (/home/nodyx)"
else
  ok "Utilisateur système 'nodyx' déjà présent"
fi
mkdir -p /home/nodyx/.pm2/logs
chown -R nodyx:nodyx /home/nodyx/.pm2

# ═══════════════════════════════════════════════════════════════════════════════
#  POSTGRESQL
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de PostgreSQL"

# Detect installed PostgreSQL version (needed for the versioned service name)
_PG_VER=$(ls /usr/lib/postgresql/ 2>/dev/null | sort -Vr | head -1)
[[ -z "$_PG_VER" ]] && die "PostgreSQL introuvable dans /usr/lib/postgresql/ — installation incomplète."

# On Debian/Ubuntu, `postgresql.service` is a meta-service that runs /bin/true.
# The real service managing the cluster is postgresql@X-main.service.
systemctl enable  "postgresql@${_PG_VER}-main" --quiet 2>/dev/null || true
systemctl start   "postgresql@${_PG_VER}-main" 2>/dev/null || true

# Wait for PostgreSQL socket to be ready
info "Attente du démarrage de PostgreSQL..."
_PG_READY=false
for _pg_i in {1..15}; do
  sudo -u postgres pg_isready -q 2>/dev/null && { _PG_READY=true; break; }
  sleep 2
done

if ! $_PG_READY; then
  info "Cluster PostgreSQL non prêt — initialisation..."

  # Ensure server binaries (initdb) are present — some ARM packages omit them
  if ! command -v "/usr/lib/postgresql/${_PG_VER}/bin/initdb" &>/dev/null; then
    info "Installation de postgresql-${_PG_VER} (binaires serveur manquants)..."
    apt-get install -y -q "postgresql-${_PG_VER}" >/dev/null 2>&1 || true
  fi

  # If the cluster config exists but the data directory is not initialized
  # (pg_lsclusters shows "down / <unknown>"), drop the config and recreate cleanly
  if [[ ! -f "/var/lib/postgresql/${_PG_VER}/main/PG_VERSION" ]]; then
    info "Répertoire de données absent — recréation du cluster..."
    pg_dropcluster   "${_PG_VER}" main 2>/dev/null || true
    pg_createcluster "${_PG_VER}" main 2>/dev/null || true
  fi

  # Start the cluster (pg_ctlcluster bypasses systemd, works even without a unit)
  pg_ctlcluster "${_PG_VER}" main start 2>/dev/null || true
  systemctl restart "postgresql@${_PG_VER}-main" 2>/dev/null || true

  for _pg_i in {1..15}; do
    sudo -u postgres pg_isready -q 2>/dev/null && { _PG_READY=true; break; }
    sleep 2
  done
fi

$_PG_READY || die "PostgreSQL n'a pas démarré après 60s.\nVérifie : sudo pg_lsclusters  |  sudo systemctl status postgresql@${_PG_VER}-main"
ok "PostgreSQL ${_PG_VER} prêt"

# Create role + database (idempotent)
sudo -u postgres psql -c "
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
    ELSE
      ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
    END IF;
  END \$\$;
" >/dev/null

# Sauvegarde automatique avant toute action destructive (wipe ou reinstall)
if [[ "$INSTALL_MODE" == "wipe" || "$INSTALL_MODE" == "reinstall" ]]; then
  _auto_backup_db "$INSTALL_MODE"
fi

# Mode wipe : supprimer la base existante proprement
if [[ "$INSTALL_MODE" == "wipe" ]]; then
  info "Mode réinitialisation — suppression de la base de données existante..."
  sudo -u postgres psql -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>/dev/null || true
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null
  ok "Base de données '${DB_NAME}' supprimée"
fi

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" \
  | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null

sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
# PG15+ revokes CREATE on public schema by default — grant it explicitly for migrations
sudo -u postgres psql -d "$DB_NAME" -c "GRANT CREATE ON SCHEMA public TO ${DB_USER};" >/dev/null
ok "Base de données '${DB_NAME}' prête"

# ═══════════════════════════════════════════════════════════════════════════════
#  REDIS
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de Redis"
# Sur Debian Trixie+, le service redis est "static" — il faut d'abord le unmask
# Garantir que les répertoires Redis existent (peuvent manquer après purge partielle)
mkdir -p /var/lib/redis /var/log/redis
chown redis:redis /var/lib/redis /var/log/redis 2>/dev/null || true
chmod 750 /var/lib/redis /var/log/redis 2>/dev/null || true
systemctl unmask redis-server 2>/dev/null || true
systemctl enable redis-server --quiet 2>/dev/null || true
systemctl start redis-server 2>/dev/null || true

# Vérification + retry si le démarrage a échoué
_REDIS_OK=false
for _ri in {1..10}; do
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    _REDIS_OK=true; break
  fi
  sleep 2
done

if ! $_REDIS_OK; then
  # Dernier recours : démarrer directement en daemon
  warn "systemctl redis-server échoué — tentative de démarrage direct..."
  redis-server --daemonize yes --logfile /var/log/redis/redis-server.log \
    --dir /var/lib/redis 2>/dev/null || true
  sleep 3
  redis-cli ping 2>/dev/null | grep -q PONG && _REDIS_OK=true || true
fi

$_REDIS_OK || die "Redis n'a pas démarré.\nVérifie : sudo journalctl -xeu redis-server"
ok "Redis démarré"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-TURN (STUN/TURN Rust natif — remplace coturn) — ignoré en mode Relay
# ═══════════════════════════════════════════════════════════════════════════════
if ! $RELAY_MODE; then
  step "Installation de nodyx-turn (relay vocal WebRTC)"

  _ARCH=$(uname -m)
  case "$_ARCH" in
    x86_64)  _TURN_ARCH="amd64" ;;
    aarch64) _TURN_ARCH="arm64" ;;
    *) die "Architecture non supportée pour nodyx-turn : $_ARCH" ;;
  esac

  _TURN_VERSION="v0.1.2-p2p"
  _TURN_URL="https://github.com/Pokled/Nodyx/releases/download/${_TURN_VERSION}/nodyx-turn-linux-${_TURN_ARCH}"
  info "Téléchargement nodyx-turn ${_TURN_VERSION} (${_TURN_ARCH})..."
  if ! curl -fsSL --max-time 60 "$_TURN_URL" -o /usr/local/bin/nodyx-turn; then
    die "Impossible de télécharger nodyx-turn.\nURL : ${_TURN_URL}\nVérifie ta connexion et que la release ${_TURN_VERSION} existe sur GitHub."
  fi
  if ! file /usr/local/bin/nodyx-turn 2>/dev/null | grep -q ELF; then
    rm -f /usr/local/bin/nodyx-turn
    die "Le fichier téléchargé n'est pas un binaire valide.\nURL : ${_TURN_URL}"
  fi
  chmod +x /usr/local/bin/nodyx-turn

  # Fichier de configuration (secret partagé avec nodyx-core)
  cat > /etc/nodyx-turn.env <<TURNENV
TURN_PUBLIC_IP=${PUBLIC_IP}
TURN_REALM=${DOMAIN}
TURN_SECRET=${TURN_SECRET}
TURN_PORT=3478
TURN_TTL=86400
TURNENV
  chmod 600 /etc/nodyx-turn.env

  # Service systemd
  cat > /etc/systemd/system/nodyx-turn.service <<SVC
[Unit]
Description=Nodyx TURN Server (WebRTC relay)
After=network.target

[Service]
EnvironmentFile=/etc/nodyx-turn.env
ExecStart=/usr/local/bin/nodyx-turn server \
  --udp-port \${TURN_PORT} \
  --public-ip \${TURN_PUBLIC_IP} \
  --realm \${TURN_REALM} \
  --secret \${TURN_SECRET} \
  --ttl \${TURN_TTL}
Restart=on-failure
RestartSec=5s
User=nodyx

[Install]
WantedBy=multi-user.target
SVC

  systemctl daemon-reload
  systemctl enable nodyx-turn --quiet
  systemctl restart nodyx-turn
  ok "nodyx-turn démarré (IP: ${PUBLIC_IP}, port UDP 3478)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PARE-FEU (UFW)
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du pare-feu"

# Sauvegarde des règles UFW existantes avant reset
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  _ufw_bak="/root/ufw-backup-$(date +%Y%m%d-%H%M%S).rules"
  ufw status verbose > "$_ufw_bak" 2>/dev/null || true
  warn "Règles UFW existantes sauvegardées dans ${_ufw_bak}"
fi

_rollback_register "warn 'UFW modifié — restaure manuellement si besoin : ufw --force reset && ufw allow ssh && ufw --force enable'"
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow ssh >/dev/null 2>&1
if ! $RELAY_MODE; then
  ufw allow 80/tcp >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  ufw allow 3478/tcp >/dev/null 2>&1
  ufw allow 3478/udp >/dev/null 2>&1
  ufw allow 5349/tcp >/dev/null 2>&1
  ufw allow 5349/udp >/dev/null 2>&1
  ufw allow 49152:65535/udp >/dev/null 2>&1
fi
ufw --force enable >/dev/null 2>&1
ok "Pare-feu configuré${RELAY_MODE:+ (mode Relay — seul SSH ouvert, connexions sortantes libres)}"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX RELAY CLIENT — binaire (mode Relay uniquement)
# ═══════════════════════════════════════════════════════════════════════════════
if $RELAY_MODE; then
  step "Téléchargement du binaire Nodyx Relay Client"

  _ARCH=$(uname -m)
  case "$_ARCH" in
    x86_64)  _RELAY_ARCH="amd64" ;;
    aarch64) _RELAY_ARCH="arm64" ;;
    *) die "Architecture non supportée pour Nodyx Relay : $_ARCH (supporté: x86_64, aarch64)" ;;
  esac

  _RELAY_VERSION="v0.1.3-p2p"
  _RELAY_URL="https://github.com/Pokled/Nodyx/releases/download/${_RELAY_VERSION}/nodyx-relay-linux-${_RELAY_ARCH}"

  info "Téléchargement nodyx-relay ${_RELAY_VERSION} (${_RELAY_ARCH})..."
  if ! curl -fsSL --max-time 60 "$_RELAY_URL" -o /usr/local/bin/nodyx-relay; then
    die "Impossible de télécharger nodyx-relay.\nURL : ${_RELAY_URL}\nVérifie ta connexion et que la release ${_RELAY_VERSION} existe sur GitHub."
  fi
  # Vérifier que c'est bien un binaire ELF (pas une page HTML d'erreur)
  if ! file /usr/local/bin/nodyx-relay 2>/dev/null | grep -q ELF; then
    rm -f /usr/local/bin/nodyx-relay
    die "Le fichier téléchargé n'est pas un binaire valide (release introuvable ?).\nURL : ${_RELAY_URL}"
  fi
  chmod +x /usr/local/bin/nodyx-relay
  ok "nodyx-relay $(/usr/local/bin/nodyx-relay --version 2>&1 || echo '?') installé"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX — CLONE / UPDATE
# ═══════════════════════════════════════════════════════════════════════════════
step "Téléchargement de Nodyx"

if [[ -d "$NODYX_DIR/.git" ]]; then
  info "Mise à jour du dépôt existant..."
  git -C "$NODYX_DIR" pull --ff-only
else
  info "Clonage du dépôt dans $NODYX_DIR..."
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$REPO_URL" "$NODYX_DIR"
fi
ok "Code Nodyx présent dans $NODYX_DIR"

# Lire la version réelle depuis le dépôt (évite les décalages avec la version hardcodée)
_PKG_VER=$(node -p "require('${NODYX_DIR}/nodyx-core/package.json').version" 2>/dev/null || true)
if [[ -n "$_PKG_VER" ]]; then
  NODYX_VERSION="$_PKG_VER"
  info "Version détectée depuis le dépôt : ${NODYX_VERSION}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-CORE — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du backend (nodyx-core)"

cat > "${NODYX_DIR}/nodyx-core/.env" <<COREENV
# Généré par install.sh — ne pas modifier manuellement

# Identité de la communauté
NODYX_COMMUNITY_NAME=${COMMUNITY_NAME}
NODYX_COMMUNITY_SLUG=${COMMUNITY_SLUG}
NODYX_COMMUNITY_DESCRIPTION=${COMMUNITY_DESC}
NODYX_COMMUNITY_LANGUAGE=${COMMUNITY_LANG}
NODYX_COMMUNITY_COUNTRY=${COMMUNITY_COUNTRY}
NODYX_VERSION=${NODYX_VERSION}

# Serveur
PORT=3000
HOST=0.0.0.0
NODE_ENV=production

# JWT
JWT_SECRET=${JWT_SECRET}

# PostgreSQL
DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Frontend (CORS)
FRONTEND_URL=https://${DOMAIN}

# TURN relay (nodyx-turn) — credentials dynamiques par utilisateur
TURN_PUBLIC_IP=${PUBLIC_IP:-}
TURN_SECRET=${TURN_SECRET:-}
TURN_PORT=3478

# SMTP
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_SECURE=${SMTP_SECURE}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_FROM:-noreply@${DOMAIN}}
COREENV
# En mode Relay, ajouter des STUN publics en fallback (pas de nodyx-turn)
if $RELAY_MODE; then
  printf "\n# Fallback STUN (relay mode — nodyx-turn non installé)\nSTUN_FALLBACK_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302\n" \
    >> "${NODYX_DIR}/nodyx-core/.env"
fi

cd "${NODYX_DIR}/nodyx-core"
run_bg "npm install (backend)..." npm install --no-fund --no-audit \
  || die "npm install backend échoué. Vérifie ta connexion Internet."
run_bg "Compilation TypeScript (backend)..." npm run build \
  || die "Build backend échoué. Vérifie les logs ci-dessus."
[[ -f "${NODYX_DIR}/nodyx-core/dist/index.js" ]] \
  || die "dist/index.js absent — le build TypeScript n'a pas produit de sortie."
ok "Backend compilé"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-FRONTEND — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du frontend (nodyx-frontend)"

cat > "${NODYX_DIR}/nodyx-frontend/.env" <<FEENV
# Généré par install.sh — ne pas modifier manuellement

PUBLIC_API_URL=https://${DOMAIN}
# Nodyx Signet (authentificateur optionnel) — laisser vide si non utilisé
PUBLIC_SIGNET_URL=
# Les credentials TURN sont désormais générés dynamiquement par nodyx-core (nodyx-turn).
# Ces variables sont conservées pour compatibilité avec d'éventuelles instances existantes.
PUBLIC_TURN_URL=
PUBLIC_TURN_USERNAME=
PUBLIC_TURN_CREDENTIAL=
FEENV

cd "${NODYX_DIR}/nodyx-frontend"
run_bg "npm install (frontend)..." npm install --no-fund --no-audit \
  || die "npm install frontend échoué. Vérifie ta connexion Internet."

# Sur ARM64 : s'assurer que le binaire natif Rollup est bien présent
# (évite l'erreur "traceVariable / tick from svelte" avec le fallback JS)
if [[ "$(uname -m)" == "aarch64" ]]; then
  if [[ ! -f "node_modules/@rollup/rollup-linux-arm64-gnu/rollup.linux-arm64-gnu.node" ]]; then
    info "Binaire Rollup ARM64 absent — installation forcée..."
    npm install @rollup/rollup-linux-arm64-gnu --no-save --no-fund --no-audit 2>/dev/null || true
  fi
fi

export NODE_OPTIONS="--max-old-space-size=1024"
run_bg "Build SvelteKit (peut durer 2-5 min sur ARM)..." \
  npm run build \
  || die "Build frontend échoué. Vérifie les logs ci-dessus."
unset NODE_OPTIONS
[[ -f "${NODYX_DIR}/nodyx-frontend/build/index.js" ]] \
  || die "build/index.js absent — le build SvelteKit n'a pas produit de sortie."
ok "Frontend compilé"

# ═══════════════════════════════════════════════════════════════════════════════
#  CADDY
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de Caddy (proxy HTTPS)"

if $RELAY_MODE; then
  # En mode Relay : Caddy écoute sur HTTP port 80 (local seulement).
  # TLS est géré en amont par le serveur nodyx-relay sur nodyx.org.
  cat > /etc/caddy/Caddyfile <<CADDY
:80 {
    encode gzip

    header {
        X-Content-Type-Options  "nosniff"
        X-Frame-Options         "SAMEORIGIN"
        Referrer-Policy         "strict-origin-when-cross-origin"
        -Server
    }

    @honeypot path_regexp hp ^/(\.env|\.env\.|\.git/|\.htaccess|\.htpasswd|wp-admin|wp-login\.php|wp-config\.php|xmlrpc\.php|phpmyadmin|pma/|adminer|myadmin|shell\.php|cmd\.php|c99\.php|r57\.php|webshell|config\.php|configuration\.php|web\.config|settings\.php|backup\.sql|dump\.sql|db\.sql|database\.sql|install\.php|setup\.php|installer|console|manager/|administrator|eval\.php|debug|id_rsa|credentials|config\.json|database\.yml|\.aws|\.ssh)
    handle @honeypot {
        rewrite * /api/v1/_hp?p={http.request.uri.path}
        reverse_proxy localhost:3000 {
            header_up -X-Forwarded-For
        }
    }

    reverse_proxy /api/* localhost:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /uploads/* localhost:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /socket.io/* localhost:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy * localhost:4173
}
CADDY
else
  cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    encode gzip

    header {
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "SAMEORIGIN"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "camera=(self), microphone=(self), geolocation=(self)"
        Content-Security-Policy   "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' wss: https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self';"
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        -Server
    }

    @honeypot path_regexp hp ^/(\.env|\.env\.|\.git/|\.htaccess|\.htpasswd|wp-admin|wp-login\.php|wp-config\.php|xmlrpc\.php|phpmyadmin|pma/|adminer|myadmin|shell\.php|cmd\.php|c99\.php|r57\.php|webshell|config\.php|configuration\.php|web\.config|settings\.php|backup\.sql|dump\.sql|db\.sql|database\.sql|install\.php|setup\.php|installer|console|manager/|administrator|eval\.php|debug|id_rsa|credentials|config\.json|database\.yml|\.aws|\.ssh)
    handle @honeypot {
        rewrite * /api/v1/_hp?p={http.request.uri.path}
        reverse_proxy localhost:3000 {
            header_up -X-Forwarded-For
        }
    }

    reverse_proxy /api/* localhost:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /uploads/* localhost:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /socket.io/* localhost:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy * localhost:4173
}
CADDY
fi

systemctl enable caddy --quiet
systemctl restart caddy
if $RELAY_MODE; then
  ok "Caddy configuré (HTTP local port 80 — TLS géré par relay.nodyx.org)"
else
  ok "Caddy configuré (Let's Encrypt automatique pour $DOMAIN)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PM2 ECOSYSTEM
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de PM2"

cat > "${NODYX_DIR}/ecosystem.config.js" <<PM2
module.exports = {
  apps: [
    {
      name: 'nodyx-core',
      script: 'dist/index.js',
      cwd: '${NODYX_DIR}/nodyx-core',
      watch: false,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'nodyx-frontend',
      script: 'build/index.js',
      cwd: '${NODYX_DIR}/nodyx-frontend',
      watch: false,
      max_memory_restart: '256M',
      env: { NODE_ENV: 'production', PORT: '4173', HOST: '127.0.0.1', ORIGIN: 'https://${DOMAIN}', PRIVATE_API_SSR_URL: 'http://127.0.0.1:3000/api/v1' },
    },
  ],
}
PM2

# Donner la propriété du répertoire à l'utilisateur nodyx
chown -R nodyx:nodyx "${NODYX_DIR}"

# Arrêter les anciens processus nodyx (root ou nodyx) sans toucher aux autres apps PM2
pm2 delete nodyx-core     2>/dev/null || true
pm2 delete nodyx-frontend 2>/dev/null || true
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 delete nodyx-core     2>/dev/null || true
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 delete nodyx-frontend  2>/dev/null || true

# Démarrer les apps sous l'utilisateur nodyx
_rollback_register "runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 delete nodyx-core nodyx-frontend 2>/dev/null || true #rollback PM2"
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 startOrRestart "${NODYX_DIR}/ecosystem.config.js" --update-env
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save

# Service systemd pm2-nodyx (démarrage automatique au boot)
cat > /etc/systemd/system/pm2-nodyx.service <<SVC
[Unit]
Description=PM2 process manager (nodyx)
Documentation=https://pm2.keymetrics.io/
After=network.target postgresql.service redis-server.service

[Service]
Type=forking
User=nodyx
LimitNOFILE=infinity
LimitNPROC=infinity
LimitCORE=infinity
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
Environment=PM2_HOME=/home/nodyx/.pm2
PIDFile=/home/nodyx/.pm2/pm2.pid
Restart=on-failure
ExecStart=$(which pm2) start ${NODYX_DIR}/ecosystem.config.js
ExecReload=$(which pm2) reload all
ExecStop=$(which pm2) kill

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable pm2-nodyx --quiet
ok "PM2 configuré sous l'utilisateur 'nodyx'"

info "Vérification du démarrage des processus (5s)..."
sleep 5
for _app in nodyx-core nodyx-frontend; do
  _st=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null \
    | grep " ${_app} " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_st" == "online" ]]; then
    ok "  $_app — online"
  else
    warn "$_app — statut : ${_st}"
    warn "Logs de démarrage :"
    runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs "$_app" --lines 20 --nostream 2>/dev/null || true
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
#  WAIT FOR BACKEND + BOOTSTRAP (community + admin)
# ═══════════════════════════════════════════════════════════════════════════════
step "Initialisation de la communauté et du compte administrateur"

_BACKEND_READY=false
_bw_si=0; _bw_elapsed=0
for _bw_i in {1..90}; do
  if curl -sf http://localhost:3000/api/v1/instance/info >/dev/null 2>&1; then
    printf "\r\033[2K"
    ok "Backend opérationnel (${_bw_elapsed}s)"
    _BACKEND_READY=true
    break
  fi
  printf "\r  ${CYAN}%s${RESET}  Backend en démarrage (migrations incluses)...  ${YELLOW}%ds${RESET}   " \
    "${_HC_SPIN[$((${_bw_si} % 10))]}" "$_bw_elapsed"
  _bw_si=$((_bw_si+1)); sleep 2; _bw_elapsed=$((_bw_elapsed+2))
done
printf "\r\033[2K"

if ! $_BACKEND_READY; then
  warn "Backend non opérationnel après 180s."
  warn "Logs PM2 (nodyx-core) :"
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 35 --nostream 2>/dev/null || true
  warn "Pour relancer : runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart nodyx-core"
  warn "Pour déboguer : runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core"
  warn "Tentative de création du compte admin quand même..."
fi

# Register admin account — retry jusqu'à 3 fois (backend peut encore démarrer)
_REGISTER_OK=false
for _reg_try in 1 2 3; do
  _REG_JSON=$(python3 -c "import json,sys; print(json.dumps({'username':sys.argv[1],'email':sys.argv[2],'password':sys.argv[3]}))" \
    "$ADMIN_USERNAME" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" 2>/dev/null \
    || printf '{"username":"%s","email":"%s","password":"%s"}' "$ADMIN_USERNAME" "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  HTTP_CODE=$(curl -s -o /tmp/nodyx_register.json -w "%{http_code}" \
    -X POST http://localhost:3000/api/v1/auth/register \
    -H "Content-Type: application/json" \
    -d "$_REG_JSON" 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
    ok "Compte '${ADMIN_USERNAME}' créé"
    _REGISTER_OK=true; break
  elif [[ "$HTTP_CODE" == "409" ]]; then
    ok "Compte '${ADMIN_USERNAME}' déjà existant (réinstallation ?)"
    _REGISTER_OK=true; break
  else
    warn "Tentative ${_reg_try}/3 — HTTP ${HTTP_CODE} : $(cat /tmp/nodyx_register.json 2>/dev/null | head -c 200)"
    [[ $_reg_try -lt 3 ]] && { info "Retry dans 8s..."; sleep 8; }
  fi
done

if ! $_REGISTER_OK; then
  warn "Inscription impossible après 3 tentatives."
  warn "Tu pourras créer ton compte sur https://${DOMAIN}/auth/register"
fi

# Bootstrap community + make admin owner — done directly in PostgreSQL
# (The API requires a community to exist before any admin action)
# Escape single quotes for SQL safety (e.g. "L'Atelier" → "L''Atelier")
COMMUNITY_NAME_SQL="${COMMUNITY_NAME//\'/\'\'}"
COMMUNITY_DESC_SQL="${COMMUNITY_DESC//\'/\'\'}"
ADMIN_EMAIL_SQL="${ADMIN_EMAIL//\'/\'\'}"

USER_ID=$(sudo -u postgres psql -d "$DB_NAME" -tc \
  "SELECT id FROM users WHERE lower(email)=lower('${ADMIN_EMAIL_SQL}');" 2>/dev/null | tr -d ' \n')

if [[ -n "$USER_ID" ]]; then
  sudo -u postgres psql -d "$DB_NAME" <<SQL >/dev/null
    -- Create the instance community
    INSERT INTO communities (name, slug, description, owner_id, is_public)
    VALUES (
      '${COMMUNITY_NAME_SQL}',
      '${COMMUNITY_SLUG}',
      '${COMMUNITY_DESC_SQL}',
      '${USER_ID}',
      true
    )
    ON CONFLICT (slug) DO NOTHING;

    -- Make admin the owner of the community
    INSERT INTO community_members (community_id, user_id, role)
    SELECT id, '${USER_ID}', 'owner'
    FROM communities WHERE slug = '${COMMUNITY_SLUG}'
    ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'owner';
SQL
  ok "Communauté '${COMMUNITY_NAME}' créée, ${ADMIN_USERNAME} → owner"
else
  warn "Utilisateur introuvable en DB. Initialisation communauté ignorée."
  warn "Lance le backend et crée ton compte sur https://${DOMAIN}/auth/register"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  OPTIONAL — FREE nodyx.org SUBDOMAIN
# ═══════════════════════════════════════════════════════════════════════════════
step "Sous-domaine gratuit nodyx.org"

NODYX_SUBDOMAIN=""
NODYX_DIRECTORY_TOKEN=""
NODYX_DIRECTORY_URL="https://nodyx.org/api/directory"

echo ""
# En mode Relay ou auto-domaine, le sous-domaine nodyx.org est obligatoire/automatique.
if $RELAY_MODE; then
  echo -e "  Mode Relay : enregistrement de ${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET} obligatoire — automatique."
  want_subdomain="o"
elif $DOMAIN_IS_AUTO; then
  echo -e "  Tu n'as pas de domaine propre : ${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET} va être activé"
  echo -e "  automatiquement comme alias mémorable pour ton instance."
  want_subdomain="o"
else
  echo -e "  Alias optionnel : ${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET}"
  echo -e "  Redirige vers ton instance — utile comme raccourci mémorable."
  echo ""
  read -rp "$(echo -e "  Activer ${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET} ? [O/n] ")" want_subdomain
fi

if [[ "${want_subdomain,,}" != "n" ]]; then
  info "Enregistrement auprès du directory nodyx.org..."

  REGISTER_RESPONSE=$(curl -s -X POST "${NODYX_DIRECTORY_URL}/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":        \"${COMMUNITY_NAME}\",
      \"slug\":        \"${COMMUNITY_SLUG}\",
      \"url\":         \"https://${DOMAIN}\",
      \"language\":    \"${COMMUNITY_LANG}\",
      \"version\":     \"${NODYX_VERSION}\"
    }" 2>/dev/null || true)

  REGISTER_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
  REGISTER_SLUG=$(echo "$REGISTER_RESPONSE" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4 || true)

  if [[ -n "$REGISTER_TOKEN" ]]; then
    NODYX_DIRECTORY_TOKEN="$REGISTER_TOKEN"
    NODYX_SUBDOMAIN="${REGISTER_SLUG:-${COMMUNITY_SLUG}.nodyx.org}"
    ok "Enregistré ! Sous-domaine : ${BOLD}https://${NODYX_SUBDOMAIN}${RESET}"
    if ! $RELAY_MODE; then
      info "Le DNS sera actif dans ~30 secondes."
      info "Sauvegarde le token directory — nécessaire pour les heartbeats et la désinscription."
    fi
    # Injecter le token dans .env + redémarrer nodyx-core pour activer les heartbeats
    {
      printf "\n# Annuaire nodyx.org\n"
      printf "DIRECTORY_TOKEN=%s\n" "${NODYX_DIRECTORY_TOKEN}"
      printf "DIRECTORY_API_URL=https://nodyx.org\n"
      printf "SELF_URL=http://127.0.0.1:3000\n"
      printf "VPS_IP=%s\n" "${PUBLIC_IP:-}"
      printf "NODYX_GLOBAL_INDEXING=true\n"
    } >> "${NODYX_DIR}/nodyx-core/.env"
    cd "${NODYX_DIR}" && runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart nodyx-core 2>/dev/null || true
  else
    # Check for slug conflict (409) — common on reinstall / machine change
    if echo "$REGISTER_RESPONSE" | grep -q 'Slug already taken'; then
      warn "Le slug '${COMMUNITY_SLUG}' est déjà enregistré dans le directory."
      if $RELAY_MODE; then
        echo ""
        echo -e "  ${BOLD}Options :${RESET}"
        echo -e "  ${GREEN}[1]${RESET} Choisir un slug différent maintenant"
        echo -e "  ${YELLOW}[2]${RESET} Annuler (contacte le support nodyx.org pour libérer le slug)"
        echo ""
        read -rp "$(echo -e "  ${BOLD}Choix [1-2] (défaut: 1): ${RESET}")" _slug_choice </dev/tty
        _slug_choice="${_slug_choice:-1}"
        if [[ "$_slug_choice" == "1" ]]; then
          read -rp "$(echo -e "  ${BOLD}Nouveau slug (lettres, chiffres, tirets) : ${RESET}")" _new_slug </dev/tty
          _new_slug="${_new_slug:-}"
          if [[ -z "$_new_slug" ]]; then
            die "Slug vide — installation annulée."
          fi
          COMMUNITY_SLUG="$_new_slug"
          REGISTER_RESPONSE=$(curl -fsSL -X POST "https://nodyx.org/api/directory/register" \
            -H "Content-Type: application/json" \
            -d "{
              \"slug\":        \"${COMMUNITY_SLUG}\",
              \"name\":        \"${COMMUNITY_NAME}\",
              \"url\":         \"https://${COMMUNITY_SLUG}.nodyx.org\",
              \"language\":    \"${COMMUNITY_LANG}\",
              \"version\":     \"${NODYX_VERSION}\"
            }" 2>/dev/null || true)
          REGISTER_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
          REGISTER_SLUG=$(echo "$REGISTER_RESPONSE" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4 || true)
          if [[ -n "$REGISTER_TOKEN" ]]; then
            NODYX_DIRECTORY_TOKEN="$REGISTER_TOKEN"
            NODYX_SUBDOMAIN="${REGISTER_SLUG:-${COMMUNITY_SLUG}.nodyx.org}"
            ok "Enregistré ! Sous-domaine : ${BOLD}https://${NODYX_SUBDOMAIN}${RESET}"
          else
            die "Enregistrement échoué avec le nouveau slug. Vérifie ta connexion et réessaie."
          fi
        else
          die "Installation annulée. Contacte le support nodyx.org pour libérer le slug '${COMMUNITY_SLUG}'."
        fi
      else
        warn "Si c'est une réinstallation, l'ancienne entrée sera écrasée au prochain ping."
      fi
    else
      warn "Enregistrement échoué."
      warn "Réponse : $(echo "$REGISTER_RESPONSE" | head -c 200)"
      warn "Tu peux réessayer manuellement plus tard sur https://nodyx.org"
      if $RELAY_MODE; then
        die "Enregistrement au directory échoué. Le mode Relay nécessite un slug valide."
      fi
    fi
  fi
else
  info "Sous-domaine gratuit ignoré. Tu utiliseras https://${DOMAIN}"
fi

# ── Relay client systemd service (mode Relay uniquement) ──────────────────────
if $RELAY_MODE && [[ -n "$NODYX_DIRECTORY_TOKEN" ]]; then
  step "Configuration du service Nodyx Relay Client"

  cat > /etc/systemd/system/nodyx-relay-client.service <<SVC
[Unit]
Description=Nodyx Relay Client — tunnel vers relay.nodyx.org
After=network.target

[Service]
ExecStart=/usr/local/bin/nodyx-relay client \
  --server relay.nodyx.org:7443 \
  --slug ${COMMUNITY_SLUG} \
  --token ${NODYX_DIRECTORY_TOKEN} \
  --local-port 80
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=60
StartLimitBurst=5
User=nodyx

[Install]
WantedBy=multi-user.target
SVC

  systemctl daemon-reload
  systemctl enable nodyx-relay-client --quiet
  systemctl start nodyx-relay-client
  ok "Nodyx Relay Client démarré — tunnel vers relay.nodyx.org:7443 actif"
  info "Ton instance sera accessible sur https://${DOMAIN} dans quelques secondes."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  SAVE CREDENTIALS
# ═══════════════════════════════════════════════════════════════════════════════
CREDS_FILE="/root/nodyx-credentials.txt"

# Prépare les blocs conditionnels pour le fichier credentials
_CREDS_TURN=""
if ! $RELAY_MODE; then
  _CREDS_TURN="TURN relay       : turn:${PUBLIC_IP}:3478 (nodyx-turn)
TURN secret      : ${TURN_SECRET}"
fi
_CREDS_RELAY=""
if $RELAY_MODE; then
  _CREDS_RELAY="Mode réseau      : Nodyx Relay (tunnel TCP sortant)
Relay service    : sudo systemctl status nodyx-relay-client"
fi

cat > "$CREDS_FILE" <<CREDS
═══════════════════════════════════════════════
  NODYX — Credentials de l'instance
  Générés le $(date)
═══════════════════════════════════════════════

URL              : https://${DOMAIN}
Admin username   : ${ADMIN_USERNAME}
Admin email      : ${ADMIN_EMAIL}
Admin password   : ${ADMIN_PASSWORD}

PostgreSQL user  : ${DB_USER}
PostgreSQL pass  : ${DB_PASSWORD}
PostgreSQL DB    : ${DB_NAME}

JWT secret       : ${JWT_SECRET}

${_CREDS_TURN}
${_CREDS_RELAY}
$([ -n "$SMTP_HOST" ] && printf "SMTP host        : %s:%s\nSMTP user        : %s\nSMTP pass        : %s\nSMTP from        : %s" "$SMTP_HOST" "$SMTP_PORT" "$SMTP_USER" "$SMTP_PASS" "$SMTP_FROM")
Nodyx dir        : ${NODYX_DIR}
$([ -n "$NODYX_SUBDOMAIN" ] && echo "Sous-domaine     : https://${NODYX_SUBDOMAIN}")
$([ -n "$NODYX_DIRECTORY_TOKEN" ] && echo "Directory token  : ${NODYX_DIRECTORY_TOKEN}")

GARDE CE FICHIER EN LIEU SÛR — ne le partage jamais.
CREDS
chmod 600 "$CREDS_FILE"

# ── Génération du script de mise à jour ───────────────────────────────────────
UPDATE_SCRIPT="/usr/local/bin/nodyx-update"
cat > "$UPDATE_SCRIPT" <<'UPDATESCRIPT'
#!/usr/bin/env bash
# nodyx-update — Met à jour Nodyx vers la dernière version
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }
UPDATESCRIPT

# Injecter NODYX_DIR (résolu au moment de l'install)
cat >> "$UPDATE_SCRIPT" <<UPDATESCRIPT2
NODYX_DIR="${NODYX_DIR}"
UPDATESCRIPT2

cat >> "$UPDATE_SCRIPT" <<'UPDATESCRIPT3'

[[ $EUID -ne 0 ]] && die "Lance en root : sudo nodyx-update"
echo -e "\n${BOLD}━━━  Mise à jour Nodyx  ━━━${RESET}\n"

info "Récupération des dernières modifications..."
git -C "$NODYX_DIR" pull --ff-only || die "git pull échoué. Vérifie ta connexion ou résous les conflits."

info "Rebuild backend..."
cd "${NODYX_DIR}/nodyx-core"
npm install --no-fund --no-audit --silent
npm run build || die "Build backend échoué."
ok "Backend compilé"

info "Rebuild frontend..."
cd "${NODYX_DIR}/nodyx-frontend"
npm install --no-fund --no-audit --silent
npm run build || die "Build frontend échoué."
ok "Frontend compilé"

info "Redémarrage des services..."
cd "$NODYX_DIR"
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart ecosystem.config.js --update-env
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save

echo ""
ok "Nodyx mis à jour et redémarré."
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list
UPDATESCRIPT3

chmod +x "$UPDATE_SCRIPT"
ok "Script de mise à jour : ${BOLD}nodyx-update${RESET} (sudo nodyx-update)"

# ── Génération du script de diagnostic nodyx-doctor ──────────────────────────
DOCTOR_SCRIPT="/usr/local/bin/nodyx-doctor"
cat > "$DOCTOR_SCRIPT" <<'DOCTORHEAD'
#!/usr/bin/env bash
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
_pass() { printf "  ${GREEN}✔${RESET}  %-42s %s\n" "$1" "${2:-}"; }
_warn() { printf "  ${YELLOW}⚠${RESET}  %-42s %s\n" "$1" "${2:-}"; }
_fail() { printf "  ${RED}✘${RESET}  %-42s %s\n" "$1" "${2:-}"; }
_sect() { echo ""; echo -e "  ${BOLD}${CYAN}▸ $1${RESET}"; echo -e "  ${CYAN}$(printf '─%.0s' {1..52})${RESET}"; }
DOCTORHEAD

cat >> "$DOCTOR_SCRIPT" <<DOCTORVARS
NODYX_DIR="${NODYX_DIR}"
DOMAIN="${DOMAIN}"
DB_NAME="${DB_NAME}"
DOCTORVARS

cat >> "$DOCTOR_SCRIPT" <<'DOCTORBODY'
[[ $EUID -ne 0 ]] && { echo "Lance en root : sudo nodyx-doctor"; exit 1; }
echo ""
echo -e "${BOLD}  ━━━  nodyx-doctor — Diagnostic complet  ━━━${RESET}"

# ── Services système ──────────────────────────────────────────────────────────
_sect "Services système"
for _svc in postgresql redis-server caddy nodyx-turn pm2-nodyx; do
  if ! systemctl list-unit-files "${_svc}.service" 2>/dev/null | grep -q "$_svc"; then continue; fi
  if systemctl is-active --quiet "$_svc" 2>/dev/null; then
    _since=$(systemctl show "$_svc" -p ActiveEnterTimestamp 2>/dev/null \
      | cut -d= -f2 | sed 's/  */ /g' | awk '{print $3,$4}' 2>/dev/null || echo "?")
    _pass "$_svc" "actif depuis ${_since}"
  else
    _fail "$_svc" "(inactif — sudo systemctl start ${_svc})"
  fi
done

# ── Applications PM2 ─────────────────────────────────────────────────────────
_sect "Applications PM2"
for _app in nodyx-core nodyx-frontend; do
  _raw=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 show "$_app" 2>/dev/null || echo "")
  _status=$(echo "$_raw" | grep -i '│ status' | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  _mem=$(echo "$_raw" | grep -iE 'heap size|memory usage' | grep -oE '[0-9.]+ ?(mb|gb)' -i | head -1 || echo "?")
  _restarts=$(echo "$_raw" | grep -i 'restart' | grep -oE '[0-9]+' | tail -1 || echo "?")
  _uptime=$(echo "$_raw" | grep -i 'uptime' | grep -oP '\d+[smhd/]+\d*[smhd]*' | head -1 || echo "?")
  if [[ "$_status" == "online" ]]; then
    _pass "$_app" "↑${_uptime}  mem:${_mem}  restarts:${_restarts}"
  else
    _fail "$_app" "[${_status}] — runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart ${_app}"
  fi
done

# ── Santé API ─────────────────────────────────────────────────────────────────
_sect "Santé API"
_t0=$(date +%s%3N)
_api_body=$(curl -sf --max-time 5 http://localhost:3000/api/v1/instance/info 2>/dev/null || echo "")
_t1=$(date +%s%3N)
if [[ -n "$_api_body" ]]; then
  _ver=$(echo "$_api_body" | grep -o '"version":"[^"]*"' | cut -d'"' -f4 || echo "?")
  _ms=$(( _t1 - _t0 ))
  _pass "API /api/v1/instance/info" "v${_ver}  (${_ms}ms)"
else
  _fail "API /api/v1/instance/info" "(non joignable — nodyx-core en cours ?)"
fi

# ── Certificat TLS ────────────────────────────────────────────────────────────
if [[ -n "${DOMAIN:-}" ]]; then
  _sect "Certificat TLS"
  _cert_end=$(echo | timeout 5 openssl s_client -connect "${DOMAIN}:443" \
    -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2 || echo "")
  if [[ -n "$_cert_end" ]]; then
    _days=$(( ( $(date -d "$_cert_end" +%s 2>/dev/null || echo 0) - $(date +%s) ) / 86400 ))
    if   [[ $_days -gt 30 ]]; then _pass "${DOMAIN}" "expire dans ${_days} jours"
    elif [[ $_days -gt  7 ]]; then _warn "${DOMAIN}" "expire dans ${_days} jours — renouvellement bientôt"
    else                           _fail "${DOMAIN}" "expire dans ${_days} jours — URGENT"
    fi
  else
    _warn "${DOMAIN}" "(TLS non accessible depuis ce serveur)"
  fi
fi

# ── Base de données ───────────────────────────────────────────────────────────
_sect "Base de données"
if sudo -u postgres pg_isready -q 2>/dev/null; then
  _tables=$(sudo -u postgres psql -d "$DB_NAME" -tc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d ' \n' || echo "?")
  _dbsz=$(sudo -u postgres psql -d "$DB_NAME" -tc \
    "SELECT pg_size_pretty(pg_database_size('${DB_NAME}'))" 2>/dev/null | tr -d ' \n' || echo "?")
  _pass "PostgreSQL '${DB_NAME}'" "${_tables} tables  ${_dbsz}"
else
  _fail "PostgreSQL" "(pg_isready échoué)"
fi

if redis-cli ping 2>/dev/null | grep -q PONG; then
  _rmem=$(redis-cli info memory 2>/dev/null | grep 'used_memory_human' | cut -d: -f2 | tr -d '[:space:]' || echo "?")
  _rkeys=$(redis-cli dbsize 2>/dev/null | tr -d '[:space:]' || echo "?")
  _pass "Redis" "mem:${_rmem}  clés:${_rkeys}"
else
  _fail "Redis" "(ping échoué — sudo systemctl start redis-server)"
fi

# ── Ressources système ────────────────────────────────────────────────────────
_sect "Ressources système"
_ram_free=$(free -m 2>/dev/null | awk '/^Mem/{print $7}')
_ram_total=$(free -m 2>/dev/null | awk '/^Mem/{print $2}')
_swap=$(free -m 2>/dev/null | awk '/^Swap/{print $2}')
[[ "$_ram_free" -gt 300 ]] \
  && _pass "RAM disponible" "${_ram_free} MB / ${_ram_total} MB" \
  || _warn "RAM disponible" "${_ram_free} MB / ${_ram_total} MB  (ajouterle swap !)"
[[ "$_swap" -gt 0 ]] \
  && _pass "Swap" "${_swap} MB" \
  || _warn "Swap" "aucun swapfile — ajouter : fallocate -l 1G /swapfile && mkswap /swapfile && swapon /swapfile"

_disk_avail=$(df -h "${NODYX_DIR}" 2>/dev/null | awk 'NR==2{print $4}' || echo "?")
_disk_pct=$(df "${NODYX_DIR}" 2>/dev/null | awk 'NR==2{gsub(/%/,"",$5); print $5}' || echo 0)
[[ "$_disk_pct" -lt 80 ]] \
  && _pass "Disque ${NODYX_DIR}" "${_disk_avail} libres  (${_disk_pct}% utilisé)" \
  || _warn "Disque ${NODYX_DIR}" "${_disk_avail} libres  (${_disk_pct}% utilisé — attention)"

# ── Sécurité ──────────────────────────────────────────────────────────────────
_sect "Sécurité"
_jwt=$(grep '^JWT_SECRET=' "${NODYX_DIR}/nodyx-core/.env" 2>/dev/null | cut -d= -f2 || echo "")
[[ "${#_jwt}" -ge 32 ]] \
  && _pass "JWT_SECRET" "(${#_jwt} chars — fort)" \
  || _fail "JWT_SECRET" "trop court (${#_jwt} chars) — régénère dans nodyx-core/.env !"
_smtp=$(grep '^SMTP_HOST=' "${NODYX_DIR}/nodyx-core/.env" 2>/dev/null | cut -d= -f2 || echo "")
[[ -n "$_smtp" ]] \
  && _pass "SMTP" "configuré (${_smtp})" \
  || _warn "SMTP" "non configuré — emails désactivés"
ufw status 2>/dev/null | grep -q 'Status: active' \
  && _pass "UFW pare-feu" "actif" \
  || _warn "UFW pare-feu" "inactif ! (sudo ufw enable)"

# ── Score final ───────────────────────────────────────────────────────────────
echo ""
echo -e "  ${CYAN}$(printf '═%.0s' {1..52})${RESET}"
echo -e "  ${BOLD}nodyx-doctor${RESET}  |  $(date '+%Y-%m-%d %H:%M:%S')  |  ${NODYX_DIR}"
echo -e "  ${CYAN}$(printf '═%.0s' {1..52})${RESET}"
echo ""
DOCTORBODY

chmod +x "$DOCTOR_SCRIPT"
ok "Script de diagnostic  : ${BOLD}nodyx-doctor${RESET} (sudo nodyx-doctor)"

# ═══════════════════════════════════════════════════════════════════════════════
#  HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════════════════
step "Vérification post-installation"

HC_PASS=0; HC_WARN=0; HC_FAIL=0

_hc_pass() { HC_PASS=$((HC_PASS+1)); echo -e "  ${GREEN}✔${RESET}  $*"; }
_hc_warn() { HC_WARN=$((HC_WARN+1)); echo -e "  ${YELLOW}⚠${RESET}  $*"; }
_hc_fail() { HC_FAIL=$((HC_FAIL+1)); echo -e "  ${RED}✘${RESET}  $*"; }
_hc_sect() {
  echo ""
  echo -e "  ${BOLD}${CYAN}▸ $1${RESET}"
  echo -e "  ${CYAN}──────────────────────────────────────────────────${RESET}"
}

# Poll URL until 2xx/3xx or timeout; shows live braille spinner
_wait_https() {
  local url="$1" label="$2" max_secs="${3:-120}"
  local waited=0 code si=0
  while [[ $waited -lt $max_secs ]]; do
    code=$(curl -sk --max-time 4 -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || true)
    [[ "$code" =~ ^[23] ]] && { printf "\r\033[2K"; return 0; }
    printf "\r  ${CYAN}%s${RESET}  %s  ${YELLOW}%ds${RESET}   " "${_HC_SPIN[$((si % 10))]}" "$label" "$waited"
    si=$((si+1)); sleep 2; waited=$((waited+2))
  done
  printf "\r\033[2K"
  return 1
}

# ── Services système ──────────────────────────────────────────────────────────
_hc_sect "Services système"
_HC_SVCS="postgresql redis-server caddy"
if ! $RELAY_MODE; then _HC_SVCS="$_HC_SVCS nodyx-turn"; fi
if $RELAY_MODE; then _HC_SVCS="$_HC_SVCS nodyx-relay-client"; fi
for _svc in $_HC_SVCS; do
  if systemctl is-active --quiet "$_svc" 2>/dev/null; then
    _hc_pass "$_svc"
  else
    _hc_fail "$_svc  ${YELLOW}(sudo systemctl start $_svc)${RESET}"
  fi
done

# ── Nodyx (PM2) ───────────────────────────────────────────────────────────────
_hc_sect "Nodyx (PM2)"
for _app in nodyx-core nodyx-frontend; do
  _pm2=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null \
    | grep " $_app " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_pm2" == "online" ]]; then
    _hc_pass "$_app"
  else
    _hc_fail "$_app  ${YELLOW}[${_pm2}] — runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart $_app${RESET}"
  fi
done

# ── Réseau & HTTPS ────────────────────────────────────────────────────────────
_hc_sect "Réseau & HTTPS"

if $RELAY_MODE; then
  # En mode Relay : vérification locale uniquement — l'HTTPS passe par le tunnel.
  _api_code=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://localhost/api/v1/instance/info" 2>/dev/null || true)
  if [[ "$_api_code" =~ ^[23] ]]; then
    _hc_pass "API locale http://localhost/api/v1/instance/info  →  HTTP ${_api_code}"
  else
    _hc_warn "API locale  →  HTTP ${_api_code:-timeout}  ${YELLOW}(backend en démarrage ?)${RESET}"
  fi
  _hc_pass "URL publique : https://${DOMAIN}  ${CYAN}(via tunnel relay — non vérifiable localement)${RESET}"
else
  _dns_ip=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -n "$_dns_ip" ]]; then
    _hc_pass "DNS ${DOMAIN}  →  ${_dns_ip}"
  else
    _hc_warn "DNS ${DOMAIN}  →  non résolu  ${YELLOW}(propagation en cours ?)${RESET}"
  fi

  if _wait_https "https://${DOMAIN}" "Attente certificat TLS…" 120; then
    _hc_pass "HTTPS https://${DOMAIN}"
  else
    _hc_warn "HTTPS https://${DOMAIN}  →  timeout  ${YELLOW}(cert Let's Encrypt en cours de génération)${RESET}"
  fi

  _api_code=$(curl -sk --max-time 5 -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/v1/instance/info" 2>/dev/null || true)
  if [[ "$_api_code" =~ ^[23] ]]; then
    _hc_pass "API /api/v1/instance/info  →  HTTP ${_api_code}"
  else
    _hc_warn "API /api/v1/instance/info  →  HTTP ${_api_code:-timeout}"
  fi
fi

# ── Annuaire Nodyx ────────────────────────────────────────────────────────────
if [[ -n "${NODYX_SUBDOMAIN:-}" ]]; then
  _hc_sect "Annuaire Nodyx"

  _sub_ip=$(getent hosts "$NODYX_SUBDOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -n "$_sub_ip" ]]; then
    _hc_pass "DNS ${NODYX_SUBDOMAIN}  →  ${_sub_ip}"
  else
    _hc_warn "DNS ${NODYX_SUBDOMAIN}  →  propagation en cours  ${YELLOW}(~30s, c'est normal)${RESET}"
  fi

  _dir_status=$(curl -s --max-time 5 "${NODYX_DIRECTORY_URL}/instances/${COMMUNITY_SLUG}" 2>/dev/null \
    | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || true)
  if [[ "$_dir_status" == "active" ]]; then
    _hc_pass "Annuaire  →  instance ${GREEN}active${RESET}"
  elif [[ -n "$_dir_status" ]]; then
    _hc_warn "Annuaire  →  statut : ${_dir_status}"
  else
    _hc_warn "Annuaire  →  non joignable  ${YELLOW}(normal si DNS en propagation)${RESET}"
  fi
fi

# ── Score final ───────────────────────────────────────────────────────────────
HC_TOTAL=$((HC_PASS + HC_WARN + HC_FAIL))
echo ""
echo -e "  ${CYAN}$(printf '═%.0s' {1..50})${RESET}"
if [[ $HC_FAIL -eq 0 && $HC_WARN -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}  ✔  ${HC_PASS}/${HC_TOTAL} vérifications — TOUT EST AU VERT !${RESET}"
elif [[ $HC_FAIL -eq 0 ]]; then
  echo -e "  ${YELLOW}${BOLD}  ⚠  ${HC_PASS}/${HC_TOTAL} OK — ${HC_WARN} avertissement(s) à corriger${RESET}"
else
  echo -e "  ${RED}${BOLD}  ✘  ${HC_PASS}/${HC_TOTAL} OK — ${HC_FAIL} erreur(s) / ${HC_WARN} avertissement(s)${RESET}"
fi
echo -e "  ${CYAN}$(printf '═%.0s' {1..50})${RESET}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}"
cat <<'LOGO'
  ╔══════════════════════════════════════════════════════════════╗
  ║                                                              ║
  ║    ✦   N O D Y X   ·   I N S T A N C E   O N L I N E   ✦  ║
  ║                                                              ║
  ╠══════════════════════════════════════════════════════════════╣
LOGO
echo -e "${RESET}"
echo -e "     ${BOLD}Instance   ${GREEN}https://${DOMAIN}${RESET}"
if ! $RELAY_MODE && [[ -n "$NODYX_SUBDOMAIN" ]]; then
  echo -e "     ${BOLD}Alias      ${CYAN}https://${NODYX_SUBDOMAIN}${RESET}"
fi
echo -e "     ${BOLD}Admin      ${RESET}${ADMIN_USERNAME}  ·  ${ADMIN_EMAIL}"
if ! $RELAY_MODE; then
  echo -e "     ${BOLD}Vocal      ${RESET}stun/turn:${PUBLIC_IP}:3478 (nodyx-turn)"
fi
if $RELAY_MODE; then
  echo -e "     ${BOLD}Relay      ${RESET}tunnel → relay.nodyx.org:7443"
fi
echo -e "     ${BOLD}Version    ${RESET}${NODYX_VERSION}"
echo -e "     ${BOLD}Dossier    ${RESET}${NODYX_DIR}"
echo ""
echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${RESET}"
echo ""
echo -e "     ${BOLD}${CYAN}▸ Gestion${RESET}"
echo -e "       runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list"
echo -e "       runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core"
echo -e "       runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart all"
echo -e "       ${CYAN}# ou via systemd :${RESET}"
echo -e "       sudo systemctl restart pm2-nodyx"
echo ""
echo -e "     ${BOLD}${CYAN}▸ Mise à jour${RESET}"
echo -e "       sudo nodyx-update                git pull + rebuild + restart"
echo ""
echo -e "     ${BOLD}${CYAN}▸ Base de données${RESET}"
echo -e "       sudo -u postgres psql ${DB_NAME}"
echo -e "       sudo -u postgres pg_dump ${DB_NAME} > backup_\$(date +%F).sql"
echo ""
echo -e "     ${BOLD}${CYAN}▸ Diagnostic${RESET}"
echo -e "       sudo nodyx-doctor               rapport complet (services, TLS, DB, RAM...)"
echo -e "       systemctl status caddy"
echo -e "       curl -s http://localhost:3000/api/v1/instance/info | python3 -m json.tool"
if $RELAY_MODE; then
  echo ""
  echo -e "     ${BOLD}${CYAN}▸ Tunnel Relay${RESET}"
  echo -e "       systemctl status nodyx-relay-client"
  echo -e "       journalctl -u nodyx-relay-client -f"
fi
echo ""
echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${RESET}"
echo ""
echo -e "     ${BOLD}Credentials →  ${CYAN}${CREDS_FILE}${RESET}"
echo -e "     ${CYAN}(garde ce fichier en lieu sûr — ne le partage jamais)${RESET}"
echo ""
if $RELAY_MODE; then
  echo -e "     ${GREEN}✔  Mode Relay — aucun port à ouvrir, aucun DNS à configurer.${RESET}"
else
  echo -e "     ${YELLOW}⚠  Assure-toi que ton DNS ${BOLD}${DOMAIN}${RESET}${YELLOW} pointe vers ${PUBLIC_IP}${RESET}"
fi
echo ""
echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# Marquer l'installation comme complète — désactive le rollback trap
_INSTALL_COMPLETE=true
