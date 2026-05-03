#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Nodyx - Cloudflare Tunnel installer / Installeur Cloudflare Tunnel
#  Ubuntu 22.04 / 24.04  ·  Debian 11 / 12 / 13  ·  ARM64 supported
#
#  For home servers behind NAT - no port 80/443 needed, outbound tunnel only.
#  Pour serveurs derrière NAT - pas de port 80/443 à ouvrir, tunnel sortant.
#
#  ── Install (recommended) ──────────────────────────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash
#
#  ── Upgrade ────────────────────────────────────────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash -s -- --upgrade
#
#  ── Help ───────────────────────────────────────────────────────────────────
#
#    sudo bash install_tunnel.sh --help
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

INSTALLER_VERSION="1.1.0"

# ── Tempfile cleanup ──────────────────────────────────────────────────────────
# Every mktemp we issue is registered here so the EXIT trap can wipe it on a
# crash, Ctrl-C, or normal exit. Avoids /tmp filling up with .log files from
# repeated --repair / --upgrade runs and from interrupted installs.
declare -a _TEMP_FILES=()
_register_temp() { _TEMP_FILES+=("$1"); }
_cleanup_on_exit() {
  local rc=$?
  set +e
  for f in "${_TEMP_FILES[@]:-}"; do
    [[ -n "$f" ]] && rm -f "$f" 2>/dev/null
  done
  # If we were re-launched via curl|bash, the spawning shell wrote our own
  # source to /tmp/nodyx_tunnel_XXXXXX.sh and exec'd into us. Clean that up.
  if [[ "${BASH_SOURCE[0]:-}" == /tmp/nodyx_tunnel_*.sh ]]; then
    rm -f "${BASH_SOURCE[0]}" 2>/dev/null
  fi
  exit "$rc"
}
trap _cleanup_on_exit EXIT

# ── Auto-relaunch if stdin is piped (curl|bash) ───────────────────────────────
if [[ ! -t 0 ]]; then
  _SELF=$(mktemp /tmp/nodyx_tunnel_XXXXXX.sh)
  curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh -o "$_SELF" 2>/dev/null \
    || wget -qO "$_SELF" https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh
  # Drain remaining stdin so the upstream curl finishes writing into its pipe
  # before we exec — otherwise curl exits with code 23 (write to closed pipe).
  cat >/dev/null 2>&1 || true
  exec bash "$_SELF" "$@" </dev/tty
fi

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── i18n ──────────────────────────────────────────────────────────────────────
# Priority: --lang=  >  NODYX_LANG env  >  LANG auto-detect (fr*→fr)  >  en
# Lookup chain: T_FR[k] → T_EN[k] → key (so missing strings stay visible)
NODYX_LANG="${NODYX_LANG:-}"
for _arg in "$@"; do
  case "$_arg" in
    --lang=*) NODYX_LANG="${_arg#*=}" ;;
    --lang)   echo "Error: use --lang=en or --lang=fr (with =)" >&2; exit 1 ;;
  esac
done
if [[ -z "$NODYX_LANG" ]]; then
  case "${LANG:-}" in
    fr*|FR*) NODYX_LANG=fr ;;
    *)       NODYX_LANG=en ;;
  esac
fi
case "$NODYX_LANG" in en|fr) ;; *) NODYX_LANG=en ;; esac
export NODYX_LANG

declare -A T_EN T_FR

# ── Translations ──────────────────────────────────────────────────────────────
# §1 - Banner / help
T_EN[banner_subtitle]='Tunnel Installer v%s · Forum · Chat · Voice · Canvas'
T_FR[banner_subtitle]='Installeur Tunnel v%s · Forum · Chat · Voice · Canvas'
T_EN[banner_mode]='Cloudflare Tunnel mode - zero open ports, AGPL-3.0'
T_FR[banner_mode]='Mode Cloudflare Tunnel - zéro port ouvert, AGPL-3.0'

T_EN[help_usage]='  Usage: bash install_tunnel.sh [OPTIONS]'
T_FR[help_usage]='  Utilisation : bash install_tunnel.sh [OPTIONS]'
T_EN[help_modes_header]='  Modes (skip detection menu):'
T_FR[help_modes_header]='  Modes (bypass du menu de détection) :'
T_EN[help_upgrade]='    --upgrade          Update existing instance (rebuild+restart)'
T_FR[help_upgrade]="    --upgrade          Mettre à jour l'instance existante (rebuild+restart)"
T_EN[help_repair]='    --repair           Repair without reconfiguring (rebuild+restart)'
T_FR[help_repair]='    --repair           Réparer sans reconfigurer (rebuild+restart)'
T_EN[help_reinstall]='    --reinstall        Reinstall while preserving the DB'
T_FR[help_reinstall]='    --reinstall        Réinstaller en préservant la DB'
T_EN[help_wipe]='    --wipe             Reinstall + erase the DB (DANGER)'
T_FR[help_wipe]='    --wipe             Réinstaller + effacer la DB (DANGER)'
T_EN[help_config_header]='  Configuration (skip prompts):'
T_FR[help_config_header]='  Configuration (évite les prompts) :'
T_EN[help_domain]='    --domain=DOMAIN         Public domain managed by Cloudflare'
T_FR[help_domain]='    --domain=DOMAIN         Domaine public géré par Cloudflare'
T_EN[help_tunnel]='    --tunnel=cf|pangolin|none  Reverse-tunnel provider (default: ask)'
T_FR[help_tunnel]='    --tunnel=cf|pangolin|none  Fournisseur du tunnel inverse (défaut : demande)'
T_EN[help_token]='    --tunnel-token=TOKEN    Cloudflare Tunnel token (cf mode only)'
T_FR[help_token]='    --tunnel-token=TOKEN    Token du tunnel Cloudflare (mode cf uniquement)'
T_EN[help_slug]='    --slug=SLUG             Community identifier'
T_FR[help_slug]='    --slug=SLUG             Identifiant de la communauté'
T_EN[help_name]='    --name=NAME             Community name'
T_FR[help_name]='    --name=NAME             Nom de la communauté'
T_EN[help_admin_user]='    --admin-user=USER       Admin username'
T_FR[help_admin_user]="    --admin-user=USER       Nom d'utilisateur admin"
T_EN[help_admin_email]='    --admin-email=EMAIL     Admin email'
T_FR[help_admin_email]='    --admin-email=EMAIL     Email admin'
T_EN[help_admin_pass]='    --admin-password=PASS   Admin password'
T_FR[help_admin_pass]='    --admin-password=PASS   Mot de passe admin'
T_EN[help_options_header]='  Options:'
T_FR[help_options_header]='  Options :'
T_EN[help_yes]='    --yes, -y          Auto-confirm all prompts'
T_FR[help_yes]='    --yes, -y          Répondre oui à toutes les confirmations'
T_EN[help_lang]='    --lang=en|fr       UI language (default: auto from $LANG)'
T_FR[help_lang]='    --lang=en|fr       Langue (défaut : auto via $LANG)'
T_EN[help_help]='    --help             Show this help'
T_FR[help_help]='    --help             Afficher cette aide'
T_EN[unknown_flag]='Unknown flag: %s (ignored)'
T_FR[unknown_flag]='Flag inconnu : %s (ignoré)'

# §2 - Preflight
T_EN[err_root]='Run this script as root: sudo bash install_tunnel.sh'
T_FR[err_root]='Lance ce script en root : sudo bash install_tunnel.sh'
T_EN[err_os]='Unsupported OS. Use Ubuntu 22.04/24.04 or Debian 11/12/13.'
T_FR[err_os]='OS non supporté. Utilise Ubuntu 22.04/24.04 ou Debian 11/12/13.'
T_EN[err_arch]='Unsupported architecture: %s (need amd64 or arm64)'
T_FR[err_arch]='Architecture non supportée : %s (besoin de amd64 ou arm64)'
T_EN[ram_low]='Free RAM low: %s MB (recommended: 512+ MB)'
T_FR[ram_low]='RAM disponible faible : %s MB (recommandé : 512+ MB)'
T_EN[ram_swap_hint]='Tip: sudo fallocate -l 1G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile'
T_FR[ram_swap_hint]='Astuce : sudo fallocate -l 1G /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile'
T_EN[continue_anyway]='Continue anyway?'
T_FR[continue_anyway]='Continuer quand même ?'
T_EN[disk_low]='Free disk on /opt low: %s MB (recommended: 1+ GB)'
T_FR[disk_low]="Espace disque faible sur /opt : %s MB (recommandé : 1+ GB)"
T_EN[install_cancelled]='Installation cancelled.'
T_FR[install_cancelled]='Installation annulée.'

# §3 - Detection menu
T_EN[detect_existing]='Existing Nodyx installation detected (%s)'
T_FR[detect_existing]='Installation Nodyx existante détectée (%s)'
T_EN[detect_choose]='What would you like to do?'
T_FR[detect_choose]='Que souhaites-tu faire ?'
T_EN[detect_1]='1. Update    - git pull + rebuild + restart (keep config)'
T_FR[detect_1]='1. Mise à jour - git pull + rebuild + restart (garde la config)'
T_EN[detect_2]='2. Repair    - rebuild + restart (no config change)'
T_FR[detect_2]='2. Réparation  - rebuild + restart (sans toucher la config)'
T_EN[detect_3]='3. Reinstall - clean install, keep the database'
T_FR[detect_3]='3. Réinstaller - install propre, garde la base de données'
T_EN[detect_4]='4. Wipe      - reinstall + ERASE the database (DANGER)'
T_FR[detect_4]='4. Wipe        - réinstaller + EFFACER la base (DANGER)'
T_EN[detect_5]='5. Cancel'
T_FR[detect_5]='5. Annuler'
T_EN[detect_prompt]='Choice [1-5]'
T_FR[detect_prompt]='Choix [1-5]'

# §4 - Steps
T_EN[step_prereq]='Cloudflare Tunnel prerequisites'
T_FR[step_prereq]='Prérequis Cloudflare Tunnel'
T_EN[step_config]='Configure your instance'
T_FR[step_config]='Configuration de ton instance'
T_EN[step_packages]='Installing system packages'
T_FR[step_packages]='Installation des paquets système'
T_EN[step_pg]='Configuring PostgreSQL'
T_FR[step_pg]='Configuration de PostgreSQL'
T_EN[step_redis]='Configuring Redis'
T_FR[step_redis]='Configuration de Redis'
T_EN[step_user]='Creating system user'
T_FR[step_user]='Création de l’utilisateur système'
T_EN[step_clone]='Fetching Nodyx source'
T_FR[step_clone]='Récupération du code Nodyx'
T_EN[step_backend]='Building backend (nodyx-core)'
T_FR[step_backend]='Build du backend (nodyx-core)'
T_EN[step_frontend]='Building frontend (nodyx-frontend)'
T_FR[step_frontend]='Build du frontend (nodyx-frontend)'
T_EN[step_caddy]='Configuring Caddy (HTTP-only behind tunnel)'
T_FR[step_caddy]='Configuration de Caddy (HTTP local derrière tunnel)'
T_EN[step_pm2]='Configuring PM2'
T_FR[step_pm2]='Configuration de PM2'
T_EN[step_firewall]='Configuring firewall (UFW)'
T_FR[step_firewall]='Configuration du pare-feu (UFW)'
T_EN[step_cf_install]='Installing cloudflared'
T_FR[step_cf_install]='Installation de cloudflared'
T_EN[step_cf_register]='Registering Cloudflare Tunnel service'
T_FR[step_cf_register]='Enregistrement du service Cloudflare Tunnel'
T_EN[step_bootstrap]='Bootstrapping community + admin account'
T_FR[step_bootstrap]='Création de la communauté + compte admin'
T_EN[step_helpers]='Installing helper scripts'
T_FR[step_helpers]='Installation des scripts utilitaires'
T_EN[step_healthcheck]='Post-install health check'
T_FR[step_healthcheck]='Vérification post-installation'

# §5 - Config prompts
T_EN[cfg_community_name]='Community name (e.g. Mamie’s Knitting Club)'
T_FR[cfg_community_name]='Nom de la communauté (ex : Club Tricot de Mamie)'
T_EN[cfg_slug]='Unique identifier (slug)'
T_FR[cfg_slug]='Identifiant unique (slug)'
T_EN[cfg_lang]='Main language (fr/en/de/es/it/pt)'
T_FR[cfg_lang]='Langue principale (fr/en/de/es/it/pt)'
T_EN[cfg_domain_header]='Public domain'
T_FR[cfg_domain_header]='Domaine public'
T_EN[cfg_domain_help]='Domain visitors will use to reach this server. DNS setup depends on the tunnel mode you pick next. Examples: club.example.com'
T_FR[cfg_domain_help]='Domaine que les visiteurs utiliseront pour atteindre ce serveur. La config DNS dépend du tunnel choisi à l''étape suivante. Ex : club.example.com'
T_EN[cfg_domain_prompt]='Domain'
T_FR[cfg_domain_prompt]='Domaine'
T_EN[cfg_domain_invalid]='‘%s’ doesn’t look like a valid domain (no dot).'
T_FR[cfg_domain_invalid]='‘%s’ ne ressemble pas à un domaine valide (pas de point).'
T_EN[cfg_admin_header]='Admin account'
T_FR[cfg_admin_header]='Compte administrateur'
T_EN[cfg_admin_user]='Admin username'
T_FR[cfg_admin_user]='Nom d’utilisateur admin'
T_EN[cfg_admin_email]='Admin email'
T_FR[cfg_admin_email]='Email admin'
T_EN[cfg_admin_pass]='Admin password'
T_FR[cfg_admin_pass]='Mot de passe admin'
T_EN[cfg_token_header]='Cloudflare Tunnel token'
T_FR[cfg_token_header]='Token Cloudflare Tunnel'
T_EN[cfg_token_help1]='1. Open  https://one.dash.cloudflare.com'
T_FR[cfg_token_help1]='1. Ouvre https://one.dash.cloudflare.com'
T_EN[cfg_token_help2]='2. Networks > Tunnels > Create a tunnel > Cloudflared'
T_FR[cfg_token_help2]='2. Networks > Tunnels > Create a tunnel > Cloudflared'
T_EN[cfg_token_help3]='3. Name your tunnel, save, copy the install token'
T_FR[cfg_token_help3]='3. Nomme le tunnel, sauvegarde, copie le token d’installation'
T_EN[cfg_token_prompt]='Tunnel install token'
T_FR[cfg_token_prompt]='Token d’installation du tunnel'
T_EN[cfg_token_short]='Token looks too short (got %s chars). Make sure you copied the whole string.'
T_FR[cfg_token_short]='Le token semble trop court (%s caractères). Vérifie que tu as bien copié la chaîne complète.'

# §5b - Tunnel mode selection
T_EN[cfg_tunnel_header]='Reverse tunnel provider'
T_FR[cfg_tunnel_header]='Fournisseur du tunnel inverse'
T_EN[cfg_tunnel_help]='Pick how the public traffic reaches this server.'
T_FR[cfg_tunnel_help]='Choisis comment le trafic public arrive jusqu''à ce serveur.'
T_EN[cfg_tunnel_cf]='1. Cloudflare Tunnel (cloudflared, token-based, easiest)'
T_FR[cfg_tunnel_cf]='1. Cloudflare Tunnel (cloudflared, par token, le plus simple)'
T_EN[cfg_tunnel_pangolin]='2. Pangolin (self-hosted, you run newt; no Cloudflare dependency)'
T_FR[cfg_tunnel_pangolin]='2. Pangolin (auto-hébergé, tu fais tourner newt; pas de Cloudflare)'
T_EN[cfg_tunnel_none]='3. None / custom (frp, rathole, headscale, your own VPS reverse proxy)'
T_FR[cfg_tunnel_none]='3. Aucun / custom (frp, rathole, headscale, ton propre reverse proxy VPS)'
T_EN[cfg_tunnel_prompt]='Choice [1-3]'
T_FR[cfg_tunnel_prompt]='Choix [1-3]'
T_EN[cfg_tunnel_invalid]='Invalid tunnel mode: %s (use cf, pangolin or none)'
T_FR[cfg_tunnel_invalid]='Mode tunnel invalide : %s (utilise cf, pangolin ou none)'
T_EN[cfg_tunnel_cf_note]='Cloudflare Tunnel: your domain MUST be on Cloudflare nameservers (cloudflared sets up DNS for you).'
T_FR[cfg_tunnel_cf_note]='Cloudflare Tunnel : ton domaine DOIT être sur les nameservers Cloudflare (cloudflared configure le DNS pour toi).'
T_EN[cfg_tunnel_pangolin_note]='Pangolin: this script configures Caddy + real-IP forwarding. Install newt yourself afterwards (instructions in summary).'
T_FR[cfg_tunnel_pangolin_note]='Pangolin : ce script configure Caddy + forwarding de la vraie IP. Installe newt toi-même ensuite (instructions dans le récap).'
T_EN[cfg_tunnel_none_note]='Custom: this script configures Caddy on localhost:80 with trusted-proxy headers. Wire your own tunnel to it.'
T_FR[cfg_tunnel_none_note]='Custom : ce script configure Caddy sur localhost:80 avec les headers trusted-proxy. Branche ton propre tunnel dessus.'
T_EN[cfg_recap]='Summary'
T_FR[cfg_recap]='Récapitulatif'
T_EN[cfg_recap_mode]='Mode'
T_FR[cfg_recap_mode]='Mode'
T_EN[cfg_recap_domain]='Domain'
T_FR[cfg_recap_domain]='Domaine'
T_EN[cfg_recap_community]='Community'
T_FR[cfg_recap_community]='Communauté'
T_EN[cfg_recap_lang]='Language'
T_FR[cfg_recap_lang]='Langue'
T_EN[cfg_recap_admin]='Admin'
T_FR[cfg_recap_admin]='Admin'
T_EN[cfg_recap_proceed]='All good? Start install?'
T_FR[cfg_recap_proceed]='Tout est bon ? On lance ?'

# §6 - Confirm helpers
T_EN[confirm_yn]='[Y/n]'
T_FR[confirm_yn]='[O/n]'
T_EN[confirm_auto_yes]='%s → yes (--yes)'
T_FR[confirm_auto_yes]='%s → oui (--yes)'

# §7 - Helper scripts / paths
T_EN[update_script_made]='Update script: %ssudo nodyx-update%s'
T_FR[update_script_made]='Script de mise à jour : %ssudo nodyx-update%s'
T_EN[doctor_script_made]='Doctor script: %ssudo nodyx-doctor%s'
T_FR[doctor_script_made]='Script de diagnostic : %ssudo nodyx-doctor%s'
T_EN[creds_saved]='Credentials saved in: %s'
T_FR[creds_saved]='Credentials sauvegardés dans : %s'

# §8 - Healthcheck + summary
T_EN[hc_services]='System services'
T_FR[hc_services]='Services système'
T_EN[hc_pm2]='Nodyx (PM2)'
T_FR[hc_pm2]='Nodyx (PM2)'
T_EN[hc_tunnel]='Cloudflare Tunnel'
T_FR[hc_tunnel]='Tunnel Cloudflare'
T_EN[hc_dns_ok]='DNS %s → %s'
T_FR[hc_dns_ok]='DNS %s → %s'
T_EN[hc_dns_pending]='DNS %s not yet resolved (CF propagation, ~1 min)'
T_FR[hc_dns_pending]='DNS %s pas encore résolu (propagation CF, ~1 min)'
T_EN[hc_https_ok]='HTTPS %s → OK via Cloudflare Tunnel'
T_FR[hc_https_ok]='HTTPS %s → OK via Cloudflare Tunnel'
T_EN[hc_https_wait]='HTTPS %s not yet reachable (tunnel propagation)'
T_FR[hc_https_wait]='HTTPS %s pas encore joignable (propagation du tunnel)'
T_EN[hc_score_green]='✔  %s/%s checks, all green!'
T_FR[hc_score_green]='✔  %s/%s vérifications, tout est au vert !'
T_EN[hc_score_warn]='⚠  %s/%s OK, %s warning(s)'
T_FR[hc_score_warn]='⚠  %s/%s OK, %s avertissement(s)'
T_EN[hc_score_fail]='✘  %s/%s OK, %s error(s), %s warning(s)'
T_FR[hc_score_fail]='✘  %s/%s OK, %s erreur(s), %s avertissement(s)'
T_EN[summary_title]='✔  Nodyx installed via Cloudflare Tunnel!'
T_FR[summary_title]='✔  Nodyx installé via Cloudflare Tunnel !'
T_EN[summary_url]='Instance'
T_FR[summary_url]='Instance'
T_EN[summary_admin]='Admin'
T_FR[summary_admin]='Admin'
T_EN[summary_voice_warn]='Voice/webcam will use public STUN servers (no UDP exposed via Cloudflare Tunnel).'
T_FR[summary_voice_warn]='Voix/webcam utilisent des serveurs STUN publics (pas d’UDP via Cloudflare Tunnel).'
T_EN[summary_dashboard]='Configure the public hostname in your CF dashboard:'
T_FR[summary_dashboard]='Configure le hostname public dans ton dashboard CF :'
T_EN[summary_dashboard_step1]='1. https://one.dash.cloudflare.com → Networks → Tunnels'
T_FR[summary_dashboard_step1]='1. https://one.dash.cloudflare.com → Networks → Tunnels'
T_EN[summary_dashboard_step2]='2. Click your tunnel → Public Hostname → Add'
T_FR[summary_dashboard_step2]='2. Clique sur ton tunnel → Public Hostname → Add'
T_EN[summary_dashboard_step3]='3. Subdomain (empty), Domain %s, Service HTTP, URL localhost:80'
T_FR[summary_dashboard_step3]='3. Subdomain (vide), Domain %s, Service HTTP, URL localhost:80'

# Mode-aware summary titles
T_EN[summary_title_cf]='✔  Nodyx installed via Cloudflare Tunnel!'
T_FR[summary_title_cf]='✔  Nodyx installé via Cloudflare Tunnel !'
T_EN[summary_title_pangolin]='✔  Nodyx ready for Pangolin!'
T_FR[summary_title_pangolin]='✔  Nodyx prêt pour Pangolin !'
T_EN[summary_title_none]='✔  Nodyx ready (custom tunnel mode)!'
T_FR[summary_title_none]='✔  Nodyx prêt (mode tunnel custom) !'

# Mode-aware voice/UDP warning
T_EN[summary_voice_warn_cf]='Voice/webcam will use public STUN servers (no UDP exposed via Cloudflare Tunnel).'
T_FR[summary_voice_warn_cf]='Voix/webcam utilisent des serveurs STUN publics (pas d’UDP via Cloudflare Tunnel).'
T_EN[summary_voice_warn_pangolin]='Voice/webcam need a UDP route. Use Pangolin "raw resources" or a dedicated nodyx-relay for UDP/3478.'
T_FR[summary_voice_warn_pangolin]='Voix/webcam nécessitent un chemin UDP. Utilise les "raw resources" Pangolin ou un nodyx-relay dédié pour UDP/3478.'
T_EN[summary_voice_warn_none]='Voice/webcam need a UDP route. Make sure your reverse tunnel forwards UDP/3478 (TURN) and the WebRTC ports.'
T_FR[summary_voice_warn_none]='Voix/webcam nécessitent un chemin UDP. Vérifie que ton tunnel transporte UDP/3478 (TURN) et les ports WebRTC.'

# Pangolin next-steps. Two newt deployment modes are explicitly supported:
#   - --network host  → newt shares the host netns; resource target = localhost:80
#   - default bridge  → newt runs in its own netns; resource target = host LAN IP:80
# Both rely on Caddy now binding on loopback AND the LAN IP (see Caddyfile section).
T_EN[summary_pangolin_header]='Next steps - connect this server to Pangolin:'
T_FR[summary_pangolin_header]='Prochaines étapes - connecter ce serveur à Pangolin :'
T_EN[summary_pangolin_s1]='1. On your Pangolin dashboard, create a Site (newt) and copy: ENDPOINT, NEWT_ID, NEWT_SECRET'
T_FR[summary_pangolin_s1]='1. Sur ton dashboard Pangolin, crée un Site (newt) et copie : ENDPOINT, NEWT_ID, NEWT_SECRET'
T_EN[summary_pangolin_s2]='2. Run newt on this server. Pick ONE of the two methods below:'
T_FR[summary_pangolin_s2]='2. Lance newt sur ce serveur. Choisis UNE des deux méthodes ci-dessous :'
T_EN[summary_pangolin_method_a]='A. Recommended - newt in --network host (target: http://localhost:80)'
T_FR[summary_pangolin_method_a]='A. Recommandé - newt en --network host (cible : http://localhost:80)'
T_EN[summary_pangolin_method_b]='B. Default Docker bridge (target: http://%s:80)'
T_FR[summary_pangolin_method_b]='B. Bridge Docker par défaut (cible : http://%s:80)'
T_EN[summary_pangolin_method_b_nohost]='B. Default Docker bridge (target: http://<host-LAN-IP>:80 - LAN IP not auto-detected)'
T_FR[summary_pangolin_method_b_nohost]='B. Bridge Docker par défaut (cible : http://<IP-LAN>:80 - IP LAN non détectée)'
T_EN[summary_pangolin_s3]='3. In Pangolin: HTTP resource for %s, target as printed above for the method you picked.'
T_FR[summary_pangolin_s3]='3. Sur Pangolin : ressource HTTP pour %s, cible imprimée ci-dessus pour la méthode choisie.'
T_EN[summary_pangolin_test]='Quick connectivity test (run on this server):'
T_FR[summary_pangolin_test]='Test de connectivité rapide (à lancer sur ce serveur) :'

# None / custom tunnel next-steps
T_EN[summary_none_header]='Next steps - point your reverse tunnel to this server:'
T_FR[summary_none_header]='Prochaines étapes - pointe ton reverse tunnel vers ce serveur :'
T_EN[summary_none_s1]='1. Caddy listens on http://127.0.0.1:80 - forward HTTP traffic for %s there.'
T_FR[summary_none_s1]='1. Caddy écoute sur http://127.0.0.1:80 - redirige le trafic HTTP de %s ici.'
T_EN[summary_none_s2]='2. Real client IP is read from X-Forwarded-For (already trusted by Caddy).'
T_FR[summary_none_s2]='2. L’IP client réelle est lue depuis X-Forwarded-For (déjà autorisé côté Caddy).'

# §9 - Upgrade fast path
T_EN[upgrade_title]='Updating Nodyx'
T_FR[upgrade_title]='Mise à jour Nodyx'
T_EN[repair_title]='Repairing Nodyx'
T_FR[repair_title]='Réparation Nodyx'
T_EN[code_fetch]='Fetching code...'
T_FR[code_fetch]='Récupération du code...'
T_EN[git_pull_fail]='git pull failed.'
T_FR[git_pull_fail]='git pull échoué.'
T_EN[code_uptodate]='Code up to date'
T_FR[code_uptodate]='Code à jour'
T_EN[backend_rebuild]='Rebuilding backend...'
T_FR[backend_rebuild]='Rebuild backend...'
T_EN[backend_built]='Backend compiled'
T_FR[backend_built]='Backend compilé'
T_EN[frontend_rebuild]='Rebuilding frontend...'
T_FR[frontend_rebuild]='Rebuild frontend...'
T_EN[frontend_built]='Frontend compiled'
T_FR[frontend_built]='Frontend compilé'
T_EN[services_restart]='Restarting services...'
T_FR[services_restart]='Redémarrage des services...'
T_EN[upgrade_done]='Nodyx operational'
T_FR[upgrade_done]='Nodyx opérationnel'

# §10 - Auto-backup DB
T_EN[db_autobackup]='Automatic DB backup (%s)...'
T_FR[db_autobackup]='Sauvegarde automatique de la DB (%s)...'
T_EN[db_autobackup_done]='Backup: %s  (%s)'
T_FR[db_autobackup_done]='Sauvegarde : %s  (%s)'
T_EN[db_autobackup_fail]='DB backup failed (DB empty or inaccessible) : continuing.'
T_FR[db_autobackup_fail]='Sauvegarde DB échouée (DB vide ou inaccessible) : on continue.'

# ── t() lookup with FR → EN → key fallback ──────────────────────────────────
t() {
  local k="$1"
  if [[ "$NODYX_LANG" == "fr" && -n "${T_FR[$k]:-}" ]]; then
    printf '%s' "${T_FR[$k]}"
  elif [[ -n "${T_EN[$k]:-}" ]]; then
    printf '%s' "${T_EN[$k]}"
  else
    printf '%s' "$k"
  fi
}

# ── Logging ───────────────────────────────────────────────────────────────────
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
die()  { echo -e "\n${RED}${BOLD}✘${RESET}  ${RED}$*${RESET}\n" >&2; exit 1; }
step() { echo ""; echo -e "${BOLD}━━━  $*  ━━━${RESET}"; }

_HC_SPIN=('⠋' '⠙' '⠹' '⠸' '⠼' '⠴' '⠦' '⠧' '⠇' '⠏')

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
    echo -e "  ${RED}✘${RESET}  $label"
    echo -e "  ${YELLOW}── last lines / dernières lignes ──${RESET}"
    tail -25 "$log" | sed 's/^/     /'
  fi
  rm -f "$log"
  return $rc
}

banner() {
  echo -e "${BOLD}${CYAN}"
  cat <<'EOF'
  ███╗   ██╗ ██████╗ ██████╗ ██╗   ██╗██╗  ██╗
  ████╗  ██║██╔═══██╗██╔═══██╗██║   ██║╚██╗██╔╝
  ██╔██╗ ██║██║   ██║██║   ██║██║ ██╗██║ ╚███╔╝
  ██║╚██╗██║██║   ██║██║   ██║██║ ████╔╝ ██╔██╗
  ██║ ╚████║╚██████╔╝╚██████╔╝╚███╔██╔╝ ██╔╝╚██╗
  ╚═╝  ╚═══╝ ╚═════╝  ╚═════╝  ╚══╝╚═╝  ╚═╝  ╚═╝
EOF
  echo -e "${RESET}"
  printf "  ${BOLD}NODYX${RESET}  $(t banner_subtitle)\n" "$INSTALLER_VERSION"
  echo -e "  $(t banner_mode)"
  echo ""
}

# ── Helpers ───────────────────────────────────────────────────────────────────
gen_secret()  { openssl rand -hex 32; }
gen_pass()    { openssl rand -base64 18 | tr -d '/+='; }
slugify()     { echo "$1" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g'; }

# ── CLI flags ─────────────────────────────────────────────────────────────────
INSTALL_MODE=""        # "" | upgrade | repair | reinstall | wipe
TUNNEL_MODE=""         # "" | cf | pangolin | none
DOMAIN_FLAG=""
TUNNEL_TOKEN_FLAG=""
SLUG_FLAG=""
NAME_FLAG=""
ADMIN_USER_FLAG=""
ADMIN_EMAIL_FLAG=""
ADMIN_PASS_FLAG=""
AUTO_YES=false

show_help() {
  banner
  echo "$(t help_usage)"
  echo ""
  echo "$(t help_modes_header)"
  echo "$(t help_upgrade)"
  echo "$(t help_repair)"
  echo "$(t help_reinstall)"
  echo "$(t help_wipe)"
  echo ""
  echo "$(t help_config_header)"
  echo "$(t help_domain)"
  echo "$(t help_tunnel)"
  echo "$(t help_token)"
  echo "$(t help_slug)"
  echo "$(t help_name)"
  echo "$(t help_admin_user)"
  echo "$(t help_admin_email)"
  echo "$(t help_admin_pass)"
  echo ""
  echo "$(t help_options_header)"
  echo "$(t help_yes)"
  echo "$(t help_lang)"
  echo "$(t help_help)"
  echo ""
  exit 0
}

for _arg in "$@"; do
  case "$_arg" in
    --upgrade)              INSTALL_MODE="upgrade" ;;
    --repair)               INSTALL_MODE="repair" ;;
    --reinstall)            INSTALL_MODE="reinstall" ;;
    --wipe)                 INSTALL_MODE="wipe" ;;
    --yes|-y)               AUTO_YES=true ;;
    --domain=*)             DOMAIN_FLAG="${_arg#*=}" ;;
    --tunnel-token=*)       TUNNEL_TOKEN_FLAG="${_arg#*=}" ;;
    --tunnel=*)             TUNNEL_MODE="${_arg#*=}" ;;
    --slug=*)               SLUG_FLAG="${_arg#*=}" ;;
    --name=*)               NAME_FLAG="${_arg#*=}" ;;
    --admin-user=*)         ADMIN_USER_FLAG="${_arg#*=}" ;;
    --admin-email=*)        ADMIN_EMAIL_FLAG="${_arg#*=}" ;;
    --admin-password=*)     ADMIN_PASS_FLAG="${_arg#*=}" ;;
    --lang=*)               ;;  # already parsed
    --help|-h)              show_help ;;
    *)                      printf "$(t unknown_flag)\n" "$_arg" >&2 ;;
  esac
done

_confirm() {
  local msg="$1"
  if $AUTO_YES; then
    printf "  ${CYAN}?${RESET}  "; printf "$(t confirm_auto_yes)\n" "$msg"
    return 0
  fi
  read -rp "$(echo -e "  ${BOLD}${msg}${RESET} $(t confirm_yn) ")" _ans
  case "${_ans,,}" in
    n|no|non) return 1 ;;
    *)        return 0 ;;
  esac
}

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

# ── Constants ─────────────────────────────────────────────────────────────────
NODYX_DIR="/opt/nodyx"
REPO_URL="https://github.com/Pokled/Nodyx.git"
DB_NAME="nodyx"
DB_USER="nodyx_user"

# ═══════════════════════════════════════════════════════════════════════════════
#  AUTO-BACKUP DB
# ═══════════════════════════════════════════════════════════════════════════════
_auto_backup_db() {
  local mode="$1"
  local backup_dir="/var/backups/nodyx"
  mkdir -p "$backup_dir"
  local stamp; stamp=$(date +%Y%m%d_%H%M%S)
  local target="${backup_dir}/nodyx_${mode}_${stamp}.sql.gz"
  printf "  ${CYAN}→${RESET}  $(t db_autobackup)\n" "$mode"
  if sudo -u postgres pg_dump -d "$DB_NAME" 2>/dev/null | gzip > "$target" 2>/dev/null; then
    if [[ -s "$target" ]]; then
      local size; size=$(du -h "$target" | awk '{print $1}')
      printf "  ${GREEN}✔${RESET}  $(t db_autobackup_done)\n" "$target" "$size"
    else
      rm -f "$target"
      warn "$(t db_autobackup_fail)"
    fi
  else
    rm -f "$target" 2>/dev/null || true
    warn "$(t db_autobackup_fail)"
  fi
}

# ═══════════════════════════════════════════════════════════════════════════════
#  CADDYFILE RENDERING (shared between fresh install and --repair)
#
#  Extracted into a function so `--repair` can rebuild /etc/caddy/Caddyfile
#  in place. Without this the doctor's "rerun --repair to rebind" hint was a
#  lie - the repair fast path skipped the Caddy section entirely.
#
#  TUNNEL_MODE is read from the env (fresh install) or from
#  /etc/nodyx/tunnel-mode (repair). HOST_PRIMARY_IP is autodetected.
# ═══════════════════════════════════════════════════════════════════════════════
_render_caddyfile() {
  local _mode="${TUNNEL_MODE:-}"
  if [[ -z "$_mode" && -f /etc/nodyx/tunnel-mode ]]; then
    _mode=$(cat /etc/nodyx/tunnel-mode 2>/dev/null || echo cf)
  fi
  [[ -z "$_mode" ]] && _mode="cf"

  local _CADDY_CLIENT_IP_HEADERS
  case "$_mode" in
    cf)       _CADDY_CLIENT_IP_HEADERS='client_ip_headers CF-Connecting-IP X-Forwarded-For' ;;
    pangolin) _CADDY_CLIENT_IP_HEADERS='client_ip_headers X-Forwarded-For' ;;
    *)        _CADDY_CLIENT_IP_HEADERS='client_ip_headers X-Forwarded-For' ;;
  esac

  local _HOST_PRIMARY_IP
  _HOST_PRIMARY_IP=$(ip -4 route get 1.1.1.1 2>/dev/null \
    | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}' || true)
  HOST_PRIMARY_IP="$_HOST_PRIMARY_IP"

  # Site address `:80` matches every Host on port 80. Pairing it with an
  # explicit `bind` directive lets us control which interfaces Caddy listens
  # on without filtering by Host header. The previous form
  # `http://127.0.0.1:80, http://[::1]:80 { }` was a Host filter masquerading
  # as a bind: Caddy only matched requests whose Host header was literally
  # `127.0.0.1` or `[::1]`, so when newt forwarded a request from Pangolin
  # with the public Host, no site matched and Caddy returned 0 bytes
  # (see https://github.com/Pokled/nodyx/discussions/23).
  local _CADDY_BIND_IPS="127.0.0.1 ::1"
  if [[ "$_mode" == "pangolin" && -n "$_HOST_PRIMARY_IP" ]]; then
    _CADDY_BIND_IPS="${_CADDY_BIND_IPS} ${_HOST_PRIMARY_IP}"
  fi

  # Atomic write: render to a tempfile, validate, then mv into place. Without
  # this, a syntax error after editing the heredoc would leave a broken
  # Caddyfile on disk - and on next reload Caddy would refuse to start.
  local _new_caddyfile
  _new_caddyfile=$(mktemp /etc/caddy/.Caddyfile.new.XXXXXX) || return 1

  cat > "$_new_caddyfile" <<CADDY
{
    servers {
        # Trust loopback + RFC1918 sources so the tunnel client (cloudflared,
        # newt, frpc, ...) can forward the real visitor IP. Without this every
        # visitor would look like 127.0.0.1 and rate-limits/IP-bans break.
        trusted_proxies static private_ranges
        ${_CADDY_CLIENT_IP_HEADERS}

        # Cap header size at 16KB. Default is 1MB, which leaves the door open
        # to slow-header DoS. 16KB still fits CF Tunnel + Pangolin + cookies
        # + Authorization comfortably (a JWT is ~500B).
        max_header_size 16KB
    }
}

# Reusable snippets keep mode-specific blocks short and prevent drift between
# /api, /uploads, /socket.io, the honeypot rewrite, and the SPA fallback.
(security_headers) {
    header {
        X-Content-Type-Options    "nosniff"
        X-Frame-Options           "SAMEORIGIN"
        Referrer-Policy           "strict-origin-when-cross-origin"
        Permissions-Policy        "camera=(self), microphone=(self), geolocation=(self)"
        Content-Security-Policy   "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob:; font-src 'self' data:; connect-src 'self' wss: https:; frame-src https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self';"
        -Server
    }
}

(proxy_backend) {
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
        # dial_timeout: loopback should connect in <100ms; 5s = generous margin.
        # response_header_timeout: 30s covers Socket.IO long-poll (pingTimeout
        # defaults to 25s) without blocking forever on a hung backend.
        # No read/write timeouts: WebSocket upgrades hold the connection long-term.
        transport http {
            dial_timeout 5s
            response_header_timeout 30s
        }
    }
}

(proxy_frontend) {
    reverse_proxy 127.0.0.1:4173 {
        header_up X-Real-IP {client_ip}
        header_up X-Forwarded-For {client_ip}
        transport http {
            dial_timeout 5s
            response_header_timeout 30s
        }
    }
}

:80 {
    bind ${_CADDY_BIND_IPS}

    encode gzip

    import security_headers

    # Honeypot: paths classic scanners hit. Rewritten to /api/v1/_hp so nodyx-core
    # logs the source IP and can ban it. Must be matched BEFORE /api/* handle.
    @honeypot path_regexp hp ^/(\.env|\.env\.|\.git/|\.htaccess|\.htpasswd|wp-admin|wp-login\.php|wp-config\.php|xmlrpc\.php|phpmyadmin|pma/|adminer|myadmin|shell\.php|cmd\.php|c99\.php|r57\.php|webshell|config\.php|configuration\.php|web\.config|settings\.php|backup\.sql|dump\.sql|db\.sql|database\.sql|install\.php|setup\.php|installer|console|manager/|administrator|eval\.php|debug|id_rsa|credentials|config\.json|database\.yml|\.aws|\.ssh)
    handle @honeypot {
        rewrite * /api/v1/_hp?p={http.request.uri.path}
        import proxy_backend
    }

    handle /api/* {
        import proxy_backend
    }
    handle /uploads/* {
        import proxy_backend
    }
    handle /socket.io/* {
        import proxy_backend
    }

    handle {
        import proxy_frontend
    }
}
CADDY

  # Validate the tempfile, not the live config. Only mv into place once
  # caddy validate is happy - that way a broken render leaves the previous
  # /etc/caddy/Caddyfile (and the running Caddy) untouched.
  local _vlog
  _vlog=$(mktemp /tmp/nodyx_caddy_validate_XXXXXX.log)
  if ! caddy validate --config "$_new_caddyfile" --adapter caddyfile >"$_vlog" 2>&1; then
    cat "$_vlog" >&2
    rm -f "$_vlog" "$_new_caddyfile"
    return 1
  fi
  rm -f "$_vlog"

  # Atomic replacement (mv on the same filesystem is atomic). chmod first so
  # the file inherits the same perms it would have via cat (root:root, 0644).
  chmod 0644 "$_new_caddyfile" 2>/dev/null || true
  mv -f "$_new_caddyfile" /etc/caddy/Caddyfile
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
#  PANGOLIN UFW RULES (shared between fresh install and --repair)
#
#  Pangolin Method B (newt in default Docker bridge) connects to the host's
#  LAN IP on :80. With UFW's default-deny-incoming policy, that path is blocked
#  unless we explicitly allow :80 from RFC1918 ranges. Method A (--network host)
#  uses loopback and is unaffected.
#
#  Idempotent: each rule is tagged with a sentinel comment so re-running this
#  on an existing install (or via --repair) doesn't duplicate rules. We allow
#  RFC1918 ranges only - never 0.0.0.0/0 - so the public internet can't bypass
#  the tunnel and hit Caddy directly.
# ═══════════════════════════════════════════════════════════════════════════════
_PANGOLIN_UFW_TAG='Nodyx: pangolin newt (RFC1918)'
_ensure_pangolin_ufw() {
  local _mode="${TUNNEL_MODE:-}"
  if [[ -z "$_mode" && -f /etc/nodyx/tunnel-mode ]]; then
    _mode=$(cat /etc/nodyx/tunnel-mode 2>/dev/null || echo cf)
  fi
  [[ "$_mode" != "pangolin" ]] && return 0
  command -v ufw >/dev/null 2>&1 || return 0

  # Rule check: ufw status verbose includes the comment text. If we already
  # tagged a rule with our sentinel, skip - prevents duplicate entries on
  # repeated --repair runs.
  if ufw status verbose 2>/dev/null | grep -qF "$_PANGOLIN_UFW_TAG"; then
    return 0
  fi

  ufw allow from 10.0.0.0/8     to any port 80 proto tcp comment "$_PANGOLIN_UFW_TAG" >/dev/null 2>&1 || true
  ufw allow from 172.16.0.0/12  to any port 80 proto tcp comment "$_PANGOLIN_UFW_TAG" >/dev/null 2>&1 || true
  ufw allow from 192.168.0.0/16 to any port 80 proto tcp comment "$_PANGOLIN_UFW_TAG" >/dev/null 2>&1 || true
  return 0
}

# ═══════════════════════════════════════════════════════════════════════════════
#  UPGRADE / REPAIR FAST PATH
# ═══════════════════════════════════════════════════════════════════════════════
_nodyx_upgrade() {
  local title; title=$(t upgrade_title)
  [[ "${1:-}" == "repair" ]] && title=$(t repair_title)
  step "$title"

  # Snapshot the DB before any potentially destructive step. An "upgrade" pulls
  # new migrations that may fail mid-run; a "repair" rebuilds in place but a
  # botched build can still leave the schema in an inconsistent state. The
  # helper is a no-op if the DB is empty/unreachable, so it costs nothing on
  # a freshly-installed host where there's nothing to lose anyway.
  _auto_backup_db "${1:-upgrade}"

  if [[ "${1:-}" != "repair" ]]; then
    info "$(t code_fetch)"
    git -C "$NODYX_DIR" pull --ff-only || die "$(t git_pull_fail)"
    ok "$(t code_uptodate)"
  fi

  info "$(t backend_rebuild)"
  cd "${NODYX_DIR}/nodyx-core"
  run_bg "npm install (backend)" npm install --no-fund --no-audit
  run_bg "npm run build (backend)" npm run build
  ok "$(t backend_built)"

  info "$(t frontend_rebuild)"
  cd "${NODYX_DIR}/nodyx-frontend"
  run_bg "npm install (frontend)" npm install --no-fund --no-audit
  run_bg "npm run build (frontend)" npm run build
  ok "$(t frontend_built)"

  info "$(t services_restart)"
  chown -R nodyx:nodyx "$NODYX_DIR" 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 startOrRestart "${NODYX_DIR}/ecosystem.config.js" --update-env 2>/dev/null \
    || pm2 restart all 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save 2>/dev/null || true
  local _persisted_mode="cf"
  [[ -f /etc/nodyx/tunnel-mode ]] && _persisted_mode=$(cat /etc/nodyx/tunnel-mode 2>/dev/null || echo cf)

  # Regenerate /etc/caddy/Caddyfile from the (possibly updated) template so
  # config drift between the installed script and the running Caddyfile is
  # erased. _render_caddyfile reads tunnel-mode itself, so we don't need to
  # set TUNNEL_MODE here. Without this, the doctor's "rerun --repair to
  # rebind" hint silently does nothing - which is what bit forke24x7 in #23.
  if _render_caddyfile; then
    systemctl reload caddy 2>/dev/null || systemctl restart caddy 2>/dev/null || true
    ok "Caddyfile regenerated and reloaded"
  else
    warn "Caddyfile validation failed - leaving the previous /etc/caddy/Caddyfile untouched on disk"
  fi

  # Re-apply Pangolin UFW rule too. Idempotent via comment-tag - safe to
  # re-run on every repair.
  TUNNEL_MODE="$_persisted_mode" _ensure_pangolin_ufw || true

  if [[ "$_persisted_mode" == "cf" ]]; then
    systemctl restart cloudflared 2>/dev/null || true
  fi

  echo ""
  ok "$(t upgrade_done)"
  exit 0
}

# ═══════════════════════════════════════════════════════════════════════════════
#  PREFLIGHT
# ═══════════════════════════════════════════════════════════════════════════════
banner

[[ $EUID -ne 0 ]] && die "$(t err_root)"

if ! grep -qiE 'ubuntu|debian' /etc/os-release 2>/dev/null; then
  die "$(t err_os)"
fi

_arch=$(uname -m)
case "$_arch" in
  x86_64|amd64) CF_ARCH="amd64" ;;
  aarch64|arm64) CF_ARCH="arm64" ;;
  *) die "$(printf "$(t err_arch)" "$_arch")" ;;
esac

# RAM check
_RAM_FREE_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $7}' || echo 9999)
if [[ "$_RAM_FREE_MB" -lt 400 ]]; then
  warn "$(printf "$(t ram_low)" "$_RAM_FREE_MB")"
  warn "$(t ram_swap_hint)"
  _confirm "$(t continue_anyway)" || die "$(t install_cancelled)"
fi

# Disk check
_DISK_FREE_MB=$(df -m /opt 2>/dev/null | awk 'NR==2{print $4}' || echo 9999)
if [[ "$_DISK_FREE_MB" -lt 1024 ]]; then
  warn "$(printf "$(t disk_low)" "$_DISK_FREE_MB")"
  _confirm "$(t continue_anyway)" || die "$(t install_cancelled)"
fi

# Container / init-system detection. The script registers a pm2-nodyx.service
# unit, calls systemctl restart caddy / postgresql / cloudflared, and configures
# UFW. All three need systemd as PID 1 and (for UFW) NET_ADMIN. In a Docker
# container without systemd, or an unprivileged LXC missing capabilities, these
# steps would fail mid-run and leave the operator with a half-installed host.
#
# systemd-detect-virt exits 1 AND prints "none" when not in a container, so
# we capture-and-discard the exit code rather than chaining "|| echo none"
# (which would duplicate the literal "none" into the variable).
_VIRT="none"
if command -v systemd-detect-virt >/dev/null 2>&1; then
  _detected=$(systemd-detect-virt --container 2>/dev/null) || true
  [[ -n "$_detected" && "$_detected" != "none" ]] && _VIRT="$_detected"
fi
_INIT=$(ps -p 1 -o comm= 2>/dev/null | tr -d ' \n' || echo "?")

if [[ "$_VIRT" != "none" ]]; then
  warn "Container environment detected (systemd-detect-virt → ${_VIRT})."
  if [[ "$_INIT" != "systemd" ]]; then
    warn "PID 1 is '${_INIT}', not systemd."
    warn "The pm2-nodyx.service unit, systemctl, and UFW will not work in this"
    warn "environment. Use a privileged LXC, an Ubuntu/Debian VM, or the"
    warn "official Docker compose file (docker-compose.yml at the repo root)."
    _confirm "$(t continue_anyway)" || die "$(t install_cancelled)"
  else
    info "systemd is PID 1 - install should work, but the container may need extra capabilities (NET_ADMIN for UFW, SYS_ADMIN for some systemd ops)."
  fi
fi

# Internet connectivity preflight. apt-get update, git clone, npm install all
# need outbound HTTPS. Failing here gives a clear message; failing 5 minutes
# into npm install gives a cryptic ETIMEDOUT buried under 200 lines of output.
if ! getent hosts github.com >/dev/null 2>&1; then
  warn "DNS lookup for github.com failed - the install needs outbound DNS."
  warn "Check /etc/resolv.conf, systemd-resolved, or your container DNS config."
  _confirm "$(t continue_anyway)" || die "$(t install_cancelled)"
elif ! curl -fsS --max-time 5 -o /dev/null https://github.com 2>/dev/null; then
  warn "Outbound HTTPS to github.com is failing - the install needs port 443 open."
  warn "Check firewall, corporate proxy, or VPN routing."
  _confirm "$(t continue_anyway)" || die "$(t install_cancelled)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  DETECTION MENU
# ═══════════════════════════════════════════════════════════════════════════════
if [[ -d "$NODYX_DIR/.git" && -z "$INSTALL_MODE" ]]; then
  step "$(printf "$(t detect_existing)" "$NODYX_DIR")"
  echo ""
  echo "  $(t detect_choose)"
  echo "  $(t detect_1)"
  echo "  $(t detect_2)"
  echo "  $(t detect_3)"
  echo "  $(t detect_4)"
  echo "  $(t detect_5)"
  echo ""
  read -rp "$(echo -e "  ${CYAN}?${RESET} $(t detect_prompt): ")" _choice
  case "$_choice" in
    1) INSTALL_MODE="upgrade" ;;
    2) INSTALL_MODE="repair" ;;
    3) INSTALL_MODE="reinstall" ;;
    4) INSTALL_MODE="wipe" ;;
    *) die "$(t install_cancelled)" ;;
  esac
fi

# Fast path: upgrade or repair
if [[ "$INSTALL_MODE" == "upgrade" ]]; then
  _nodyx_upgrade
elif [[ "$INSTALL_MODE" == "repair" ]]; then
  _nodyx_upgrade repair
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_prereq)"
echo ""
echo -e "  ${CYAN}→${RESET}  $(t cfg_token_help1)"
echo -e "  ${CYAN}→${RESET}  $(t cfg_token_help2)"
echo -e "  ${CYAN}→${RESET}  $(t cfg_token_help3)"
echo ""

step "$(t step_config)"
echo ""

# Community
if [[ -n "$NAME_FLAG" ]]; then
  COMMUNITY_NAME="$NAME_FLAG"
else
  prompt COMMUNITY_NAME "$(t cfg_community_name)"
fi

if [[ -n "$SLUG_FLAG" ]]; then
  COMMUNITY_SLUG="$SLUG_FLAG"
else
  COMMUNITY_SLUG_DEFAULT=$(slugify "$COMMUNITY_NAME")
  prompt COMMUNITY_SLUG "$(t cfg_slug)" "$COMMUNITY_SLUG_DEFAULT"
fi

COMMUNITY_LANG_DEFAULT="$NODYX_LANG"
prompt COMMUNITY_LANG "$(t cfg_lang)" "$COMMUNITY_LANG_DEFAULT"

# Domain
echo ""
echo -e "  ${BOLD}$(t cfg_domain_header)${RESET}"
echo -e "  ${CYAN}$(t cfg_domain_help)${RESET}"
echo ""
if [[ -n "$DOMAIN_FLAG" ]]; then
  DOMAIN="$DOMAIN_FLAG"
else
  _domain_ok=false
  while ! $_domain_ok; do
    read -rp "$(echo -e "  ${CYAN}?${RESET} $(t cfg_domain_prompt): ")" DOMAIN
    DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"
    DOMAIN="${DOMAIN%/}";        DOMAIN="${DOMAIN// /}"
    if [[ -z "$DOMAIN" ]]; then
      :
    elif [[ "$DOMAIN" != *.* ]]; then
      printf "  ${RED}✘  $(t cfg_domain_invalid)${RESET}\n" "$DOMAIN"
    else
      _domain_ok=true
    fi
  done
fi

# Tunnel mode selection
echo ""
echo -e "  ${BOLD}$(t cfg_tunnel_header)${RESET}"
echo -e "  ${CYAN}$(t cfg_tunnel_help)${RESET}"
echo ""
echo "  $(t cfg_tunnel_cf)"
echo "  $(t cfg_tunnel_pangolin)"
echo "  $(t cfg_tunnel_none)"
echo ""

# Validate flag-provided value, else prompt
case "$TUNNEL_MODE" in
  cf|pangolin|none) ;;
  "")
    while true; do
      read -rp "$(echo -e "  ${CYAN}?${RESET} $(t cfg_tunnel_prompt): ")" _tm
      case "$_tm" in
        1|cf)        TUNNEL_MODE="cf";       break ;;
        2|pangolin)  TUNNEL_MODE="pangolin"; break ;;
        3|none)      TUNNEL_MODE="none";     break ;;
      esac
    done
    ;;
  *) die "$(printf "$(t cfg_tunnel_invalid)" "$TUNNEL_MODE")" ;;
esac

CF_TUNNEL_TOKEN=""
if [[ "$TUNNEL_MODE" == "cf" ]]; then
  echo ""
  info "$(t cfg_tunnel_cf_note)"
  echo ""
  echo -e "  ${BOLD}$(t cfg_token_header)${RESET}"
  if [[ -n "$TUNNEL_TOKEN_FLAG" ]]; then
    CF_TUNNEL_TOKEN="$TUNNEL_TOKEN_FLAG"
  else
    prompt_secret CF_TUNNEL_TOKEN "$(t cfg_token_prompt)"
  fi
  if [[ ${#CF_TUNNEL_TOKEN} -lt 80 ]]; then
    warn "$(printf "$(t cfg_token_short)" "${#CF_TUNNEL_TOKEN}")"
  fi
elif [[ "$TUNNEL_MODE" == "pangolin" ]]; then
  echo ""
  info "$(t cfg_tunnel_pangolin_note)"
else
  echo ""
  info "$(t cfg_tunnel_none_note)"
fi

# Admin
echo ""
echo -e "  ${BOLD}$(t cfg_admin_header)${RESET}"
if [[ -n "$ADMIN_USER_FLAG" ]]; then
  ADMIN_USERNAME="$ADMIN_USER_FLAG"
else
  prompt ADMIN_USERNAME "$(t cfg_admin_user)"
fi
if [[ -n "$ADMIN_EMAIL_FLAG" ]]; then
  ADMIN_EMAIL="$ADMIN_EMAIL_FLAG"
else
  prompt ADMIN_EMAIL "$(t cfg_admin_email)"
fi
if [[ -n "$ADMIN_PASS_FLAG" ]]; then
  ADMIN_PASSWORD="$ADMIN_PASS_FLAG"
else
  prompt_secret ADMIN_PASSWORD "$(t cfg_admin_pass)"
fi

# Recap
echo ""
echo -e "  ${BOLD}${CYAN}┌─ $(t cfg_recap) ──────────────────────${RESET}"
case "$TUNNEL_MODE" in
  cf)       _MODE_LABEL="Cloudflare Tunnel" ;;
  pangolin) _MODE_LABEL="Pangolin (newt)" ;;
  none)     _MODE_LABEL="Custom reverse tunnel" ;;
esac
echo -e "  ${BOLD}${CYAN}│${RESET}  $(t cfg_recap_mode)       : ${GREEN}${_MODE_LABEL}${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  $(t cfg_recap_domain)     : ${BOLD}${DOMAIN}${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  $(t cfg_recap_community)  : ${BOLD}${COMMUNITY_NAME}${RESET} (${COMMUNITY_SLUG})"
echo -e "  ${BOLD}${CYAN}│${RESET}  $(t cfg_recap_lang)       : ${BOLD}${COMMUNITY_LANG}${RESET}"
echo -e "  ${BOLD}${CYAN}│${RESET}  $(t cfg_recap_admin)      : ${BOLD}${ADMIN_USERNAME}${RESET} <${ADMIN_EMAIL}>"
echo -e "  ${BOLD}${CYAN}└───────────────────────────────${RESET}"
echo ""
_confirm "$(t cfg_recap_proceed)" || die "$(t install_cancelled)"

# ═══════════════════════════════════════════════════════════════════════════════
#  GENERATED SECRETS
# ═══════════════════════════════════════════════════════════════════════════════
DB_PASSWORD=$(gen_pass)
JWT_SECRET=$(gen_secret)

# ═══════════════════════════════════════════════════════════════════════════════
#  SYSTEM PACKAGES
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_packages)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q \
  git curl wget gnupg2 ca-certificates lsb-release \
  openssl ufw build-essential \
  postgresql postgresql-contrib \
  redis-server \
  fonts-dejavu-core \
  >/dev/null 2>&1
ok "System packages installed"

# Node.js 20 LTS
if ! command -v node &>/dev/null || [[ "$(node -e 'process.stdout.write(process.version.split(".")[0].slice(1))')" -lt 20 ]]; then
  info "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -q nodejs >/dev/null 2>&1
  ok "Node.js $(node -v) installed"
else
  ok "Node.js $(node -v) already present"
fi

# Caddy
if ! command -v caddy &>/dev/null; then
  info "Installing Caddy..."
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -q && apt-get install -y -q caddy >/dev/null 2>&1
  ok "Caddy installed"
else
  ok "Caddy already present"
fi

# PM2
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 --silent
  ok "PM2 installed"
else
  ok "PM2 already present"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  CREATE 'nodyx' SYSTEM USER
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_user)"
if ! id -u nodyx &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -m -d /home/nodyx nodyx
  ok "User 'nodyx' created"
else
  ok "User 'nodyx' already exists"
fi
mkdir -p /home/nodyx/.pm2/logs
chown -R nodyx:nodyx /home/nodyx/.pm2

# pm2-logrotate must be installed under the nodyx PM2_HOME, NOT root's. The
# previous install ran "pm2 install pm2-logrotate" as root: it landed in
# /root/.pm2/, the nodyx daemon never saw it, and PM2 logs were never rotated.
# Symptom was silent — log files just kept growing under /home/nodyx/.pm2/logs/
# until the disk filled up.
if ! runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null | grep -q pm2-logrotate; then
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 install pm2-logrotate >/dev/null 2>&1 || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 set pm2-logrotate:max_size 50M 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 set pm2-logrotate:retain 7 2>/dev/null || true
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  POSTGRESQL
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_pg)"

_PG_VER=$(ls /usr/lib/postgresql/ 2>/dev/null | sort -Vr | head -1)
[[ -z "$_PG_VER" ]] && die "PostgreSQL not found after install."

systemctl enable  "postgresql@${_PG_VER}-main" --quiet 2>/dev/null || true
systemctl start   "postgresql@${_PG_VER}-main" 2>/dev/null || true

_PG_READY=false
for _pg_i in {1..15}; do
  sudo -u postgres pg_isready -q 2>/dev/null && { _PG_READY=true; break; }
  sleep 2
done

if ! $_PG_READY; then
  if [[ ! -f "/var/lib/postgresql/${_PG_VER}/main/PG_VERSION" ]]; then
    pg_dropcluster   "${_PG_VER}" main 2>/dev/null || true
    pg_createcluster "${_PG_VER}" main 2>/dev/null || true
  fi
  pg_ctlcluster "${_PG_VER}" main start 2>/dev/null || true
  systemctl restart "postgresql@${_PG_VER}-main" 2>/dev/null || true
  for _pg_i in {1..15}; do
    sudo -u postgres pg_isready -q 2>/dev/null && { _PG_READY=true; break; }
    sleep 2
  done
fi
$_PG_READY || die "PostgreSQL ${_PG_VER} did not start."
ok "PostgreSQL ${_PG_VER} ready"

sudo -u postgres psql -c "
  DO \$\$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${DB_USER}') THEN
      CREATE ROLE ${DB_USER} WITH LOGIN PASSWORD '${DB_PASSWORD}';
    ELSE
      ALTER ROLE ${DB_USER} WITH PASSWORD '${DB_PASSWORD}';
    END IF;
  END \$\$;
" >/dev/null

# Auto-backup before destructive operations
if [[ "$INSTALL_MODE" == "wipe" || "$INSTALL_MODE" == "reinstall" ]]; then
  _auto_backup_db "$INSTALL_MODE"
fi

if [[ "$INSTALL_MODE" == "wipe" ]]; then
  sudo -u postgres psql -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>/dev/null || true
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null
fi

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" \
  | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null

sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
sudo -u postgres psql -d "$DB_NAME" -c "GRANT CREATE ON SCHEMA public TO ${DB_USER};" >/dev/null
ok "Database '${DB_NAME}' ready"

# ═══════════════════════════════════════════════════════════════════════════════
#  REDIS
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_redis)"
mkdir -p /var/lib/redis /var/log/redis
chown redis:redis /var/lib/redis /var/log/redis 2>/dev/null || true
chmod 750 /var/lib/redis /var/log/redis 2>/dev/null || true
systemctl unmask redis-server 2>/dev/null || true
systemctl enable redis-server --quiet 2>/dev/null || true
systemctl start redis-server 2>/dev/null || true

_REDIS_OK=false
for _ri in {1..10}; do
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    _REDIS_OK=true; break
  fi
  sleep 2
done
if ! $_REDIS_OK; then
  redis-server --daemonize yes --logfile /var/log/redis/redis-server.log --dir /var/lib/redis 2>/dev/null || true
  sleep 3
  redis-cli ping 2>/dev/null | grep -q PONG && _REDIS_OK=true || true
fi
$_REDIS_OK || die "Redis did not start."
ok "Redis running"

# ═══════════════════════════════════════════════════════════════════════════════
#  FIREWALL (UFW) - Tunnel mode: outbound only, only SSH inbound
#
#  Idempotent: if UFW is already active, we DO NOT touch the rules. An admin
#  may have set up Pangolin newt allowances, custom SSH ports, VPN bypasses,
#  etc. The previous "ufw --force reset" wiped all of that silently. Now we
#  only apply our default profile when UFW is inactive (fresh install).
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_firewall)"
if ufw status 2>/dev/null | head -1 | grep -q "Status: active"; then
  warn "UFW already active - leaving existing rules untouched."
  warn "Make sure SSH (22/tcp) and your tunnel client can reach this host: sudo ufw status verbose"
else
  ufw default deny incoming  >/dev/null 2>&1 || true
  ufw default allow outgoing >/dev/null 2>&1 || true
  ufw allow ssh              >/dev/null 2>&1 || true
  ufw --force enable         >/dev/null 2>&1 || true
  ok "Firewall enabled (SSH inbound only - tunnel handles web traffic outbound)"
fi

# Pangolin Method B: newt-in-bridge connects to host LAN IP on :80. Loopback
# (Method A) is unfiltered by UFW, so it works either way. We open :80 from
# RFC1918 only, never the public internet - the tunnel is the public path.
if [[ "$TUNNEL_MODE" == "pangolin" ]]; then
  if _ensure_pangolin_ufw; then
    ok "UFW: :80/tcp allowed from RFC1918 ranges (Pangolin newt in bridge mode)"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  CLONE / UPDATE
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_clone)"
if [[ -d "$NODYX_DIR/.git" ]]; then
  git -C "$NODYX_DIR" pull --ff-only
else
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$REPO_URL" "$NODYX_DIR"
fi
ok "Source present in $NODYX_DIR"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-CORE - .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_backend)"

# umask 077 in a subshell so the .env (containing JWT_SECRET + DB_PASSWORD)
# is created mode 600 atomically, never world-readable in between cat and chmod.
(umask 077; cat > "${NODYX_DIR}/nodyx-core/.env" <<COREENV
# Generated by install_tunnel.sh - do not edit manually
NODYX_COMMUNITY_NAME=${COMMUNITY_NAME}
NODYX_COMMUNITY_SLUG=${COMMUNITY_SLUG}
NODYX_COMMUNITY_LANGUAGE=${COMMUNITY_LANG}
NODYX_COMMUNITY_COUNTRY=

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

# CF Tunnel terminates TLS at the edge - public URL still https://
FRONTEND_URL=https://${DOMAIN}
COREENV
)

cd "${NODYX_DIR}/nodyx-core"
run_bg "npm install (backend)" npm install --no-fund --no-audit \
  || die "Backend npm install failed."
run_bg "TypeScript compile (backend)" npm run build \
  || die "Backend build failed."
[[ -f "${NODYX_DIR}/nodyx-core/dist/index.js" ]] \
  || die "dist/index.js missing - backend build produced no output."
ok "Backend compiled"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-FRONTEND - .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_frontend)"

# Frontend .env doesn't carry server secrets today, but PUBLIC_TENOR_KEY /
# PUBLIC_GIPHY_KEY may be filled in later. Same umask 077 dance for safety.
(umask 077; cat > "${NODYX_DIR}/nodyx-frontend/.env" <<FEENV
# Generated by install_tunnel.sh - do not edit manually
PUBLIC_API_URL=https://${DOMAIN}
PRIVATE_API_SSR_URL=http://127.0.0.1:3000/api/v1

# Required by SvelteKit \$env/static/public.
# Even when empty, these MUST be present at build time or vite/rollup
# fails with "PUBLIC_X is not exported by virtual:env/static/public".
# Voice/TURN credentials are normally served dynamically by nodyx-core
# via the voice:init Socket.IO event.
PUBLIC_TURN_URL=
PUBLIC_TURN_USERNAME=
PUBLIC_TURN_CREDENTIAL=

# Nodyx Signet (optional 2FA authenticator) — leave empty if unused.
PUBLIC_SIGNET_URL=

# Optional integrations (left empty by default).
PUBLIC_TENOR_KEY=
PUBLIC_GIPHY_KEY=
FEENV
)

cd "${NODYX_DIR}/nodyx-frontend"
run_bg "npm install (frontend)" npm install --no-fund --no-audit \
  || die "Frontend npm install failed."
run_bg "SvelteKit build (2-5 min on ARM)" npm run build \
  || die "Frontend build failed."
[[ -f "${NODYX_DIR}/nodyx-frontend/build/index.js" ]] \
  || die "build/index.js missing - frontend build produced no output."
ok "Frontend compiled"

# ═══════════════════════════════════════════════════════════════════════════════
#  CADDY (HTTP-only, behind a reverse tunnel)
#
#  Real-client-IP forwarding is mode-aware so rate-limiting, IP bans and
#  honeypot logging see the actual visitor IP, not 127.0.0.1:
#    cf       -> Cloudflare Tunnel sets CF-Connecting-IP
#    pangolin -> newt + Traefik forward X-Forwarded-For (XFF)
#    none     -> trust loopback XFF; user wires their own tunnel
#
#  Bind addresses are mode-aware too. Cloudflared and most home-tunnel clients
#  reach Caddy via loopback, but newt in a Docker bridge container cannot:
#  inside the container, "localhost" is the container itself. For pangolin we
#  therefore bind on the host's primary LAN IP as well, so newt can run in
#  --network host (loopback works) OR in bridge mode (target the LAN IP).
#
#  TLS terminates upstream (CF edge, Pangolin VPS, or your own proxy), so no
#  HSTS here - it would lock visitors out if the tunnel ever goes via plain HTTP.
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_caddy)"

_render_caddyfile || die "Caddyfile validation failed."

systemctl enable caddy --quiet
systemctl restart caddy

case "$TUNNEL_MODE" in
  cf)
    ok "Caddy listening on 127.0.0.1:80 (Cloudflare Tunnel terminates TLS, real IP via CF-Connecting-IP)"
    ;;
  pangolin)
    if [[ -n "$HOST_PRIMARY_IP" ]]; then
      ok "Caddy listening on 127.0.0.1:80 + ${HOST_PRIMARY_IP}:80 (Pangolin / newt, real IP via X-Forwarded-For)"
    else
      ok "Caddy listening on 127.0.0.1:80 (Pangolin / newt, real IP via X-Forwarded-For)"
      warn "Could not detect a primary IPv4 - newt in bridge mode won't reach Caddy. Run newt with --network host."
    fi
    ;;
  none)
    ok "Caddy listening on 127.0.0.1:80 (custom tunnel, real IP via X-Forwarded-For from loopback)"
    ;;
esac

# ═══════════════════════════════════════════════════════════════════════════════
#  PM2 ECOSYSTEM (under nodyx system user)
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_pm2)"

# Adapt PM2 memory caps to host RAM
_TOTAL_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $2}' || echo 2048)
if   [[ "$_TOTAL_MB" -lt 1500 ]]; then _PM2_CORE_MEM="220M"; _PM2_FRONT_MEM="180M"
elif [[ "$_TOTAL_MB" -lt 3000 ]]; then _PM2_CORE_MEM="450M"; _PM2_FRONT_MEM="350M"
else                                    _PM2_CORE_MEM="800M"; _PM2_FRONT_MEM="600M"
fi

cat > "${NODYX_DIR}/ecosystem.config.js" <<PM2
module.exports = {
  apps: [
    {
      name: 'nodyx-core',
      script: 'dist/index.js',
      cwd: '${NODYX_DIR}/nodyx-core',
      watch: false,
      max_memory_restart: '${_PM2_CORE_MEM}',
      env: { NODE_ENV: 'production' },
    },
    {
      name: 'nodyx-frontend',
      script: 'build/index.js',
      cwd: '${NODYX_DIR}/nodyx-frontend',
      watch: false,
      max_memory_restart: '${_PM2_FRONT_MEM}',
      env: { NODE_ENV: 'production', PORT: '4173', HOST: '127.0.0.1', ORIGIN: 'https://${DOMAIN}', PRIVATE_API_SSR_URL: 'http://127.0.0.1:3000/api/v1' },
    },
  ],
}
PM2

chown -R nodyx:nodyx "${NODYX_DIR}"

# Stop legacy root-owned PM2 instances + nodyx-owned ones (idempotent)
pm2 delete nodyx-core     2>/dev/null || true
pm2 delete nodyx-frontend 2>/dev/null || true
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 delete nodyx-core     2>/dev/null || true
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 delete nodyx-frontend 2>/dev/null || true

runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 startOrRestart "${NODYX_DIR}/ecosystem.config.js" --update-env
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save

# pm2-nodyx systemd unit
cat > /etc/systemd/system/pm2-nodyx.service <<SVC
[Unit]
Description=PM2 process manager (nodyx)
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
ExecStart=$(which pm2) resurrect
ExecReload=$(which pm2) reload all
ExecStop=$(which pm2) kill

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable pm2-nodyx --quiet
ok "PM2 running under nodyx user"

sleep 5
for _app in nodyx-core nodyx-frontend; do
  _st=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null \
    | grep " ${_app} " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_st" == "online" ]]; then
    ok "  $_app - online"
  else
    warn "$_app - status: ${_st}"
    runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs "$_app" --lines 20 --nostream 2>/dev/null || true
  fi
done

if [[ "$TUNNEL_MODE" == "cf" ]]; then
  # ═══════════════════════════════════════════════════════════════════════════════
  #  CLOUDFLARED - Install
  # ═══════════════════════════════════════════════════════════════════════════════
  step "$(t step_cf_install)"

  if command -v cloudflared &>/dev/null; then
    ok "cloudflared already installed: $(cloudflared --version 2>&1 | head -1)"
  else
    if [[ "$CF_ARCH" == "amd64" ]]; then
      info "Installing cloudflared via apt (Cloudflare repo)..."
      mkdir -p --mode=0755 /usr/share/keyrings
      curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
        -o /usr/share/keyrings/cloudflare-main.gpg 2>/dev/null
      _DIST=$(. /etc/os-release && echo "$VERSION_CODENAME")
      echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared ${_DIST} main" \
        > /etc/apt/sources.list.d/cloudflared.list
      apt-get update -q
      apt-get install -y -q cloudflared >/dev/null 2>&1 \
        || die "cloudflared apt install failed. Check /etc/apt/sources.list.d/cloudflared.list"
    else
      info "Installing cloudflared via .deb (arm64)..."
      _DEB=$(mktemp /tmp/cloudflared_XXXXXX.deb)
      curl -fsSL --max-time 120 \
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb" \
        -o "$_DEB" || die "cloudflared download failed."
      dpkg -i "$_DEB" >/dev/null 2>&1 || apt-get install -f -y -q >/dev/null 2>&1
      rm -f "$_DEB"
    fi
    command -v cloudflared &>/dev/null || die "cloudflared install completed but binary not on PATH."
    ok "cloudflared $(cloudflared --version 2>&1 | head -1) installed"
  fi

  # ═══════════════════════════════════════════════════════════════════════════════
  #  CLOUDFLARED - Register tunnel service (idempotent via token hash)
  # ═══════════════════════════════════════════════════════════════════════════════
  step "$(t step_cf_register)"

  _TOKEN_HASH=$(echo -n "$CF_TUNNEL_TOKEN" | sha256sum | awk '{print $1}')
  _TOKEN_HASH_FILE="/etc/cloudflared/.token_hash"
  mkdir -p /etc/cloudflared

  _NEED_REGISTER=true
  if [[ -f "$_TOKEN_HASH_FILE" ]] && [[ "$(cat "$_TOKEN_HASH_FILE" 2>/dev/null)" == "$_TOKEN_HASH" ]] \
     && systemctl is-active --quiet cloudflared 2>/dev/null; then
    _NEED_REGISTER=false
    ok "cloudflared service already registered with this token"
  fi

  if $_NEED_REGISTER; then
    # Cleanly uninstall any previous registration, then re-install with the new token
    cloudflared service uninstall 2>/dev/null || true
    systemctl stop cloudflared 2>/dev/null || true

    info "Registering cloudflared service with the token..."
    _CF_LOG=$(mktemp /tmp/nodyx_cf_install_XXXXXX.log); _register_temp "$_CF_LOG"
    if ! cloudflared service install "$CF_TUNNEL_TOKEN" >"$_CF_LOG" 2>&1; then
      cat "$_CF_LOG" >&2
      die "cloudflared service install failed. Check the token in your CF dashboard."
    fi
    (umask 077; echo -n "$_TOKEN_HASH" > "$_TOKEN_HASH_FILE")
    chmod 600 "$_TOKEN_HASH_FILE"

    systemctl enable cloudflared --quiet 2>/dev/null || true
    systemctl restart cloudflared 2>/dev/null || true
    sleep 3
    if systemctl is-active --quiet cloudflared; then
      ok "Cloudflare Tunnel service active"
    else
      warn "cloudflared service not active - diagnostic: systemctl status cloudflared"
    fi
  fi
else
  step "Tunnel client (skipped, mode=$TUNNEL_MODE)"
  if [[ "$TUNNEL_MODE" == "pangolin" ]]; then
    info "Caddy is wired up. Install newt on this host pointing at your Pangolin VPS - see summary at the end."
  else
    info "Caddy is wired up. Connect your reverse tunnel of choice to localhost:80 - see summary at the end."
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  WAIT FOR BACKEND + BOOTSTRAP COMMUNITY + ADMIN
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_bootstrap)"

_BACKEND_READY=false
_bw_si=0; _bw_elapsed=0
for _bw_i in {1..90}; do
  if curl -sf http://localhost:3000/api/v1/instance/info >/dev/null 2>&1; then
    printf "\r\033[2K"
    ok "Backend operational (${_bw_elapsed}s)"
    _BACKEND_READY=true
    break
  fi
  printf "\r  ${CYAN}%s${RESET}  Waiting for backend (migrations included)...  ${YELLOW}%ds${RESET}   " \
    "${_HC_SPIN[$((_bw_si % 10))]}" "$_bw_elapsed"
  _bw_si=$((_bw_si+1)); sleep 2; _bw_elapsed=$((_bw_elapsed+2))
done
printf "\r\033[2K"

if ! $_BACKEND_READY; then
  warn "Backend did not respond within 180s. Logs (nodyx-core):"
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 35 --nostream 2>/dev/null || true
fi

# Register admin (retry up to 3x)
_REGISTER_OK=false
_REGISTER_BODY=$(mktemp /tmp/nodyx_register_XXXXXX.json); _register_temp "$_REGISTER_BODY"
for _reg_try in 1 2 3; do
  HTTP_CODE=$(curl -s -o "$_REGISTER_BODY" -w "%{http_code}" \
    -X POST http://localhost:3000/api/v1/auth/register \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"${ADMIN_USERNAME}\",\"email\":\"${ADMIN_EMAIL}\",\"password\":\"${ADMIN_PASSWORD}\"}" \
    2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
    ok "Account '${ADMIN_USERNAME}' created"
    _REGISTER_OK=true; break
  elif [[ "$HTTP_CODE" == "409" ]]; then
    ok "Account '${ADMIN_USERNAME}' already exists"
    _REGISTER_OK=true; break
  else
    warn "Attempt ${_reg_try}/3 - HTTP ${HTTP_CODE}"
    [[ $_reg_try -lt 3 ]] && sleep 8
  fi
done

# Pass user input to psql via --set so values are quoted by libpq itself
# (:'var' substitution). Bash interpolation of names containing apostrophes
# would otherwise break the SQL ("L'Étoile") or open a SQL-injection hole.
# Note: psql's -c does not perform variable substitution; we have to pipe the
# SQL through stdin via a quoted heredoc.
USER_ID=$(sudo -u postgres psql -d "$DB_NAME" --set=email="$ADMIN_EMAIL" -tA 2>/dev/null <<'SQL' | tr -d ' \n'
SELECT id FROM users WHERE lower(email)=lower(:'email');
SQL
)

if [[ -n "$USER_ID" ]]; then
  # Heredoc must be quoted (<<'SQL') so bash leaves the :'name' / :'slug' /
  # :'user_id' tokens intact for psql to substitute.
  sudo -u postgres psql -d "$DB_NAME" \
    --set=name="$COMMUNITY_NAME" \
    --set=slug="$COMMUNITY_SLUG" \
    --set=user_id="$USER_ID" \
    <<'SQL' >/dev/null
    INSERT INTO communities (name, slug, description, owner_id, is_public)
    VALUES (:'name', :'slug', '', :'user_id', true)
    ON CONFLICT (slug) DO NOTHING;

    INSERT INTO community_members (community_id, user_id, role)
    SELECT id, :'user_id', 'owner'
    FROM communities WHERE slug = :'slug'
    ON CONFLICT (community_id, user_id) DO UPDATE SET role = 'owner';
SQL
  ok "Community '${COMMUNITY_NAME}' created - ${ADMIN_USERNAME} → owner"
else
  warn "Admin user not found in DB - register at https://${DOMAIN}/auth/register once DNS is live."
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  SAVE CREDENTIALS
# ═══════════════════════════════════════════════════════════════════════════════
# Persist tunnel mode for nodyx-doctor / nodyx-update / future --upgrade runs
mkdir -p /etc/nodyx
echo "$TUNNEL_MODE" > /etc/nodyx/tunnel-mode
chmod 644 /etc/nodyx/tunnel-mode

case "$TUNNEL_MODE" in
  cf)       _CREDS_MODE_LABEL="Cloudflare Tunnel" ;;
  pangolin) _CREDS_MODE_LABEL="Pangolin (newt)" ;;
  none)     _CREDS_MODE_LABEL="Custom reverse tunnel" ;;
esac

CREDS_FILE="/root/nodyx-credentials.txt"
# umask 077 so the first cat creates the file mode 600 atomically. Subsequent
# >> appends keep the inode's permissions, so they don't need the dance again.
(umask 077; cat > "$CREDS_FILE" <<CREDS
═══════════════════════════════════════════════════════
  NODYX - Instance credentials (${_CREDS_MODE_LABEL})
  Generated: $(date)
═══════════════════════════════════════════════════════

URL              : https://${DOMAIN}
Admin username   : ${ADMIN_USERNAME}
Admin email      : ${ADMIN_EMAIL}
Admin password   : ${ADMIN_PASSWORD}

PostgreSQL user  : ${DB_USER}
PostgreSQL pass  : ${DB_PASSWORD}
PostgreSQL DB    : ${DB_NAME}

JWT secret       : ${JWT_SECRET}

Nodyx dir        : ${NODYX_DIR}
Tunnel mode      : ${TUNNEL_MODE} (cat /etc/nodyx/tunnel-mode)

CREDS
)

case "$TUNNEL_MODE" in
  cf)
    cat >> "$CREDS_FILE" <<CFCREDS
── Cloudflare Tunnel ───────────────────────────────────
Service          : systemctl status cloudflared
Logs             : journalctl -u cloudflared -f
Public hostname  : configure in https://one.dash.cloudflare.com
                   → Networks → Tunnels → (your tunnel) → Public Hostname
                   → Domain: ${DOMAIN}, Service: HTTP, URL: localhost:80
CFCREDS
    ;;
  pangolin)
    if [[ -n "${HOST_PRIMARY_IP:-}" ]]; then
      _PG_BIND="http://127.0.0.1:80 + http://${HOST_PRIMARY_IP}:80 (loopback + LAN IP)"
      _PG_TARGET_B="http://${HOST_PRIMARY_IP}:80"
    else
      _PG_BIND="http://127.0.0.1:80 (loopback only - LAN IP not detected)"
      _PG_TARGET_B="http://<LAN-IP>:80"
    fi
    cat >> "$CREDS_FILE" <<PGCREDS
── Pangolin (newt client) ──────────────────────────────
Caddy listens    : ${_PG_BIND}
Setup            : create a Site (newt) on your Pangolin dashboard,
                   then run the newt client here with ENDPOINT/NEWT_ID/NEWT_SECRET.
Resource (A)     : newt --network host  →  ${DOMAIN} → http://localhost:80
Resource (B)     : newt default bridge  →  ${DOMAIN} → ${_PG_TARGET_B}
Real IP          : Caddy reads X-Forwarded-For from trusted private/loopback ranges.
PGCREDS
    ;;
  none)
    cat >> "$CREDS_FILE" <<NCCREDS
── Custom reverse tunnel ───────────────────────────────
Caddy listens    : http://127.0.0.1:80
Public domain    : ${DOMAIN}
What to do       : forward HTTP traffic from your reverse tunnel
                   to 127.0.0.1:80 on this server, then point your DNS to
                   the public side of the tunnel.
Real IP          : Caddy reads X-Forwarded-For from private/loopback ranges.
NCCREDS
    ;;
esac

cat >> "$CREDS_FILE" <<'CRENDS'

KEEP THIS FILE SAFE - never share it.
CRENDS
chmod 600 "$CREDS_FILE"

# ═══════════════════════════════════════════════════════════════════════════════
#  HELPER SCRIPTS - nodyx-update + nodyx-doctor
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_helpers)"

# nodyx-update
cat > /usr/local/bin/nodyx-update <<'UPDATESH'
#!/usr/bin/env bash
set -euo pipefail
GREEN='\033[0;32m'; CYAN='\033[0;36m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
info() { echo -e "${CYAN}→${RESET}  $*"; }
die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }
[[ $EUID -ne 0 ]] && die "Run as root: sudo nodyx-update"
UPDATESH
echo "NODYX_DIR=\"${NODYX_DIR}\"" >> /usr/local/bin/nodyx-update
cat >> /usr/local/bin/nodyx-update <<'UPDATESH2'

TUNNEL_MODE_FILE="/etc/nodyx/tunnel-mode"
TUNNEL_MODE_VAL="cf"
[[ -f "$TUNNEL_MODE_FILE" ]] && TUNNEL_MODE_VAL=$(cat "$TUNNEL_MODE_FILE" 2>/dev/null || echo cf)

echo -e "\n${BOLD}━━━  Nodyx update  ━━━${RESET}\n"
info "Pulling latest..."
git -C "$NODYX_DIR" pull --ff-only || die "git pull failed."

info "Rebuild backend..."
cd "${NODYX_DIR}/nodyx-core"
npm install --no-fund --no-audit --silent
npm run build || die "Backend build failed."
ok "Backend compiled"

info "Rebuild frontend..."
cd "${NODYX_DIR}/nodyx-frontend"
npm install --no-fund --no-audit --silent
npm run build || die "Frontend build failed."
ok "Frontend compiled"

info "Restart services..."
chown -R nodyx:nodyx "$NODYX_DIR"
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 startOrRestart "${NODYX_DIR}/ecosystem.config.js" --update-env
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save

case "$TUNNEL_MODE_VAL" in
  cf)
    systemctl restart cloudflared 2>/dev/null || true
    ;;
  pangolin)
    info "Pangolin mode: newt is managed externally (skipping cloudflared restart)."
    ;;
  none)
    info "Custom tunnel mode: no managed tunnel client to restart."
    ;;
esac

echo ""
ok "Nodyx updated and restarted (tunnel mode: $TUNNEL_MODE_VAL)."
runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list
UPDATESH2
chmod +x /usr/local/bin/nodyx-update
printf "  ${GREEN}✔${RESET}  $(t update_script_made)\n" "${BOLD}" "${RESET}"

# nodyx-doctor
cat > /usr/local/bin/nodyx-doctor <<'DOCSH'
#!/usr/bin/env bash
set -uo pipefail
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
PASS=0; WARN=0; FAIL=0
_pass(){ PASS=$((PASS+1)); echo -e "  ${GREEN}✔${RESET}  $*"; }
_warn(){ WARN=$((WARN+1)); echo -e "  ${YELLOW}⚠${RESET}  $*"; }
_fail(){ FAIL=$((FAIL+1)); echo -e "  ${RED}✘${RESET}  $*"; }
_sect(){ echo ""; echo -e "  ${BOLD}${CYAN}▸ $1${RESET}"; }

[[ $EUID -ne 0 ]] && { echo "Run as root: sudo nodyx-doctor"; exit 1; }

TUNNEL_MODE_VAL="cf"
[[ -f /etc/nodyx/tunnel-mode ]] && TUNNEL_MODE_VAL=$(cat /etc/nodyx/tunnel-mode 2>/dev/null || echo cf)
case "$TUNNEL_MODE_VAL" in
  cf)       _MODE_LABEL="Cloudflare Tunnel" ;;
  pangolin) _MODE_LABEL="Pangolin (newt)" ;;
  none)     _MODE_LABEL="Custom reverse tunnel" ;;
  *)        _MODE_LABEL="Unknown ($TUNNEL_MODE_VAL)" ;;
esac

echo -e "\n${BOLD}━━━  Nodyx doctor ($_MODE_LABEL)  ━━━${RESET}"

_sect "System services"
_BASE_SVC=(postgresql redis-server caddy)
[[ "$TUNNEL_MODE_VAL" == "cf" ]] && _BASE_SVC+=(cloudflared)
for s in "${_BASE_SVC[@]}"; do
  if systemctl is-active --quiet "$s" 2>/dev/null; then _pass "$s"
  else _fail "$s  (systemctl status $s)"; fi
done

_sect "PM2 (nodyx user)"
for app in nodyx-core nodyx-frontend; do
  st=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null \
    | grep " $app " | grep -oE 'online|stopped|errored|launching' | head -1 || echo absent)
  case "$st" in
    online) _pass "$app" ;;
    *)      _fail "$app [$st]" ;;
  esac
done

_sect "Network"
api=$(curl -s --max-time 4 -o /dev/null -w '%{http_code}' http://localhost:3000/api/v1/instance/info 2>/dev/null || true)
[[ "$api" =~ ^[23] ]] && _pass "Backend /api/v1/instance/info → HTTP $api" || _fail "Backend → HTTP ${api:-timeout}"

caddy_code=$(curl -s --max-time 4 -o /dev/null -w '%{http_code}' http://localhost:80/ 2>/dev/null || true)
[[ "$caddy_code" =~ ^[23] ]] && _pass "Caddy localhost:80 → HTTP $caddy_code" || _warn "Caddy localhost:80 → HTTP ${caddy_code:-timeout}"

_sect "Tunnel ($_MODE_LABEL)"
case "$TUNNEL_MODE_VAL" in
  cf)
    if systemctl is-active --quiet cloudflared 2>/dev/null; then
      _pass "cloudflared service active"
      recent_err=$(journalctl -u cloudflared --since '5 min ago' --no-pager 2>/dev/null | grep -ciE 'error|failed' || true)
      [[ "$recent_err" -lt 3 ]] && _pass "No recent errors in journal" || _warn "$recent_err errors in last 5 min: journalctl -u cloudflared -n 50"
    else
      _fail "cloudflared not active"
    fi
    ;;
  pangolin)
    # Newt detection: native binary or Docker container.
    _newt_mode=""
    if pgrep -af 'newt' >/dev/null 2>&1; then
      _newt_mode="native"
    elif docker ps --format '{{.Names}} {{.Image}}' 2>/dev/null | grep -qi 'newt'; then
      _newt_mode="docker"
      _newt_net=$(docker inspect newt --format '{{.HostConfig.NetworkMode}}' 2>/dev/null || echo "?")
    fi
    case "$_newt_mode" in
      native) _pass "newt client process detected (native)" ;;
      docker) _pass "newt container detected (NetworkMode: ${_newt_net:-?})"
              [[ "${_newt_net:-}" != "host" ]] \
                && _warn "newt is in '${_newt_net}' mode, not --network host. It must reach Caddy via the host LAN IP."
              ;;
      *)      _warn "No newt process detected (start the Pangolin newt client on this host)" ;;
    esac

    # Collect every address Caddy is bound to on :80 (note: \. is a literal
    # dot in the regex; the previous \\. matched any character because the
    # heredoc preserved both backslashes).
    _caddy_addrs=$(ss -ltn 2>/dev/null | awk '$4 ~ /:80$/ {print $4}' | sed 's/:80$//' | sort -u)
    if [[ -z "$_caddy_addrs" ]]; then
      _fail "Nothing listening on :80 - Pangolin won't be able to reach Caddy"
    else
      _pass "Caddy listening on :80 (addresses: $(echo "$_caddy_addrs" | tr '\n' ' '))"
      # The LAN IP bind only matters for Method B (newt in default Docker
      # bridge). When newt is in --network host or runs natively, loopback
      # is enough, so suppress the warning to avoid a false positive
      # (reported by @forke24x7 in discussion #23).
      _host_ip=$(ip -4 route get 1.1.1.1 2>/dev/null \
        | awk '{for(i=1;i<=NF;i++) if($i=="src") {print $(i+1); exit}}')
      if [[ -n "$_host_ip" ]] \
         && ! echo "$_caddy_addrs" | grep -qF "$_host_ip" \
         && [[ "$_newt_mode" == "docker" && "${_newt_net:-}" != "host" ]]; then
        _warn "Caddy is NOT bound on the LAN IP (${_host_ip})."
        _warn "newt is in '${_newt_net}' mode and needs to reach Caddy via the LAN IP. Re-run sudo bash install_tunnel.sh --repair to rebind."
      fi
    fi
    ;;
  none)
    if ss -ltn 2>/dev/null | awk '$4 ~ /:80$/ {print $4}' | grep -q .; then
      _pass "Caddy is listening on :80 (ready for your reverse tunnel)"
    else
      _warn "Nothing listening on :80 - your tunnel client cannot reach Caddy"
    fi
    _warn "Custom tunnel mode: no managed client - this script can't check the remote side"
    ;;
esac

TOT=$((PASS+WARN+FAIL))
echo ""
if   [[ $FAIL -eq 0 && $WARN -eq 0 ]]; then echo -e "  ${GREEN}${BOLD}✔  $PASS/$TOT - all green${RESET}"
elif [[ $FAIL -eq 0 ]];                   then echo -e "  ${YELLOW}${BOLD}⚠  $PASS/$TOT OK - $WARN warning(s)${RESET}"
else                                            echo -e "  ${RED}${BOLD}✘  $PASS/$TOT OK - $FAIL error(s) / $WARN warning(s)${RESET}"
fi
echo ""
DOCSH
chmod +x /usr/local/bin/nodyx-doctor
printf "  ${GREEN}✔${RESET}  $(t doctor_script_made)\n" "${BOLD}" "${RESET}"

# ═══════════════════════════════════════════════════════════════════════════════
#  HEALTH CHECK
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_healthcheck)"

HC_PASS=0; HC_WARN=0; HC_FAIL=0
_hc_pass() { HC_PASS=$((HC_PASS+1)); echo -e "  ${GREEN}✔${RESET}  $*"; }
_hc_warn() { HC_WARN=$((HC_WARN+1)); echo -e "  ${YELLOW}⚠${RESET}  $*"; }
_hc_fail() { HC_FAIL=$((HC_FAIL+1)); echo -e "  ${RED}✘${RESET}  $*"; }
_hc_sect() {
  echo ""
  echo -e "  ${BOLD}${CYAN}▸ $1${RESET}"
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

_hc_sect "$(t hc_services)"
for _svc in postgresql redis-server caddy; do
  if systemctl is-active --quiet "$_svc" 2>/dev/null; then
    _hc_pass "$_svc"
  else
    _hc_fail "$_svc"
  fi
done

_hc_sect "$(t hc_pm2)"
for _app in nodyx-core nodyx-frontend; do
  _pm2=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null | grep " $_app " | grep -oE 'online|stopped|errored|launching' | head -1 || echo absent)
  if [[ "$_pm2" == "online" ]]; then
    _hc_pass "$_app"
  else
    _hc_fail "$_app  [${_pm2}]"
  fi
done

case "$TUNNEL_MODE" in
  cf)       _HC_TUNNEL_LABEL="Cloudflare Tunnel" ;;
  pangolin) _HC_TUNNEL_LABEL="Pangolin (newt)" ;;
  none)     _HC_TUNNEL_LABEL="Custom reverse tunnel" ;;
esac
_hc_sect "$_HC_TUNNEL_LABEL"
case "$TUNNEL_MODE" in
  cf)
    if systemctl is-active --quiet cloudflared 2>/dev/null; then
      _hc_pass "cloudflared (tunnel active)"
    else
      _hc_fail "cloudflared not active"
    fi
    ;;
  pangolin)
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(:|\.)80$'; then
      _hc_pass "Caddy listening on :80 (ready for newt)"
    else
      _hc_fail "Nothing listening on :80"
    fi
    _hc_warn "Run the Pangolin newt client on this host (see summary below)"
    ;;
  none)
    if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE '(:|\.)80$'; then
      _hc_pass "Caddy listening on :80 (ready for your reverse tunnel)"
    else
      _hc_fail "Nothing listening on :80"
    fi
    ;;
esac

_dns_ip=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
if [[ -n "$_dns_ip" ]]; then
  printf "  ${GREEN}✔${RESET}  $(t hc_dns_ok)\n" "$DOMAIN" "$_dns_ip"
  HC_PASS=$((HC_PASS+1))
else
  printf "  ${YELLOW}⚠${RESET}  $(t hc_dns_pending)\n" "$DOMAIN"
  HC_WARN=$((HC_WARN+1))
fi

# HTTPS reachability only meaningful for cf (cloudflared owns DNS+TLS).
# For pangolin/none, DNS+TLS depend on user setup which may not yet be wired up.
if [[ "$TUNNEL_MODE" == "cf" ]]; then
  if _wait_https "https://${DOMAIN}" "Waiting for HTTPS via tunnel..." 60; then
    printf "  ${GREEN}✔${RESET}  $(t hc_https_ok)\n" "https://${DOMAIN}"
    HC_PASS=$((HC_PASS+1))
  else
    printf "  ${YELLOW}⚠${RESET}  $(t hc_https_wait)\n" "https://${DOMAIN}"
    HC_WARN=$((HC_WARN+1))
  fi
else
  printf "  ${CYAN}→${RESET}  HTTPS check skipped (mode=%s, configure your tunnel/resource first)\n" "$TUNNEL_MODE"
fi

HC_TOTAL=$((HC_PASS + HC_WARN + HC_FAIL))
echo ""
if   [[ $HC_FAIL -eq 0 && $HC_WARN -eq 0 ]]; then printf "  ${GREEN}${BOLD}$(t hc_score_green)${RESET}\n" "$HC_PASS" "$HC_TOTAL"
elif [[ $HC_FAIL -eq 0 ]];                    then printf "  ${YELLOW}${BOLD}$(t hc_score_warn)${RESET}\n"  "$HC_PASS" "$HC_TOTAL" "$HC_WARN"
else                                                printf "  ${RED}${BOLD}$(t hc_score_fail)${RESET}\n"     "$HC_PASS" "$HC_TOTAL" "$HC_FAIL" "$HC_WARN"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
case "$TUNNEL_MODE" in
  cf)       _SUMMARY_TITLE=$(t summary_title_cf) ;;
  pangolin) _SUMMARY_TITLE=$(t summary_title_pangolin) ;;
  none)     _SUMMARY_TITLE=$(t summary_title_none) ;;
esac
echo -e "${GREEN}${BOLD}╔═════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║  ${_SUMMARY_TITLE}  ║${RESET}"
echo -e "${GREEN}${BOLD}╚═════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}$(t summary_url):${RESET}    https://${DOMAIN}"
echo -e "  ${BOLD}$(t summary_admin):${RESET}  ${ADMIN_USERNAME} / ${ADMIN_EMAIL}"
echo ""
printf "  ${CYAN}$(t creds_saved)${RESET}\n" "${BOLD}${CREDS_FILE}${RESET}"
echo ""

case "$TUNNEL_MODE" in
  cf)
    echo -e "  ${BOLD}${CYAN}▸ $(t summary_dashboard)${RESET}"
    echo -e "  $(t summary_dashboard_step1)"
    echo -e "  $(t summary_dashboard_step2)"
    printf  "  $(t summary_dashboard_step3)\n" "${DOMAIN}"
    echo ""
    echo -e "  ${BOLD}${CYAN}▸ Service management${RESET}"
    echo -e "  sudo nodyx-doctor                     # full diagnostic"
    echo -e "  sudo nodyx-update                     # git pull + rebuild + restart"
    echo -e "  systemctl status cloudflared          # tunnel state"
    echo -e "  journalctl -u cloudflared -f          # tunnel logs"
    echo -e "  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list"
    echo ""
    warn "$(t summary_voice_warn_cf)"
    ;;
  pangolin)
    echo -e "  ${BOLD}${CYAN}▸ $(t summary_pangolin_header)${RESET}"
    echo -e "  $(t summary_pangolin_s1)"
    echo -e "  $(t summary_pangolin_s2)"
    echo ""

    # Method A: --network host (works regardless of bridge subnet, simplest)
    echo -e "  ${BOLD}${GREEN}$(t summary_pangolin_method_a)${RESET}"
    echo -e "  ${BOLD}docker run -d --name newt --network host --restart unless-stopped \\"
    echo -e "    -e PANGOLIN_ENDPOINT=https://your-pangolin.example.com \\"
    echo -e "    -e NEWT_ID=your_newt_id \\"
    echo -e "    -e NEWT_SECRET=your_newt_secret \\"
    echo -e "    fosrl/newt:latest${RESET}"
    echo ""

    # Method B: default Docker bridge - target host LAN IP
    if [[ -n "${HOST_PRIMARY_IP:-}" ]]; then
      printf  "  ${BOLD}$(t summary_pangolin_method_b)${RESET}\n" "${HOST_PRIMARY_IP}"
    else
      echo -e "  ${BOLD}$(t summary_pangolin_method_b_nohost)${RESET}"
    fi
    echo -e "  ${BOLD}docker run -d --name newt --restart unless-stopped \\"
    echo -e "    -e PANGOLIN_ENDPOINT=https://your-pangolin.example.com \\"
    echo -e "    -e NEWT_ID=your_newt_id \\"
    echo -e "    -e NEWT_SECRET=your_newt_secret \\"
    echo -e "    fosrl/newt:latest${RESET}"
    echo ""

    printf  "  $(t summary_pangolin_s3)\n" "${DOMAIN}"
    echo ""

    # Connectivity smoke-test the operator can paste before going live.
    echo -e "  ${CYAN}$(t summary_pangolin_test)${RESET}"
    echo -e "  ${BOLD}docker exec newt wget -qO- http://localhost/api/v1/instance/info  # method A${RESET}"
    if [[ -n "${HOST_PRIMARY_IP:-}" ]]; then
      echo -e "  ${BOLD}docker exec newt wget -qO- http://${HOST_PRIMARY_IP}/api/v1/instance/info  # method B${RESET}"
    fi
    echo ""

    echo -e "  ${BOLD}${CYAN}▸ Service management${RESET}"
    echo -e "  sudo nodyx-doctor                     # full diagnostic"
    echo -e "  sudo nodyx-update                     # git pull + rebuild + restart"
    echo -e "  docker logs -f newt                   # newt client logs"
    echo -e "  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list"
    echo ""
    warn "$(t summary_voice_warn_pangolin)"
    ;;
  none)
    echo -e "  ${BOLD}${CYAN}▸ $(t summary_none_header)${RESET}"
    printf  "  $(t summary_none_s1)\n" "${DOMAIN}"
    echo -e "  $(t summary_none_s2)"
    echo ""
    echo -e "  ${BOLD}${CYAN}▸ Service management${RESET}"
    echo -e "  sudo nodyx-doctor                     # full diagnostic"
    echo -e "  sudo nodyx-update                     # git pull + rebuild + restart"
    echo -e "  ss -ltn 'sport = :80'                 # confirm Caddy is listening"
    echo -e "  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list"
    echo ""
    warn "$(t summary_voice_warn_none)"
    ;;
esac
echo ""
