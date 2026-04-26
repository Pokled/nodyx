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

# ── Auto-update si lancé directement (fichier local potentiellement ancien) ───
# On se télécharge dans /tmp et on compare ; si différent → relance la version fraîche.
# _NODYX_SELFUPDATE=1 empêche la récursion.
if [[ -z "${_NODYX_SELFUPDATE:-}" ]] && [[ -z "${_NODYX_NO_SELFUPDATE:-}" ]]; then
  _FRESH=$(mktemp /tmp/nodyx_install_XXXXXX.sh)
  if curl -fsSL --max-time 10 https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh \
       -o "$_FRESH" 2>/dev/null; then
    if ! diff -q "$_FRESH" "$0" &>/dev/null 2>&1; then
      chmod +x "$_FRESH"
      export _NODYX_SELFUPDATE=1
      exec bash "$_FRESH" "$@"
    fi
  fi
  rm -f "$_FRESH" 2>/dev/null || true
fi

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

# ── i18n ──────────────────────────────────────────────────────────────────────
# Language priority: --lang= flag  >  NODYX_LANG env  >  LANG auto-detect (fr*→fr)  >  en
# Fallback chain at lookup time: T_FR[k] → T_EN[k] → key (so missing strings stay visible)
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

# ── Translations (organized by section, EN first, then FR) ───────────────────
# All user-facing strings live here. printf-style: use %s for variable substitution,
# %% for literal percent. Keep T_EN authoritative (English is source of truth).
# Keys grouped by section matching the script body for maintainability.

# §1 — _nodyx_upgrade : upgrade / repair fast path
T_EN[upgrade_title]='  ━━━  Updating Nodyx v%s → v%s  ━━━'
T_FR[upgrade_title]='  ━━━  Mise à jour Nodyx v%s → v%s  ━━━'
T_EN[repair_title]='  ━━━  Repairing Nodyx v%s  ━━━'
T_FR[repair_title]='  ━━━  Réparation Nodyx v%s  ━━━'
T_EN[user_create]="Creating system user 'nodyx' (migrating from root PM2)..."
T_FR[user_create]="Création de l'utilisateur système 'nodyx' (migration depuis root PM2)..."
T_EN[user_created]="User 'nodyx' created"
T_FR[user_created]="Utilisateur 'nodyx' créé"
T_EN[code_fetch]="Fetching code..."
T_FR[code_fetch]="Récupération du code..."
T_EN[git_pull_fail]="git pull failed. Check your connection or resolve conflicts manually."
T_FR[git_pull_fail]="git pull échoué. Vérifie ta connexion ou résous les conflits manuellement."
T_EN[code_uptodate]="Code up to date"
T_FR[code_uptodate]="Code à jour"
T_EN[backend_rebuild]="Rebuilding backend (nodyx-core)..."
T_FR[backend_rebuild]="Rebuild backend (nodyx-core)..."
T_EN[npm_install_backend_fail]="Backend npm install failed."
T_FR[npm_install_backend_fail]="npm install backend échoué."
T_EN[backend_build_fail]="Backend build failed. Check the logs above."
T_FR[backend_build_fail]="Build backend échoué. Consulte les logs ci-dessus."
T_EN[backend_built]="Backend compiled"
T_FR[backend_built]="Backend compilé"
T_EN[frontend_rebuild]="Rebuilding frontend (nodyx-frontend)..."
T_FR[frontend_rebuild]="Rebuild frontend (nodyx-frontend)..."
T_EN[npm_install_frontend_fail]="Frontend npm install failed."
T_FR[npm_install_frontend_fail]="npm install frontend échoué."
T_EN[frontend_build_fail]="Frontend build failed."
T_FR[frontend_build_fail]="Build frontend échoué."
T_EN[frontend_built]="Frontend compiled"
T_FR[frontend_built]="Frontend compilé"
T_EN[services_restart]="Restarting services..."
T_FR[services_restart]="Redémarrage des services..."
T_EN[relay_recreate]="Relay client missing or inactive — reconfiguring..."
T_FR[relay_recreate]="Relay client absent ou inactif — reconfiguration..."
T_EN[relay_restarted]="Relay client restarted — tunnel to relay.nodyx.org active"
T_FR[relay_restarted]="Relay client redémarré — tunnel vers relay.nodyx.org actif"
T_EN[upgrade_done]='✔  Nodyx v%s operational'
T_FR[upgrade_done]='✔  Nodyx v%s opérationnel'

# §2 — Rollback trap
T_EN[rollback_failed]='  ✘  Installation failed (code: %s) — rolling back...'
T_FR[rollback_failed]='  ✘  Installation échouée (code: %s) — rollback en cours...'
T_EN[rollback_doctor_hint]='  Partial state possible. Run %ssudo nodyx-doctor%s to diagnose.'
T_FR[rollback_doctor_hint]='  État partiel possible. Lance %ssudo nodyx-doctor%s pour diagnostiquer.'
T_EN[rollback_manual_hint]='  Partial state possible. Quick diagnostic commands:'
T_FR[rollback_manual_hint]='  État partiel possible. Commandes de diagnostic rapide :'
T_EN[rollback_relaunch]="  Re-run the installer to finish the configuration."
T_FR[rollback_relaunch]="  Relance l'installeur pour terminer la configuration."

# §3 — Auto-backup DB
T_EN[db_autobackup]='Automatic DB backup (%s)...'
T_FR[db_autobackup]='Sauvegarde automatique de la DB (%s)...'
T_EN[db_autobackup_done]='Backup: %s%s%s  (%s)'
T_FR[db_autobackup_done]='Sauvegarde : %s%s%s  (%s)'
T_EN[db_autobackup_restore_hint]="warn 'Restore the DB if needed: sudo gunzip -c %s | sudo -u postgres psql nodyx'"
T_FR[db_autobackup_restore_hint]="warn 'Restaurer la DB si besoin : sudo gunzip -c %s | sudo -u postgres psql nodyx'"
T_EN[db_autobackup_fail]="DB backup failed (DB empty or inaccessible) — continuing."
T_FR[db_autobackup_fail]="Sauvegarde DB échouée (DB vide ou inaccessible) — on continue."

# §4 — Banner + system info
T_EN[banner_subtitle]='Forum · Chat · Voice · Canvas'
T_FR[banner_subtitle]='Forum · Chat · Voice · Canvas'
T_EN[banner_disk_label]='Disk'
T_FR[banner_disk_label]='Disk'
T_EN[banner_disk_avail]='available'
T_FR[banner_disk_avail]='disponibles'

# §5 — CLI help (--help / -h output)
T_EN[help_usage]='  Usage: bash install.sh [OPTIONS]'
T_FR[help_usage]='  Utilisation : bash install.sh [OPTIONS]'
T_EN[help_modes_header]='  Modes (bypass detection menu):'
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
T_EN[help_domain]='    --domain=DOMAIN         Instance domain'
T_FR[help_domain]="    --domain=DOMAIN         Domaine de l'instance"
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
T_EN[help_no_turn]='    --no-turn          Skip nodyx-turn installation'
T_FR[help_no_turn]='    --no-turn          Ne pas installer nodyx-turn'
T_EN[help_no_subdomain]='    --no-subdomain     Skip nodyx.org subdomain registration'
T_FR[help_no_subdomain]='    --no-subdomain     Ne pas enregistrer le sous-domaine nodyx.org'
T_EN[help_lang]='    --lang=en|fr       UI language (default: auto from $LANG, fallback en)'
T_FR[help_lang]='    --lang=en|fr       Langue (défaut : auto via $LANG, fallback en)'
T_EN[help_help]='    --help             Show this help'
T_FR[help_help]='    --help             Afficher cette aide'
T_EN[unknown_flag]='Unknown flag: %s (ignored)'
T_FR[unknown_flag]='Flag inconnu : %s (ignoré)'

# §6 — Confirm / prompt helpers
T_EN[confirm_yn]='[Y/n]'
T_FR[confirm_yn]='[O/n]'
T_EN[confirm_auto_yes]='%s → yes (--yes)'
T_FR[confirm_auto_yes]='%s → oui (--yes)'
T_EN[prompt_preset]='%s: %s%s%s  %s(pre-filled)%s'
T_FR[prompt_preset]='%s : %s%s%s  %s(pré-rempli)%s'
T_EN[secret_too_short]='Password too short (minimum %d characters).'
T_FR[secret_too_short]='Mot de passe trop court (minimum %d caractères).'
T_EN[secret_confirm]='Confirm the password'
T_FR[secret_confirm]='Confirmez le mot de passe'
T_EN[secret_mismatch]='Passwords do not match. Try again.'
T_FR[secret_mismatch]='Les mots de passe ne correspondent pas. Réessayez.'

# §7 — run_bg + preflight
T_EN[run_bg_fail]='Failed: %s'
T_FR[run_bg_fail]='Échec : %s'
T_EN[run_bg_tail]='── Last lines ────────────────────────────────────────────'
T_FR[run_bg_tail]='── Dernières lignes ──────────────────────────────────────'
T_EN[require_root]='Run this script as root: sudo bash install.sh'
T_FR[require_root]='Lance ce script en root : sudo bash install.sh'
T_EN[unsupported_os]='OS not supported. Use Ubuntu 22.04/24.04 or Debian 11/12/13.'
T_FR[unsupported_os]='OS non supporté. Utilise Ubuntu 22.04/24.04 ou Debian 11/12/13.'

# §8 — Architecture / RAM / Disk preflight
T_EN[arm32_unsupported]='ARM 32-bit architecture (%s) not supported.\n  Vite 7 / Rollup 4 require a 64-bit OS.\n  On Raspberry Pi: enable 64-bit mode in /boot/config.txt (arm_64bit=1)\n  or install Raspberry Pi OS 64-bit (recommended for Pi 3B+ and above).'
T_FR[arm32_unsupported]='Architecture ARM 32-bit (%s) non supportée.\n  Vite 7 / Rollup 4 nécessite un OS 64-bit.\n  Sur Raspberry Pi : active le mode 64-bit dans /boot/config.txt (arm_64bit=1)\n  ou installe Raspberry Pi OS 64-bit (recommandé pour Pi 3B+ et supérieur).'
T_EN[arm64_detected]='ARM64 architecture detected — Rollup binary will be checked after npm install.'
T_FR[arm64_detected]='Architecture ARM64 détectée — le binaire Rollup sera vérifié après npm install.'
T_EN[ram_low_econ]='Total RAM: %s MB — economy mode enabled (reduced PM2 limits, %s GB swap)'
T_FR[ram_low_econ]='RAM totale : %s MB — mode économique activé (limites PM2 réduites, swap %s GB)'
T_EN[ram_mid]='Total RAM: %s MB — intermediate PM2 limits'
T_FR[ram_mid]='RAM totale : %s MB — limites PM2 intermédiaires'
T_EN[ram_avail_warn]='Available RAM: %s MB (recommended: 512 MB+)'
T_FR[ram_avail_warn]='RAM disponible : %s MB (recommandé : 512 MB+)'
T_EN[swap_creating]='Insufficient RAM + swap — auto-creating a %s GB swapfile...'
T_FR[swap_creating]="RAM + swap insuffisants — création automatique d'un swapfile %s GB..."
T_EN[swap_created]='Swapfile %s GB created, activated and persistent (added to /etc/fstab)'
T_FR[swap_created]='Swapfile %s GB créé, activé et persistant (ajouté dans /etc/fstab)'
T_EN[swap_existing]='Existing swapfile (/swapfile) activated'
T_FR[swap_existing]='Swapfile existant (/swapfile) activé'
T_EN[ram_swap_ok]='Low RAM (%s MB) compensated by swap (%s MB) — OK'
T_FR[ram_swap_ok]='RAM faible (%s MB) compensée par le swap (%s MB) — OK'
T_EN[disk_low]='Low disk space on /opt: %s MB (recommended: 1 GB+)'
T_FR[disk_low]='Espace disque faible sur /opt : %s MB (recommandé : 1 GB+)'
T_EN[continue_anyway]='Continue anyway?'
T_FR[continue_anyway]='Continuer quand même ?'
T_EN[install_cancelled]='Installation cancelled.'
T_FR[install_cancelled]='Installation annulée.'
T_EN[install_cancelled_disk]='Installation cancelled — free up disk space and retry.'
T_FR[install_cancelled_disk]="Installation annulée — libère de l'espace et relance."
T_EN[invalid_choice]='Invalid choice — installation cancelled.'
T_FR[invalid_choice]='Choix invalide — installation annulée.'

# §9 — Existing instance detection + install mode menu
T_EN[detect_pm2_root]='  ● Active PM2 processes (root daemon)'
T_FR[detect_pm2_root]='  ● Processus PM2 actifs (daemon root)'
T_EN[detect_pm2_nodyx]='  ● Active PM2 processes (nodyx daemon)'
T_FR[detect_pm2_nodyx]='  ● Processus PM2 actifs (daemon nodyx)'
T_EN[detect_dir]='  ● Directory %s%s'
T_FR[detect_dir]='  ● Répertoire %s%s'
T_EN[detect_dir_ver]=' (v%s)'
T_FR[detect_dir_ver]=' (v%s)'
T_EN[detect_db]="  ● PostgreSQL 'nodyx' database (%s tables)"
T_FR[detect_db]="  ● Base de données PostgreSQL 'nodyx' (%s tables)"
T_EN[detect_upgrade_avail]='↑  Update available: v%s → v%s'
T_FR[detect_upgrade_avail]='↑  Mise à jour disponible : v%s → v%s'
T_EN[detect_regression]='⚠  Regression detected: installed v%s > installer v%s'
T_FR[detect_regression]='⚠  Régression détectée : version installée v%s > installeur v%s'
T_EN[detect_same_ver]='≡  Nodyx instance v%s already installed on this server'
T_FR[detect_same_ver]='≡  Instance Nodyx v%s déjà installée sur ce serveur'
T_EN[detect_unknown]='⚠  A Nodyx installation seems to already be present'
T_FR[detect_unknown]='⚠  Une installation Nodyx semble déjà présente'
T_EN[menu_what_do]='What would you like to do?'
T_FR[menu_what_do]='Que souhaites-tu faire ?'
T_EN[menu_upgrade_to]='Update to v%s — data and config preserved'
T_FR[menu_upgrade_to]='Mettre à jour vers v%s — données et config préservées'
T_EN[menu_recommended]='(recommended)'
T_FR[menu_recommended]='(recommandé)'
T_EN[menu_reinstall]='Full reinstall — reconfigure everything, DB data preserved'
T_FR[menu_reinstall]='Réinstaller complètement — reconfigurer tout, données DB préservées'
T_EN[menu_reset_db]='Reset %s(DANGER)%s — reconfigure + %sERASE the database%s'
T_FR[menu_reset_db]='Réinitialiser %s(DANGER)%s — reconfigurer + %sEFFACER la base de données%s'
T_EN[menu_cancel]='Cancel'
T_FR[menu_cancel]='Annuler'
T_EN[menu_repair]='Repair — rebuild + restart without reconfiguring'
T_FR[menu_repair]='Réparer — rebuild + restart sans reconfigurer'
T_EN[menu_repair_current]='Repair the current installation — rebuild + restart, no version change'
T_FR[menu_repair_current]="Réparer l'installation actuelle — rebuild + restart, sans changer de version"
T_EN[menu_force_reinstall]='Force reinstall to v%s %s(downgrade — discouraged)%s'
T_FR[menu_force_reinstall]='Forcer la réinstallation en v%s %s(rétrogradation — déconseillé)%s'
T_EN[menu_choice_prompt]='Choice [1-%s] (default: %s):'
T_FR[menu_choice_prompt]='Choix [1-%s] (défaut: %s) :'
T_EN[wipe_warning]='⚠  The "nodyx" database will be entirely erased!'
T_FR[wipe_warning]='⚠  La base de données "nodyx" sera entièrement effacée !'
T_EN[reinstall_notice]='Reinstall — DB data preserved, all config will be regenerated.'
T_FR[reinstall_notice]='Réinstallation — données DB préservées, toute la config sera régénérée.'

# §10 — Port conflicts + other PM2
T_EN[caddy_present]='Caddy already present on 80/443 — it will be auto-reconfigured.'
T_FR[caddy_present]='Caddy déjà présent sur 80/443 — il sera reconfiguré automatiquement.'
T_EN[port_conflicts]='⚠  Services conflicting with the ports required by Nodyx:'
T_FR[port_conflicts]='⚠  Services en conflit avec les ports requis par Nodyx :'
T_EN[port_conflict_line]='  ● %s%s%s → port(s) %s'
T_FR[port_conflict_line]='  ● %s%s%s → port(s) %s'
T_EN[port_options]='Options:'
T_FR[port_options]='Options :'
T_EN[port_stop_disable]='Stop and disable %s — frees the ports %s(recommended)%s'
T_FR[port_stop_disable]='Arrêter et désactiver %s — libère les ports %s(recommandé)%s'
T_EN[port_continue]='Continue without stopping — risk of conflict when Caddy starts'
T_FR[port_continue]='Continuer sans arrêter — risque de conflit au démarrage de Caddy'
T_EN[port_choice_prompt]='Choice [1-3] (default: 1):'
T_FR[port_choice_prompt]='Choix [1-3] (défaut: 1) :'
T_EN[port_svc_stopped]='%s stopped and disabled'
T_FR[port_svc_stopped]='%s arrêté et désactivé'
T_EN[port_svc_remain]='Services left running — Caddy may fail to start on 80/443.'
T_FR[port_svc_remain]='Services laissés en place — Caddy pourrait échouer à démarrer sur 80/443.'
T_EN[port_cancel_resolve]='Installation cancelled — resolve port conflicts and retry.'
T_FR[port_cancel_resolve]='Installation annulée — résous les conflits de ports et relance.'
T_EN[port_force_hint]='The installer can try to free the ports automatically (fuser -k).'
T_FR[port_force_hint]="L'installeur peut tenter de libérer les ports automatiquement (fuser -k)."
T_EN[port_force_prompt]='Free the ports and continue? [y/N]:'
T_FR[port_force_prompt]='Libérer les ports et continuer ? [o/N] :'
T_EN[ports_freed]='Ports freed'
T_FR[ports_freed]='Ports libérés'
T_EN[other_pm2_apps]='ℹ  Other PM2 applications are running on this server:'
T_FR[other_pm2_apps]="ℹ  D'autres applications PM2 tournent sur ce serveur :"
T_EN[other_pm2_note]='→ They will NOT be touched. Only "nodyx-core" and "nodyx-frontend" are managed.'
T_FR[other_pm2_note]='→ Elles ne seront PAS modifiées. Seuls "nodyx-core" et "nodyx-frontend" sont gérés.'
T_EN[continue_q]='Continue?'
T_FR[continue_q]='Continuer ?'
T_EN[unknown_proc]='unknown'
T_FR[unknown_proc]='inconnu'

# §11 — IP detection + force mode
T_EN[step_detect_ip]="Detecting public IP"
T_FR[step_detect_ip]="Détection de l'IP publique"
T_EN[ip_undetected]='Could not auto-detect the public IP.'
T_FR[ip_undetected]="Impossible de détecter l'IP publique automatiquement."
T_EN[prompt_public_ip]='Public IP of this server'
T_FR[prompt_public_ip]='IP publique de ce serveur'
T_EN[ip_detected]='Public IP: %s%s%s'
T_FR[ip_detected]='IP publique : %s%s%s'
T_EN[force_mode_cli]='Mode forced via CLI: %s%s%s'
T_FR[force_mode_cli]='Mode forcé via CLI : %s%s%s'
T_EN[force_no_install]='No installation found in %s — cannot %s.'
T_FR[force_no_install]='Aucune installation trouvée dans %s — impossible de %s.'

# §12 — Network connectivity
T_EN[step_net_check]='Checking network connectivity'
T_FR[step_net_check]='Vérification de la connectivité réseau'
T_EN[net_unreach]='← unreachable'
T_FR[net_unreach]='← non joignable'
T_EN[net_caddy_cdn_unreach]='← CDN unreachable'
T_FR[net_caddy_cdn_unreach]='← CDN non joignable'
T_EN[net_caddy_apt_note]='(non-critical — Caddy installs via apt anyway)'
T_FR[net_caddy_apt_note]="(non critique — Caddy s'installe quand même via apt)"
T_EN[net_critical_fail]='Some critical network dependencies are unreachable.'
T_FR[net_critical_fail]='Certaines dépendances réseau critiques sont injoignables.'
T_EN[net_install_at_risk]='The install may fail at the npm install or apt-get step.'
T_FR[net_install_at_risk]="L'installation risque d'échouer à l'étape npm install ou apt-get."
T_EN[net_fix_and_retry]='Fix network connectivity (firewall? DNS?) and retry.'
T_FR[net_fix_and_retry]='Corrige la connectivité réseau (pare-feu ? DNS ?) et relance.'

# §13 — Configuration prompts
T_EN[step_configure]='Configuring your instance'
T_FR[step_configure]='Configuration de ton instance'
T_EN[conf_identity]='01  Community identity'
T_FR[conf_identity]='01  Identité de la communauté'
T_EN[prompt_community_name]='Community name (e.g. Linux France)'
T_FR[prompt_community_name]='Nom de la communauté (ex: Linux France)'
T_EN[prompt_community_slug]='Unique identifier (slug)'
T_FR[prompt_community_slug]='Identifiant unique (slug)'
T_EN[slug_too_short]='Slug too short after sanitisation (min 3 chars). Pick a longer name.'
T_FR[slug_too_short]='Le slug est trop court après sanitisation (min 3 caractères). Choisis un nom plus long.'
T_EN[prompt_community_lang]='Primary language (en/fr/de/es/it/pt)'
T_FR[prompt_community_lang]='Langue principale (fr/en/de/es/it/pt)'
T_EN[prompt_community_desc]='Short description (optional)'
T_FR[prompt_community_desc]='Description courte (optionnel)'
T_EN[prompt_community_country]='Country (e.g. FR, BE, CH) — optional'
T_FR[prompt_community_country]='Pays (ex: FR, BE, CH) — optionnel'
T_EN[conf_network]='02  Network connection mode'
T_FR[conf_network]='02  Mode de connexion réseau'
T_EN[net_mode_intro]='Choose how your instance will be reachable from the Internet:'
T_FR[net_mode_intro]='Choisis comment ton instance sera accessible depuis Internet :'
T_EN[net_mode_1]='[1] Personal domain'
T_FR[net_mode_1]='[1] Domaine personnel'
T_EN[net_mode_1_desc]='— you have a domain (e.g. mycommunity.com) and ports 80/443 are open'
T_FR[net_mode_1_desc]='— tu as un domaine (ex: moncommunaute.fr) et les ports 80/443 sont ouverts'
T_EN[net_mode_2]='[2] Nodyx Relay'
T_FR[net_mode_2]='[2] Nodyx Relay'
T_EN[net_mode_2_desc]='— %srecommended%s — no port to open, no domain required (RPi, home box, ...)'
T_FR[net_mode_2_desc]='— %srecommandé%s — aucun port à ouvrir, aucun domaine requis (RPi, box, ...)'
T_EN[net_mode_3]='[3] sslip.io auto'
T_FR[net_mode_3]='[3] sslip.io auto'
T_EN[net_mode_3_desc]='— free auto domain, ports 80/443 must be open'
T_FR[net_mode_3_desc]='— domaine gratuit automatique, ports 80/443 ouverts requis'
T_EN[net_mode_prompt]='Choice [1/2/3] (default: 2 — Nodyx Relay):'
T_FR[net_mode_prompt]='Choix [1/2/3] (défaut : 2 — Nodyx Relay) :'
T_EN[prompt_domain]='Instance domain (e.g. mycommunity.com)'
T_FR[prompt_domain]="Domaine de l'instance (ex: moncommunaute.fr)"
T_EN[relay_mode_url]='Nodyx Relay mode — URL: %s%s%s'
T_FR[relay_mode_url]='Mode Nodyx Relay — URL : %s%s%s'
T_EN[relay_mode_no_port]='No port to open. The tunnel will be established to relay.nodyx.org.'
T_FR[relay_mode_no_port]='Aucun port à ouvrir. Le tunnel sera établi vers relay.nodyx.org.'
T_EN[auto_domain]='Auto domain: %s%s%s'
T_FR[auto_domain]='Domaine automatique : %s%s%s'
T_EN[sslip_resolves]='sslip.io auto-resolves to %s — HTTPS certificate handled by Caddy.'
T_FR[sslip_resolves]='sslip.io résout automatiquement vers %s — certificat HTTPS géré par Caddy.'
T_EN[conf_admin]='03  Admin account'
T_FR[conf_admin]='03  Compte administrateur'
T_EN[prompt_admin_user]='Admin username'
T_FR[prompt_admin_user]="Nom d'utilisateur admin"
T_EN[prompt_admin_email]='Admin email'
T_FR[prompt_admin_email]='Email admin'
T_EN[prompt_admin_pass]='Admin password (min 8 chars)'
T_FR[prompt_admin_pass]='Mot de passe admin (min 8 caractères)'
T_EN[conf_smtp]='04  Email configuration (SMTP)'
T_FR[conf_smtp]='04  Configuration email (SMTP)'
T_EN[smtp_use]='Account verification, password reset, notifications.'
T_FR[smtp_use]='Vérification de compte, reset de mot de passe, notifications.'
T_EN[smtp_compat]='Compatible with %sResend, Gmail, Mailgun, OVH%s or any SMTP server.'
T_FR[smtp_compat]='Compatible avec %sResend, Gmail, Mailgun, OVH%s ou tout serveur SMTP.'
T_EN[smtp_now]='Configure SMTP now? [y/N]:'
T_FR[smtp_now]='Configurer le SMTP maintenant ? [o/N] :'
T_EN[prompt_smtp_host]='SMTP host (e.g. smtp.resend.com)'
T_FR[prompt_smtp_host]='Hôte SMTP (ex: smtp.resend.com)'
T_EN[prompt_smtp_port]='SMTP port'
T_FR[prompt_smtp_port]='Port SMTP'
T_EN[smtp_force_tls]='Force TLS (port 465)? [y/N]:'
T_FR[smtp_force_tls]='TLS forcé (port 465) ? [o/N] :'
T_EN[prompt_smtp_user]='SMTP user (e.g. resend or user@domain.com)'
T_FR[prompt_smtp_user]='Utilisateur SMTP (ex: resend ou user@domain.com)'
T_EN[prompt_smtp_pass]='SMTP password / API key'
T_FR[prompt_smtp_pass]='Mot de passe / clé SMTP'
T_EN[prompt_smtp_from]='From address (e.g. noreply@mycommunity.com)'
T_FR[prompt_smtp_from]='Adresse expéditeur (ex: noreply@moncommunaute.fr)'
T_EN[smtp_configured]='SMTP configured (%s:%s)'
T_FR[smtp_configured]='SMTP configuré (%s:%s)'
T_EN[smtp_skipped]='SMTP skipped — emails will be disabled. Configurable later in nodyx-core/.env'
T_FR[smtp_skipped]='SMTP ignoré — les emails seront désactivés. Configurable plus tard dans nodyx-core/.env'

# §14 — DNS pre-check + recap
T_EN[dns_checking]='Checking DNS for %s%s%s...'
T_FR[dns_checking]='Vérification DNS de %s%s%s...'
T_EN[dns_unresolved]='DNS %s%s%s — unresolved (domain not configured or propagation in progress).'
T_FR[dns_unresolved]='DNS %s%s%s — non résolu (domaine non configuré ou propagation en cours).'
T_EN[dns_le_will_fail]="Let's Encrypt will not be able to issue a TLS certificate."
T_FR[dns_le_will_fail]="Let's Encrypt ne pourra pas générer de certificat TLS."
T_EN[dns_set_a]='→ Configure your A record: %s%s%s%s → %s%s'
T_FR[dns_set_a]='→ Configure ton enregistrement A : %s%s%s%s → %s%s'
T_EN[dns_fix_first]='Configure DNS first: %s → %s, then retry.'
T_FR[dns_fix_first]="Configure le DNS d'abord : %s → %s, puis relance."
T_EN[dns_mismatch]='DNS %s%s%s → %s%s%s  (this server IP: %s)'
T_FR[dns_mismatch]='DNS %s%s%s → %s%s%s  (IP de ce serveur : %s)'
T_EN[dns_le_mismatch_fail]="Mismatch! Let's Encrypt will fail — Caddy cannot validate the domain."
T_FR[dns_le_mismatch_fail]="Mismatch ! Let's Encrypt va échouer — Caddy ne peut pas valider le domaine."
T_EN[dns_update_a]='→ Update your A record at your registrar.'
T_FR[dns_update_a]="→ Mets à jour l'enregistrement A chez ton registrar."
T_EN[dns_fix_correct]='Fix DNS (%s must point to %s) then retry.'
T_FR[dns_fix_correct]='Corrige le DNS (%s doit pointer vers %s) puis relance.'
T_EN[dns_ok]='DNS %s → %s  ✔'
T_FR[dns_ok]='DNS %s → %s  ✔'
T_EN[recap_title]='│              Summary                              │'
T_FR[recap_title]='│              Récapitulatif                       │'
T_EN[recap_domain]='Domain     :'
T_FR[recap_domain]='Domaine    :'
T_EN[recap_sslip]='(sslip.io auto)'
T_FR[recap_sslip]='(sslip.io auto)'
T_EN[recap_community]='Community  :'
T_FR[recap_community]='Communauté :'
T_EN[recap_lang]='Language   :'
T_FR[recap_lang]='Langue     :'
T_EN[recap_admin]='Admin      :'
T_FR[recap_admin]='Admin      :'
T_EN[recap_mode]='Mode       :'
T_FR[recap_mode]='Mode       :'
T_EN[recap_smtp]='SMTP       :'
T_FR[recap_smtp]='SMTP       :'
T_EN[recap_smtp_off]='not configured'
T_FR[recap_smtp_off]='non configuré'
T_EN[start_install]='Start the installation?'
T_FR[start_install]="Lancer l'installation ?"

# §15 — System packages + Node + Caddy + PM2 + nodyx user
T_EN[step_install_deps]='Installing system dependencies'
T_FR[step_install_deps]='Installation des dépendances système'
T_EN[deps_installed]='System packages installed'
T_FR[deps_installed]='Paquets système installés'
T_EN[node_installing]='Installing Node.js 20 LTS...'
T_FR[node_installing]='Installation de Node.js 20 LTS...'
T_EN[node_installed]='Node.js %s installed'
T_FR[node_installed]='Node.js %s installé'
T_EN[node_present]='Node.js %s already present'
T_FR[node_present]='Node.js %s déjà présent'
T_EN[caddy_installing]='Installing Caddy...'
T_FR[caddy_installing]='Installation de Caddy...'
T_EN[caddy_installed]='Caddy %s installed'
T_FR[caddy_installed]='Caddy %s installé'
T_EN[caddy_already]='Caddy %s already present'
T_FR[caddy_already]='Caddy %s déjà présent'
T_EN[pm2_installed]='PM2 installed'
T_FR[pm2_installed]='PM2 installé'
T_EN[pm2_already]='PM2 already present'
T_FR[pm2_already]='PM2 déjà présent'
T_EN[pm2_logrotate_set]='pm2-logrotate configured (50M, 7 days)'
T_FR[pm2_logrotate_set]='pm2-logrotate configuré (50M, 7 jours)'
T_EN[step_create_user]='Creating system user'
T_FR[step_create_user]="Création de l'utilisateur système"
T_EN[user_created_full]="System user 'nodyx' created (/home/nodyx)"
T_FR[user_created_full]="Utilisateur système 'nodyx' créé (/home/nodyx)"
T_EN[user_already]="System user 'nodyx' already present"
T_FR[user_already]="Utilisateur système 'nodyx' déjà présent"

# §16 — PostgreSQL
T_EN[step_pg]='Configuring PostgreSQL'
T_FR[step_pg]='Configuration de PostgreSQL'
T_EN[pg_not_found]='PostgreSQL not found in /usr/lib/postgresql/ — incomplete install.'
T_FR[pg_not_found]='PostgreSQL introuvable dans /usr/lib/postgresql/ — installation incomplète.'
T_EN[pg_waiting]='Waiting for PostgreSQL to start...'
T_FR[pg_waiting]='Attente du démarrage de PostgreSQL...'
T_EN[pg_init]='PostgreSQL cluster not ready — initializing...'
T_FR[pg_init]='Cluster PostgreSQL non prêt — initialisation...'
T_EN[pg_install_pkg]='Installing postgresql-%s (server binaries missing)...'
T_FR[pg_install_pkg]='Installation de postgresql-%s (binaires serveur manquants)...'
T_EN[pg_recreate_cluster]='Data directory missing — recreating cluster...'
T_FR[pg_recreate_cluster]='Répertoire de données absent — recréation du cluster...'
T_EN[pg_did_not_start]="PostgreSQL didn't start after 60s.\nCheck: sudo pg_lsclusters  |  sudo systemctl status postgresql@%s-main"
T_FR[pg_did_not_start]="PostgreSQL n'a pas démarré après 60s.\nVérifie : sudo pg_lsclusters  |  sudo systemctl status postgresql@%s-main"
T_EN[pg_ready]='PostgreSQL %s ready'
T_FR[pg_ready]='PostgreSQL %s prêt'
T_EN[pg_wipe_dropping]='Wipe mode — dropping the existing database...'
T_FR[pg_wipe_dropping]='Mode réinitialisation — suppression de la base de données existante...'
T_EN[pg_db_dropped]="Database '%s' dropped"
T_FR[pg_db_dropped]="Base de données '%s' supprimée"
T_EN[pg_db_ready]="Database '%s' ready"
T_FR[pg_db_ready]="Base de données '%s' prête"

# §17 — Redis
T_EN[step_redis]='Configuring Redis'
T_FR[step_redis]='Configuration de Redis'
T_EN[redis_systemctl_fail]='systemctl redis-server failed — attempting direct daemon start...'
T_FR[redis_systemctl_fail]='systemctl redis-server échoué — tentative de démarrage direct...'
T_EN[redis_did_not_start]="Redis didn't start.\nCheck: sudo journalctl -xeu redis-server"
T_FR[redis_did_not_start]="Redis n'a pas démarré.\nVérifie : sudo journalctl -xeu redis-server"
T_EN[redis_started]='Redis started'
T_FR[redis_started]='Redis démarré'

# §18 — TURN + UFW + Relay
T_EN[step_turn]='Installing nodyx-turn (WebRTC voice relay)'
T_FR[step_turn]='Installation de nodyx-turn (relay vocal WebRTC)'
T_EN[turn_unsupported_arch]='Unsupported architecture for nodyx-turn: %s'
T_FR[turn_unsupported_arch]='Architecture non supportée pour nodyx-turn : %s'
T_EN[turn_downloading]='Downloading nodyx-turn %s (%s)...'
T_FR[turn_downloading]='Téléchargement nodyx-turn %s (%s)...'
T_EN[turn_dl_fail]="Could not download nodyx-turn.\nURL: %s\nCheck your connection and that the %s release exists on GitHub.\nWorkaround: re-run with --no-turn to skip nodyx-turn (voice will use public STUN only)."
T_FR[turn_dl_fail]="Impossible de télécharger nodyx-turn.\nURL : %s\nVérifie ta connexion et que la release %s existe sur GitHub.\nContournement : relance avec --no-turn pour ignorer nodyx-turn (le vocal utilisera uniquement un STUN public)."
T_EN[turn_not_binary]="The downloaded file is not a valid binary.\nURL: %s"
T_FR[turn_not_binary]="Le fichier téléchargé n'est pas un binaire valide.\nURL : %s"
T_EN[turn_started]='nodyx-turn started (IP: %s, UDP port 3478)'
T_FR[turn_started]='nodyx-turn démarré (IP: %s, port UDP 3478)'
T_EN[step_firewall]='Configuring the firewall'
T_FR[step_firewall]='Configuration du pare-feu'
T_EN[ufw_existing_saved]='Existing UFW rules saved to %s'
T_FR[ufw_existing_saved]='Règles UFW existantes sauvegardées dans %s'
T_EN[ufw_rollback_msg]="warn 'UFW modified — restore manually if needed: ufw --force reset && ufw allow ssh && ufw --force enable'"
T_FR[ufw_rollback_msg]="warn 'UFW modifié — restaure manuellement si besoin : ufw --force reset && ufw allow ssh && ufw --force enable'"
T_EN[ufw_configured]='Firewall configured%s'
T_FR[ufw_configured]='Pare-feu configuré%s'
T_EN[ufw_relay_note]=' (Relay mode — only SSH open, outbound free)'
T_FR[ufw_relay_note]=' (mode Relay — seul SSH ouvert, connexions sortantes libres)'
T_EN[step_relay_dl]='Downloading the Nodyx Relay Client binary'
T_FR[step_relay_dl]='Téléchargement du binaire Nodyx Relay Client'
T_EN[relay_unsupported_arch]='Unsupported architecture for Nodyx Relay: %s (supported: x86_64, aarch64)'
T_FR[relay_unsupported_arch]='Architecture non supportée pour Nodyx Relay : %s (supporté: x86_64, aarch64)'
T_EN[relay_downloading]='Downloading nodyx-relay %s (%s)...'
T_FR[relay_downloading]='Téléchargement nodyx-relay %s (%s)...'
T_EN[relay_dl_fail]="Could not download nodyx-relay.\nURL: %s\nCheck your connection and that the %s release exists on GitHub."
T_FR[relay_dl_fail]="Impossible de télécharger nodyx-relay.\nURL : %s\nVérifie ta connexion et que la release %s existe sur GitHub."
T_EN[relay_not_binary]="The downloaded file is not a valid binary (release missing?).\nURL: %s"
T_FR[relay_not_binary]="Le fichier téléchargé n'est pas un binaire valide (release introuvable ?).\nURL : %s"
T_EN[relay_installed]='nodyx-relay %s installed'
T_FR[relay_installed]='nodyx-relay %s installé'

# §19 — Clone + Core .env + builds
T_EN[step_clone]='Downloading Nodyx'
T_FR[step_clone]='Téléchargement de Nodyx'
T_EN[clone_updating]='Updating existing repository...'
T_FR[clone_updating]='Mise à jour du dépôt existant...'
T_EN[clone_cloning]='Cloning repository into %s...'
T_FR[clone_cloning]='Clonage du dépôt dans %s...'
T_EN[clone_done]='Nodyx code present in %s'
T_FR[clone_done]='Code Nodyx présent dans %s'
T_EN[ver_from_repo]='Version detected from repo: %s'
T_FR[ver_from_repo]='Version détectée depuis le dépôt : %s'
T_EN[clone_dir_dirty]="Target directory %s already exists and is not a git clone of Nodyx.\nMove or delete it, then re-run the installer."
T_FR[clone_dir_dirty]="Le dossier cible %s existe déjà et n'est pas un clone git de Nodyx.\nDéplace-le ou supprime-le, puis relance l'installeur."
T_EN[step_backend]='Configuring the backend (nodyx-core)'
T_FR[step_backend]='Configuration du backend (nodyx-core)'
T_EN[backend_npm_install_label]='npm install (backend)...'
T_FR[backend_npm_install_label]='npm install (backend)...'
T_EN[backend_npm_install_fail2]='Backend npm install failed. Check your Internet connection.'
T_FR[backend_npm_install_fail2]='npm install backend échoué. Vérifie ta connexion Internet.'
T_EN[backend_compile_label]='TypeScript compile (backend)...'
T_FR[backend_compile_label]='Compilation TypeScript (backend)...'
T_EN[backend_build_fail2]='Backend build failed. Check the logs above.'
T_FR[backend_build_fail2]='Build backend échoué. Vérifie les logs ci-dessus.'
T_EN[backend_dist_missing]="dist/index.js missing — TypeScript build produced no output."
T_FR[backend_dist_missing]="dist/index.js absent — le build TypeScript n'a pas produit de sortie."
T_EN[step_frontend]='Configuring the frontend (nodyx-frontend)'
T_FR[step_frontend]='Configuration du frontend (nodyx-frontend)'
T_EN[front_npm_install_label]='npm install (frontend)...'
T_FR[front_npm_install_label]='npm install (frontend)...'
T_EN[front_npm_install_fail2]='Frontend npm install failed. Check your Internet connection.'
T_FR[front_npm_install_fail2]='npm install frontend échoué. Vérifie ta connexion Internet.'
T_EN[rollup_arm64_force]='ARM64 Rollup binary missing — forcing install...'
T_FR[rollup_arm64_force]='Binaire Rollup ARM64 absent — installation forcée...'
T_EN[front_low_ram_node_cap]='Low RAM (%s MB) — Node heap capped at 512 MB for the build'
T_FR[front_low_ram_node_cap]='RAM limitée (%s MB) — heap Node plafonné à 512 MB pour le build'
T_EN[front_build_label]='Build SvelteKit (may take 2-5 min on ARM%s)...'
T_FR[front_build_label]='Build SvelteKit (peut durer 2-5 min sur ARM%s)...'
T_EN[front_build_label_rpi]=', ~8 min on RPi 1 GB'
T_FR[front_build_label_rpi]=', ~8 min sur RPi 1 GB'
T_EN[front_build_fail2]='Frontend build failed. Check the logs above.'
T_FR[front_build_fail2]='Build frontend échoué. Vérifie les logs ci-dessus.'
T_EN[front_build_missing]="build/index.js missing — SvelteKit build produced no output."
T_FR[front_build_missing]="build/index.js absent — le build SvelteKit n'a pas produit de sortie."

# §20 — Caddy + PM2 ecosystem
T_EN[step_caddy]='Configuring Caddy (HTTPS proxy)'
T_FR[step_caddy]='Configuration de Caddy (proxy HTTPS)'
T_EN[caddy_relay_done]='Caddy configured (local HTTP port 80 — TLS handled by relay.nodyx.org)'
T_FR[caddy_relay_done]='Caddy configuré (HTTP local port 80 — TLS géré par relay.nodyx.org)'
T_EN[caddy_le_done]="Caddy configured (Let's Encrypt automatic for %s)"
T_FR[caddy_le_done]="Caddy configuré (Let's Encrypt automatique pour %s)"
T_EN[step_pm2_eco]='Configuring PM2'
T_FR[step_pm2_eco]='Configuration de PM2'

# §21 — PM2 startup + bootstrap (community + admin)
T_EN[pm2_user_done]="PM2 configured under user 'nodyx'"
T_FR[pm2_user_done]="PM2 configuré sous l'utilisateur 'nodyx'"
T_EN[pm2_check_5s]='Checking process startup (5s)...'
T_FR[pm2_check_5s]='Vérification du démarrage des processus (5s)...'
T_EN[pm2_app_online]='  %s — online'
T_FR[pm2_app_online]='  %s — online'
T_EN[pm2_app_status]='%s — status: %s'
T_FR[pm2_app_status]='%s — statut : %s'
T_EN[pm2_logs_label]='Startup logs:'
T_FR[pm2_logs_label]='Logs de démarrage :'
T_EN[step_bootstrap]='Initializing the community and admin account'
T_FR[step_bootstrap]='Initialisation de la communauté et du compte administrateur'
T_EN[backend_starting]='Backend starting (migrations included)...'
T_FR[backend_starting]='Backend en démarrage (migrations incluses)...'
T_EN[backend_ready]='Backend up (%ss)'
T_FR[backend_ready]='Backend opérationnel (%ss)'
T_EN[backend_not_ready]='Backend did not become operational after 180s.'
T_FR[backend_not_ready]='Backend non opérationnel après 180s.'
T_EN[pm2_logs_core]='PM2 logs (nodyx-core):'
T_FR[pm2_logs_core]='Logs PM2 (nodyx-core) :'
T_EN[pm2_restart_hint]='To restart: runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart nodyx-core'
T_FR[pm2_restart_hint]='Pour relancer : runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart nodyx-core'
T_EN[pm2_debug_hint]='To debug: runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core'
T_FR[pm2_debug_hint]='Pour déboguer : runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core'
T_EN[admin_create_anyway]='Trying to create the admin account anyway...'
T_FR[admin_create_anyway]='Tentative de création du compte admin quand même...'
T_EN[admin_created]="Account '%s' created"
T_FR[admin_created]="Compte '%s' créé"
T_EN[admin_exists]="Account '%s' already exists (reinstall?)"
T_FR[admin_exists]="Compte '%s' déjà existant (réinstallation ?)"
T_EN[admin_try_n]='Attempt %s/3 — HTTP %s : %s'
T_FR[admin_try_n]='Tentative %s/3 — HTTP %s : %s'
T_EN[admin_retry_in]='Retry in 8s...'
T_FR[admin_retry_in]='Retry dans 8s...'
T_EN[admin_register_failed]='Registration failed after 3 attempts.'
T_FR[admin_register_failed]='Inscription impossible après 3 tentatives.'
T_EN[admin_register_manual]='You can create your account at https://%s/auth/register'
T_FR[admin_register_manual]='Tu pourras créer ton compte sur https://%s/auth/register'
T_EN[community_created]="Community '%s' created, %s → owner"
T_FR[community_created]="Communauté '%s' créée, %s → owner"
T_EN[user_not_found_db]='User not found in DB. Community init skipped.'
T_FR[user_not_found_db]='Utilisateur introuvable en DB. Initialisation communauté ignorée.'
T_EN[user_register_at]='Start the backend and create your account at https://%s/auth/register'
T_FR[user_register_at]='Lance le backend et crée ton compte sur https://%s/auth/register'

# §22 — Free nodyx.org subdomain
T_EN[step_subdomain]='Free nodyx.org subdomain'
T_FR[step_subdomain]='Sous-domaine gratuit nodyx.org'
T_EN[sub_relay_required]='Relay mode: registering %s is required — automatic.'
T_FR[sub_relay_required]='Mode Relay : enregistrement de %s obligatoire — automatique.'
T_EN[sub_auto_explain]='You have no domain of your own: %s will be activated'
T_FR[sub_auto_explain]="Tu n'as pas de domaine propre : %s va être activé"
T_EN[sub_auto_explain2]='automatically as a memorable alias for your instance.'
T_FR[sub_auto_explain2]='automatiquement comme alias mémorable pour ton instance.'
T_EN[sub_skipped_flag]='nodyx.org subdomain skipped (--no-subdomain)'
T_FR[sub_skipped_flag]='Sous-domaine nodyx.org ignoré (--no-subdomain)'
T_EN[sub_optional_alias]='Optional alias: %s'
T_FR[sub_optional_alias]='Alias optionnel : %s'
T_EN[sub_alias_redirect]='Redirects to your instance — useful as a memorable shortcut.'
T_FR[sub_alias_redirect]='Redirige vers ton instance — utile comme raccourci mémorable.'
T_EN[sub_enable_q]='Enable %s? [Y/n] '
T_FR[sub_enable_q]='Activer %s ? [O/n] '
T_EN[sub_registering]='Registering with the nodyx.org directory...'
T_FR[sub_registering]='Enregistrement auprès du directory nodyx.org...'
T_EN[sub_registered]='Registered! Subdomain: %s'
T_FR[sub_registered]='Enregistré ! Sous-domaine : %s'
T_EN[sub_dns_30s]='DNS will be active in ~30 seconds.'
T_FR[sub_dns_30s]='Le DNS sera actif dans ~30 secondes.'
T_EN[sub_save_token]='Save the directory token — needed for heartbeats and unregistering.'
T_FR[sub_save_token]='Sauvegarde le token directory — nécessaire pour les heartbeats et la désinscription.'
T_EN[sub_slug_taken]="The slug '%s' is already registered in the directory."
T_FR[sub_slug_taken]="Le slug '%s' est déjà enregistré dans le directory."
T_EN[sub_options]='Options:'
T_FR[sub_options]='Options :'
T_EN[sub_choose_new_slug]='[1] Choose a different slug now'
T_FR[sub_choose_new_slug]='[1] Choisir un slug différent maintenant'
T_EN[sub_cancel_contact]='[2] Cancel (contact nodyx.org support to release the slug)'
T_FR[sub_cancel_contact]='[2] Annuler (contacte le support nodyx.org pour libérer le slug)'
T_EN[sub_choice_prompt]='Choice [1-2] (default: 1):'
T_FR[sub_choice_prompt]='Choix [1-2] (défaut: 1) :'
T_EN[sub_new_slug_prompt]='New slug (letters, numbers, dashes):'
T_FR[sub_new_slug_prompt]='Nouveau slug (lettres, chiffres, tirets) :'
T_EN[sub_slug_empty]='Empty slug — installation cancelled.'
T_FR[sub_slug_empty]='Slug vide — installation annulée.'
T_EN[sub_register_new_failed]='Registration failed with the new slug. Check your connection and retry.'
T_FR[sub_register_new_failed]='Enregistrement échoué avec le nouveau slug. Vérifie ta connexion et réessaie.'
T_EN[sub_install_cancelled]="Installation cancelled. Contact nodyx.org support to release the slug '%s'."
T_FR[sub_install_cancelled]="Installation annulée. Contacte le support nodyx.org pour libérer le slug '%s'."
T_EN[sub_reinstall_overwrite]='If this is a reinstall, the old entry will be overwritten on the next ping.'
T_FR[sub_reinstall_overwrite]="Si c'est une réinstallation, l'ancienne entrée sera écrasée au prochain ping."
T_EN[sub_register_failed]='Registration failed.'
T_FR[sub_register_failed]='Enregistrement échoué.'
T_EN[sub_response_label]='Response: %s'
T_FR[sub_response_label]='Réponse : %s'
T_EN[sub_retry_later]='You can retry manually later at https://nodyx.org'
T_FR[sub_retry_later]='Tu peux réessayer manuellement plus tard sur https://nodyx.org'
T_EN[sub_relay_needs_slug]='Directory registration failed. Relay mode requires a valid slug.'
T_FR[sub_relay_needs_slug]='Enregistrement au directory échoué. Le mode Relay nécessite un slug valide.'
T_EN[sub_skipped]='Free subdomain skipped. You will use https://%s'
T_FR[sub_skipped]='Sous-domaine gratuit ignoré. Tu utiliseras https://%s'

# §23 — Relay client systemd service
T_EN[step_relay_client]='Configuring the Nodyx Relay Client service'
T_FR[step_relay_client]='Configuration du service Nodyx Relay Client'
T_EN[relay_client_started]='Nodyx Relay Client started — tunnel to relay.nodyx.org:7443 active'
T_FR[relay_client_started]='Nodyx Relay Client démarré — tunnel vers relay.nodyx.org:7443 actif'
T_EN[relay_client_url_soon]='Your instance will be reachable at https://%s in a few seconds.'
T_FR[relay_client_url_soon]='Ton instance sera accessible sur https://%s dans quelques secondes.'

# §24 — Scripts (update + doctor)
T_EN[update_script_done]='Update script: %snodyx-update%s (sudo nodyx-update)'
T_FR[update_script_done]='Script de mise à jour : %snodyx-update%s (sudo nodyx-update)'
T_EN[doctor_script_done]='Diagnostic script  : %snodyx-doctor%s (sudo nodyx-doctor)'
T_FR[doctor_script_done]='Script de diagnostic  : %snodyx-doctor%s (sudo nodyx-doctor)'

# §25 — Healthcheck
T_EN[step_healthcheck]='Post-installation check'
T_FR[step_healthcheck]='Vérification post-installation'
T_EN[hc_services]='System services'
T_FR[hc_services]='Services système'
T_EN[hc_pm2]='Nodyx (PM2)'
T_FR[hc_pm2]='Nodyx (PM2)'
T_EN[hc_net]='Network & HTTPS'
T_FR[hc_net]='Réseau & HTTPS'
T_EN[hc_directory]='Nodyx directory'
T_FR[hc_directory]='Annuaire Nodyx'
T_EN[hc_api_local_ok]='Local API http://localhost/api/v1/instance/info  →  HTTP %s'
T_FR[hc_api_local_ok]='API locale http://localhost/api/v1/instance/info  →  HTTP %s'
T_EN[hc_api_local_warn]='Local API  →  HTTP %s  %s(backend starting?)%s'
T_FR[hc_api_local_warn]='API locale  →  HTTP %s  %s(backend en démarrage ?)%s'
T_EN[hc_url_via_tunnel]='Public URL: https://%s  %s(via relay tunnel — not locally verifiable)%s'
T_FR[hc_url_via_tunnel]='URL publique : https://%s  %s(via tunnel relay — non vérifiable localement)%s'
T_EN[hc_dns_ok]='DNS %s  →  %s'
T_FR[hc_dns_ok]='DNS %s  →  %s'
T_EN[hc_dns_unresolved]='DNS %s  →  unresolved  %s(propagation in progress?)%s'
T_FR[hc_dns_unresolved]='DNS %s  →  non résolu  %s(propagation en cours ?)%s'
T_EN[hc_wait_tls]='Waiting for TLS certificate…'
T_FR[hc_wait_tls]='Attente certificat TLS…'
T_EN[hc_https_ok]='HTTPS https://%s'
T_FR[hc_https_ok]='HTTPS https://%s'
T_EN[hc_https_timeout]="HTTPS https://%s  →  timeout  %s(Let's Encrypt cert in progress)%s"
T_FR[hc_https_timeout]="HTTPS https://%s  →  timeout  %s(cert Let's Encrypt en cours de génération)%s"
T_EN[hc_api_ok]='API /api/v1/instance/info  →  HTTP %s'
T_FR[hc_api_ok]='API /api/v1/instance/info  →  HTTP %s'
T_EN[hc_api_warn]='API /api/v1/instance/info  →  HTTP %s'
T_FR[hc_api_warn]='API /api/v1/instance/info  →  HTTP %s'
T_EN[hc_dir_dns_ok]='DNS %s  →  %s'
T_FR[hc_dir_dns_ok]='DNS %s  →  %s'
T_EN[hc_dir_dns_propagating]='DNS %s  →  propagating  %s(~30s, this is normal)%s'
T_FR[hc_dir_dns_propagating]="DNS %s  →  propagation en cours  %s(~30s, c'est normal)%s"
T_EN[hc_dir_active]='Directory  →  instance %sactive%s'
T_FR[hc_dir_active]='Annuaire  →  instance %sactive%s'
T_EN[hc_dir_status]='Directory  →  status: %s'
T_FR[hc_dir_status]='Annuaire  →  statut : %s'
T_EN[hc_dir_unreachable]='Directory  →  unreachable  %s(normal if DNS propagating)%s'
T_FR[hc_dir_unreachable]='Annuaire  →  non joignable  %s(normal si DNS en propagation)%s'
T_EN[hc_all_green]='✔  %s/%s checks — ALL GREEN!'
T_FR[hc_all_green]='✔  %s/%s vérifications — TOUT EST AU VERT !'
T_EN[hc_warnings]='⚠  %s/%s OK — %s warning(s) to address'
T_FR[hc_warnings]='⚠  %s/%s OK — %s avertissement(s) à corriger'
T_EN[hc_failures]='✘  %s/%s OK — %s error(s) / %s warning(s)'
T_FR[hc_failures]='✘  %s/%s OK — %s erreur(s) / %s avertissement(s)'

# §26 — Final summary banner
T_EN[banner_online]='║    ✦   N O D Y X   ·   I N S T A N C E   O N L I N E   ✦  ║'
T_FR[banner_online]='║   ✦   N O D Y X   ·   I N S T A N C E   E N   L I G N E   ✦  ║'
T_EN[summ_instance]='Instance'
T_FR[summ_instance]='Instance'
T_EN[summ_alias]='Alias   '
T_FR[summ_alias]='Alias   '
T_EN[summ_admin]='Admin   '
T_FR[summ_admin]='Admin   '
T_EN[summ_voice]='Voice   '
T_FR[summ_voice]='Vocal   '
T_EN[summ_relay]='Relay   '
T_FR[summ_relay]='Relay   '
T_EN[summ_version]='Version '
T_FR[summ_version]='Version '
T_EN[summ_dir]='Folder  '
T_FR[summ_dir]='Dossier '
T_EN[summ_management]='▸ Management'
T_FR[summ_management]='▸ Gestion'
T_EN[summ_or_systemd]='# or via systemd:'
T_FR[summ_or_systemd]='# ou via systemd :'
T_EN[summ_update]='▸ Update'
T_FR[summ_update]='▸ Mise à jour'
T_EN[summ_update_hint]='git pull + rebuild + restart'
T_FR[summ_update_hint]='git pull + rebuild + restart'
T_EN[summ_database]='▸ Database'
T_FR[summ_database]='▸ Base de données'
T_EN[summ_diag]='▸ Diagnostic'
T_FR[summ_diag]='▸ Diagnostic'
T_EN[summ_diag_hint]='full report (services, TLS, DB, RAM...)'
T_FR[summ_diag_hint]='rapport complet (services, TLS, DB, RAM...)'
T_EN[summ_relay_tunnel]='▸ Relay tunnel'
T_FR[summ_relay_tunnel]='▸ Tunnel Relay'
T_EN[summ_creds_arrow]='Credentials →'
T_FR[summ_creds_arrow]='Credentials →'
T_EN[summ_creds_warn]='(keep this file safe — never share it)'
T_FR[summ_creds_warn]='(garde ce fichier en lieu sûr — ne le partage jamais)'
T_EN[summ_relay_no_dns]='✔  Relay mode — no port to open, no DNS to configure.'
T_FR[summ_relay_no_dns]='✔  Mode Relay — aucun port à ouvrir, aucun DNS à configurer.'
T_EN[summ_dns_check]='⚠  Make sure your DNS %s%s%s%s points to %s'
T_FR[summ_dns_check]='⚠  Assure-toi que ton DNS %s%s%s%s pointe vers %s'

# __T_END__

# Looks up T_<LANG>[KEY], falls back to T_EN[KEY], falls back to KEY itself.
t() {
  local _k="$1"; shift
  local _v
  case "$NODYX_LANG" in
    fr) _v="${T_FR[$_k]:-${T_EN[$_k]:-$_k}}" ;;
    *)  _v="${T_EN[$_k]:-$_k}" ;;
  esac
  if (( $# > 0 )); then
    # shellcheck disable=SC2059
    printf "$_v" "$@"
  else
    printf '%s' "$_v"
  fi
}

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
  ██║╚██╗██║██║   ██║██║  ██║  ╚██╔╝   ██╔██╗
  ██║ ╚████║╚██████╔╝██████╔╝   ██║   ██╔╝ ██╗
  ╚═╝  ╚═══╝ ╚═════╝ ╚═════╝   ╚═╝   ╚═╝  ╚═╝
EOF
  echo -e "${RESET}"
  echo -e "  ${CYAN}$(printf '═%.0s' {1..52})${RESET}"
  echo -e "  ${CYAN}║${RESET}  ${BOLD}Installer v2.2${RESET}  ·  $(t banner_subtitle)    ${CYAN}║${RESET}"
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
  echo -e "  ${CYAN}◈${RESET}  $(t banner_disk_label)    ${BOLD}${_disk} $(t banner_disk_avail)${RESET}"
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
    echo -e "${GREEN}${BOLD}$(t upgrade_title "$from_ver" "$to_ver")${RESET}"
  else
    echo -e "${CYAN}${BOLD}$(t repair_title "$from_ver")${RESET}"
  fi
  echo ""

  # Ensure the 'nodyx' system user exists (may be missing on old installs)
  if ! id -u nodyx &>/dev/null; then
    info "$(t user_create)"
    useradd -r -s /usr/sbin/nologin -m -d /home/nodyx nodyx
    ok "$(t user_created)"
  fi
  mkdir -p /home/nodyx/.pm2/logs
  chown -R nodyx:nodyx /home/nodyx/.pm2 2>/dev/null || true

  # pm2-logrotate si absent (vérifier sur le daemon nodyx)
  if ! runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null | grep -q 'pm2-logrotate'; then
    npm install -g pm2-logrotate --silent 2>/dev/null || true
    runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 set pm2-logrotate:max_size 50M 2>/dev/null || true
    runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 set pm2-logrotate:retain 7 2>/dev/null || true
  fi

  # Arrêter les anciens processus PM2 root (migration nexus-* → nodyx-*)
  for _old_proc in nexus-core nexus-frontend nodyx-core nodyx-frontend; do
    pm2 delete "$_old_proc" 2>/dev/null || true
  done
  # Libérer les ports même si les process appartiennent à un autre utilisateur
  for _port in 3000 4173; do
    fuser -k "${_port}/tcp" 2>/dev/null || true
  done

  info "$(t code_fetch)"
  git config --global --add safe.directory "$dir" 2>/dev/null || true
  # Reset generated files (package-lock.json, ecosystem.config.js…) to unblock the pull
  # ecosystem.config.js is in the repo but rewritten by the installer — reset to avoid a git conflict
  git -C "$dir" checkout -- nodyx-core/package-lock.json nodyx-frontend/package-lock.json ecosystem.config.js 2>/dev/null || true
  git -C "$dir" pull --ff-only || die "$(t git_pull_fail)"
  ok "$(t code_uptodate)"

  info "$(t backend_rebuild)"
  cd "${dir}/nodyx-core"
  npm install --no-fund --no-audit --silent || die "$(t npm_install_backend_fail)"
  npm run build || die "$(t backend_build_fail)"
  ok "$(t backend_built)"

  info "$(t frontend_rebuild)"
  cd "${dir}/nodyx-frontend"
  export NODE_OPTIONS="--max-old-space-size=1024"
  npm install --no-fund --no-audit --silent || die "$(t npm_install_frontend_fail)"
  npm run build || die "$(t frontend_build_fail)"
  unset NODE_OPTIONS
  ok "$(t frontend_built)"

  info "$(t services_restart)"
  chown -R nodyx:nodyx "$dir" 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart "${dir}/ecosystem.config.js" --update-env 2>/dev/null \
    || runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 startOrRestart "${dir}/ecosystem.config.js" --update-env
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save

  # ── Relay client : recréer le service s'il est absent (upgrade depuis ancienne install) ──
  local _env_file="${dir}/nodyx-core/.env"
  local _dir_token; _dir_token=$(grep '^DIRECTORY_TOKEN=' "$_env_file" 2>/dev/null | cut -d= -f2- || true)
  local _slug;      _slug=$(grep '^NODYX_COMMUNITY_SLUG=' "$_env_file" 2>/dev/null | cut -d= -f2- || true)
  if [[ -n "$_dir_token" && -n "$_slug" ]] && ! systemctl is-active --quiet nodyx-relay-client 2>/dev/null; then
    if [[ -f /usr/local/bin/nodyx-relay ]]; then
      info "$(t relay_recreate)"
      cat > /etc/systemd/system/nodyx-relay-client.service <<_SVC
[Unit]
Description=Nodyx Relay Client
After=network.target
[Service]
ExecStart=/usr/local/bin/nodyx-relay client --server relay.nodyx.org:7443 --slug ${_slug} --token ${_dir_token} --local-port 80
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=60
StartLimitBurst=5
User=nodyx
[Install]
WantedBy=multi-user.target
_SVC
      systemctl daemon-reload
      systemctl enable nodyx-relay-client --quiet
      systemctl start nodyx-relay-client
      ok "$(t relay_restarted)"
    fi
  fi

  _new_ver=$(node -p "require('${dir}/nodyx-core/package.json').version" 2>/dev/null || echo "$to_ver")
  echo ""
  echo -e "  ${GREEN}${BOLD}$(t upgrade_done "$_new_ver")${RESET}"
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
  echo -e "${RED}${BOLD}$(t rollback_failed "$_ec")${RESET}"
  for (( _ri=${#_ROLLBACK_STEPS[@]}-1; _ri>=0; _ri-- )); do
    info "  ↩ ${_ROLLBACK_STEPS[$_ri]%%#*}"
    eval "${_ROLLBACK_STEPS[$_ri]}" 2>/dev/null || true
  done
  echo ""
  if [[ -x /usr/local/bin/nodyx-doctor ]]; then
    echo -e "${YELLOW}$(t rollback_doctor_hint "${BOLD}" "${RESET}${YELLOW}")${RESET}"
  else
    echo -e "${YELLOW}$(t rollback_manual_hint)${RESET}"
    echo -e "${YELLOW}    • PM2  : ${BOLD}runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list${RESET}"
    echo -e "${YELLOW}    • Logs : ${BOLD}journalctl -u nodyx-core -n 50${RESET}"
    echo -e "${YELLOW}    • DB   : ${BOLD}sudo -u postgres psql -c '\\l'${RESET}"
    echo -e "${YELLOW}$(t rollback_relaunch)${RESET}"
  fi
  echo ""
}
trap '_nodyx_rollback' EXIT

# ── Auto-backup DB avant action destructive ───────────────────────────────────
_auto_backup_db() {
  local reason="${1:-pre-action}"
  [[ "${_DB_EXISTS:-false}" == "true" ]] || return 0
  local bak="/root/nodyx-db-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
  info "$(t db_autobackup "$reason")"
  if sudo -u postgres pg_dump nodyx 2>/dev/null | gzip > "$bak"; then
    local sz; sz=$(du -sh "$bak" 2>/dev/null | cut -f1 || echo "?")
    ok "$(t db_autobackup_done "${BOLD}" "$bak" "${RESET}" "$sz")"
    _rollback_register "$(t db_autobackup_restore_hint "$bak")"
  else
    warn "$(t db_autobackup_fail)"
    rm -f "$bak"
  fi
}

# ── Version ────────────────────────────────────────────────────────────────────
NODYX_VERSION="2.2.0"
INSTALLER_VERSION="2.2.0"

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
      echo "$(t help_slug)"
      echo "$(t help_name)"
      echo "$(t help_admin_user)"
      echo "$(t help_admin_email)"
      echo "$(t help_admin_pass)"
      echo ""
      echo "$(t help_options_header)"
      echo "$(t help_yes)"
      echo "$(t help_no_turn)"
      echo "$(t help_no_subdomain)"
      echo "$(t help_lang)"
      echo "$(t help_help)"
      echo ""
      exit 0 ;;
    --lang=*) ;;  # already handled at i18n init
    --*) warn "$(t unknown_flag "${_arg}")" ;;
  esac
done

# Shortcut: --yes auto-confirms (replaces read -rp for confirmations)
_confirm() {
  # Usage: _confirm "message" [default=y]  → returns 0 if yes, 1 if no
  local msg="$1" default="${2:-y}"
  # Accept legacy 'o' (oui) as default for backward compat with FR-era callers
  [[ "$default" == "o" ]] && default="y"
  if $_AUTO_YES; then info "$(t confirm_auto_yes "$msg")"; return 0; fi
  read -rp "$(echo -e "  ${BOLD}${msg} $(t confirm_yn): ${RESET}")" _c </dev/tty
  _c="${_c:-$default}"
  # 'n' rejects; everything else (y/Y/o/O/empty) accepts — works regardless of UI language
  [[ "${_c,,}" != "n" ]]
}

#
# TODO — Phase 6 (quand RHEL/Rocky/Alma sera ajouté) :
#   Refacto modulaire en install/ (apt vs dnf, firewall, package names).
#   Un seul install.sh entry point, des modules sourcés par fonction.
#   NE PAS FAIRE avant d'avoir un vrai cas d'usage RHEL à tester.

prompt() {
  local var="$1" msg="$2" default="${3:-}" val=''
  # If the variable is already pre-filled (via CLI arg), skip the prompt
  local _preset="${!var:-}"
  if [[ -n "$_preset" ]]; then
    info "$(t prompt_preset "$msg" "${BOLD}" "${_preset}" "${RESET}" "${CYAN}" "${RESET}")"
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
    [[ -n "$val" ]] && echo -e "  ${YELLOW}⚠${RESET}  $(t secret_too_short "$minlen")"
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
      [[ -n "$val" ]] && echo -e "  ${YELLOW}⚠${RESET}  $(t secret_too_short "$minlen")"
      read -rsp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val </dev/tty
      echo
    done
    read -rsp "$(echo -e "  ${CYAN}?${RESET} $(t secret_confirm): ")" val2 </dev/tty
    echo
    if [[ "$val" == "$val2" ]]; then
      break
    else
      echo -e "  ${RED}✘${RESET}  $(t secret_mismatch)"
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
    echo -e "  ${RED}✘${RESET}  $(t run_bg_fail "$label")"
    echo -e "  ${YELLOW}$(t run_bg_tail)${RESET}"
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

[[ $EUID -ne 0 ]] && die "$(t require_root)"

# OS check
if ! grep -qiE 'ubuntu|debian' /etc/os-release 2>/dev/null; then
  die "$(t unsupported_os)"
fi

# Architecture check — Rollup 4 (Vite 7) has no native binary for ARM 32-bit
_ARCH=$(uname -m)
if [[ "$_ARCH" == "armv7l" || "$_ARCH" == "armv6l" ]]; then
  die "$(t arm32_unsupported "${_ARCH}")"
fi

# On ARM64: explicitly install the native Rollup binary
# (npm optionalDependencies may miss it in some ARM configs)
if [[ "$_ARCH" == "aarch64" ]]; then
  info "$(t arm64_detected)"
fi

# RAM check — auto-swap si insuffisant + adaptation des limites PM2 selon la RAM totale
_RAM_TOTAL_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $2}' || echo 9999)
_RAM_FREE_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $7}' || echo 9999)
_SWAP_TOTAL_MB=$(free -m 2>/dev/null | awk '/^Swap/{print $2}' || echo 0)

# Limites PM2 adaptées selon la RAM totale disponible sur la machine
# < 1.5 GB  → petit RPi (1 GB) : limites conservatrices + swap 2 GB
# 1.5–3 GB  → RPi 4 2-4 GB / petit VPS : limites intermédiaires
# ≥ 3 GB    → VPS standard : limites normales
if [[ "$_RAM_TOTAL_MB" -lt 1500 ]]; then
  _PM2_CORE_MEM="256M"
  _PM2_FRONT_MEM="192M"
  _SWAP_SIZE_GB=2
  warn "$(t ram_low_econ "${_RAM_TOTAL_MB}" "${_SWAP_SIZE_GB}")"
elif [[ "$_RAM_TOTAL_MB" -lt 3000 ]]; then
  _PM2_CORE_MEM="384M"
  _PM2_FRONT_MEM="256M"
  _SWAP_SIZE_GB=1
  info "$(t ram_mid "${_RAM_TOTAL_MB}")"
else
  _PM2_CORE_MEM="512M"
  _PM2_FRONT_MEM="512M"
  _SWAP_SIZE_GB=1
fi

if [[ "$_RAM_FREE_MB" -lt 512 ]]; then
  warn "$(t ram_avail_warn "${_RAM_FREE_MB}")"
  if [[ $(( _RAM_FREE_MB + _SWAP_TOTAL_MB )) -lt 512 ]]; then
    info "$(t swap_creating "${_SWAP_SIZE_GB}")"
    if [[ ! -f /swapfile ]]; then
      fallocate -l "${_SWAP_SIZE_GB}G" /swapfile 2>/dev/null \
        || dd if=/dev/zero of=/swapfile bs=1M count=$(( _SWAP_SIZE_GB * 1024 )) status=none
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
      swapon /swapfile
      grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
      ok "$(t swap_created "${_SWAP_SIZE_GB}")"
    else
      swapon /swapfile 2>/dev/null || true
      ok "$(t swap_existing)"
    fi
  else
    ok "$(t ram_swap_ok "${_RAM_FREE_MB}" "${_SWAP_TOTAL_MB}")"
  fi
fi

# Disk check — npm + build = ~700 MB minimum
_DISK_FREE_MB=$(df -m /opt 2>/dev/null | awk 'NR==2{print $4}' || echo 9999)
if [[ "$_DISK_FREE_MB" -lt 1024 ]]; then
  warn "$(t disk_low "${_DISK_FREE_MB}")"
  _confirm "$(t continue_anyway)" || die "$(t install_cancelled_disk)"
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

# Active PM2 processes (root user)
if command -v pm2 &>/dev/null && pm2 list 2>/dev/null | grep -qE 'nodyx-core|nodyx-frontend'; then
  _EXISTING=true
  _EXISTING_MSGS+=("$(t detect_pm2_root)")
fi
# Active PM2 processes (nodyx user)
if id -u nodyx &>/dev/null && runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null | grep -qE 'nodyx-core|nodyx-frontend'; then
  _EXISTING=true
  _EXISTING_MSGS+=("$(t detect_pm2_nodyx)")
fi
# Installation directory
if [[ -d "$_NODYX_CHECK_DIR" ]]; then
  _EXISTING=true
  _ver_suffix=""
  [[ -n "$_INSTALLED_VERSION" ]] && _ver_suffix="$(t detect_dir_ver "${_INSTALLED_VERSION}")"
  _EXISTING_MSGS+=("$(t detect_dir "${_NODYX_CHECK_DIR}" "${_ver_suffix}")")
fi
# PostgreSQL database
if command -v psql &>/dev/null \
   && sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='nodyx'" 2>/dev/null | grep -q 1; then
  _EXISTING=true
  _DB_EXISTS=true
  _DB_TABLE_COUNT=$(sudo -u postgres psql -d nodyx -tc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d ' \n' || echo 0)
  _EXISTING_MSGS+=("$(t detect_db "${_DB_TABLE_COUNT}")")
fi

if $_EXISTING; then
  echo ""

  # ── Contextual title based on the situation ──
  if [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$NODYX_VERSION" "$_INSTALLED_VERSION"; then
    echo -e "  ${GREEN}${BOLD}$(t detect_upgrade_avail "${_INSTALLED_VERSION}" "${NODYX_VERSION}")${RESET}"
  elif [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$_INSTALLED_VERSION" "$NODYX_VERSION"; then
    echo -e "  ${RED}${BOLD}$(t detect_regression "${_INSTALLED_VERSION}" "${NODYX_VERSION}")${RESET}"
  elif [[ -n "$_INSTALLED_VERSION" ]]; then
    echo -e "  ${CYAN}${BOLD}$(t detect_same_ver "${_INSTALLED_VERSION}")${RESET}"
  else
    echo -e "  ${YELLOW}${BOLD}$(t detect_unknown)${RESET}"
  fi
  echo ""
  for _msg in "${_EXISTING_MSGS[@]}"; do echo -e "  ${YELLOW}${_msg}${RESET}"; done
  echo ""

  # ── Menu adapted to the situation ──
  _cancel_opt=2
  if [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$NODYX_VERSION" "$_INSTALLED_VERSION"; then
    # UPDATE available
    _cancel_opt=$($_DB_EXISTS && echo 4 || echo 3)
    echo -e "  ${BOLD}$(t menu_what_do)${RESET}"
    echo -e "  ${GREEN}[1]${RESET} ${BOLD}$(t menu_upgrade_to "${NODYX_VERSION}")${RESET} ${GREEN}$(t menu_recommended)${RESET}"
    echo -e "  ${CYAN}[2]${RESET} $(t menu_reinstall)"
    if $_DB_EXISTS; then
      echo -e "  ${RED}[3]${RESET} $(t menu_reset_db "${RED}" "${RESET}" "${RED}" "${RESET}")"
      echo -e "  ${YELLOW}[4]${RESET} $(t menu_cancel)"
    else
      echo -e "  ${YELLOW}[3]${RESET} $(t menu_cancel)"
    fi
    echo ""
    read -rp "$(echo -e "  ${BOLD}$(t menu_choice_prompt "${_cancel_opt}" "1") ${RESET}")" _det_choice </dev/tty
    _det_choice="${_det_choice:-1}"
    case "$_det_choice" in
      1) INSTALL_MODE="upgrade"   ;;
      2) INSTALL_MODE="reinstall" ;;
      3) $_DB_EXISTS && INSTALL_MODE="wipe" || die "$(t install_cancelled)" ;;
      4) die "$(t install_cancelled)" ;;
      *) die "$(t invalid_choice)" ;;
    esac

  elif [[ -n "$_INSTALLED_VERSION" ]] && version_gt "$_INSTALLED_VERSION" "$NODYX_VERSION"; then
    # REGRESSION (installed > installer)
    echo -e "  ${BOLD}$(t menu_what_do)${RESET}"
    echo -e "  ${CYAN}[1]${RESET} $(t menu_repair_current)"
    echo -e "  ${RED}[2]${RESET} $(t menu_force_reinstall "${NODYX_VERSION}" "${RED}" "${RESET}")"
    echo -e "  ${YELLOW}[3]${RESET} $(t menu_cancel) ${YELLOW}$(t menu_recommended)${RESET}"
    echo ""
    read -rp "$(echo -e "  ${BOLD}$(t menu_choice_prompt "3" "3") ${RESET}")" _det_choice </dev/tty
    _det_choice="${_det_choice:-3}"
    case "$_det_choice" in
      1) INSTALL_MODE="repair"    ;;
      2) INSTALL_MODE="reinstall" ;;
      *) die "$(t install_cancelled)" ;;
    esac

  else
    # SAME VERSION or unknown
    _cancel_opt=$($_DB_EXISTS && echo 4 || echo 3)
    echo -e "  ${BOLD}$(t menu_what_do)${RESET}"
    echo -e "  ${CYAN}[1]${RESET} $(t menu_repair)"
    echo -e "  ${CYAN}[2]${RESET} $(t menu_reinstall)"
    if $_DB_EXISTS; then
      echo -e "  ${RED}[3]${RESET} $(t menu_reset_db "${RED}" "${RESET}" "${RED}" "${RESET}")"
      echo -e "  ${YELLOW}[4]${RESET} $(t menu_cancel)"
    else
      echo -e "  ${YELLOW}[3]${RESET} $(t menu_cancel)"
    fi
    echo ""
    read -rp "$(echo -e "  ${BOLD}$(t menu_choice_prompt "${_cancel_opt}" "${_cancel_opt}") ${RESET}")" _det_choice </dev/tty
    _det_choice="${_det_choice:-${_cancel_opt}}"
    case "$_det_choice" in
      1) INSTALL_MODE="repair"    ;;
      2) INSTALL_MODE="reinstall" ;;
      3) $_DB_EXISTS && INSTALL_MODE="wipe" || die "$(t install_cancelled)" ;;
      4) die "$(t install_cancelled)" ;;
      *) die "$(t invalid_choice)" ;;
    esac
  fi

  # ── Fast upgrade/repair path: no interactive reconfiguration ──
  if [[ "$INSTALL_MODE" == "upgrade" || "$INSTALL_MODE" == "repair" ]]; then
    _nodyx_upgrade "${_INSTALLED_VERSION:-?}" "$NODYX_VERSION" "$_NODYX_CHECK_DIR"
    _INSTALL_COMPLETE=true
    exit 0
  fi

  [[ "$INSTALL_MODE" == "wipe" ]]      && warn "$(t wipe_warning)"
  [[ "$INSTALL_MODE" == "reinstall" ]] && warn "$(t reinstall_notice)"
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
        _pb_add "${_proc_fb:-$(t unknown_proc)}" "$_port"
        ;;
      *)
        _pb_add "$_proc_base" "$_port" ;;
    esac
  fi
done

$_PORT_CADDY_FOUND && info "$(t caddy_present)"

if [[ ${#_PORT_BLOCKER_SVCS[@]} -gt 0 ]]; then
  echo ""
  echo -e "  ${YELLOW}${BOLD}$(t port_conflicts)${RESET}"
  for _i in "${!_PORT_BLOCKER_SVCS[@]}"; do
    echo -e "  ${YELLOW}$(t port_conflict_line "${BOLD}" "${_PORT_BLOCKER_SVCS[$_i]}" "${RESET}${YELLOW}" "${_PORT_BLOCKER_PORTS[$_i]}")${RESET}"
  done
  echo ""

  # Known services that can be stopped cleanly
  _stoppable=()
  for _svc in "${_PORT_BLOCKER_SVCS[@]}"; do
    if [[ "$_svc" =~ ^(nginx|apache2|httpd)$ ]] && systemctl is-active --quiet "$_svc" 2>/dev/null; then
      _stoppable+=("$_svc")
    fi
  done

  if [[ ${#_stoppable[@]} -gt 0 ]]; then
    echo -e "  ${BOLD}$(t port_options)${RESET}"
    echo -e "  ${GREEN}[1]${RESET} $(t port_stop_disable "${BOLD}${_stoppable[*]}${RESET}" "${GREEN}" "${RESET}")"
    echo -e "  ${CYAN}[2]${RESET} $(t port_continue)"
    echo -e "  ${YELLOW}[3]${RESET} $(t menu_cancel)"
    echo ""
    read -rp "$(echo -e "  ${BOLD}$(t port_choice_prompt) ${RESET}")" _port_choice </dev/tty
    _port_choice="${_port_choice:-1}"
    case "$_port_choice" in
      1)
        for _svc in "${_stoppable[@]}"; do
          systemctl stop    "$_svc" 2>/dev/null || true
          systemctl disable "$_svc" 2>/dev/null || true
          ok "$(t port_svc_stopped "${_svc}")"
        done ;;
      2) warn "$(t port_svc_remain)" ;;
      *) die "$(t port_cancel_resolve)" ;;
    esac
  else
    echo -e "  ${YELLOW}$(t port_force_hint)${RESET}"
    read -rp "$(echo -e "  ${BOLD}$(t port_force_prompt) ${RESET}")" _port_force </dev/tty
    # Accept y/Y/o/O regardless of UI language
    [[ ! "${_port_force,,}" =~ ^(y|o)$ ]] && die "$(t install_cancelled)"
    for _bp in "${_PORT_BLOCKER_PORTS[@]}"; do
      for _p in $_bp; do
        fuser -k "${_p}/tcp" 2>/dev/null || true
      done
    done
    sleep 1
    ok "$(t ports_freed)"
  fi
fi

# ── 3. Other PM2 processes ───────────────────────────────────────────────────
if command -v pm2 &>/dev/null; then
  _other_pm2=$(pm2 list --no-color 2>/dev/null \
    | awk '/│/ && (/ online / || / stopped / || / errored /) && !/nodyx-core|nodyx-frontend/ {
        for(i=1;i<=NF;i++) if($i!~/^[│┼]$/ && $i~/^[a-zA-Z0-9]/) {print $i; break}
      }' | grep -v '^$' || true)
  if [[ -n "$_other_pm2" ]]; then
    echo ""
    echo -e "  ${CYAN}${BOLD}$(t other_pm2_apps)${RESET}"
    while IFS= read -r _proc; do echo -e "  ${CYAN}  ● ${_proc}${RESET}"; done <<< "$_other_pm2"
    echo ""
    echo -e "  ${CYAN}$(t other_pm2_note)${RESET}"
    echo ""
    _confirm "$(t continue_q)" || die "$(t install_cancelled)"
  fi
fi

# Bootstrap curl (needed before the main package install step)
if ! command -v curl &>/dev/null; then
  apt-get install -y -q curl >/dev/null 2>&1 || true
fi

# Detect external IP
step "$(t step_detect_ip)"
PUBLIC_IP=$(curl -s --max-time 5 https://api.ipify.org || curl -s --max-time 5 https://ifconfig.me || true)
if [[ -z "$PUBLIC_IP" ]]; then
  warn "$(t ip_undetected)"
  prompt PUBLIC_IP "$(t prompt_public_ip)"
else
  ok "$(printf "$(t ip_detected)" "${BOLD}" "$PUBLIC_IP" "${RESET}")"
fi

# ── _FORCE_MODE bypass : si flag CLI, court-circuiter le menu de détection ──
if [[ -n "$_FORCE_MODE" ]]; then
  INSTALL_MODE="$_FORCE_MODE"
  info "$(printf "$(t force_mode_cli)" "${BOLD}" "${INSTALL_MODE}" "${RESET}")"
  if [[ "$INSTALL_MODE" == "upgrade" || "$INSTALL_MODE" == "repair" ]]; then
    [[ -d "$_NODYX_CHECK_DIR" ]] || die "$(printf "$(t force_no_install)" "${_NODYX_CHECK_DIR}" "${INSTALL_MODE}")"
    _installed_ver=$(node -p "require('${_NODYX_CHECK_DIR}/nodyx-core/package.json').version" 2>/dev/null || echo "?")
    _nodyx_upgrade "$_installed_ver" "$NODYX_VERSION" "$_NODYX_CHECK_DIR"
    _INSTALL_COMPLETE=true
    exit 0
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NETWORK CONNECTIVITY CHECK
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_net_check)"

_NET_FAIL=false
_CADDY_REPO_OK=true
_net_check() {
  local label="$1" url="$2"
  if curl -sf --max-time 7 --head "$url" >/dev/null 2>&1 \
  || curl -sf --max-time 7       "$url" >/dev/null 2>&1; then
    ok "  ${label}"
  else
    warn "  ${label}  ${YELLOW}$(t net_unreach)${RESET}"
    _NET_FAIL=true
  fi
}
_net_check "GitHub"              "https://api.github.com"
_net_check "npm registry"        "https://registry.npmjs.org"
_net_check "nodesource.com"      "https://deb.nodesource.com"
_net_check "nodyx.org directory" "https://nodyx.org"

# Caddy : non-blocking check — Cloudsmith CDN sometimes slow/filtered,
# but Caddy installs via apt even if this fails.
if curl -sf --max-time 7 --head "https://dl.cloudsmith.io/public/caddy/stable" >/dev/null 2>&1 \
|| curl -sf --max-time 7        "https://dl.cloudsmith.io/public/caddy/stable" >/dev/null 2>&1; then
  ok "  Caddy packages"
else
  _CADDY_REPO_OK=false
  info "  Caddy packages  ${YELLOW}$(t net_caddy_cdn_unreach)${RESET} $(t net_caddy_apt_note)"
fi

if $_NET_FAIL; then
  echo ""
  warn "$(t net_critical_fail)"
  warn "$(t net_install_at_risk)"
  _confirm "$(t continue_q)" \
    || die "$(t net_fix_and_retry)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  CONFIGURATION — interactive prompts
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_configure)"
echo ""

# Pre-fill from CLI args (prompt() will skip already-set vars)
[[ -n "$_ARG_NAME" ]]        && COMMUNITY_NAME="$_ARG_NAME"
[[ -n "$_ARG_SLUG" ]]        && COMMUNITY_SLUG="$_ARG_SLUG"
[[ -n "$_ARG_ADMIN_USER" ]]  && ADMIN_USERNAME="$_ARG_ADMIN_USER"
[[ -n "$_ARG_ADMIN_EMAIL" ]] && ADMIN_EMAIL="$_ARG_ADMIN_EMAIL"
[[ -n "$_ARG_ADMIN_PASS" ]]  && ADMIN_PASSWORD="$_ARG_ADMIN_PASS"
[[ -n "$_ARG_DOMAIN" ]]      && DOMAIN="$_ARG_DOMAIN"

conf_section "$(t conf_identity)"
prompt   COMMUNITY_NAME  "$(t prompt_community_name)"
COMMUNITY_SLUG_DEFAULT=$(slugify "$COMMUNITY_NAME")
prompt   COMMUNITY_SLUG  "$(t prompt_community_slug)" "$COMMUNITY_SLUG_DEFAULT"
COMMUNITY_SLUG=$(slugify "$COMMUNITY_SLUG")
if [[ ${#COMMUNITY_SLUG} -lt 3 ]]; then
  die "$(t slug_too_short)"
fi
prompt   COMMUNITY_LANG  "$(t prompt_community_lang)" "$NODYX_LANG"
prompt   COMMUNITY_DESC    "$(t prompt_community_desc)" ""
prompt   COMMUNITY_COUNTRY "$(t prompt_community_country)" ""

conf_section "$(t conf_network)"
echo -e "  ${BOLD}$(t net_mode_intro)${RESET}"
echo -e "  ┌─ ${BOLD}$(t net_mode_1)${RESET}  $(t net_mode_1_desc)"
echo -e "  ├─ ${BOLD}$(t net_mode_2)${RESET}         $(printf "$(t net_mode_2_desc)" "${GREEN}" "${RESET}")"
echo -e "  └─ ${BOLD}$(t net_mode_3)${RESET}       $(t net_mode_3_desc)"
echo ""
read -rp "$(echo -e "  ${CYAN}?${RESET} $(t net_mode_prompt) ")" NET_MODE
NET_MODE="${NET_MODE:-2}"

RELAY_MODE=false
DOMAIN_IS_AUTO=false

case "$NET_MODE" in
  1)
    prompt DOMAIN "$(t prompt_domain)"
    ;;
  2)
    RELAY_MODE=true
    DOMAIN="${COMMUNITY_SLUG}.nodyx.org"
    ok "$(printf "$(t relay_mode_url)" "${BOLD}" "https://${DOMAIN}" "${RESET}")"
    info "$(t relay_mode_no_port)"
    ;;
  3|*)
    DOMAIN="${PUBLIC_IP//./-}.sslip.io"
    DOMAIN_IS_AUTO=true
    ok "$(printf "$(t auto_domain)" "${BOLD}" "${DOMAIN}" "${RESET}")"
    info "$(printf "$(t sslip_resolves)" "${PUBLIC_IP}")"
    ;;
esac

conf_section "$(t conf_admin)"
prompt        ADMIN_USERNAME "$(t prompt_admin_user)"
prompt        ADMIN_EMAIL    "$(t prompt_admin_email)"
prompt_secret_confirm ADMIN_PASSWORD "$(t prompt_admin_pass)" 8

conf_section "$(t conf_smtp)"
echo -e "  $(t smtp_use)"
echo -e "  $(printf "$(t smtp_compat)" "${BOLD}" "${RESET}")"
echo ""
read -rp "$(echo -e "  ${CYAN}?${RESET} $(t smtp_now) ")" want_smtp </dev/tty
want_smtp="${want_smtp:-n}"

SMTP_HOST=""
SMTP_PORT="587"
SMTP_SECURE="false"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM=""

if [[ "${want_smtp,,}" =~ ^(o|y)$ ]]; then
  prompt   SMTP_HOST   "$(t prompt_smtp_host)"
  prompt   SMTP_PORT   "$(t prompt_smtp_port)" "587"
  read -rp "$(echo -e "  ${CYAN}?${RESET} $(t smtp_force_tls) ")" _smtp_tls </dev/tty
  [[ "${_smtp_tls,,}" =~ ^(o|y)$ ]] && SMTP_SECURE="true" && SMTP_PORT="465"
  prompt   SMTP_USER   "$(t prompt_smtp_user)"
  prompt_secret SMTP_PASS "$(t prompt_smtp_pass)" 1
  prompt   SMTP_FROM   "$(t prompt_smtp_from)"
  ok "$(printf "$(t smtp_configured)" "${SMTP_HOST}" "${SMTP_PORT}")"
else
  info "$(t smtp_skipped)"
fi

# ── DNS pre-check (Let's Encrypt will fail if DNS doesn't point here) ───────
if ! $RELAY_MODE && ! $DOMAIN_IS_AUTO && [[ -n "${DOMAIN:-}" ]]; then
  info "$(printf "$(t dns_checking)" "${BOLD}" "${DOMAIN}" "${RESET}")"
  _dns_ip=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -z "$_dns_ip" ]]; then
    echo ""
    warn "$(printf "$(t dns_unresolved)" "${BOLD}" "${DOMAIN}" "${RESET}")"
    warn "$(t dns_le_will_fail)"
    echo -e "  ${CYAN}$(printf "$(t dns_set_a)" "${BOLD}" "${DOMAIN}" "${RESET}" "${CYAN}" "${PUBLIC_IP}" "${RESET}")"
    _confirm "$(t continue_q)" \
      || die "$(printf "$(t dns_fix_first)" "${DOMAIN}" "${PUBLIC_IP}")"
  elif [[ "$_dns_ip" != "$PUBLIC_IP" ]]; then
    echo ""
    warn "$(printf "$(t dns_mismatch)" "${BOLD}" "${DOMAIN}" "${RESET}" "${RED}" "${_dns_ip}" "${RESET}" "${PUBLIC_IP}")"
    warn "$(t dns_le_mismatch_fail)"
    echo -e "  ${CYAN}$(t dns_update_a)${RESET}"
    _confirm "$(t continue_q)" \
      || die "$(printf "$(t dns_fix_correct)" "${DOMAIN}" "${PUBLIC_IP}")"
  else
    ok "$(printf "$(t dns_ok)" "${DOMAIN}" "${_dns_ip}")"
  fi
fi

echo ""
echo -e "  ${BOLD}${CYAN}┌──────────────────────────────────────────────────┐${RESET}"
echo -e "  ${BOLD}${CYAN}$(t recap_title)${RESET}"
echo -e "  ${BOLD}${CYAN}├──────────────────────────────────────────────────┤${RESET}"
echo -e "  ${CYAN}│${RESET}  $(t recap_domain) ${BOLD}${DOMAIN}${RESET}$(${DOMAIN_IS_AUTO} && echo " ${CYAN}$(t recap_sslip)${RESET}" || true)"
echo -e "  ${CYAN}│${RESET}  $(t recap_community) ${BOLD}${COMMUNITY_NAME}${RESET} (slug: ${COMMUNITY_SLUG})"
echo -e "  ${CYAN}│${RESET}  $(t recap_lang) ${BOLD}${COMMUNITY_LANG}${RESET}"
echo -e "  ${CYAN}│${RESET}  $(t recap_admin) ${BOLD}${ADMIN_USERNAME}${RESET} <${ADMIN_EMAIL}>"
echo -e "  ${CYAN}│${RESET}  $(t recap_mode) ${BOLD}${INSTALL_MODE}${RESET}"
if [[ -n "$SMTP_HOST" ]]; then
echo -e "  ${CYAN}│${RESET}  $(t recap_smtp) ${BOLD}${SMTP_HOST}:${SMTP_PORT}${RESET} (from: ${SMTP_FROM})"
else
echo -e "  ${CYAN}│${RESET}  $(t recap_smtp) ${YELLOW}$(t recap_smtp_off)${RESET}"
fi
echo -e "  ${BOLD}${CYAN}└──────────────────────────────────────────────────┘${RESET}"
echo ""
_confirm "$(t start_install)" || die "$(t install_cancelled)"

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
step "$(t step_install_deps)"

export DEBIAN_FRONTEND=noninteractive
apt-get update -q
# git first — needed to clone the repo, and most VPS images don't ship with it
apt-get install -y -q git 2>/dev/null
_SYS_PKGS="curl wget gnupg2 ca-certificates lsb-release openssl ufw build-essential postgresql postgresql-contrib redis-server fonts-dejavu-core file"
# shellcheck disable=SC2086
apt-get install -y -q $_SYS_PKGS 2>/dev/null
ok "$(t deps_installed)"

# Node.js 20 LTS
_NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//;s/\..*//' || echo 0)
if ! command -v node &>/dev/null || [[ "$_NODE_MAJOR" -lt 20 ]]; then
  info "$(t node_installing)"
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1
  apt-get install -y -q nodejs >/dev/null 2>&1
  ok "$(printf "$(t node_installed)" "$(node -v)")"
else
  ok "$(printf "$(t node_present)" "$(node -v)")"
fi

# Caddy
if ! command -v caddy &>/dev/null; then
  info "$(t caddy_installing)"
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https >/dev/null 2>&1
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -q && apt-get install -y -q caddy >/dev/null 2>&1
  ok "$(printf "$(t caddy_installed)" "$(caddy version | head -1)")"
else
  ok "$(printf "$(t caddy_already)" "$(caddy version | head -1)")"
fi

# PM2
if ! command -v pm2 &>/dev/null; then
  npm install -g pm2 --silent
  ok "$(t pm2_installed)"
else
  ok "$(t pm2_already)"
fi

# PM2 log-rotate — check on the nodyx daemon (the one actually running the apps)
if ! runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null | grep -q 'pm2-logrotate'; then
  npm install -g pm2-logrotate --silent 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 set pm2-logrotate:max_size 50M 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 set pm2-logrotate:retain 7 2>/dev/null || true
  ok "$(t pm2_logrotate_set)"
fi

# ── Create the 'nodyx' system user ───────────────────────────────────────────
step "$(t step_create_user)"
if ! id -u nodyx &>/dev/null; then
  useradd -r -s /usr/sbin/nologin -m -d /home/nodyx nodyx
  ok "$(t user_created_full)"
else
  ok "$(t user_already)"
fi
mkdir -p /home/nodyx/.pm2/logs
chown -R nodyx:nodyx /home/nodyx/.pm2

# ═══════════════════════════════════════════════════════════════════════════════
#  POSTGRESQL
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_pg)"

# Detect installed PostgreSQL version (needed for the versioned service name)
_PG_VER=$(ls /usr/lib/postgresql/ 2>/dev/null | sort -Vr | head -1)
[[ -z "$_PG_VER" ]] && die "$(t pg_not_found)"

# On Debian/Ubuntu, `postgresql.service` is a meta-service that runs /bin/true.
# The real service managing the cluster is postgresql@X-main.service.
systemctl enable  "postgresql@${_PG_VER}-main" --quiet 2>/dev/null || true
systemctl start   "postgresql@${_PG_VER}-main" 2>/dev/null || true

# Wait for PostgreSQL socket to be ready
info "$(t pg_waiting)"
_PG_READY=false
for _pg_i in {1..15}; do
  sudo -u postgres pg_isready -q 2>/dev/null && { _PG_READY=true; break; }
  sleep 2
done

if ! $_PG_READY; then
  info "$(t pg_init)"

  # Ensure server binaries (initdb) are present — some ARM packages omit them
  if ! command -v "/usr/lib/postgresql/${_PG_VER}/bin/initdb" &>/dev/null; then
    info "$(printf "$(t pg_install_pkg)" "${_PG_VER}")"
    apt-get install -y -q "postgresql-${_PG_VER}" >/dev/null 2>&1 || true
  fi

  # If the cluster config exists but the data directory is not initialized
  # (pg_lsclusters shows "down / <unknown>"), drop the config and recreate cleanly
  if [[ ! -f "/var/lib/postgresql/${_PG_VER}/main/PG_VERSION" ]]; then
    info "$(t pg_recreate_cluster)"
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

$_PG_READY || die "$(printf "$(t pg_did_not_start)" "${_PG_VER}")"
ok "$(printf "$(t pg_ready)" "${_PG_VER}")"

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

# Wipe mode: drop existing DB cleanly
if [[ "$INSTALL_MODE" == "wipe" ]]; then
  info "$(t pg_wipe_dropping)"
  sudo -u postgres psql -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>/dev/null || true
  sudo -u postgres psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null
  ok "$(printf "$(t pg_db_dropped)" "${DB_NAME}")"
fi

sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" \
  | grep -q 1 \
  || sudo -u postgres psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null

sudo -u postgres psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
# PG15+ revokes CREATE on public schema by default — grant it explicitly for migrations
sudo -u postgres psql -d "$DB_NAME" -c "GRANT CREATE ON SCHEMA public TO ${DB_USER};" >/dev/null
ok "$(printf "$(t pg_db_ready)" "${DB_NAME}")"

# ═══════════════════════════════════════════════════════════════════════════════
#  REDIS
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_redis)"
# On Debian Trixie+, the redis service is "static" — must be unmasked first
# Ensure Redis directories exist (may be missing after partial purge)
mkdir -p /var/lib/redis /var/log/redis
chown redis:redis /var/lib/redis /var/log/redis 2>/dev/null || true
chmod 750 /var/lib/redis /var/log/redis 2>/dev/null || true
systemctl unmask redis-server 2>/dev/null || true
systemctl enable redis-server --quiet 2>/dev/null || true
systemctl start redis-server 2>/dev/null || true

# Verify + retry if start failed
_REDIS_OK=false
for _ri in {1..10}; do
  if redis-cli ping 2>/dev/null | grep -q PONG; then
    _REDIS_OK=true; break
  fi
  sleep 2
done

if ! $_REDIS_OK; then
  # Last resort: start as daemon directly
  warn "$(t redis_systemctl_fail)"
  redis-server --daemonize yes --logfile /var/log/redis/redis-server.log \
    --dir /var/lib/redis 2>/dev/null || true
  sleep 3
  redis-cli ping 2>/dev/null | grep -q PONG && _REDIS_OK=true || true
fi

$_REDIS_OK || die "$(t redis_did_not_start)"
ok "$(t redis_started)"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-TURN (STUN/TURN Rust natif — remplace coturn) — ignoré en mode Relay
# ═══════════════════════════════════════════════════════════════════════════════
if ! $RELAY_MODE && ! $SKIP_TURN; then
  step "$(t step_turn)"

  _ARCH=$(uname -m)
  case "$_ARCH" in
    x86_64)  _TURN_ARCH="amd64" ;;
    aarch64) _TURN_ARCH="arm64" ;;
    *) die "$(printf "$(t turn_unsupported_arch)" "$_ARCH")" ;;
  esac

  _TURN_VERSION="v0.1.2-p2p"
  # Note: assets on v0.1.2-p2p still ship under the legacy "nexus-turn" name —
  # the Rust crate was renamed to nodyx-turn but the GitHub release predates that
  # rename. The downloaded binary is identical; we just save it as nodyx-turn.
  _TURN_URL="https://github.com/Pokled/Nodyx/releases/download/${_TURN_VERSION}/nexus-turn-linux-${_TURN_ARCH}"
  info "$(printf "$(t turn_downloading)" "${_TURN_VERSION}" "${_TURN_ARCH}")"
  _TURN_TMP="$(mktemp /tmp/nodyx-turn.XXXXXX)"
  if ! curl -fsSL --max-time 60 "$_TURN_URL" -o "$_TURN_TMP"; then
    rm -f "$_TURN_TMP"
    die "$(printf "$(t turn_dl_fail)" "${_TURN_URL}" "${_TURN_VERSION}")"
  fi
  if ! file "$_TURN_TMP" 2>/dev/null | grep -q ELF; then
    rm -f "$_TURN_TMP"
    die "$(printf "$(t turn_not_binary)" "${_TURN_URL}")"
  fi
  chmod +x "$_TURN_TMP"
  mv -f "$_TURN_TMP" /usr/local/bin/nodyx-turn

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
  ok "$(printf "$(t turn_started)" "${PUBLIC_IP}")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  FIREWALL (UFW)
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_firewall)"

# Backup existing UFW rules before reset
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  _ufw_bak="/root/ufw-backup-$(date +%Y%m%d-%H%M%S).rules"
  ufw status verbose > "$_ufw_bak" 2>/dev/null || true
  warn "$(printf "$(t ufw_existing_saved)" "${_ufw_bak}")"
fi

_rollback_register "$(t ufw_rollback_msg)"
ufw --force reset >/dev/null 2>&1
ufw default deny incoming >/dev/null 2>&1
ufw default allow outgoing >/dev/null 2>&1
ufw allow ssh >/dev/null 2>&1
if ! $RELAY_MODE; then
  ufw allow 80/tcp >/dev/null 2>&1
  ufw allow 443/tcp >/dev/null 2>&1
  if ! $SKIP_TURN; then
    ufw allow 3478/tcp >/dev/null 2>&1
    ufw allow 3478/udp >/dev/null 2>&1
    ufw allow 5349/tcp >/dev/null 2>&1
    ufw allow 5349/udp >/dev/null 2>&1
    ufw allow 49152:65535/udp >/dev/null 2>&1
  fi
fi
ufw --force enable >/dev/null 2>&1
ok "$(printf "$(t ufw_configured)" "$($RELAY_MODE && t ufw_relay_note || true)")"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX RELAY CLIENT — binaire (mode Relay uniquement)
# ═══════════════════════════════════════════════════════════════════════════════
if $RELAY_MODE; then
  step "$(t step_relay_dl)"

  _ARCH=$(uname -m)
  case "$_ARCH" in
    x86_64)  _RELAY_ARCH="amd64" ;;
    aarch64) _RELAY_ARCH="arm64" ;;
    *) die "$(printf "$(t relay_unsupported_arch)" "$_ARCH")" ;;
  esac

  _RELAY_VERSION="v0.1.3-p2p"
  _RELAY_URL="https://github.com/Pokled/Nodyx/releases/download/${_RELAY_VERSION}/nodyx-relay-linux-${_RELAY_ARCH}"

  info "$(printf "$(t relay_downloading)" "${_RELAY_VERSION}" "${_RELAY_ARCH}")"
  _RELAY_TMP="$(mktemp /tmp/nodyx-relay.XXXXXX)"
  if ! curl -fsSL --max-time 60 "$_RELAY_URL" -o "$_RELAY_TMP"; then
    rm -f "$_RELAY_TMP"
    die "$(printf "$(t relay_dl_fail)" "${_RELAY_URL}" "${_RELAY_VERSION}")"
  fi
  # Verify it's an ELF binary (not an HTML error page)
  if ! file "$_RELAY_TMP" 2>/dev/null | grep -q ELF; then
    rm -f "$_RELAY_TMP"
    die "$(printf "$(t relay_not_binary)" "${_RELAY_URL}")"
  fi
  # Atomic mv: works even if the old binary is running
  chmod +x "$_RELAY_TMP"
  mv -f "$_RELAY_TMP" /usr/local/bin/nodyx-relay
  chmod +x /usr/local/bin/nodyx-relay
  ok "$(printf "$(t relay_installed)" "$(/usr/local/bin/nodyx-relay --version 2>&1 || echo '?')")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX — CLONE / UPDATE
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_clone)"

# Make sure the parent directory exists — minimal LXC/container images
# (Proxmox templates, scratch Debian) sometimes ship without /opt.
mkdir -p "$(dirname "$NODYX_DIR")"

if [[ -d "$NODYX_DIR/.git" ]]; then
  info "$(t clone_updating)"
  git -C "$NODYX_DIR" pull --ff-only
elif [[ -d "$NODYX_DIR" ]] && [[ -n "$(ls -A "$NODYX_DIR" 2>/dev/null)" ]]; then
  # Directory exists and isn't empty but isn't a Nodyx git clone — refuse to
  # clobber. The detection menu would normally catch this earlier; this is the
  # belt-and-braces fallback for fresh-mode installs.
  die "$(printf "$(t clone_dir_dirty)" "$NODYX_DIR")"
else
  info "$(printf "$(t clone_cloning)" "$NODYX_DIR")"
  # Clone into the directory (creates it if missing, works fine if empty)
  GIT_TERMINAL_PROMPT=0 git clone --depth 1 "$REPO_URL" "$NODYX_DIR"
fi
ok "$(printf "$(t clone_done)" "$NODYX_DIR")"

# Read the actual version from the repo (avoids drift with the hardcoded version)
_PKG_VER=$(node -p "require('${NODYX_DIR}/nodyx-core/package.json').version" 2>/dev/null || true)
if [[ -n "$_PKG_VER" ]]; then
  NODYX_VERSION="$_PKG_VER"
  info "$(printf "$(t ver_from_repo)" "${NODYX_VERSION}")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-CORE — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_backend)"

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
run_bg "$(t backend_npm_install_label)" npm install --no-fund --no-audit \
  || die "$(t backend_npm_install_fail2)"
run_bg "$(t backend_compile_label)" npm run build \
  || die "$(t backend_build_fail2)"
[[ -f "${NODYX_DIR}/nodyx-core/dist/index.js" ]] \
  || die "$(t backend_dist_missing)"
ok "$(t backend_built)"

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-FRONTEND — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_frontend)"

cat > "${NODYX_DIR}/nodyx-frontend/.env" <<FEENV
# Généré par install.sh — ne pas modifier manuellement

PUBLIC_API_URL=https://${DOMAIN}
# SSR bypass — nodyx-frontend contacte nodyx-core directement sans passer par Caddy
PRIVATE_API_SSR_URL=http://127.0.0.1:${NODYX_CORE_PORT:-3000}/api/v1
# Nodyx Signet (authentificateur optionnel) — laisser vide si non utilisé
PUBLIC_SIGNET_URL=
# Les credentials TURN sont désormais générés dynamiquement par nodyx-core (nodyx-turn).
# Ces variables sont conservées pour compatibilité avec d'éventuelles instances existantes.
PUBLIC_TURN_URL=
PUBLIC_TURN_USERNAME=
PUBLIC_TURN_CREDENTIAL=
FEENV

cd "${NODYX_DIR}/nodyx-frontend"
run_bg "$(t front_npm_install_label)" npm install --no-fund --no-audit \
  || die "$(t front_npm_install_fail2)"

# On ARM64: ensure native Rollup binary is present
# (avoids "traceVariable / tick from svelte" error with the JS fallback)
if [[ "$(uname -m)" == "aarch64" ]]; then
  if [[ ! -f "node_modules/@rollup/rollup-linux-arm64-gnu/rollup.linux-arm64-gnu.node" ]]; then
    info "$(t rollup_arm64_force)"
    npm install @rollup/rollup-linux-arm64-gnu --no-save --no-fund --no-audit 2>/dev/null || true
  fi
fi

# On low RAM (RPi 1 GB), cap Node heap to avoid OOM during build
if [[ "$_RAM_TOTAL_MB" -lt 1500 ]]; then
  export NODE_OPTIONS="--max-old-space-size=512"
  info "$(printf "$(t front_low_ram_node_cap)" "${_RAM_TOTAL_MB}")"
  _RPI_LABEL="$(t front_build_label_rpi)"
else
  export NODE_OPTIONS="--max-old-space-size=1024"
  _RPI_LABEL=""
fi
run_bg "$(printf "$(t front_build_label)" "${_RPI_LABEL}")" \
  npm run build \
  || die "$(t front_build_fail2)"
unset NODE_OPTIONS
[[ -f "${NODYX_DIR}/nodyx-frontend/build/index.js" ]] \
  || die "$(t front_build_missing)"
ok "$(t frontend_built)"

# ═══════════════════════════════════════════════════════════════════════════════
#  CADDY
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_caddy)"

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
        reverse_proxy 127.0.0.1:3000 {
            header_up -X-Forwarded-For
        }
    }

    reverse_proxy /api/* 127.0.0.1:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /uploads/* 127.0.0.1:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /socket.io/* 127.0.0.1:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy * 127.0.0.1:4173
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
        reverse_proxy 127.0.0.1:3000 {
            header_up -X-Forwarded-For
        }
    }

    reverse_proxy /api/* 127.0.0.1:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /uploads/* 127.0.0.1:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy /socket.io/* 127.0.0.1:3000 {
        header_up -X-Forwarded-For
    }
    reverse_proxy * 127.0.0.1:4173
}
CADDY
fi

systemctl enable caddy --quiet
systemctl restart caddy
if $RELAY_MODE; then
  ok "$(t caddy_relay_done)"
else
  ok "$(printf "$(t caddy_le_done)" "$DOMAIN")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  PM2 ECOSYSTEM
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_pm2_eco)"

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
ExecStart=$(which pm2) resurrect
ExecReload=$(which pm2) reload all
ExecStop=$(which pm2) kill

[Install]
WantedBy=multi-user.target
SVC

systemctl daemon-reload
systemctl enable pm2-nodyx --quiet
ok "$(t pm2_user_done)"

info "$(t pm2_check_5s)"
sleep 5
for _app in nodyx-core nodyx-frontend; do
  _st=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null \
    | grep " ${_app} " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_st" == "online" ]]; then
    ok "$(printf "$(t pm2_app_online)" "$_app")"
  else
    warn "$(printf "$(t pm2_app_status)" "$_app" "${_st}")"
    warn "$(t pm2_logs_label)"
    runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs "$_app" --lines 20 --nostream 2>/dev/null || true
  fi
done

# ═══════════════════════════════════════════════════════════════════════════════
#  WAIT FOR BACKEND + BOOTSTRAP (community + admin)
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_bootstrap)"

_BACKEND_READY=false
_bw_si=0; _bw_elapsed=0
for _bw_i in {1..90}; do
  if curl -sf http://localhost:3000/api/v1/instance/info >/dev/null 2>&1; then
    printf "\r\033[2K"
    ok "$(printf "$(t backend_ready)" "${_bw_elapsed}")"
    _BACKEND_READY=true
    break
  fi
  printf "\r  ${CYAN}%s${RESET}  $(t backend_starting)  ${YELLOW}%ds${RESET}   " \
    "${_HC_SPIN[$((${_bw_si} % 10))]}" "$_bw_elapsed"
  _bw_si=$((_bw_si+1)); sleep 2; _bw_elapsed=$((_bw_elapsed+2))
done
printf "\r\033[2K"

if ! $_BACKEND_READY; then
  warn "$(t backend_not_ready)"
  warn "$(t pm2_logs_core)"
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 35 --nostream 2>/dev/null || true
  warn "$(t pm2_restart_hint)"
  warn "$(t pm2_debug_hint)"
  warn "$(t admin_create_anyway)"
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
    ok "$(printf "$(t admin_created)" "${ADMIN_USERNAME}")"
    _REGISTER_OK=true; break
  elif [[ "$HTTP_CODE" == "409" ]]; then
    ok "$(printf "$(t admin_exists)" "${ADMIN_USERNAME}")"
    _REGISTER_OK=true; break
  else
    warn "$(printf "$(t admin_try_n)" "${_reg_try}" "${HTTP_CODE}" "$(cat /tmp/nodyx_register.json 2>/dev/null | head -c 200)")"
    [[ $_reg_try -lt 3 ]] && { info "$(t admin_retry_in)"; sleep 8; }
  fi
done

if ! $_REGISTER_OK; then
  warn "$(t admin_register_failed)"
  warn "$(printf "$(t admin_register_manual)" "${DOMAIN}")"
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
  ok "$(printf "$(t community_created)" "${COMMUNITY_NAME}" "${ADMIN_USERNAME}")"
else
  warn "$(t user_not_found_db)"
  warn "$(printf "$(t user_register_at)" "${DOMAIN}")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  OPTIONAL — FREE nodyx.org SUBDOMAIN
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_subdomain)"

NODYX_SUBDOMAIN=""
NODYX_DIRECTORY_TOKEN=""
NODYX_DIRECTORY_URL="https://nodyx.org/api/directory"

echo ""
# In relay or auto-domain mode, the nodyx.org subdomain is required/automatic.
if $RELAY_MODE; then
  echo -e "  $(printf "$(t sub_relay_required)" "${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET}")"
  want_subdomain="o"
elif $DOMAIN_IS_AUTO; then
  echo -e "  $(printf "$(t sub_auto_explain)" "${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET}")"
  echo -e "  $(t sub_auto_explain2)"
  want_subdomain="o"
elif $SKIP_SUBDOMAIN; then
  info "$(t sub_skipped_flag)"
  want_subdomain="n"
else
  echo -e "  $(printf "$(t sub_optional_alias)" "${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET}")"
  echo -e "  $(t sub_alias_redirect)"
  echo ""
  read -rp "$(echo -e "  $(printf "$(t sub_enable_q)" "${BOLD}${COMMUNITY_SLUG}.nodyx.org${RESET}")")" want_subdomain
fi

if [[ "${want_subdomain,,}" != "n" ]]; then
  info "$(t sub_registering)"

  REGISTER_HTTP_CODE=""
  REGISTER_RESPONSE=$(curl -s -w '\n__HTTP_CODE__:%{http_code}' -X POST "${NODYX_DIRECTORY_URL}/register" \
    -H "Content-Type: application/json" \
    -d "{
      \"name\":        \"${COMMUNITY_NAME}\",
      \"slug\":        \"${COMMUNITY_SLUG}\",
      \"url\":         \"https://${DOMAIN}\",
      \"language\":    \"${COMMUNITY_LANG}\",
      \"version\":     \"${NODYX_VERSION}\"
    }" 2>/dev/null || true)
  REGISTER_HTTP_CODE=$(echo "$REGISTER_RESPONSE" | grep -o '__HTTP_CODE__:[0-9]*' | cut -d: -f2 || echo "000")
  REGISTER_RESPONSE=$(echo "$REGISTER_RESPONSE" | grep -v '__HTTP_CODE__' || true)

  REGISTER_TOKEN=$(echo "$REGISTER_RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4 || true)
  REGISTER_SLUG=$(echo "$REGISTER_RESPONSE" | grep -o '"subdomain":"[^"]*"' | cut -d'"' -f4 || true)

  if [[ -n "$REGISTER_TOKEN" ]]; then
    NODYX_DIRECTORY_TOKEN="$REGISTER_TOKEN"
    NODYX_SUBDOMAIN="${REGISTER_SLUG:-${COMMUNITY_SLUG}.nodyx.org}"
    ok "$(printf "$(t sub_registered)" "${BOLD}https://${NODYX_SUBDOMAIN}${RESET}")"
    if ! $RELAY_MODE; then
      info "$(t sub_dns_30s)"
      info "$(t sub_save_token)"
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
    # Double check : code HTTP 409 ET/OU message "already taken" dans la réponse
    if [[ "${REGISTER_HTTP_CODE}" == "409" ]] || echo "$REGISTER_RESPONSE" | grep -qi 'already taken\|slug.*conflict\|already registered'; then
      warn "$(printf "$(t sub_slug_taken)" "${COMMUNITY_SLUG}")"
      if $RELAY_MODE; then
        echo ""
        echo -e "  ${BOLD}$(t sub_options)${RESET}"
        echo -e "  ${GREEN}$(t sub_choose_new_slug)${RESET}"
        echo -e "  ${YELLOW}$(t sub_cancel_contact)${RESET}"
        echo ""
        read -rp "$(echo -e "  ${BOLD}$(t sub_choice_prompt) ${RESET}")" _slug_choice </dev/tty
        _slug_choice="${_slug_choice:-1}"
        if [[ "$_slug_choice" == "1" ]]; then
          read -rp "$(echo -e "  ${BOLD}$(t sub_new_slug_prompt) ${RESET}")" _new_slug </dev/tty
          _new_slug="${_new_slug:-}"
          if [[ -z "$_new_slug" ]]; then
            die "$(t sub_slug_empty)"
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
            DOMAIN="${COMMUNITY_SLUG}.nodyx.org"
            ok "$(printf "$(t sub_registered)" "${BOLD}https://${NODYX_SUBDOMAIN}${RESET}")"
            # Injecter le token dans .env + mettre à jour le domaine partout
            {
              printf "\n# Annuaire nodyx.org\n"
              printf "DIRECTORY_TOKEN=%s\n" "${NODYX_DIRECTORY_TOKEN}"
              printf "DIRECTORY_API_URL=https://nodyx.org\n"
              printf "SELF_URL=http://127.0.0.1:3000\n"
              printf "VPS_IP=%s\n" "${PUBLIC_IP:-}"
              printf "NODYX_GLOBAL_INDEXING=true\n"
            } >> "${NODYX_DIR}/nodyx-core/.env"
            # Mettre à jour FRONTEND_URL, PUBLIC_API_URL et ORIGIN avec le nouveau slug
            sed -i "s|^FRONTEND_URL=.*|FRONTEND_URL=https://${DOMAIN}|" "${NODYX_DIR}/nodyx-core/.env"
            sed -i "s|^PUBLIC_API_URL=.*|PUBLIC_API_URL=https://${DOMAIN}|" "${NODYX_DIR}/nodyx-frontend/.env"
            sed -i "s|ORIGIN: 'https://[^']*'|ORIGIN: 'https://${DOMAIN}'|g" "${NODYX_DIR}/ecosystem.config.js"
            cd "${NODYX_DIR}" && runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart nodyx-core 2>/dev/null || true
          else
            die "$(t sub_register_new_failed)"
          fi
        else
          die "$(printf "$(t sub_install_cancelled)" "${COMMUNITY_SLUG}")"
        fi
      else
        warn "$(t sub_reinstall_overwrite)"
      fi
    else
      warn "$(t sub_register_failed)"
      warn "$(printf "$(t sub_response_label)" "$(echo "$REGISTER_RESPONSE" | head -c 200)")"
      warn "$(t sub_retry_later)"
      if $RELAY_MODE; then
        die "$(t sub_relay_needs_slug)"
      fi
    fi
  fi
else
  info "$(printf "$(t sub_skipped)" "${DOMAIN}")"
fi

# ── Relay client systemd service (relay mode only) ──────────────────────────
if $RELAY_MODE && [[ -n "$NODYX_DIRECTORY_TOKEN" ]]; then
  step "$(t step_relay_client)"

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
  ok "$(t relay_client_started)"
  info "$(printf "$(t relay_client_url_soon)" "${DOMAIN}")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  SAVE CREDENTIALS
# ═══════════════════════════════════════════════════════════════════════════════
CREDS_FILE="/root/nodyx-credentials.txt"

# Prépare les blocs conditionnels pour le fichier credentials
_CREDS_TURN=""
if ! $RELAY_MODE && ! $SKIP_TURN; then
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
git config --global --add safe.directory "$NODYX_DIR" 2>/dev/null || true
git -C "$NODYX_DIR" checkout -- nodyx-core/package-lock.json nodyx-frontend/package-lock.json 2>/dev/null || true
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
ok "$(printf "$(t update_script_done)" "${BOLD}" "${RESET}")"

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
  || _warn "RAM disponible" "${_ram_free} MB / ${_ram_total} MB  (ajouter le swap !)"
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
ok "$(printf "$(t doctor_script_done)" "${BOLD}" "${RESET}")"

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

# ── System services ──────────────────────────────────────────────────────────
_hc_sect "$(t hc_services)"
_HC_SVCS="postgresql redis-server caddy"
if ! $RELAY_MODE && ! $SKIP_TURN; then _HC_SVCS="$_HC_SVCS nodyx-turn"; fi
if $RELAY_MODE; then _HC_SVCS="$_HC_SVCS nodyx-relay-client"; fi
for _svc in $_HC_SVCS; do
  if systemctl is-active --quiet "$_svc" 2>/dev/null; then
    _hc_pass "$_svc"
  else
    _hc_fail "$_svc  ${YELLOW}(sudo systemctl start $_svc)${RESET}"
  fi
done

# ── Nodyx (PM2) ───────────────────────────────────────────────────────────────
_hc_sect "$(t hc_pm2)"
for _app in nodyx-core nodyx-frontend; do
  _pm2=$(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list 2>/dev/null \
    | grep " $_app " | grep -oE 'online|stopped|errored|launching' | head -1 || echo "absent")
  if [[ "$_pm2" == "online" ]]; then
    _hc_pass "$_app"
  else
    _hc_fail "$_app  ${YELLOW}[${_pm2}] — runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart $_app${RESET}"
  fi
done

# ── Network & HTTPS ──────────────────────────────────────────────────────────
_hc_sect "$(t hc_net)"

if $RELAY_MODE; then
  # In Relay mode: local check only — HTTPS goes through the tunnel.
  _api_code=$(curl -s --max-time 5 -o /dev/null -w '%{http_code}' "http://localhost/api/v1/instance/info" 2>/dev/null || true)
  if [[ "$_api_code" =~ ^[23] ]]; then
    _hc_pass "$(printf "$(t hc_api_local_ok)" "${_api_code}")"
  else
    _hc_warn "$(printf "$(t hc_api_local_warn)" "${_api_code:-timeout}" "${YELLOW}" "${RESET}")"
  fi
  _hc_pass "$(printf "$(t hc_url_via_tunnel)" "${DOMAIN}" "${CYAN}" "${RESET}")"
else
  _dns_ip=$(getent hosts "$DOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -n "$_dns_ip" ]]; then
    _hc_pass "$(printf "$(t hc_dns_ok)" "${DOMAIN}" "${_dns_ip}")"
  else
    _hc_warn "$(printf "$(t hc_dns_unresolved)" "${DOMAIN}" "${YELLOW}" "${RESET}")"
  fi

  if _wait_https "https://${DOMAIN}" "$(t hc_wait_tls)" 120; then
    _hc_pass "$(printf "$(t hc_https_ok)" "${DOMAIN}")"
  else
    _hc_warn "$(printf "$(t hc_https_timeout)" "${DOMAIN}" "${YELLOW}" "${RESET}")"
  fi

  _api_code=$(curl -sk --max-time 5 -o /dev/null -w '%{http_code}' "https://${DOMAIN}/api/v1/instance/info" 2>/dev/null || true)
  if [[ "$_api_code" =~ ^[23] ]]; then
    _hc_pass "$(printf "$(t hc_api_ok)" "${_api_code}")"
  else
    _hc_warn "$(printf "$(t hc_api_warn)" "${_api_code:-timeout}")"
  fi
fi

# ── Nodyx directory ──────────────────────────────────────────────────────────
if [[ -n "${NODYX_SUBDOMAIN:-}" ]]; then
  _hc_sect "$(t hc_directory)"

  _sub_ip=$(getent hosts "$NODYX_SUBDOMAIN" 2>/dev/null | awk '{print $1}' | head -1 || true)
  if [[ -n "$_sub_ip" ]]; then
    _hc_pass "$(printf "$(t hc_dir_dns_ok)" "${NODYX_SUBDOMAIN}" "${_sub_ip}")"
  else
    _hc_warn "$(printf "$(t hc_dir_dns_propagating)" "${NODYX_SUBDOMAIN}" "${YELLOW}" "${RESET}")"
  fi

  _dir_status=$(curl -s --max-time 5 "${NODYX_DIRECTORY_URL}/instances/${COMMUNITY_SLUG}" 2>/dev/null \
    | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || true)
  if [[ "$_dir_status" == "active" ]]; then
    _hc_pass "$(printf "$(t hc_dir_active)" "${GREEN}" "${RESET}")"
  elif [[ -n "$_dir_status" ]]; then
    _hc_warn "$(printf "$(t hc_dir_status)" "${_dir_status}")"
  else
    _hc_warn "$(printf "$(t hc_dir_unreachable)" "${YELLOW}" "${RESET}")"
  fi
fi

# ── Score final ───────────────────────────────────────────────────────────────
HC_TOTAL=$((HC_PASS + HC_WARN + HC_FAIL))
echo ""
echo -e "  ${CYAN}$(printf '═%.0s' {1..50})${RESET}"
if [[ $HC_FAIL -eq 0 && $HC_WARN -eq 0 ]]; then
  echo -e "  ${GREEN}${BOLD}  $(printf "$(t hc_all_green)" "${HC_PASS}" "${HC_TOTAL}")${RESET}"
elif [[ $HC_FAIL -eq 0 ]]; then
  echo -e "  ${YELLOW}${BOLD}  $(printf "$(t hc_warnings)" "${HC_PASS}" "${HC_TOTAL}" "${HC_WARN}")${RESET}"
else
  echo -e "  ${RED}${BOLD}  $(printf "$(t hc_failures)" "${HC_PASS}" "${HC_TOTAL}" "${HC_FAIL}" "${HC_WARN}")${RESET}"
fi
echo -e "  ${CYAN}$(printf '═%.0s' {1..50})${RESET}"
echo ""

# ═══════════════════════════════════════════════════════════════════════════════
#  SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║                                                              ║"
echo "  $(t banner_online)"
echo "  ║                                                              ║"
echo "  ╠══════════════════════════════════════════════════════════════╣"
echo -e "${RESET}"
echo -e "     ${BOLD}$(t summ_instance)   ${GREEN}https://${DOMAIN}${RESET}"
if ! $RELAY_MODE && [[ -n "$NODYX_SUBDOMAIN" ]]; then
  echo -e "     ${BOLD}$(t summ_alias)   ${CYAN}https://${NODYX_SUBDOMAIN}${RESET}"
fi
echo -e "     ${BOLD}$(t summ_admin)   ${RESET}${ADMIN_USERNAME}  ·  ${ADMIN_EMAIL}"
if ! $RELAY_MODE; then
  echo -e "     ${BOLD}$(t summ_voice)   ${RESET}stun/turn:${PUBLIC_IP}:3478 (nodyx-turn)"
fi
if $RELAY_MODE; then
  echo -e "     ${BOLD}$(t summ_relay)   ${RESET}tunnel → relay.nodyx.org:7443"
fi
echo -e "     ${BOLD}$(t summ_version)   ${RESET}${NODYX_VERSION}"
echo -e "     ${BOLD}$(t summ_dir)   ${RESET}${NODYX_DIR}"
echo ""
echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${RESET}"
echo ""
echo -e "     ${BOLD}${CYAN}$(t summ_management)${RESET}"
echo -e "       runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 list"
echo -e "       runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core"
echo -e "       runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart all"
echo -e "       ${CYAN}$(t summ_or_systemd)${RESET}"
echo -e "       sudo systemctl restart pm2-nodyx"
echo ""
echo -e "     ${BOLD}${CYAN}$(t summ_update)${RESET}"
echo -e "       sudo nodyx-update                $(t summ_update_hint)"
echo ""
echo -e "     ${BOLD}${CYAN}$(t summ_database)${RESET}"
echo -e "       sudo -u postgres psql ${DB_NAME}"
echo -e "       sudo -u postgres pg_dump ${DB_NAME} > backup_\$(date +%F).sql"
echo ""
echo -e "     ${BOLD}${CYAN}$(t summ_diag)${RESET}"
echo -e "       sudo nodyx-doctor               $(t summ_diag_hint)"
echo -e "       systemctl status caddy"
echo -e "       curl -s http://localhost:3000/api/v1/instance/info | python3 -m json.tool"
if $RELAY_MODE; then
  echo ""
  echo -e "     ${BOLD}${CYAN}$(t summ_relay_tunnel)${RESET}"
  echo -e "       systemctl status nodyx-relay-client"
  echo -e "       journalctl -u nodyx-relay-client -f"
fi
echo ""
echo -e "${GREEN}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${RESET}"
echo ""
echo -e "     ${BOLD}$(t summ_creds_arrow)  ${CYAN}${CREDS_FILE}${RESET}"
echo -e "     ${CYAN}$(t summ_creds_warn)${RESET}"
echo ""
if $RELAY_MODE; then
  echo -e "     ${GREEN}$(t summ_relay_no_dns)${RESET}"
else
  echo -e "     ${YELLOW}$(printf "$(t summ_dns_check)" "${BOLD}" "${DOMAIN}" "${RESET}" "${YELLOW}" "${PUBLIC_IP}")${RESET}"
fi
echo ""
echo -e "${GREEN}${BOLD}  ╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# Marquer l'installation comme complète — désactive le rollback trap
_INSTALL_COMPLETE=true
