#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Nodyx — désinstallation / uninstaller
#  Usage : sudo bash uninstall.sh [--dry-run] [--dir=/opt/nodyx]
#
#  Règles (réécriture du 03/10/2026, l'ancienne version datait de mars) :
#   1. Ne toucher qu'à ce que install.sh / install_tunnel.sh ont posé. Caddy,
#      Redis, PostgreSQL et le pare-feu peuvent servir à d'autres choses : on
#      n'y retire que la part de Nodyx, et on refuse d'aller plus loin si
#      d'autres usages sont détectés.
#   2. S'arrêter net si l'installation n'est pas reconnue (dossier, fichiers).
#   3. Sauvegarder AVANT de détruire : base, uploads, .env, archives de
#      sauvegarde de Nodyx. Une sauvegarde ratée arrête tout.
#   4. Chaque étape destructive demande son accord. --dry-run montre tout ce
#      qui serait fait sans rien modifier.
#   5. Le bilan final dit ce qui a échoué. Jamais « terminé » sur un échec.
#
#  Pour les tests seulement : NODYX_UNINSTALL_ROOT préfixe tous les chemins
#  (faux système de fichiers), NODYX_UNINSTALL_TTY remplace /dev/tty.
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

ROOT="${NODYX_UNINSTALL_ROOT:-}"
TTY_IN="${NODYX_UNINSTALL_TTY:-/dev/tty}"
DRY=false
NODYX_DIR="$ROOT/opt/nodyx"
for _arg in "$@"; do
  case "$_arg" in
    --dry-run)  DRY=true ;;
    --dir=*)    NODYX_DIR="$ROOT${_arg#*=}" ;;
    -h|--help)  sed -n '2,20p' "$0"; exit 0 ;;
    *)          echo "Option inconnue / unknown option: $_arg" >&2; exit 2 ;;
  esac
done

case "${LANG:-}${LC_ALL:-}" in fr*|*fr_*) L=fr ;; *) L=en ;; esac
m() { if [[ $L == fr ]]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
skip() { echo -e "  ${CYAN}↷${RESET}  $*"; }
step() { echo ""; echo -e "${BOLD}━━━  $*  ━━━${RESET}"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }

FAILS=()
fail() { FAILS+=("$1"); echo -e "${RED}✘${RESET}  $1"; }

# Toute commande qui MODIFIE le système passe par run : en simulation, elle
# est seulement affichée.
run() {
  if $DRY; then echo -e "  ${CYAN}[$(m simulation dry-run)]${RESET} $*"; return 0; fi
  "$@"
}

# Les réponses viennent du terminal, jamais de l'entrée standard : lancé via
# « curl … | bash », read lirait sinon le texte du script lui-même.
# (Les accolades limitent le 2>/dev/null à cette ligne : un « exec … 2>/dev/null »
# nu ferait taire TOUS les messages d'erreur du script ensuite.)
{ exec 3<"$TTY_IN"; } 2>/dev/null || die "$(m "Lance ce script depuis un terminal : sudo bash uninstall.sh" "Run this script from a terminal: sudo bash uninstall.sh")"
ask() {
  local a
  read -r -u 3 -p "$(echo -e "  ${YELLOW}?${RESET} $1 [$(m o/N y/N)] ")" a || return 1
  [[ "${a,,}" =~ ^(o|oui|y|yes)$ ]]
}

pm2n() { runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 "$@"; }
have() { command -v "$1" &>/dev/null; }

# ═══════════════════════════════════════════════════════════════════════════════
#  1. RECONNAISSANCE — rien n'est modifié ici
# ═══════════════════════════════════════════════════════════════════════════════
[[ $EUID -eq 0 || -n "$ROOT" ]] || die "$(m "Lance ce script en root : sudo bash uninstall.sh" "Run as root: sudo bash uninstall.sh")"

[[ -d "$NODYX_DIR" ]] || die "$(m "Aucune installation Nodyx standard trouvée dans $NODYX_DIR. Rien n'a été touché. (Autre dossier : --dir=…)" "No standard Nodyx install found in $NODYX_DIR. Nothing was touched. (Other location: --dir=…)")"
NODYX_REAL="$(realpath -e "$NODYX_DIR")"
case "${NODYX_REAL#"$ROOT"}" in
  ""|/|/opt|/srv|/var|/var/www|/usr|/usr/local|/home|/root|/etc|/boot|/tmp|/bin|/sbin|/lib|/lib64)
    die "$(m "Dossier refusé : $NODYX_REAL. Rien n'a été touché." "Refused directory: $NODYX_REAL. Nothing was touched.")" ;;
esac
[[ -f "$NODYX_REAL/nodyx-core/package.json" && -d "$NODYX_REAL/nodyx-frontend" ]] \
  && grep -q '"name": *"nodyx-core"' "$NODYX_REAL/nodyx-core/package.json" \
  || die "$(m "$NODYX_REAL ne ressemble pas à une installation Nodyx (nodyx-core/ et nodyx-frontend/ attendus). Rien n'a été touché." "$NODYX_REAL does not look like a Nodyx install (nodyx-core/ and nodyx-frontend/ expected). Nothing was touched.")"

ENV_FILE="$NODYX_REAL/nodyx-core/.env"
# Lecture du .env SANS l'exécuter (jamais « source » : un .env peut contenir n'importe quoi).
envget() { [[ -f "$ENV_FILE" ]] && grep -m1 -E "^$1=" "$ENV_FILE" | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]\$//" || true; }
DB_NAME="$(envget DB_NAME)";  DB_NAME="${DB_NAME:-nodyx}"
DB_USER="$(envget DB_USER)";  DB_USER="${DB_USER:-nodyx_user}"
REDIS_HOST="$(envget REDIS_HOST)"; REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="$(envget REDIS_PORT)"; REDIS_PORT="${REDIS_PORT:-6379}"
REDIS_PREFIX="$(envget REDIS_KEY_PREFIX)"; REDIS_PREFIX="${REDIS_PREFIX:-nodyx:}"
DOMAIN="$(envget FRONTEND_URL | sed -E 's#^[a-z]+://##; s#[/:].*$##')"

# Ces noms finissent dans du SQL et un motif Redis : on les valide.
[[ "$DB_NAME" =~ ^[a-z_][a-z0-9_]{0,62}$ && "$DB_USER" =~ ^[a-z_][a-z0-9_]{0,62}$ ]] \
  || die "$(m "Nom de base ou d'utilisateur inattendu dans $ENV_FILE. Rien n'a été touché." "Unexpected database or user name in $ENV_FILE. Nothing was touched.")"
case "$DB_NAME" in postgres|template0|template1) die "$(m "Base refusée : $DB_NAME" "Refused database: $DB_NAME")" ;; esac
[[ "$REDIS_PREFIX" =~ ^[A-Za-z0-9_.-]+:$ ]] \
  || die "$(m "Préfixe Redis inattendu ($REDIS_PREFIX). Rien n'a été touché." "Unexpected Redis prefix ($REDIS_PREFIX). Nothing was touched.")"

# Autres applications PM2 du même utilisateur : on garde alors le démon, son
# service de démarrage et l'utilisateur nodyx.
OTHER_PM2=""
if have pm2 && id nodyx &>/dev/null; then
  OTHER_PM2="$(pm2n jlist 2>/dev/null | node -e '
    let s=""; process.stdin.on("data",d=>s+=d).on("end",()=>{ try {
      const ours=new Set(["nodyx-core","nodyx-frontend"]);
      console.log(JSON.parse(s).filter(p=>!ours.has(p.name)&&!(p.pm2_env&&p.pm2_env.pmx_module)).map(p=>p.name).join(" "))
    } catch { console.log("?") } })' 2>/dev/null || echo "?")"
fi

# Plusieurs instances Nodyx sur la même machine partagent souvent Redis (même
# préfixe nodyx:) et le reste : une désinstallation automatique y ferait des
# dégâts chez les voisines. On refuse.
_cores=""
for _a in $OTHER_PM2; do [[ "$_a" == *-core ]] && _cores+="$_a "; done
[[ -n "$_cores" ]] && die "$(m "D'autres instances Nodyx tournent sur ce serveur ($_cores). Désinstallation automatique refusée : elle toucherait aussi à leurs données. Rien n'a été touché." "Other Nodyx instances run on this server ($_cores). Automatic uninstall refused: it would also touch their data. Nothing was touched.")"

# Sites du Caddyfile hors de Nodyx (blocs de premier niveau, sans le bloc
# global ni les fragments « (nom) »).
CADDYFILE="$ROOT/etc/caddy/Caddyfile"
caddy_sites() {
  [[ -f "$CADDYFILE" ]] || return 0
  awk '
    { line=$0; sub(/#.*/, "", line) }
    depth==0 && line ~ /\{[[:space:]]*$/ {
      head=line; sub(/\{[[:space:]]*$/, "", head); gsub(/^[[:space:]]+|[[:space:]]+$/, "", head)
      if (head != "" && head !~ /^\(/) { n=split(head, a, /[ ,]+/); for (i=1;i<=n;i++) if (a[i]!="") print a[i] }
    }
    { o=gsub(/\{/, "{", line); c=gsub(/\}/, "}", line); depth+=o-c }
  ' "$CADDYFILE"
}
OTHER_SITES=""
while read -r _s; do
  [[ -z "$_s" ]] && continue
  _h="${_s#http://}"; _h="${_h#https://}"
  [[ "$_h" == ":80" || ( -n "$DOMAIN" && "$_h" == "$DOMAIN" ) ]] || OTHER_SITES+="$_s "
done < <(caddy_sites)
CADDY_RESUME=false
if have systemctl && systemctl cat caddy 2>/dev/null | grep -q -- '--resume'; then CADDY_RESUME=true; fi

# ═══════════════════════════════════════════════════════════════════════════════
#  2. PLAN ET CONFIRMATION
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${RED}${BOLD}  $(m "DÉSINSTALLATION DE NODYX" "NODYX UNINSTALL")$($DRY && echo " — $(m SIMULATION DRY-RUN)")${RESET}"
echo ""
info "$(m Installation Install) : ${BOLD}$NODYX_REAL${RESET}  ($(m domaine domain) : ${DOMAIN:-?})"
info "$(m "Base PostgreSQL" "PostgreSQL database") : ${BOLD}$DB_NAME${RESET} ($(m utilisateur user) $DB_USER)"
info "$(m "Clés Redis" "Redis keys") : ${BOLD}${REDIS_PREFIX}*${RESET} $(m "seulement" "only")"
if [[ "$OTHER_PM2" == "?" ]]; then
  warn "$(m "Liste PM2 illisible : par prudence, PM2 et l'utilisateur nodyx seront conservés" "PM2 list unreadable: to be safe, PM2 and the nodyx user will be kept")"
elif [[ -n "$OTHER_PM2" ]]; then
  warn "$(m "Autres applications PM2 détectées" "Other PM2 apps detected") : $OTHER_PM2 → $(m "PM2 et l'utilisateur nodyx seront conservés" "PM2 and the nodyx user will be kept")"
fi
[[ -n "$OTHER_SITES" ]] && warn "$(m "Autres sites dans le Caddyfile" "Other sites in the Caddyfile") : $OTHER_SITES→ $(m "le Caddyfile ne sera pas modifié" "the Caddyfile will not be modified")"
$CADDY_RESUME && warn "$(m "Caddy tourne avec une configuration sauvegardée (--resume) : il ne sera pas touché" "Caddy runs from a saved configuration (--resume): it will not be touched")"
echo ""

_expect="${DOMAIN:-nodyx}"
read -r -u 3 -p "$(echo -e "  ${YELLOW}?${RESET} $(m "Pour confirmer, tape" "To confirm, type") ${BOLD}$_expect${RESET} : ")" _typed || _typed=""
[[ "$_typed" == "$_expect" ]] || { echo -e "\n  ${GREEN}$(m "Annulé. Rien n'a été touché." "Cancelled. Nothing was touched.")${RESET}\n"; exit 0; }

# ═══════════════════════════════════════════════════════════════════════════════
#  3. SAUVEGARDE — avant toute destruction
# ═══════════════════════════════════════════════════════════════════════════════
step "$(m Sauvegarde Backup)"
BK="$ROOT/root/nodyx-uninstall-$(date +%Y%m%d-%H%M%S)"
BACKED_UP=false
if ask "$(m "Sauvegarder base, uploads, .env et archives dans $BK (recommandé) ?" "Back up database, uploads, .env and archives to $BK (recommended)?")"; then
  # Assez de place ? (uploads + archives, la base compressée en plus)
  _need_kb="$(du -sk "$NODYX_REAL/nodyx-core/uploads" "$NODYX_REAL/nodyx-core/backups" 2>/dev/null | awk '{s+=$1} END {print s+0}')"
  _free_kb="$(df -Pk "$ROOT/root" 2>/dev/null | awk 'NR==2 {print $4}')"
  if [[ -n "$_free_kb" ]] && (( _need_kb * 12 / 10 > _free_kb )); then
    die "$(m "Pas assez de place pour la sauvegarde ($(( _need_kb / 1024 )) Mo nécessaires, $(( _free_kb / 1024 )) Mo libres). Rien n'a été touché." "Not enough space for the backup ($(( _need_kb / 1024 )) MB needed, $(( _free_kb / 1024 )) MB free). Nothing was touched.")"
  fi
  run mkdir -p "$BK" && run chmod 700 "$BK"
  for _f in nodyx-core/.env nodyx-frontend/.env; do
    [[ -f "$NODYX_REAL/$_f" ]] && run cp -p "$NODYX_REAL/$_f" "$BK/$(echo "$_f" | tr / _)"
  done
  [[ -f "$CADDYFILE" ]] && run cp -p "$CADDYFILE" "$BK/Caddyfile"
  [[ -f "$ROOT/root/nodyx-credentials.txt" ]] && run cp -p "$ROOT/root/nodyx-credentials.txt" "$BK/"
  [[ -d "$NODYX_REAL/nodyx-core/backups" ]] && run cp -a "$NODYX_REAL/nodyx-core/backups" "$BK/archives-nodyx"
  [[ -d "$NODYX_REAL/nodyx-core/uploads" ]] && run tar -czf "$BK/uploads.tar.gz" -C "$NODYX_REAL/nodyx-core" uploads
  if have pg_dump && runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1; then
    if $DRY; then
      run pg_dump -Fc "$DB_NAME" "> $BK/base.dump"
    elif runuser -u postgres -- pg_dump -Fc "$DB_NAME" > "$BK/base.dump" && [[ -s "$BK/base.dump" ]] \
         && pg_restore --list "$BK/base.dump" >/dev/null 2>&1; then
      ok "$(m "Base sauvegardée et relue" "Database backed up and verified") : $BK/base.dump"
    else
      die "$(m "La sauvegarde de la base a échoué. Arrêt : rien n'a été détruit. Sauvegarde partielle dans $BK" "Database backup failed. Stopping: nothing was destroyed. Partial backup in $BK")"
    fi
  fi
  BACKED_UP=true
  ok "$(m "Sauvegarde dans" "Backup in") $BK"
else
  warn "$(m "Pas de sauvegarde : les données supprimées ne pourront pas être récupérées." "No backup: deleted data cannot be recovered.")"
  ask "$(m "Continuer quand même ?" "Continue anyway?")" || { echo -e "\n  ${GREEN}$(m "Annulé. Rien n'a été touché." "Cancelled. Nothing was touched.")${RESET}\n"; exit 0; }
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  4. APPLICATIONS PM2 (sous l'utilisateur nodyx)
# ═══════════════════════════════════════════════════════════════════════════════
step "PM2"
if have pm2 && id nodyx &>/dev/null; then
  for _app in nodyx-core nodyx-frontend; do
    if pm2n describe "$_app" &>/dev/null; then
      run pm2n delete "$_app" >/dev/null && ok "$(m "Application arrêtée et retirée" "App stopped and removed") : $_app" || fail "pm2 delete $_app"
    else
      skip "$_app $(m "absente" "not found")"
    fi
  done
  run pm2n save --force >/dev/null 2>&1 || true
  if [[ -z "$OTHER_PM2" ]]; then
    run pm2n kill >/dev/null 2>&1 || true
    if [[ -f "$ROOT/etc/systemd/system/pm2-nodyx.service" ]]; then
      run systemctl disable --now pm2-nodyx >/dev/null 2>&1 || true
      run rm -f "$ROOT/etc/systemd/system/pm2-nodyx.service"
      ok "$(m "Service de démarrage pm2-nodyx retiré" "pm2-nodyx startup service removed")"
    fi
  else
    skip "$(m "Démon PM2 et pm2-nodyx conservés (autres applications)" "PM2 daemon and pm2-nodyx kept (other apps)")"
  fi
else
  skip "$(m "PM2 ou utilisateur nodyx absent" "PM2 or nodyx user not found")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  5. SERVICES NODYX (systemd) ET PROGRAMMES
# ═══════════════════════════════════════════════════════════════════════════════
step "$(m "Services Nodyx" "Nodyx services")"
for _svc in nodyx-relay-client nodyx-turn nodyx-sfud; do
  if [[ -f "$ROOT/etc/systemd/system/$_svc.service" ]]; then
    run systemctl disable --now "$_svc" >/dev/null 2>&1 || true
    run rm -f "$ROOT/etc/systemd/system/$_svc.service"
    ok "$(m "Service retiré" "Service removed") : $_svc"
  else
    skip "$_svc $(m "absent" "not found")"
  fi
done
for _f in /usr/local/bin/nodyx-relay /usr/local/bin/nodyx-turn /usr/local/bin/nodyx-sfud \
          /usr/local/bin/nodyx-doctor /usr/local/bin/nodyx-update \
          /etc/nodyx-turn.env /etc/nodyx-sfud.env; do
  [[ -e "$ROOT$_f" ]] && { run rm -f "$ROOT$_f"; ok "$(m Supprimé Removed) : $_f"; }
done
run systemctl daemon-reload 2>/dev/null || true

# Tunnel Cloudflare (install_tunnel.sh) : le jeton du tunnel vit dans le service.
if [[ -f "$ROOT/etc/nodyx/tunnel-mode" && -f "$ROOT/etc/systemd/system/cloudflared.service" ]] && have cloudflared; then
  if ask "$(m "Retirer le service du tunnel Cloudflare (cloudflared) et son jeton ?" "Remove the Cloudflare tunnel service (cloudflared) and its token?")"; then
    run cloudflared service uninstall >/dev/null 2>&1 && ok "$(m "Tunnel Cloudflare retiré" "Cloudflare tunnel removed")" || fail "cloudflared service uninstall"
  else
    skip "$(m "Tunnel Cloudflare conservé" "Cloudflare tunnel kept")"
  fi
fi
[[ -d "$ROOT/etc/nodyx" ]] && { run rm -rf "$ROOT/etc/nodyx"; ok "$(m Supprimé Removed) : /etc/nodyx"; }

# ═══════════════════════════════════════════════════════════════════════════════
#  6. CADDY — seulement la configuration de Nodyx
# ═══════════════════════════════════════════════════════════════════════════════
step "Caddy"
if ! have caddy || [[ ! -f "$CADDYFILE" ]]; then
  skip "$(m "Caddy absent" "Caddy not found")"
elif $CADDY_RESUME || [[ -n "$OTHER_SITES" ]]; then
  warn "$(m "Caddyfile NON modifié (autres sites ou configuration --resume). Retire le bloc de" "Caddyfile NOT modified (other sites or --resume config). Remove the block for") ${DOMAIN:-:80} $(m "à la main" "by hand")."
elif ask "$(m "Désinstaller Caddy (le paquet) ? Non = garder Caddy avec sa page par défaut." "Uninstall Caddy (the package)? No = keep Caddy with its default page.")"; then
  run systemctl disable --now caddy >/dev/null 2>&1 || true
  run apt-get remove -y caddy >/dev/null 2>&1 && ok "$(m "Caddy désinstallé" "Caddy uninstalled")" || fail "apt-get remove caddy"
  run rm -f "$ROOT/etc/apt/sources.list.d/caddy-stable.list"
else
  # Le Caddyfile ne servait QUE Nodyx : on remet celui d'origine du paquet,
  # validé avant d'être mis en place.
  _neutral="$(mktemp)"
  printf '# Nodyx désinstallé le %s. Ancien fichier : %s\n:80 {\n\troot * /usr/share/caddy\n\tfile_server\n}\n' \
    "$(date +%F)" "$($BACKED_UP && echo "$BK/Caddyfile" || echo "-")" > "$_neutral"
  if caddy validate --config "$_neutral" --adapter caddyfile >/dev/null 2>&1; then
    run install -m 644 "$_neutral" "$CADDYFILE"
    run systemctl reload caddy >/dev/null 2>&1 && ok "$(m "Caddyfile remis à sa page par défaut" "Caddyfile reset to its default page")" || fail "systemctl reload caddy"
  else
    fail "$(m "Caddyfile neutre refusé par caddy validate : Caddyfile laissé tel quel" "Neutral Caddyfile rejected by caddy validate: Caddyfile left as is")"
  fi
  rm -f "$_neutral"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  7. REDIS — seulement les clés de Nodyx
# ═══════════════════════════════════════════════════════════════════════════════
step "Redis"
if have redis-cli && redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping 2>/dev/null | grep -q PONG; then
  _n="$(redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --scan --pattern "${REDIS_PREFIX}*" | wc -l)"
  if (( _n == 0 )); then
    skip "$(m "Aucune clé" "No keys") ${REDIS_PREFIX}*"
  elif $DRY; then
    run redis-cli --scan --pattern "${REDIS_PREFIX}*" "| xargs redis-cli unlink   ($_n $(m clés keys))"
  else
    redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" --scan --pattern "${REDIS_PREFIX}*" \
      | xargs -r -n 500 redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" unlink >/dev/null \
      && ok "$_n $(m "clés" "keys") ${REDIS_PREFIX}* $(m supprimées removed)" || fail "redis unlink ${REDIS_PREFIX}*"
  fi
  skip "$(m "Le serveur Redis est conservé (il peut servir à d'autres applications)" "The Redis server is kept (other apps may use it)")"
else
  skip "$(m "Redis injoignable ou absent" "Redis unreachable or not installed")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  8. POSTGRESQL — la base et l'utilisateur de Nodyx
# ═══════════════════════════════════════════════════════════════════════════════
step "PostgreSQL"
pgq() { runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "$1"; }
if have psql && pgq "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" 2>/dev/null | grep -q 1; then
  if ask "$(m "Supprimer la base « $DB_NAME » et l'utilisateur « $DB_USER » ?" "Drop database \"$DB_NAME\" and user \"$DB_USER\"?")"; then
    run pgq "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME' AND pid <> pg_backend_pid();" >/dev/null 2>&1 || true
    run pgq "DROP DATABASE IF EXISTS \"$DB_NAME\";" >/dev/null && ok "$(m "Base supprimée" "Database dropped") : $DB_NAME" || fail "DROP DATABASE $DB_NAME"
    # Échoue proprement si l'utilisateur possède encore autre chose : on ne force pas.
    run pgq "DROP ROLE IF EXISTS \"$DB_USER\";" >/dev/null 2>&1 && ok "$(m "Utilisateur supprimé" "User dropped") : $DB_USER" \
      || warn "$(m "Utilisateur $DB_USER conservé : il possède encore d'autres objets" "User $DB_USER kept: it still owns other objects")"
  else
    skip "$(m "Base conservée" "Database kept")"
  fi
  _others="$(pgq "SELECT string_agg(datname, ' ') FROM pg_database WHERE datname NOT IN ('postgres','template0','template1','$DB_NAME')" 2>/dev/null || echo "?")"
  skip "$(m "Le serveur PostgreSQL est conservé" "The PostgreSQL server is kept")${_others:+ ($(m "autres bases" "other databases") : $_others)}"
else
  skip "$(m "Base $DB_NAME absente" "Database $DB_NAME not found")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  9. PARE-FEU — seulement les ports propres à Nodyx
# ═══════════════════════════════════════════════════════════════════════════════
step "$(m "Pare-feu (UFW)" "Firewall (UFW)")"
# Jamais : ufw reset, changement de politique par défaut, ni la règle SSH.
if have ufw && ufw status 2>/dev/null | grep -q "Status: active"; then
  _st="$(ufw status 2>/dev/null)"
  _removed=0
  for _r in 3478/tcp 3478/udp 5349/tcp 5349/udp 49152:65535/udp 40000:40999/udp 40000:40999/tcp; do
    if grep -qE "^${_r}[[:space:]]+ALLOW" <<<"$_st"; then
      run ufw --force delete allow "$_r" >/dev/null 2>&1 && _removed=$((_removed+1)) || fail "ufw delete allow $_r"
    fi
  done
  ok "$(m "Règles vocales/TURN de Nodyx retirées" "Nodyx voice/TURN rules removed") : $_removed"
  if grep -qE "^(80|443)/tcp[[:space:]]+ALLOW" <<<"$_st"; then
    if ask "$(m "Fermer aussi les ports web 80 et 443 ? (Non si un autre site les utilise)" "Also close web ports 80 and 443? (No if another site uses them)")"; then
      for _r in 80/tcp 443/tcp; do run ufw --force delete allow "$_r" >/dev/null 2>&1 || fail "ufw delete allow $_r"; done
      ok "$(m "Ports 80 et 443 fermés" "Ports 80 and 443 closed")"
    else
      skip "$(m "Ports 80 et 443 conservés" "Ports 80 and 443 kept")"
    fi
  fi
  skip "$(m "Règle SSH et politique par défaut inchangées" "SSH rule and default policy unchanged")"
else
  skip "$(m "UFW inactif" "UFW inactive")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  10. FICHIERS
# ═══════════════════════════════════════════════════════════════════════════════
step "$(m Fichiers Files)"
if ask "$(m "Supprimer le dossier" "Delete the folder") ${BOLD}$NODYX_REAL${RESET} ?"; then
  run rm -rf --one-file-system -- "$NODYX_REAL" && ok "$(m Supprimé Removed) : $NODYX_REAL" || fail "rm -rf $NODYX_REAL"
else
  skip "$NODYX_REAL $(m conservé kept)"
fi
if [[ -f "$ROOT/root/nodyx-credentials.txt" ]]; then
  if ask "$(m "Supprimer /root/nodyx-credentials.txt (identifiants admin) ?" "Delete /root/nodyx-credentials.txt (admin credentials)?")"; then
    run rm -f "$ROOT/root/nodyx-credentials.txt" && ok "$(m Supprimé Removed) : /root/nodyx-credentials.txt"
  fi
fi

# Utilisateur système : seulement si plus rien ne tourne sous son nom.
if id nodyx &>/dev/null && [[ -z "$OTHER_PM2" ]]; then
  if pgrep -u nodyx &>/dev/null && ! $DRY; then
    warn "$(m "Des processus tournent encore sous l'utilisateur nodyx : utilisateur conservé" "Processes still run as nodyx: user kept")"
  elif ask "$(m "Supprimer l'utilisateur système nodyx et /home/nodyx (journaux PM2) ?" "Delete the nodyx system user and /home/nodyx (PM2 logs)?")"; then
    run userdel -r nodyx >/dev/null 2>&1 && ok "$(m "Utilisateur nodyx supprimé" "nodyx user removed")" || fail "userdel -r nodyx"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  BILAN — jamais « terminé » sur un échec
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
$BACKED_UP && info "$(m "Sauvegarde" "Backup") : ${BOLD}$BK${RESET}"
compgen -G "$ROOT/root/nodyx-db-backup-*" >/dev/null && info "$(m "Sauvegardes faites par install.sh, conservées" "Backups made by install.sh, kept") : /root/nodyx-db-backup-*"
[[ -f "$ROOT/swapfile" ]] && info "$(m "Le fichier d'échange /swapfile est conservé" "The /swapfile is kept")"
if $DRY; then
  echo -e "\n  ${CYAN}$(m "Simulation terminée : rien n'a été modifié." "Dry run finished: nothing was changed.")${RESET}\n"
elif (( ${#FAILS[@]} )); then
  echo -e "\n  ${RED}${BOLD}$(m "Désinstallation INCOMPLÈTE" "Uninstall INCOMPLETE")${RESET} — ${#FAILS[@]} $(m "étape(s) en échec" "step(s) failed") :"
  for _f in "${FAILS[@]}"; do echo "    - $_f"; done
  echo ""; exit 1
else
  echo -e "\n  ${GREEN}${BOLD}$(m "Nodyx a été retiré de ce serveur." "Nodyx has been removed from this server.")${RESET}"
  echo -e "  $(m "Pour réinstaller" "To reinstall") : ${CYAN}git clone https://github.com/Pokled/nodyx.git && cd nodyx && sudo bash install.sh${RESET}\n"
fi
