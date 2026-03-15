#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Nexus — One-click node installer
#  Supports : Ubuntu 22.04 / 24.04, Debian 11 / 12 / 13
#
#  Prérequis / Prerequisites:
#    Sur un système minimal, installez d'abord git et curl :
#    On a minimal system, install git and curl first:
#      apt-get install -y git curl
#
#  Usage — Option A (clone + run) :
#    git clone https://github.com/Pokled/Nexus.git && cd Nexus && sudo bash install.sh
#
#  Usage — Option B (curl, sans git / without git) :
#    curl -fsSL https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh | sudo bash
#
#  Usage — Option C (wget, si curl absent / if curl missing) :
#    wget -qO- https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh | sudo bash
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Auto-relaunch si stdin est un pipe (curl|bash) ────────────────────────────
# Les prompts interactifs (read) nécessitent un vrai terminal.
# Si stdin n'est pas un TTY (ex: curl|bash), on se télécharge dans /tmp et on relance.
if [[ ! -t 0 ]]; then
  _SELF=$(mktemp /tmp/nexus_install_XXXXXX.sh)
  curl -fsSL https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh -o "$_SELF" 2>/dev/null \
    || wget -qO "$_SELF" https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh
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
  echo -e "${BOLD}${CYAN}"
  cat <<'EOF'
  ███╗   ██╗███████╗██╗  ██╗██╗   ██╗███████╗
  ████╗  ██║██╔════╝╚██╗██╔╝██║   ██║██╔════╝
  ██╔██╗ ██║█████╗   ╚███╔╝ ██║   ██║███████╗
  ██║╚██╗██║██╔══╝   ██╔██╗ ██║   ██║╚════██║
  ██║ ╚████║███████╗██╔╝ ██╗╚██████╔╝███████║
  ╚═╝  ╚═══╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚══════╝
EOF
  echo -e "${RESET}"
  echo -e "  ${BOLD}Nexus Node Installer${RESET} — v1.8"
  echo -e "  Forum + Chat + Voice • AGPL-3.0\n"
}

# ── Helpers ───────────────────────────────────────────────────────────────────
gen_secret()  { openssl rand -hex 32; }
gen_pass()    { openssl rand -base64 18 | tr -d '/+='; }
slugify()     { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g'; }

prompt() {
  local var="$1" msg="$2" default="${3:-}" val=''
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

step() {
  echo ""
  echo -e "${BOLD}━━━  $*  ━━━${RESET}"
}

_HC_SPIN=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

# run_bg "label" cmd [args...] — exécute une commande en arrière-plan avec spinner animé
# Affiche le temps écoulé en temps réel. Dump les dernières lignes du log en cas d'erreur.
run_bg() {
  local label="$1"; shift
  local log; log=$(mktemp /tmp/nexus_bg_XXXXXX.log)
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

# RAM check — le build SvelteKit nécessite au moins 512 MB libres
_RAM_FREE_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $7}' || echo 9999)
if [[ "$_RAM_FREE_MB" -lt 400 ]]; then
  warn "RAM disponible faible : ${_RAM_FREE_MB} MB (recommandé : 512 MB+)"
  warn "Le build frontend peut échouer sur les machines avec peu de RAM."
  warn "Astuce : sudo fallocate -l 1G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile"
  read -rp "$(echo -e "  ${BOLD}Continuer quand même ? [o/N] ${RESET}")" _ram_confirm
  [[ "${_ram_confirm,,}" != "o" ]] && die "Installation annulée — ajoute du swap et relance."
fi

# Disk check — npm + build = ~700 MB minimum
_DISK_FREE_MB=$(df -m /opt 2>/dev/null | awk 'NR==2{print $4}' || echo 9999)
if [[ "$_DISK_FREE_MB" -lt 1024 ]]; then
  warn "Espace disque faible sur /opt : ${_DISK_FREE_MB} MB (recommandé : 1 GB+)"
  read -rp "$(echo -e "  ${BOLD}Continuer quand même ? [o/N] ${RESET}")" _disk_confirm
  [[ "${_disk_confirm,,}" != "o" ]] && die "Installation annulée — libère de l'espace et relance."
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

# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION — questions interactives
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de ton instance"
echo ""

# 1 — Communauté
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

# 2 — Mode réseau
echo ""
echo -e "  ${BOLD}Mode de connexion réseau${RESET}"
echo -e "  ┌─ ${BOLD}[1] Domaine personnel${RESET}  — tu as un domaine (ex: moncommunaute.fr) et les ports 80/443 sont ouverts"
echo -e "  ├─ ${BOLD}[2] Nexus Relay${RESET}         — ${GREEN}recommandé${RESET} — aucun port à ouvrir, aucun domaine requis (RPi, box, ...)"
echo -e "  └─ ${BOLD}[3] sslip.io auto${RESET}       — domaine gratuit automatique, ports 80/443 ouverts requis"
echo ""
read -rp "$(echo -e "  ${CYAN}?${RESET} Choix [1/2/3] (défaut: 2 — Nexus Relay): ")" NET_MODE
NET_MODE="${NET_MODE:-2}"

RELAY_MODE=false
DOMAIN_IS_AUTO=false

case "$NET_MODE" in
  1)
    prompt DOMAIN "Domaine de l'instance (ex: moncommunaute.fr)"
    ;;
  2)
    RELAY_MODE=true
    DOMAIN="${COMMUNITY_SLUG}.nexusnode.app"
    ok "Mode Nexus Relay — URL : ${BOLD}https://${DOMAIN}${RESET}"
    info "Aucun port à ouvrir. Le tunnel sera établi vers relay.nexusnode.app."
    ;;
  3|*)
    DOMAIN="${PUBLIC_IP//./-}.sslip.io"
    DOMAIN_IS_AUTO=true
    ok "Domaine automatique : ${BOLD}${DOMAIN}${RESET}"
    info "sslip.io résout automatiquement vers ${PUBLIC_IP} — certificat HTTPS géré par Caddy."
    ;;
esac

# 3 — Compte administrateur
echo ""
echo -e "  ${BOLD}Compte administrateur${RESET}"
prompt        ADMIN_USERNAME "Nom d'utilisateur admin"
prompt        ADMIN_EMAIL    "Email admin"
prompt_secret ADMIN_PASSWORD "Mot de passe admin (min 8 caractères)" 8

echo ""
echo -e "  ${BOLD}Récapitulatif :${RESET}"
echo -e "  Domaine    : ${CYAN}${DOMAIN}${RESET}$(${DOMAIN_IS_AUTO} && echo ' (sslip.io automatique)' || true)"
echo -e "  Communauté : ${CYAN}${COMMUNITY_NAME}${RESET} (slug: ${COMMUNITY_SLUG})"
echo -e "  Langue     : ${CYAN}${COMMUNITY_LANG}${RESET}"
echo -e "  Admin      : ${CYAN}${ADMIN_USERNAME}${RESET} <${ADMIN_EMAIL}>"
echo ""
read -rp "$(echo -e "  ${BOLD}Continuer ? [O/n] ${RESET}")" confirm
[[ "${confirm,,}" == "n" ]] && die "Installation annulée."

# ═══════════════════════════════════════════════════════════════════════════════
#  GENERATED SECRETS
# ═══════════════════════════════════════════════════════════════════════════════
DB_NAME="nexus"
DB_USER="nexus_user"
DB_PASSWORD=$(gen_pass)
JWT_SECRET=$(gen_secret)
TURN_SECRET=$(gen_secret)
NEXUS_DIR="/opt/nexus"
REPO_URL="https://github.com/Pokled/Nexus.git"

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
#  NEXUS-TURN (STUN/TURN Rust natif — remplace coturn) — ignoré en mode Relay
# ═══════════════════════════════════════════════════════════════════════════════
if ! $RELAY_MODE; then
  step "Installation de nexus-turn (relay vocal WebRTC)"

  _ARCH=$(uname -m)
  case "$_ARCH" in
    x86_64)  _TURN_ARCH="amd64" ;;
    aarch64) _TURN_ARCH="arm64" ;;
    *) die "Architecture non supportée pour nexus-turn : $_ARCH" ;;
  esac

  _TURN_VERSION="v0.1.2-p2p"
  _TURN_URL="https://github.com/Pokled/Nexus/releases/download/${_TURN_VERSION}/nexus-turn-linux-${_TURN_ARCH}"
  info "Téléchargement nexus-turn ${_TURN_VERSION} (${_TURN_ARCH})..."
  curl -sL "$_TURN_URL" -o /usr/local/bin/nexus-turn
  chmod +x /usr/local/bin/nexus-turn

  # Fichier de configuration (secret partagé avec nexus-core)
  cat > /etc/nexus-turn.env <<TURNENV
TURN_PUBLIC_IP=${PUBLIC_IP}
TURN_REALM=${DOMAIN}
TURN_SECRET=${TURN_SECRET}
TURN_PORT=3478
TURN_TTL=86400
TURNENV
  chmod 600 /etc/nexus-turn.env

  # Service systemd
  cat > /etc/systemd/system/nexus-turn.service <<SVC
[Unit]
Description=Nexus TURN Server (WebRTC relay)
After=network.target

[Service]
EnvironmentFile=/etc/nexus-turn.env
ExecStart=/usr/local/bin/nexus-turn server \
  --udp-port \${TURN_PORT} \
  --public-ip \${TURN_PUBLIC_IP} \
  --realm \${TURN_REALM} \
  --secret \${TURN_SECRET} \
  --ttl \${TURN_TTL}
Restart=on-failure
RestartSec=5s
User=root

[Install]
WantedBy=multi-user.target
SVC

  systemctl daemon-reload
  systemctl enable nexus-turn --quiet
  systemctl restart nexus-turn
  ok "nexus-turn démarré (IP: ${PUBLIC_IP}, port UDP 3478)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PARE-FEU (UFW)
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du pare-feu"

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
#  NEXUS RELAY CLIENT — binaire (mode Relay uniquement)
# ═══════════════════════════════════════════════════════════════════════════════
if $RELAY_MODE; then
  step "Téléchargement du binaire Nexus Relay Client"

  _ARCH=$(uname -m)
  case "$_ARCH" in
    x86_64)  _RELAY_ARCH="amd64" ;;
    aarch64) _RELAY_ARCH="arm64" ;;
    *) die "Architecture non supportée pour Nexus Relay : $_ARCH (supporté: x86_64, aarch64)" ;;
  esac

  _RELAY_VERSION="v0.1.2-p2p"
  _RELAY_URL="https://github.com/Pokled/Nexus/releases/download/${_RELAY_VERSION}/nexus-relay-linux-${_RELAY_ARCH}"

  info "Téléchargement nexus-relay ${_RELAY_VERSION} (${_RELAY_ARCH})..."
  curl -sL "$_RELAY_URL" -o /usr/local/bin/nexus-relay
  chmod +x /usr/local/bin/nexus-relay
  ok "nexus-relay $(/usr/local/bin/nexus-relay --version 2>&1 || echo '?') installé"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NEXUS — CLONE / UPDATE
# ═══════════════════════════════════════════════════════════════════════════════
step "Téléchargement de Nexus"

if [[ -d "$NEXUS_DIR/.git" ]]; then
  info "Mise à jour du dépôt existant..."
  git -C "$NEXUS_DIR" pull --ff-only
else
  info "Clonage du dépôt dans $NEXUS_DIR..."
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$REPO_URL" "$NEXUS_DIR"
fi
ok "Code Nexus présent dans $NEXUS_DIR"

# ═══════════════════════════════════════════════════════════════════════════════
#  NEXUS-CORE — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du backend (nexus-core)"

cat > "${NEXUS_DIR}/nexus-core/.env" <<COREENV
# Généré par install.sh — ne pas modifier manuellement

# Identité de la communauté
NEXUS_COMMUNITY_NAME=${COMMUNITY_NAME}
NEXUS_COMMUNITY_SLUG=${COMMUNITY_SLUG}
NEXUS_COMMUNITY_DESCRIPTION=${COMMUNITY_DESC}
NEXUS_COMMUNITY_LANGUAGE=${COMMUNITY_LANG}
NEXUS_COMMUNITY_COUNTRY=${COMMUNITY_COUNTRY}
NEXUS_VERSION=1.8.0

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

# TURN relay (nexus-turn) — credentials dynamiques par utilisateur
TURN_PUBLIC_IP=${PUBLIC_IP:-}
TURN_SECRET=${TURN_SECRET:-}
TURN_PORT=3478
COREENV
# En mode Relay, ajouter des STUN publics en fallback (pas de nexus-turn)
if $RELAY_MODE; then
  printf "\n# Fallback STUN (relay mode — nexus-turn non installé)\nSTUN_FALLBACK_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302\n" \
    >> "${NEXUS_DIR}/nexus-core/.env"
fi

cd "${NEXUS_DIR}/nexus-core"
run_bg "npm install (backend)..." npm install --no-fund --no-audit \
  || die "npm install backend échoué. Vérifie ta connexion Internet."
run_bg "Compilation TypeScript (backend)..." npm run build \
  || die "Build backend échoué. Vérifie les logs ci-dessus."
[[ -f "${NEXUS_DIR}/nexus-core/dist/index.js" ]] \
  || die "dist/index.js absent — le build TypeScript n'a pas produit de sortie."
ok "Backend compilé"

# ═══════════════════════════════════════════════════════════════════════════════
#  NEXUS-FRONTEND — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du frontend (nexus-frontend)"

cat > "${NEXUS_DIR}/nexus-frontend/.env" <<FEENV
# Généré par install.sh — ne pas modifier manuellement

PUBLIC_API_URL=https://${DOMAIN}
# Nexus Signet (authentificateur optionnel) — laisser vide si non utilisé
PUBLIC_SIGNET_URL=
# Les credentials TURN sont désormais générés dynamiquement par nexus-core (nexus-turn).
# Ces variables sont conservées pour compatibilité avec d'éventuelles instances existantes.
PUBLIC_TURN_URL=
PUBLIC_TURN_USERNAME=
PUBLIC_TURN_CREDENTIAL=
FEENV

cd "${NEXUS_DIR}/nexus-frontend"
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
[[ -f "${NEXUS_DIR}/nexus-frontend/build/index.js" ]] \
  || die "build/index.js absent — le build SvelteKit n'a pas produit de sortie."
ok "Frontend compilé"

# ═══════════════════════════════════════════════════════════════════════════════
#  CADDY
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de Caddy (proxy HTTPS)"

if $RELAY_MODE; then
  # En mode Relay : Caddy écoute sur HTTP port 80 (local seulement).
  # TLS est géré en amont par le serveur nexus-relay sur nexusnode.app.
  cat > /etc/caddy/Caddyfile <<CADDY
:80 {
    reverse_proxy /api/*       localhost:3000
    reverse_proxy /uploads/*   localhost:3000
    reverse_proxy /socket.io/* localhost:3000
    reverse_proxy *            localhost:4173

    encode gzip
}
CADDY
else
  cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    reverse_proxy /api/*       localhost:3000
    reverse_proxy /uploads/*   localhost:3000
    reverse_proxy /socket.io/* localhost:3000
    reverse_proxy *            localhost:4173

    encode gzip
}
CADDY
fi

systemctl enable caddy --quiet
systemctl restart caddy
if $RELAY_MODE; then
  ok "Caddy configuré (HTTP local port 80 — TLS géré par relay.nexusnode.app)"
else
  ok "Caddy configuré (Let's Encrypt automatique pour $DOMAIN)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PM2 ECOSYSTEM
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de PM2"

cat > "${NEXUS_DIR}/ecosystem.config.js" <<PM2
module.exports = {
  apps: [
    {
      name: 'nexus-core',
      script: 'dist/index.js',
      cwd: '${NEXUS_DIR}/nexus-core',
      watch: false,
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'nexus-frontend',
      script: 'build/index.js',
      cwd: '${NEXUS_DIR}/nexus-frontend',
      watch: false,
      env: { NODE_ENV: 'production', PORT: '4173', HOST: '127.0.0.1', ORIGIN: 'https://${DOMAIN}', PRIVATE_API_SSR_URL: 'http://127.0.0.1:3000/api/v1' },
    },
  ],
}
PM2

cd "$NEXUS_DIR"
pm2 delete nexus-core    2>/dev/null || true
pm2 delete nexus-frontend 2>/dev/null || true
pm2 startOrRestart ecosystem.config.js --update-env
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 | tail -1 | bash 2>/dev/null || true
ok "PM2 configuré et lancé"

info "Vérification du démarrage des processus (5s)..."
sleep 5
for _app in nexus-core nexus-frontend; do
  _st=$(pm2 list 2>/dev/null | grep " ${_app} " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_st" == "online" ]]; then
    ok "  $_app — online"
  else
    warn "$_app — statut : ${_st}"
    warn "Logs de démarrage :"
    pm2 logs "$_app" --lines 20 --nostream 2>/dev/null || true
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
  warn "Logs PM2 (nexus-core) :"
  pm2 logs nexus-core --lines 35 --nostream 2>/dev/null || true
  warn "Pour relancer : cd ${NEXUS_DIR} && pm2 restart nexus-core"
  warn "Pour déboguer : pm2 logs nexus-core"
  warn "Tentative de création du compte admin quand même..."
fi

# Register admin account — retry jusqu'à 3 fois (backend peut encore démarrer)
_REGISTER_OK=false
for _reg_try in 1 2 3; do
  _REG_JSON=$(python3 -c "import json,sys; print(json.dumps({'username':sys.argv[1],'email':sys.argv[2],'password':sys.argv[3]}))" \
    "$ADMIN_USERNAME" "$ADMIN_EMAIL" "$ADMIN_PASSWORD" 2>/dev/null \
    || printf '{"username":"%s","email":"%s","password":"%s"}' "$ADMIN_USERNAME" "$ADMIN_EMAIL" "$ADMIN_PASSWORD")
  HTTP_CODE=$(curl -s -o /tmp/nexus_register.json -w "%{http_code}" \
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
    warn "Tentative ${_reg_try}/3 — HTTP ${HTTP_CODE} : $(cat /tmp/nexus_register.json 2>/dev/null | head -c 200)"
    [[ $_reg_try -lt 3 ]] && { info "Retry dans 8s..."; sleep 8; }
  fi
done

if ! $_REGISTER_OK; then
  warn "Inscription impossible après 3 tentatives."
  warn "Tu pourras créer ton compte sur https://${DOMAIN}/auth/register"
fi

# Bootstrap community + make admin owner — done directly in PostgreSQL
# (The API requires a community to exist before any admin action)
USER_ID=$(sudo -u postgres psql -d "$DB_NAME" -tc \
  "SELECT id FROM users WHERE lower(email)=lower('${ADMIN_EMAIL}');" 2>/dev/null | tr -d ' \n')

if [[ -n "$USER_ID" ]]; then
  sudo -u postgres psql -d "$DB_NAME" <<SQL >/dev/null
    -- Create the instance community
    INSERT INTO communities (name, slug, description, owner_id, is_public)
    VALUES (
      '${COMMUNITY_NAME}',
      '${COMMUNITY_SLUG}',
      '${COMMUNITY_DESC}',
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
#  OPTIONAL — FREE nexusnode.app SUBDOMAIN
# ═══════════════════════════════════════════════════════════════════════════════
step "Sous-domaine gratuit nexusnode.app"

NEXUS_SUBDOMAIN=""
NEXUS_DIRECTORY_TOKEN=""
NEXUS_DIRECTORY_URL="https://nexusnode.app/api/directory"

echo ""
# En mode Relay ou auto-domaine, le sous-domaine nexusnode.app est obligatoire/automatique.
if $RELAY_MODE; then
  echo -e "  Mode Relay : enregistrement de ${BOLD}${COMMUNITY_SLUG}.nexusnode.app${RESET} obligatoire — automatique."
  want_subdomain="o"
elif $DOMAIN_IS_AUTO; then
  echo -e "  Tu n'as pas de domaine propre : ${BOLD}${COMMUNITY_SLUG}.nexusnode.app${RESET} va être activé"
  echo -e "  automatiquement comme alias mémorable pour ton instance."
  want_subdomain="o"
else
  echo -e "  Alias optionnel : ${BOLD}${COMMUNITY_SLUG}.nexusnode.app${RESET}"
  echo -e "  Redirige vers ton instance — utile comme raccourci mémorable."
  echo ""
  read -rp "$(echo -e "  Activer ${BOLD}${COMMUNITY_SLUG}.nexusnode.app${RESET} ? [O/n] ")" want_subdomain
fi

if [[ "${want_subdomain,,}" != "n" ]]; then
  info "Enregistrement auprès du directory nexusnode.app..."

  REGISTER_RESPONSE=$(curl -s -X POST "${NEXUS_DIRECTORY_URL}/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":        \"${COMMUNITY_NAME}\",
      \"slug\":        \"${COMMUNITY_SLUG}\",
      \"url\":         \"https://${DOMAIN}\",
      \"language\":    \"${COMMUNITY_LANG}\",
      \"version\":     \"${NEXUS_VERSION:-1.8.0}\"
    }" 2>/dev/null || true)

  REGISTER_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
  REGISTER_SLUG=$(echo "$REGISTER_RESPONSE" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4 || true)

  if [[ -n "$REGISTER_TOKEN" ]]; then
    NEXUS_DIRECTORY_TOKEN="$REGISTER_TOKEN"
    NEXUS_SUBDOMAIN="${REGISTER_SLUG:-${COMMUNITY_SLUG}.nexusnode.app}"
    ok "Enregistré ! Sous-domaine : ${BOLD}https://${NEXUS_SUBDOMAIN}${RESET}"
    if ! $RELAY_MODE; then
      info "Le DNS sera actif dans ~30 secondes."
      info "Sauvegarde le token directory — nécessaire pour les heartbeats et la désinscription."
    fi
    # Injecter le token dans .env + redémarrer nexus-core pour activer les heartbeats
    {
      printf "\n# Annuaire nexusnode.app\n"
      printf "DIRECTORY_TOKEN=%s\n" "${NEXUS_DIRECTORY_TOKEN}"
      printf "DIRECTORY_API_URL=https://nexusnode.app\n"
      printf "SELF_URL=http://127.0.0.1:3000\n"
      printf "VPS_IP=%s\n" "${PUBLIC_IP:-}"
      printf "NEXUS_GLOBAL_INDEXING=true\n"
    } >> "${NEXUS_DIR}/nexus-core/.env"
    cd "${NEXUS_DIR}" && pm2 restart nexus-core 2>/dev/null || true
  else
    # Check for slug conflict (409) — common on reinstall
    if echo "$REGISTER_RESPONSE" | grep -q 'Slug already taken'; then
      warn "Le slug '${COMMUNITY_SLUG}' est déjà enregistré dans le directory."
      warn "Si c'est une réinstallation, l'ancienne entrée doit être supprimée d'abord."
      warn "Contacte le support nexusnode.app ou utilise un slug différent."
    else
      warn "Enregistrement échoué."
      warn "Réponse : $(echo "$REGISTER_RESPONSE" | head -c 200)"
      warn "Tu peux réessayer manuellement plus tard sur https://nexusnode.app"
    fi
    # En mode Relay, l'enregistrement est indispensable — le tunnel ne peut pas démarrer sans token.
    if $RELAY_MODE; then
      die "Enregistrement au directory échoué. Le mode Relay nécessite un slug valide. Vérifie ta connexion Internet et réessaie."
    fi
  fi
else
  info "Sous-domaine gratuit ignoré. Tu utiliseras https://${DOMAIN}"
fi

# ── Relay client systemd service (mode Relay uniquement) ──────────────────────
if $RELAY_MODE && [[ -n "$NEXUS_DIRECTORY_TOKEN" ]]; then
  step "Configuration du service Nexus Relay Client"

  cat > /etc/systemd/system/nexus-relay-client.service <<SVC
[Unit]
Description=Nexus Relay Client — tunnel vers relay.nexusnode.app
After=network.target

[Service]
ExecStart=/usr/local/bin/nexus-relay client \
  --server relay.nexusnode.app:7443 \
  --slug ${COMMUNITY_SLUG} \
  --token ${NEXUS_DIRECTORY_TOKEN} \
  --local-port 80
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=60
StartLimitBurst=5
User=root

[Install]
WantedBy=multi-user.target
SVC

  systemctl daemon-reload
  systemctl enable nexus-relay-client --quiet
  systemctl start nexus-relay-client
  ok "Nexus Relay Client démarré — tunnel vers relay.nexusnode.app:7443 actif"
  info "Ton instance sera accessible sur https://${DOMAIN} dans quelques secondes."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  SAVE CREDENTIALS
# ═══════════════════════════════════════════════════════════════════════════════
CREDS_FILE="/root/nexus-credentials.txt"

# Prépare les blocs conditionnels pour le fichier credentials
_CREDS_TURN=""
if ! $RELAY_MODE; then
  _CREDS_TURN="TURN relay       : turn:${PUBLIC_IP}:3478 (nexus-turn)
TURN secret      : ${TURN_SECRET}"
fi
_CREDS_RELAY=""
if $RELAY_MODE; then
  _CREDS_RELAY="Mode réseau      : Nexus Relay (tunnel TCP sortant)
Relay service    : sudo systemctl status nexus-relay-client"
fi

cat > "$CREDS_FILE" <<CREDS
═══════════════════════════════════════════════
  NEXUS — Credentials de l'instance
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
Nexus dir        : ${NEXUS_DIR}
$([ -n "$NEXUS_SUBDOMAIN" ] && echo "Sous-domaine     : https://${NEXUS_SUBDOMAIN}")
$([ -n "$NEXUS_DIRECTORY_TOKEN" ] && echo "Directory token  : ${NEXUS_DIRECTORY_TOKEN}")

GARDE CE FICHIER EN LIEU SÛR — ne le partage jamais.
CREDS
chmod 600 "$CREDS_FILE"

# ── Génération du script de mise à jour ───────────────────────────────────────
UPDATE_SCRIPT="/usr/local/bin/nexus-update"
cat > "$UPDATE_SCRIPT" <<'UPDATESCRIPT'
#!/usr/bin/env bash
# nexus-update — Met à jour Nexus vers la dernière version
set -euo pipefail
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }
UPDATESCRIPT

# Injecter NEXUS_DIR (résolu au moment de l'install)
cat >> "$UPDATE_SCRIPT" <<UPDATESCRIPT2
NEXUS_DIR="${NEXUS_DIR}"
UPDATESCRIPT2

cat >> "$UPDATE_SCRIPT" <<'UPDATESCRIPT3'

[[ $EUID -ne 0 ]] && die "Lance en root : sudo nexus-update"
echo -e "\n${BOLD}━━━  Mise à jour Nexus  ━━━${RESET}\n"

info "Récupération des dernières modifications..."
git -C "$NEXUS_DIR" pull --ff-only || die "git pull échoué. Vérifie ta connexion ou résous les conflits."

info "Rebuild backend..."
cd "${NEXUS_DIR}/nexus-core"
npm install --no-fund --no-audit --silent
npm run build || die "Build backend échoué."
ok "Backend compilé"

info "Rebuild frontend..."
cd "${NEXUS_DIR}/nexus-frontend"
npm install --no-fund --no-audit --silent
npm run build || die "Build frontend échoué."
ok "Frontend compilé"

info "Redémarrage des services..."
cd "$NEXUS_DIR"
pm2 restart ecosystem.config.js --update-env
pm2 save

echo ""
ok "Nexus mis à jour et redémarré."
pm2 list
UPDATESCRIPT3

chmod +x "$UPDATE_SCRIPT"
ok "Script de mise à jour : ${BOLD}nexus-update${RESET} (sudo nexus-update)"

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
if ! $RELAY_MODE; then _HC_SVCS="$_HC_SVCS nexus-turn"; fi
if $RELAY_MODE; then _HC_SVCS="$_HC_SVCS nexus-relay-client"; fi
for _svc in $_HC_SVCS; do
  if systemctl is-active --quiet "$_svc" 2>/dev/null; then
    _hc_pass "$_svc"
  else
    _hc_fail "$_svc  ${YELLOW}(sudo systemctl start $_svc)${RESET}"
  fi
done

# ── Nexus (PM2) ───────────────────────────────────────────────────────────────
_hc_sect "Nexus (PM2)"
for _app in nexus-core nexus-frontend; do
  _pm2=$(pm2 list 2>/dev/null | grep " $_app " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_pm2" == "online" ]]; then
    _hc_pass "$_app"
  else
    _hc_fail "$_app  ${YELLOW}[${_pm2}] — pm2 restart $_app${RESET}"
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

# ── Annuaire Nexus ────────────────────────────────────────────────────────────
if [[ -n "${NEXUS_SUBDOMAIN:-}" ]]; then
  _hc_sect "Annuaire Nexus"

  _sub_ip=$(getent hosts "$NEXUS_SUBDOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -n "$_sub_ip" ]]; then
    _hc_pass "DNS ${NEXUS_SUBDOMAIN}  →  ${_sub_ip}"
  else
    _hc_warn "DNS ${NEXUS_SUBDOMAIN}  →  propagation en cours  ${YELLOW}(~30s, c'est normal)${RESET}"
  fi

  _dir_status=$(curl -s --max-time 5 "${NEXUS_DIRECTORY_URL}/instances/${COMMUNITY_SLUG}" 2>/dev/null \
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
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║           ✔  Nexus installé avec succès !        ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Instance  :${RESET} https://${DOMAIN}"
if ! $RELAY_MODE && [[ -n "$NEXUS_SUBDOMAIN" ]]; then
  echo -e "  ${BOLD}Alias     :${RESET} https://${NEXUS_SUBDOMAIN} ${CYAN}(nexusnode.app)${RESET}"
fi
echo -e "  ${BOLD}Admin     :${RESET} ${ADMIN_USERNAME} / ${ADMIN_EMAIL}"
if ! $RELAY_MODE; then
  echo -e "  ${BOLD}Vocal     :${RESET} nexus-turn STUN/TURN sur ${PUBLIC_IP}:3478 (UDP)"
fi
if $RELAY_MODE; then
  echo -e "  ${BOLD}Relay     :${RESET} tunnel TCP → relay.nexusnode.app:7443"
fi
echo ""
echo -e "  ${CYAN}Credentials sauvegardés dans :${RESET} ${BOLD}${CREDS_FILE}${RESET}"
echo ""
echo -e "  ${BOLD}${CYAN}▸ Gestion des services${RESET}"
echo -e "  pm2 list                           → état de nexus-core + nexus-frontend"
echo -e "  pm2 logs nexus-core                → logs backend en temps réel"
echo -e "  pm2 logs nexus-frontend            → logs frontend en temps réel"
echo -e "  pm2 restart all                    → redémarrer tout"
echo -e "  pm2 stop all / pm2 start all       → arrêt / démarrage"
if $RELAY_MODE; then
  echo ""
  echo -e "  ${BOLD}${CYAN}▸ Tunnel Relay${RESET}"
  echo -e "  systemctl status nexus-relay-client  → état du tunnel"
  echo -e "  journalctl -u nexus-relay-client -f  → logs du tunnel"
  echo -e "  systemctl restart nexus-relay-client → redémarrer le tunnel"
fi
echo ""
echo -e "  ${BOLD}${CYAN}▸ Mise à jour${RESET}"
echo -e "  sudo nexus-update                  → git pull + rebuild + restart en une commande"
echo ""
echo -e "  ${BOLD}${CYAN}▸ Base de données${RESET}"
echo -e "  sudo -u postgres psql ${DB_NAME}   → console PostgreSQL"
echo -e "  sudo -u postgres pg_dump ${DB_NAME} > backup_nexus_\$(date +%F).sql"
echo -e "                                     → sauvegarde de la base"
echo ""
echo -e "  ${BOLD}${CYAN}▸ Diagnostic${RESET}"
echo -e "  curl -s http://localhost:3000/api/v1/instance/info | python3 -m json.tool"
echo -e "                                     → état du backend"
echo -e "  systemctl status caddy             → état du proxy"
echo -e "  caddy validate --config /etc/caddy/Caddyfile"
echo -e "                                     → valider la config Caddy"
echo -e "  sudo cat ${CREDS_FILE}             → revoir les credentials"
echo ""
if $RELAY_MODE; then
  echo -e "  ${GREEN}✔  Mode Relay actif — aucun port à ouvrir, aucun DNS à configurer.${RESET}"
  echo -e "  ${CYAN}   Le tunnel est géré automatiquement par nexus-relay-client.${RESET}"
else
  echo -e "  ${YELLOW}⚠  Assure-toi que ton DNS pointe vers ${PUBLIC_IP}${RESET}"
  echo -e "  ${YELLOW}   Le certificat SSL sera généré automatiquement par Caddy.${RESET}"
fi
echo ""
