#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Nexus — One-click node installer
#  Supports : Ubuntu 22.04 / 24.04, Debian 11 / 12
#  Usage    : bash install.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

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
  echo -e "  ${BOLD}Nexus Node Installer${RESET} — v1.0"
  echo -e "  Forum + Chat + Voice • AGPL-3.0\n"
}

# ── Helpers ───────────────────────────────────────────────────────────────────
gen_secret()  { openssl rand -hex 32; }
gen_pass()    { openssl rand -base64 18 | tr -d '/+='; }
slugify()     { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g'; }

prompt() {
  local var="$1" msg="$2" default="${3:-}"
  if [[ -n "$default" ]]; then
    read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg} [${default}]: ")" val
    val="${val:-$default}"
  else
    while [[ -z "${val:-}" ]]; do
      read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val
    done
  fi
  printf -v "$var" '%s' "$val"
}

prompt_secret() {
  local var="$1" msg="$2"
  local val=''
  while [[ -z "$val" ]]; do
    read -rsp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val
    echo
  done
  printf -v "$var" '%s' "$val"
}

step() {
  echo ""
  echo -e "${BOLD}━━━  $*  ━━━${RESET}"
}

# ═══════════════════════════════════════════════════════════════════════════════
#  PREFLIGHT
# ═══════════════════════════════════════════════════════════════════════════════
banner

[[ $EUID -ne 0 ]] && die "Lance ce script en root : sudo bash install.sh"

# OS check
if ! grep -qiE 'ubuntu|debian' /etc/os-release 2>/dev/null; then
  die "OS non supporté. Utilise Ubuntu 22.04/24.04 ou Debian 11/12."
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
#  CONFIGURATION — 5 questions
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de ton instance"
echo ""

prompt   DOMAIN          "Nom de domaine (ex: moncommunaute.fr)"
prompt   COMMUNITY_NAME  "Nom de la communauté (ex: Linux France)"
COMMUNITY_SLUG_DEFAULT=$(slugify "$COMMUNITY_NAME")
prompt   COMMUNITY_SLUG  "Slug unique de la communauté" "$COMMUNITY_SLUG_DEFAULT"
prompt   COMMUNITY_LANG  "Langue principale (fr/en/de/es/it/pt)" "fr"
echo ""
echo -e "  ${BOLD}Compte administrateur${RESET}"
prompt        ADMIN_USERNAME "Nom d'utilisateur admin"
prompt        ADMIN_EMAIL    "Email admin"
prompt_secret ADMIN_PASSWORD "Mot de passe admin"

echo ""
echo -e "  ${BOLD}Récapitulatif :${RESET}"
echo -e "  Domaine    : ${CYAN}$DOMAIN${RESET}"
echo -e "  Communauté : ${CYAN}$COMMUNITY_NAME${RESET} (slug: $COMMUNITY_SLUG)"
echo -e "  Langue     : ${CYAN}$COMMUNITY_LANG${RESET}"
echo -e "  Admin      : ${CYAN}$ADMIN_USERNAME${RESET} <$ADMIN_EMAIL>"
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
TURN_USER="nexus"
TURN_CREDENTIAL=$(gen_pass)
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
apt-get install -y -q \
  curl wget gnupg2 ca-certificates lsb-release \
  openssl ufw build-essential \
  postgresql postgresql-contrib \
  redis-server \
  coturn \
  2>/dev/null
ok "Paquets système installés"

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(\".\")[0].slice(1))')" -lt 20 ]]; then
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

systemctl enable postgresql --quiet
systemctl start postgresql

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
systemctl enable redis-server --quiet
systemctl start redis-server
ok "Redis démarré"

# ═══════════════════════════════════════════════════════════════════════════════
#  COTURN (TURN/STUN relay pour WebRTC)
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de coturn (relay vocal)"

cat > /etc/turnserver.conf <<TURN
# Nexus TURN relay — généré par install.sh
listening-port=3478
tls-listening-port=5349

listening-ip=0.0.0.0
external-ip=${PUBLIC_IP}

realm=${DOMAIN}

# Credentials statiques
user=${TURN_USER}:${TURN_CREDENTIAL}

# Sécurité
no-loopback-peers
no-multicast-peers
fingerprint

# Plage de ports relais
min-port=49152
max-port=65535

# Logs
log-file=/var/log/coturn.log
simple-log
no-cli
TURN

systemctl enable coturn --quiet
systemctl restart coturn
ok "coturn configuré et démarré (IP: ${PUBLIC_IP}, port: 3478)"

# ═══════════════════════════════════════════════════════════════════════════════
#  PARE-FEU (UFW)
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration du pare-feu"

ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow ssh >/dev/null 2>&1
ufw allow 80/tcp >/dev/null 2>&1
ufw allow 443/tcp >/dev/null 2>&1
ufw allow 3478/tcp >/dev/null 2>&1
ufw allow 3478/udp >/dev/null 2>&1
ufw allow 5349/tcp >/dev/null 2>&1
ufw allow 5349/udp >/dev/null 2>&1
ufw allow 49152:65535/udp >/dev/null 2>&1
ufw --force enable >/dev/null 2>&1
ok "Pare-feu configuré"

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
NEXUS_COMMUNITY_LANGUAGE=${COMMUNITY_LANG}
NEXUS_COMMUNITY_COUNTRY=

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

# TURN URL : on utilise l'IP directement pour contourner les proxys DNS (Cloudflare, etc.)
TURN_PUBLIC_URL="turn:${PUBLIC_IP}:3478"

cat > "${NEXUS_DIR}/nexus-frontend/.env" <<FEENV
# Généré par install.sh — ne pas modifier manuellement

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
#  CADDY
# ═══════════════════════════════════════════════════════════════════════════════
step "Configuration de Caddy (proxy HTTPS)"

cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
    reverse_proxy /api/*       localhost:3000
    reverse_proxy /uploads/*   localhost:3000
    reverse_proxy /socket.io/* localhost:3000
    reverse_proxy *            localhost:4173

    encode gzip
}
CADDY

systemctl enable caddy --quiet
systemctl restart caddy
ok "Caddy configuré (Let's Encrypt automatique pour $DOMAIN)"

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
pm2 delete nexus-core    2>/dev/null || true
pm2 delete nexus-frontend 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 | tail -1 | bash 2>/dev/null || true
ok "PM2 configuré et lancé"

# ═══════════════════════════════════════════════════════════════════════════════
#  WAIT FOR BACKEND + BOOTSTRAP (community + admin)
# ═══════════════════════════════════════════════════════════════════════════════
step "Initialisation de la communauté et du compte administrateur"

info "Attente du démarrage du backend (migrations DB incluses)..."
for i in {1..30}; do
  if curl -sf http://localhost:3000/api/v1/instance/info >/dev/null 2>&1; then
    ok "Backend opérationnel"
    break
  fi
  [[ $i -eq 30 ]] && warn "Backend long à démarrer — continue quand même..."
  sleep 2
done

# Register admin account via API (no community yet → auto-join skipped)
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
  warn "Inscription API échouée (HTTP $HTTP_CODE) : $(cat /tmp/nexus_register.json 2>/dev/null)"
  warn "Tu pourras créer ton compte sur https://${DOMAIN}/auth/register"
fi

# Bootstrap community + make admin owner — done directly in PostgreSQL
# (The API requires a community to exist before any admin action)
USER_ID=$(sudo -u postgres psql -d "$DB_NAME" -tc \
  "SELECT id FROM users WHERE email='${ADMIN_EMAIL}';" 2>/dev/null | tr -d ' \n')

if [[ -n "$USER_ID" ]]; then
  sudo -u postgres psql -d "$DB_NAME" <<SQL >/dev/null
    -- Create the instance community
    INSERT INTO communities (name, slug, description, owner_id, is_public)
    VALUES (
      '${COMMUNITY_NAME}',
      '${COMMUNITY_SLUG}',
      '',
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
step "Sous-domaine gratuit nexusnode.app (optionnel)"

NEXUS_SUBDOMAIN=""
NEXUS_DIRECTORY_TOKEN=""
NEXUS_DIRECTORY_URL="https://nexusnode.app/api/directory"

echo ""
echo -e "  Tu peux obtenir un sous-domaine gratuit : ${BOLD}${COMMUNITY_SLUG}.nexusnode.app${RESET}"
echo -e "  Cela permet à tes utilisateurs d'accéder à ton instance sans domaine propre."
echo -e "  (Tu peux toujours utiliser ton propre domaine ${CYAN}${DOMAIN}${RESET} en même temps.)"
echo ""
read -rp "$(echo -e "  Activer ${BOLD}${COMMUNITY_SLUG}.nexusnode.app${RESET} ? [O/n] ")" want_subdomain

if [[ "${want_subdomain,,}" != "n" ]]; then
  info "Enregistrement auprès du directory nexusnode.app..."

  # Wait a bit more for backend to be fully ready and reachable from outside
  # The directory will check if DOMAIN is reachable before activating the subdomain
  REGISTER_RESPONSE=$(curl -s -X POST "${NEXUS_DIRECTORY_URL}/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":        \"${COMMUNITY_NAME}\",
      \"slug\":        \"${COMMUNITY_SLUG}\",
      \"url\":         \"https://${DOMAIN}\",
      \"language\":    \"${COMMUNITY_LANG}\",
      \"version\":     \"0.4.1\"
    }" 2>/dev/null || true)

  REGISTER_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
  REGISTER_SLUG=$(echo "$REGISTER_RESPONSE" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4 || true)

  if [[ -n "$REGISTER_TOKEN" ]]; then
    NEXUS_DIRECTORY_TOKEN="$REGISTER_TOKEN"
    NEXUS_SUBDOMAIN="${REGISTER_SLUG:-${COMMUNITY_SLUG}.nexusnode.app}"
    ok "Enregistré ! Sous-domaine : ${BOLD}https://${NEXUS_SUBDOMAIN}${RESET}"
    info "Le DNS sera actif dans ~30 secondes (vérification de ton domaine en cours)."
    info "Sauvegarde le token directory — nécessaire pour les heartbeats et la désinscription."
  else
    warn "Enregistrement échoué (le directory n'a peut-être pas pu vérifier ton domaine)."
    warn "Réponse : $(echo "$REGISTER_RESPONSE" | head -c 200)"
    warn "Tu peux réessayer manuellement plus tard sur https://nexusnode.app"
  fi
else
  info "Sous-domaine gratuit ignoré. Tu utiliseras https://${DOMAIN}"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  SAVE CREDENTIALS
# ═══════════════════════════════════════════════════════════════════════════════
CREDS_FILE="/root/nexus-credentials.txt"
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

TURN URL         : turn:${PUBLIC_IP}:3478
TURN user        : ${TURN_USER}
TURN credential  : ${TURN_CREDENTIAL}

Nexus dir        : ${NEXUS_DIR}
$([ -n "$NEXUS_SUBDOMAIN" ] && echo "Sous-domaine     : https://${NEXUS_SUBDOMAIN}")
$([ -n "$NEXUS_DIRECTORY_TOKEN" ] && echo "Directory token  : ${NEXUS_DIRECTORY_TOKEN}")

GARDE CE FICHIER EN LIEU SÛR — ne le partage jamais.
CREDS
chmod 600 "$CREDS_FILE"

# ═══════════════════════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║           ✔  Nexus installé avec succès !        ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Instance  :${RESET} https://${DOMAIN}"
[[ -n "$NEXUS_SUBDOMAIN" ]] && \
echo -e "  ${BOLD}Alias     :${RESET} https://${NEXUS_SUBDOMAIN} ${CYAN}(nexusnode.app)${RESET}"
echo -e "  ${BOLD}Admin     :${RESET} ${ADMIN_USERNAME} / ${ADMIN_EMAIL}"
echo -e "  ${BOLD}Vocal     :${RESET} TURN relay sur ${PUBLIC_IP}:3478"
echo ""
echo -e "  ${CYAN}Les credentials sont sauvegardés dans :${RESET}"
echo -e "  ${BOLD}${CREDS_FILE}${RESET}"
echo ""
echo -e "  ${BOLD}Commandes utiles :${RESET}"
echo -e "  pm2 list                          → état des services"
echo -e "  pm2 logs nexus-core               → logs backend"
echo -e "  pm2 logs nexus-frontend           → logs frontend"
echo -e "  pm2 restart all                   → redémarrer tout"
echo ""
echo -e "  ${YELLOW}⚠  Assure-toi que ton DNS pointe vers ${PUBLIC_IP}${RESET}"
echo -e "  ${YELLOW}   Le certificat SSL sera généré automatiquement par Caddy.${RESET}"
echo ""
