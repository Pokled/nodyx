#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Nexus — Cloudflare Tunnel installer
#  Pour les serveurs SANS port ouvert : Raspberry Pi, NAS, box internet…
#  Supports : Ubuntu 22.04 / 24.04, Debian 11 / 12
#  Usage    : bash install_tunnel.sh
#
#  Différences avec install.sh :
#    • Cloudflare Tunnel gère le HTTPS — Caddy écoute en HTTP local (port 80)
#    • Ports 80 et 443 non exposés — CF Tunnel se connecte en SORTIE
#    • cloudflared installé et démarré comme service systemd
#    • Sous-domaine nexusnode.app ignoré (incompatible avec CF Tunnel)
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Couleurs ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "\n${RED}${BOLD}✘  ERREUR FATALE${RESET}\n${RED}   $*${RESET}\n" >&2; exit 1; }
step() { echo ""; echo -e "${BOLD}━━━  $*  ━━━${RESET}"; }

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
  echo -e "  ${BOLD}Nexus Node Installer${RESET} — v1.0  ${CYAN}✦ Mode Cloudflare Tunnel${RESET}"
  echo -e "  Hébergement à domicile • zéro port 80/443 requis • AGPL-3.0"
  echo ""
}

# ── Helpers ───────────────────────────────────────────────────────────────────
gen_secret()  { openssl rand -hex 32; }
gen_pass()    { openssl rand -base64 18 | tr -d '/+='; }
slugify()     { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g'; }

prompt() {
  local var="$1" msg="$2" default="${3:-}" val=''
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg} [${default}]: ")" val
    val="${val:-$default}"
  else
    while [[ -z "$val" ]]; do
      read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val
    done
  fi
  printf -v "$var" '%s' "$val"
}

prompt_secret() {
  local var="$1" msg="$2" val=''
  while [[ -z "$val" ]]; do
    read -rsp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val; echo
  done
  printf -v "$var" '%s' "$val"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  PREFLIGHT
# ═══════════════════════════════════════════════════════════════════════════════
banner

[[ $EUID -ne 0 ]] && die "Lance ce script en root : sudo bash install_tunnel.sh"

if ! grep -qiE 'ubuntu|debian' /etc/os-release 2>/dev/null; then
  die "OS non supporté. Utilise Ubuntu 22.04/24.04 ou Debian 11/12."
fi

step "Détection de l'IP"
PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org || curl -s --max-time 5 https://ifconfig.me || true)
if [[ -z "$PUBLIC_IP" ]]; then
  warn "IP publique non détectée automatiquement."
  prompt PUBLIC_IP "IP locale ou publique de ce serveur (ex: 192.168.1.10)"
else
  ok "IP détectée : ${BOLD}${PUBLIC_IP}${RESET}"
  info "Cette IP sera utilisée pour le relay vocal (TURN)."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PRÉREQUIS CLOUDFLARE TUNNEL — checklist interactive
# ═══════════════════════════════════════════════════════════════════════════════
step "Prérequis Cloudflare Tunnel"
echo ""
echo -e "  ${CYAN}Comment ça fonctionne :${RESET}"
echo -e "  Cloudflare Tunnel crée une connexion ${BOLD}sortante${RESET} depuis ton serveur"
echo -e "  vers Cloudflare. Les visiteurs passent par Cloudflare, qui relaie"
echo -e "  le trafic vers ton serveur. ${GREEN}Aucun port 80 ou 443 à ouvrir.${RESET}"
echo ""
echo -e "  ${BOLD}╔══════════════════════════════════════════════════════════════╗${RESET}"
echo -e "  ${BOLD}║  Checklist avant de continuer                               ║${RESET}"
echo -e "  ${BOLD}╠══════════════════════════════════════════════════════════════╣${RESET}"
echo -e "  ${BOLD}║${RESET}                                                              ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}  ${GREEN}◻  1.${RESET} Compte Cloudflare gratuit créé                      ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}        ${CYAN}→ https://dash.cloudflare.com${RESET}                        ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}                                                              ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}  ${GREEN}◻  2.${RESET} Ton domaine ajouté à ce compte Cloudflare           ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}        ${CYAN}→ \"Add a site\" dans le dashboard Cloudflare${RESET}          ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}        ${CYAN}→ Choix du plan Free (0€/mois)${RESET}                       ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}                                                              ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}  ${GREEN}◻  3.${RESET} Nameservers Cloudflare configurés chez ton registrar ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}        ${CYAN}→ Remplace les DNS par ceux donnés par Cloudflare${RESET}    ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}        ${CYAN}→ Exemple : aria.ns.cloudflare.com${RESET}                   ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}                                                              ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}  ${GREEN}◻  4.${RESET} Un navigateur web accessible sur ce réseau           ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}        ${CYAN}→ Pour l'étape de login cloudflared${RESET}                  ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}                                                              ${BOLD}║${RESET}"
echo -e "  ${BOLD}╠══════════════════════════════════════════════════════════════╣${RESET}"
echo -e "  ${BOLD}║${RESET}  ${YELLOW}⚠  VOIX / WEBCAM${RESET}                                         ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}     CF Tunnel est ${BOLD}TCP uniquement${RESET}. Pour les canaux vocaux,    ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}     ouvre ${BOLD}UDP 3478${RESET} dans ta box/routeur.                      ${BOLD}║${RESET}"
echo -e "  ${BOLD}║${RESET}     Chat, forum, médias → fonctionnent sans ça.             ${BOLD}║${RESET}"
echo -e "  ${BOLD}╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""
read -rp "$(echo -e "  ${BOLD}Tu as tout ça ? On peut continuer ? [O/n] ${RESET}")" _prereq
[[ "${_prereq,,}" == "n" ]] && die "Configure Cloudflare d'abord, puis relance : bash install_tunnel.sh"

# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION — questions interactives
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de ton instance"
echo ""

# 1 — Communauté
prompt   COMMUNITY_NAME  "Nom de la communauté (ex: Club Tricot de Mamie)"
COMMUNITY_SLUG_DEFAULT=$(slugify "$COMMUNITY_NAME")
prompt   COMMUNITY_SLUG  "Identifiant unique (slug)" "$COMMUNITY_SLUG_DEFAULT"
prompt   COMMUNITY_LANG  "Langue principale (fr/en/de/es/it/pt)" "fr"

# 2 — Domaine (obligatoire — doit être géré par Cloudflare)
echo ""
echo -e "  ${BOLD}Domaine de ton instance${RESET}"
echo -e "  ${CYAN}Ce domaine doit être géré par Cloudflare (nameservers CF activés).${RESET}"
echo -e "  Exemples : ${BOLD}moncommunaute.fr${RESET}   ${BOLD}club.mamie-tricot.net${RESET}"
echo ""

_domain_ok=false
while ! $_domain_ok; do
  read -rp "$(echo -e "  ${CYAN}?${RESET} Nom de domaine : ")" DOMAIN
  # Strip accidental http(s):// prefix and trailing slashes/spaces
  DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"
  DOMAIN="${DOMAIN%/}";        DOMAIN="${DOMAIN// /}"
  if [[ -z "$DOMAIN" ]]; then
    echo ""
    echo -e "  ${YELLOW}${BOLD}┌─ Pourquoi un domaine est-il obligatoire ici ? ──────────────┐${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}                                                              ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}  CF Tunnel crée un ${BOLD}CNAME dans ta zone DNS Cloudflare${RESET}.      ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}  Il a besoin d'accès à un domaine ${BOLD}que tu possèdes${RESET}.         ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}  ${CYAN}nexusnode.app${RESET} est notre zone — tu n'y as pas accès.       ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}                                                              ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}  ${BOLD}Tes options :${RESET}                                                ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}  ${GREEN}1.${RESET} Achète un domaine (~1€/an) chez ${CYAN}porkbun.com${RESET}            ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}     ou ${CYAN}namecheap.com${RESET}, ajoute-le à Cloudflare, reviens ici.  ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}                                                              ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}  ${GREEN}2.${RESET} Si tu peux ouvrir les ports 80/443 sur ta box,        ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}     utilise ${BOLD}install.sh${RESET} — il donne un sous-domaine gratuit   ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}     ${CYAN}${PUBLIC_IP//./-}.sslip.io${RESET} automatiquement.                 ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}│${RESET}                                                              ${YELLOW}${BOLD}│${RESET}"
    echo -e "  ${YELLOW}${BOLD}└──────────────────────────────────────────────────────────────┘${RESET}"
    echo ""
    read -rp "$(echo -e "  Quitter et utiliser ${BOLD}install.sh${RESET} à la place ? [O/n] ")" _switch
    [[ "${_switch,,}" != "n" ]] && die "Lance ${BOLD}bash install.sh${RESET} si tu peux ouvrir les ports,\n   ou achète un domaine et reviens sur ${BOLD}bash install_tunnel.sh${RESET}."
    echo ""
  elif [[ "$DOMAIN" != *.* ]]; then
    echo -e "  ${RED}✘  '${DOMAIN}' ne ressemble pas à un domaine valide (pas de point).${RESET}"
  else
    _domain_ok=true
    ok "Domaine : ${BOLD}${DOMAIN}${RESET}"
  fi
done
DOMAIN_IS_AUTO=false

# 3 — Compte administrateur
echo ""
echo -e "  ${BOLD}Compte administrateur${RESET}"
prompt        ADMIN_USERNAME "Nom d'utilisateur admin"
prompt        ADMIN_EMAIL    "Email admin"
prompt_secret ADMIN_PASSWORD "Mot de passe admin"

# Récapitulatif
echo ""
echo -e "  ${BOLD}${CYAN}┌─ Récapitulatif ─────────────────────────────────────────────┐${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  Mode       : ${GREEN}Cloudflare Tunnel${RESET} (zéro port 80/443)           ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  Domaine    : ${BOLD}${DOMAIN}${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  Communauté : ${BOLD}${COMMUNITY_NAME}${RESET} (slug: ${COMMUNITY_SLUG})"
echo -e "  ${BOLD}${CYAN}│${RESET}  Langue     : ${BOLD}${COMMUNITY_LANG}${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  Admin      : ${BOLD}${ADMIN_USERNAME}${RESET} <${ADMIN_EMAIL}>"
echo -e "  ${BOLD}${CYAN}└─────────────────────────────────────────────────────────────┘${RESET}"
echo ""
read -rp "$(echo -e "  ${BOLD}Tout est bon ? On lance ! [O/n] ${RESET}")" confirm
[[ "${confirm,,}" == "n" ]] && die "Installation annulée."

# ═══════════════════════════════════════════════════════════════════════════════
#  GENERATED SECRETS
# ═══════════════════════════════════════════════════════════════════════════════
DB_NAME="nexus"
DB_USER="nexus_user"
DB_PASSWORD=$(gen_pass)
JWT_SECRET=$(gen_secret)
TURN_USER="nexus"
TURN_CREDENTIAL=$(gen_pass)
NEXUS_DIR="/opt/nexus"
REPO_URL="https://github.com/Pokled/Nexus.git"
CF_TUNNEL_ID=""
CF_TUNNEL_NAME="$COMMUNITY_SLUG"

# ═══════════════════════════════════════════════════════════════════════════════
#  SYSTEM PACKAGES
# ═══════════════════════════════════════════════════════════════════════════════
step "Installation des dépendances système"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q git 2>/dev/null
apt-get install -y -q \
  curl wget gnupg2 ca-certificates lsb-release \
  openssl ufw build-essential \
  postgresql postgresql-contrib \
  redis-server \
  coturn \
  2>/dev/null
ok "Paquets système installés"

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt 20 ]]; then
  info "Installation de Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -q nodejs >/dev/null 2>&1
  ok "Node.js $(node -v) installé"
else
  ok "Node.js $(node -v) déjà présent"
fi

# Caddy (proxy HTTP local — TLS entièrement délégué à Cloudflare)
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

systemctl enable postgresql --quiet
systemctl start postgresql

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
sudo -u postgres psql -d "$DB_NAME" -c "GRANT CREATE ON SCHEMA public TO ${DB_USER};" >/dev/null
ok "Base de données '${DB_NAME}' prête"

# ═══════════════════════════════════════════════════════════════════════════════
#  REDIS
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de Redis"
systemctl enable redis-server --quiet
systemctl start redis-server
ok "Redis démarré"

# ═══════════════════════════════════════════════════════════════════════════════
#  COTURN (TURN/STUN relay pour WebRTC vocal)
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de coturn (relay vocal)"

cat > /etc/turnserver.conf <<TURN
# Nexus TURN relay — généré par install_tunnel.sh
listening-port=3478
tls-listening-port=5349

listening-ip=0.0.0.0
external-ip=${PUBLIC_IP}

realm=${DOMAIN}

user=${TURN_USER}:${TURN_CREDENTIAL}

no-loopback-peers
no-multicast-peers
fingerprint

min-port=49152
max-port=65535

log-file=/var/log/coturn.log
simple-log
no-cli
TURN

systemctl enable coturn --quiet
systemctl restart coturn
ok "coturn configuré (IP: ${PUBLIC_IP}, port: 3478)"
warn "Canaux vocaux : ouvre UDP 3478 dans ta box/routeur (CF Tunnel est TCP uniquement)."

# ═══════════════════════════════════════════════════════════════════════════════
#  PARE-FEU (UFW)
#  CF Tunnel = connexion SORTANTE uniquement → on n'ouvre PAS 80/443
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du pare-feu"

ufw --force reset >/dev/null 2>&1
ufw default deny incoming  >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow ssh              >/dev/null 2>&1
# Ports 80 et 443 intentionnellement FERMÉS — CF Tunnel fait des connexions sortantes
ufw allow 3478/tcp         >/dev/null 2>&1
ufw allow 3478/udp         >/dev/null 2>&1
ufw allow 5349/tcp         >/dev/null 2>&1
ufw allow 5349/udp         >/dev/null 2>&1
ufw allow 49152:65535/udp  >/dev/null 2>&1
ufw --force enable         >/dev/null 2>&1
ok "Pare-feu configuré : SSH + TURN autorisés"
info "Ports 80/443 intentionnellement fermés — CF Tunnel gère le trafic web en sortie."

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
# Généré par install_tunnel.sh — ne pas modifier manuellement

NEXUS_COMMUNITY_NAME=${COMMUNITY_NAME}
NEXUS_COMMUNITY_SLUG=${COMMUNITY_SLUG}
NEXUS_COMMUNITY_LANGUAGE=${COMMUNITY_LANG}
NEXUS_COMMUNITY_COUNTRY=

PORT=3000
HOST=0.0.0.0
NODE_ENV=production

JWT_SECRET=${JWT_SECRET}

DB_HOST=localhost
DB_PORT=5432
DB_NAME=${DB_NAME}
DB_USER=${DB_USER}
DB_PASSWORD=${DB_PASSWORD}

REDIS_HOST=localhost
REDIS_PORT=6379

# CF Tunnel gère le TLS — l'URL publique reste en https://
FRONTEND_URL=https://${DOMAIN}
COREENV

info "Installation des dépendances backend..."
cd "${NEXUS_DIR}/nexus-core"
npm install --silent 2>/dev/null
info "Build du backend..."
npm run build 2>&1 | tail -3
ok "Backend prêt"

# ═══════════════════════════════════════════════════════════════════════════════
#  NEXUS-FRONTEND — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du frontend (nexus-frontend)"

TURN_PUBLIC_URL="turn:${PUBLIC_IP}:3478"

cat > "${NEXUS_DIR}/nexus-frontend/.env" <<FEENV
# Généré par install_tunnel.sh — ne pas modifier manuellement

PUBLIC_API_URL=https://${DOMAIN}
PUBLIC_TURN_URL=${TURN_PUBLIC_URL}
PUBLIC_TURN_USERNAME=${TURN_USER}
PUBLIC_TURN_CREDENTIAL=${TURN_CREDENTIAL}
FEENV

info "Installation des dépendances frontend..."
cd "${NEXUS_DIR}/nexus-frontend"
npm install --silent 2>/dev/null
info "Build du frontend (peut prendre quelques minutes)..."
npm run build 2>&1 | tail -5
ok "Frontend prêt"

# ═══════════════════════════════════════════════════════════════════════════════
#  CADDY — proxy HTTP local
#  CF Tunnel → http://localhost:80 → Caddy → nexus-core / nexus-frontend
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de Caddy (proxy HTTP local)"

cat > /etc/caddy/Caddyfile <<CADDY
# Mode Cloudflare Tunnel
# Caddy écoute en HTTP sur le port 80 (accès local uniquement)
# Cloudflare gère le chiffrement HTTPS en amont, côté visiteurs
http://${DOMAIN} {
    reverse_proxy /api/*       localhost:3000
    reverse_proxy /uploads/*   localhost:3000
    reverse_proxy /socket.io/* localhost:3000
    reverse_proxy *            localhost:4173

    encode gzip
}
CADDY

systemctl enable caddy --quiet
systemctl restart caddy
ok "Caddy configuré en HTTP local (port 80 ← CF Tunnel)"

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
      env: { NODE_ENV: 'production', PORT: '4173', HOST: '127.0.0.1', ORIGIN: 'https://${DOMAIN}' },
    },
  ],
}
PM2

cd "$NEXUS_DIR"
pm2 delete nexus-core     2>/dev/null || true
pm2 delete nexus-frontend 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 | tail -1 | bash 2>/dev/null || true
ok "PM2 configuré et lancé"

# ═══════════════════════════════════════════════════════════════════════════════
#  CLOUDFLARE TUNNEL — Installation, authentification, configuration
# ═══════════════════════════════════════════════════════════════════════════════

# ── Étape A : Détection de l'architecture ────────────────────────────────────
step "Cloudflare Tunnel — Détection de l'architecture"
_arch=$(uname -m)
case "$_arch" in
  aarch64|arm64) CF_ARCH="arm64" ;;
  armv7l)        CF_ARCH="arm"   ;;
  *)             CF_ARCH="amd64" ;;
esac
ok "Architecture : ${_arch}  →  cloudflared-linux-${CF_ARCH}"

# ── Étape B : Installation de cloudflared ────────────────────────────────────
step "Cloudflare Tunnel — Installation de cloudflared"
if command -v cloudflared &>/dev/null; then
  ok "cloudflared déjà présent : $(cloudflared --version 2>&1 | head -1)"
else
  info "Téléchargement de cloudflared depuis GitHub releases…"
  CF_DL_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
  if ! curl -sL --max-time 120 --progress-bar "$CF_DL_URL" -o /usr/local/bin/cloudflared; then
    die "Téléchargement échoué. Vérifie ta connexion internet puis relance le script."
  fi
  chmod +x /usr/local/bin/cloudflared
  if ! cloudflared --version &>/dev/null 2>&1; then
    die "cloudflared téléchargé mais ne s'exécute pas.\nArchitecture détectée : ${_arch}\nEssaie de télécharger manuellement depuis : https://github.com/cloudflare/cloudflared/releases"
  fi
  ok "cloudflared $(cloudflared --version 2>&1 | head -1) installé dans /usr/local/bin/"
fi

# ── Étape C : Authentification ────────────────────────────────────────────────
step "Cloudflare Tunnel — Authentification"
echo ""
echo -e "  ${BOLD}${CYAN}┌──────────────────────────────────────────────────────────────┐${RESET}"
echo -e "  ${BOLD}${CYAN}│  Connexion à ton compte Cloudflare                          │${RESET}"
echo -e "  ${BOLD}${CYAN}├──────────────────────────────────────────────────────────────┤${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}                                                              ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  Dans quelques secondes, une URL va s'afficher.              ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}                                                              ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  ${BOLD}Étape 1${RESET}  Copie cette URL                                  ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  ${BOLD}Étape 2${RESET}  Ouvre-la dans ton navigateur (sur ton PC)         ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  ${BOLD}Étape 3${RESET}  Connecte-toi à ton compte Cloudflare              ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  ${BOLD}Étape 4${RESET}  Sélectionne le domaine ${BOLD}${DOMAIN}${RESET}                     ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  ${BOLD}Étape 5${RESET}  Clique sur ${BOLD}Authorize${RESET}                              ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}                                                              ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  Le script reprend ${BOLD}automatiquement${RESET} après l'autorisation.     ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}                                                              ${BOLD}${CYAN}│${RESET}"
echo -e "  ${BOLD}${CYAN}└──────────────────────────────────────────────────────────────┘${RESET}"
echo ""
read -rp "$(echo -e "  ${BOLD}Prêt ? Appuie sur Entrée pour lancer l'authentification…${RESET}")" _

cloudflared tunnel login

# Validation : le certificat doit exister
if [[ ! -f /root/.cloudflared/cert.pem ]]; then
  die "Authentification incomplète — cert.pem non trouvé dans /root/.cloudflared/\n   Assure-toi d'avoir cliqué sur 'Authorize' dans le navigateur.\n   Relance le script pour réessayer."
fi
ok "Authentification réussie — certificat Cloudflare sauvegardé"

# ── Étape D : Création du tunnel ──────────────────────────────────────────────
step "Cloudflare Tunnel — Création du tunnel '${CF_TUNNEL_NAME}'"
echo ""
info "Création du tunnel sur ton compte Cloudflare…"

CF_TUNNEL_OUTPUT=$(cloudflared tunnel create "$CF_TUNNEL_NAME" 2>&1 || true)
CF_TUNNEL_ID=$(echo "$CF_TUNNEL_OUTPUT" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)

if [[ -z "$CF_TUNNEL_ID" ]]; then
  # Tunnel déjà existant (reinstallation) — récupération de l'ID
  warn "Tunnel non créé — tentative de récupération d'un tunnel existant…"
  CF_TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null \
    | grep "$CF_TUNNEL_NAME" \
    | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)
  if [[ -z "$CF_TUNNEL_ID" ]]; then
    die "Impossible de créer ou récupérer le tunnel '${CF_TUNNEL_NAME}'.\n   Vérifie ton compte Cloudflare sur https://dash.cloudflare.com"
  fi
  warn "Tunnel existant retrouvé. ID : ${BOLD}${CF_TUNNEL_ID}${RESET}"
else
  ok "Tunnel '${CF_TUNNEL_NAME}' créé — ID : ${BOLD}${CF_TUNNEL_ID}${RESET}"
fi

# Validation : le fichier JSON de credentials doit exister
CF_CREDS_FILE="/root/.cloudflared/${CF_TUNNEL_ID}.json"
if [[ ! -f "$CF_CREDS_FILE" ]]; then
  die "Fichier credentials du tunnel introuvable : ${CF_CREDS_FILE}\n   Supprime le tunnel depuis le dashboard CF et relance le script."
fi
ok "Fichier credentials validé : ${CF_CREDS_FILE}"

# ── Étape E : Génération du fichier config.yml ────────────────────────────────
step "Cloudflare Tunnel — Configuration (config.yml)"
mkdir -p /root/.cloudflared

cat > /root/.cloudflared/config.yml <<CFCFG
# Nexus — Cloudflare Tunnel config
# Généré le $(date) par install_tunnel.sh
tunnel: ${CF_TUNNEL_ID}
credentials-file: /root/.cloudflared/${CF_TUNNEL_ID}.json

ingress:
  # Tout le trafic web passe par Caddy sur le port 80 local
  - hostname: ${DOMAIN}
    service: http://localhost:80
  # Route par défaut obligatoire
  - service: http_status:404
CFCFG

ok "config.yml généré → /root/.cloudflared/config.yml"
info "Flux : visiteur → Cloudflare (HTTPS) → Tunnel → Caddy :80 → Nexus"

# ── Étape F : Route DNS automatique ──────────────────────────────────────────
step "Cloudflare Tunnel — Enregistrement DNS"
echo ""
info "Création de l'entrée DNS dans ton compte Cloudflare…"
info "${BOLD}${DOMAIN}${RESET}  →  CNAME vers le tunnel '${CF_TUNNEL_NAME}'"
echo ""

if cloudflared tunnel route dns "$CF_TUNNEL_NAME" "$DOMAIN" 2>&1; then
  ok "DNS ${BOLD}${DOMAIN}${RESET} → tunnel '${CF_TUNNEL_NAME}' enregistré"
else
  warn "L'enregistrement DNS existe peut-être déjà (reinstallation) — ce n'est pas bloquant."
  warn "Vérifie dans Cloudflare DNS : ${DOMAIN} doit pointer vers le tunnel."
fi

# ── Étape G : Service systemd ─────────────────────────────────────────────────
step "Cloudflare Tunnel — Service systemd"

cat > /etc/systemd/system/cloudflared.service <<CFSVC
[Unit]
Description=Nexus — Cloudflare Tunnel
Documentation=https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/cloudflared tunnel --config /root/.cloudflared/config.yml run
Restart=on-failure
RestartSec=5s
KillMode=process
User=root

[Install]
WantedBy=multi-user.target
CFSVC

systemctl daemon-reload
systemctl enable cloudflared --quiet
systemctl restart cloudflared

sleep 3  # Laisser le tunnel s'établir

if systemctl is-active --quiet cloudflared; then
  ok "Service cloudflared actif et configuré pour démarrer automatiquement"
else
  warn "Service cloudflared non actif — diagnostic : systemctl status cloudflared"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  WAIT FOR BACKEND + BOOTSTRAP (community + admin)
# ═══════════════════════════════════════════════════════════════════════════════
step "Initialisation de la communauté et du compte administrateur"

info "Attente du démarrage du backend (migrations DB incluses)…"
for i in {1..30}; do
  if curl -sf http://localhost:3000/api/v1/instance/info >/dev/null 2>&1; then
    ok "Backend opérationnel"
    break
  fi
  [[ $i -eq 30 ]] && warn "Backend long à démarrer — on continue quand même…"
  sleep 2
done

HTTP_CODE=$(curl -s -o /tmp/nexus_register.json -w "%{http_code}" \
  -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d "{
    \"username\": \"${ADMIN_USERNAME}\",
    \"email\": \"${ADMIN_EMAIL}\",
    \"password\": \"${ADMIN_PASSWORD}\"
  }")

if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
  ok "Compte '${ADMIN_USERNAME}' créé"
else
  warn "Inscription API échouée (HTTP ${HTTP_CODE}) : $(cat /tmp/nexus_register.json 2>/dev/null | head -c 200)"
  warn "Tu pourras créer ton compte sur https://${DOMAIN}/auth/register"
fi

USER_ID=$(sudo -u postgres psql -d "$DB_NAME" -tc \
  "SELECT id FROM users WHERE lower(email)=lower('${ADMIN_EMAIL}');" 2>/dev/null | tr -d ' \n')

if [[ -n "$USER_ID" ]]; then
  sudo -u postgres psql -d "$DB_NAME" <<SQL >/dev/null
    INSERT INTO communities (name, slug, description, owner_id, is_public)
    VALUES (
      '${COMMUNITY_NAME}',
      '${COMMUNITY_SLUG}',
      '',
      '${USER_ID}',
      true
    )
    ON CONFLICT (slug) DO NOTHING;

    INSERT INTO community_members (community_id, user_id, role)
    SELECT id, '${USER_ID}', 'owner'
    FROM communities WHERE slug = '${COMMUNITY_SLUG}'
    ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'owner';
SQL
  ok "Communauté '${COMMUNITY_NAME}' créée, ${ADMIN_USERNAME} → owner"
else
  warn "Utilisateur introuvable en DB — crée ton compte sur https://${DOMAIN}/auth/register"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  SAVE CREDENTIALS
# ═══════════════════════════════════════════════════════════════════════════════
CREDS_FILE="/root/nexus-credentials.txt"
cat > "$CREDS_FILE" <<CREDS
═══════════════════════════════════════════════════════
  NEXUS — Credentials de l'instance (Cloudflare Tunnel)
  Générés le $(date)
═══════════════════════════════════════════════════════

URL              : https://${DOMAIN}
Admin username   : ${ADMIN_USERNAME}
Admin email      : ${ADMIN_EMAIL}
Admin password   : ${ADMIN_PASSWORD}

PostgreSQL user  : ${DB_USER}
PostgreSQL pass  : ${DB_PASSWORD}
PostgreSQL DB    : ${DB_NAME}

JWT secret       : ${JWT_SECRET}

TURN URL         : turn:${PUBLIC_IP}:3478
TURN user        : ${TURN_USER}
TURN credential  : ${TURN_CREDENTIAL}

Nexus dir        : ${NEXUS_DIR}

── Cloudflare Tunnel ───────────────────────────────────
Tunnel name      : ${CF_TUNNEL_NAME}
Tunnel ID        : ${CF_TUNNEL_ID}
Config           : /root/.cloudflared/config.yml
Credentials JSON : /root/.cloudflared/${CF_TUNNEL_ID}.json

── Commandes utiles ────────────────────────────────────
systemctl status cloudflared           → état du tunnel
cloudflared tunnel info ${CF_TUNNEL_NAME}   → connexions actives
systemctl restart cloudflared          → redémarrer le tunnel

GARDE CE FICHIER EN LIEU SÛR — ne le partage jamais.
CREDS
chmod 600 "$CREDS_FILE"

# ═══════════════════════════════════════════════════════════════════════════════
#  HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════════════════
step "Vérification post-installation"

HC_PASS=0; HC_WARN=0; HC_FAIL=0
_HC_SPIN=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

_hc_pass() { HC_PASS=$((HC_PASS+1)); echo -e "  ${GREEN}✔${RESET}  $*"; }
_hc_warn() { HC_WARN=$((HC_WARN+1)); echo -e "  ${YELLOW}⚠${RESET}  $*"; }
_hc_fail() { HC_FAIL=$((HC_FAIL+1)); echo -e "  ${RED}✘${RESET}  $*"; }
_hc_sect() {
  echo ""
  echo -e "  ${BOLD}${CYAN}▸ $1${RESET}"
  echo -e "  ${CYAN}──────────────────────────────────────────────────${RESET}"
}

_wait_https() {
  local url="$1" label="$2" max_secs="${3:-60}"
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

# ── Services système (incluant cloudflared) ───────────────────────────────────
_hc_sect "Services système"
for _svc in postgresql redis-server coturn caddy; do
  if systemctl is-active --quiet "$_svc" 2>/dev/null; then
    _hc_pass "$_svc"
  else
    _hc_fail "$_svc  ${YELLOW}→ sudo systemctl start $_svc${RESET}"
  fi
done

if systemctl is-active --quiet cloudflared 2>/dev/null; then
  _hc_pass "cloudflared  ${CYAN}(tunnel actif)${RESET}"
else
  _hc_fail "cloudflared  ${YELLOW}→ systemctl status cloudflared${RESET}"
fi

# ── Nexus (PM2) ───────────────────────────────────────────────────────────────
_hc_sect "Nexus (PM2)"
for _app in nexus-core nexus-frontend; do
  _pm2=$(pm2 list 2>/dev/null | grep " $_app " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_pm2" == "online" ]]; then
    _hc_pass "$_app"
  else
    _hc_fail "$_app  ${YELLOW}[${_pm2}] → pm2 restart $_app${RESET}"
  fi
done

# ── Tunnel Cloudflare ─────────────────────────────────────────────────────────
_hc_sect "Tunnel Cloudflare"

# Vérification DNS
_dns_ip=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
if [[ -n "$_dns_ip" ]]; then
  _hc_pass "DNS ${DOMAIN}  →  ${_dns_ip}  ${CYAN}(CNAME CF)${RESET}"
else
  _hc_warn "DNS ${DOMAIN}  →  non résolu  ${YELLOW}(propagation CF en cours, ~1 min normal)${RESET}"
fi

# Vérification HTTPS via le tunnel (timeout 60s — CF propage vite)
if _wait_https "https://${DOMAIN}" "Attente réponse via CF Tunnel…" 60; then
  _hc_pass "HTTPS https://${DOMAIN}  →  opérationnel via CF Tunnel"
else
  _hc_warn "HTTPS https://${DOMAIN}  →  pas encore joignable  ${YELLOW}(tunnel en cours de propagation)${RESET}"
fi

# Vérification API
_api_code=$(curl -sk --max-time 5 -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/v1/instance/info" 2>/dev/null || true)
if [[ "$_api_code" =~ ^[23] ]]; then
  _hc_pass "API /api/v1/instance/info  →  HTTP ${_api_code}"
else
  _hc_warn "API /api/v1/instance/info  →  HTTP ${_api_code:-timeout}"
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
echo -e "${GREEN}${BOLD}║  ✔  Nexus installé via Cloudflare Tunnel !      ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Instance  :${RESET} https://${DOMAIN}"
echo -e "  ${BOLD}Admin     :${RESET} ${ADMIN_USERNAME} / ${ADMIN_EMAIL}"
echo -e "  ${BOLD}Tunnel    :${RESET} ${CF_TUNNEL_NAME}  ${CYAN}(ID: ${CF_TUNNEL_ID:0:8}…)${RESET}"
echo -e "  ${BOLD}Vocal     :${RESET} TURN sur ${PUBLIC_IP}:3478  ${YELLOW}(UDP 3478 à ouvrir dans ta box)${RESET}"
echo ""
echo -e "  ${CYAN}Credentials sauvegardés dans :${RESET} ${BOLD}${CREDS_FILE}${RESET}"
echo ""
echo -e "  ${BOLD}Commandes utiles :${RESET}"
echo -e "  pm2 list                              → état des apps Nexus"
echo -e "  pm2 logs nexus-core                   → logs backend"
echo -e "  pm2 logs nexus-frontend               → logs frontend"
echo -e "  systemctl status cloudflared          → état du tunnel"
echo -e "  cloudflared tunnel info ${CF_TUNNEL_NAME}   → connexions actives"
echo -e "  pm2 restart all                       → redémarrer Nexus"
echo ""
echo -e "  ${YELLOW}⚠  Voix/webcam : ouvre ${BOLD}UDP 3478${RESET}${YELLOW} dans ta box/routeur.${RESET}"
echo -e "  ${YELLOW}   Chat, forum, médias — tout fonctionne sans ça.${RESET}"
echo ""
