#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Nodyx — Installeur one-click / One-click installer
#  Ubuntu 22.04 / 24.04  ·  Debian 11 / 12 / 13  ·  ARM64 supporté
#
#  ── Installation (recommandé) ───────────────────────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/nodyx/main/install.sh | sudo bash
#
#  ── Mise à jour d'une instance existante ────────────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/nodyx/main/install.sh | sudo bash -s -- --upgrade
#
#  ── Installation silencieuse (CI/CD, Ansible) ───────────────────────────────
#
#    curl -fsSL https://raw.githubusercontent.com/Pokled/nodyx/main/install.sh | sudo bash -s -- \
#      --domain=ma-communaute.fr  --name="Ma Communauté"  --slug=ma-communaute \
#      --admin-user=admin  --admin-email=admin@ma-communaute.fr \
#      --admin-password-file=/root/mdp-admin.txt  --yes
#
#    Le mot de passe se donne par fichier : en argument (--admin-password=…),
#    tout utilisateur du serveur le lit via ps. La variable NODYX_ADMIN_PASSWORD
#    marche aussi, mais seulement depuis un shell déjà root (sudo -i) : sudo vide
#    l'environnement, et « sudo NODYX_ADMIN_PASSWORD=… » remet le secret dans la
#    ligne de commande de sudo, visible via ps et inscrite dans son journal.
#    Sans terminal (Ansible, cron), --yes accepte les réponses par défaut ; une
#    question sans option ni défaut arrête l'installeur en disant laquelle.
#
#  ── Autres options ──────────────────────────────────────────────────────────
#
#    wget -qO- https://raw.githubusercontent.com/Pokled/nodyx/main/install.sh | sudo bash
#    git clone https://github.com/Pokled/nodyx.git && cd Nodyx && sudo bash install.sh
#    sudo bash install.sh --help       (liste tous les flags)
#
# ═══════════════════════════════════════════════════════════════════════════════
set -euo pipefail

# ── Auto-relaunch si le script est lu depuis un pipe (curl|bash) ──────────────
# Lu depuis un pipe, le script ne peut pas lire les réponses sur son entrée
# standard (c'est lui-même) : on se télécharge dans /tmp et on relance.
# Seulement dans ce cas : lancé depuis un fichier (nodyx-update, cron, Ansible),
# il n'y a rien à relancer. Avant le 04/10/2026, toute entrée qui n'était pas un
# terminal déclenchait la relance avec `</dev/tty`, qui n'existe pas sans
# terminal : le script mourait aussitôt, --yes ou pas.
if [[ ! -t 0 && -z "${_NODYX_RELAUNCHED:-}" ]] \
   && [[ -z "${BASH_SOURCE[0]:-}" || ! -f "${BASH_SOURCE[0]:-}" ]]; then
  _SELF=$(mktemp /tmp/nodyx_install_XXXXXX.sh)
  curl -fsSL https://raw.githubusercontent.com/Pokled/nodyx/main/install.sh -o "$_SELF" 2>/dev/null \
    || wget -qO "$_SELF" https://raw.githubusercontent.com/Pokled/nodyx/main/install.sh
  # Drain remaining stdin avant exec : sinon le curl en amont continue d'écrire
  # dans un pipe fermé après le exec et sort en code 23 (write error).
  cat >/dev/null 2>&1 || true
  export _NODYX_RELAUNCHED=1
  if { : </dev/tty; } 2>/dev/null; then exec bash "$_SELF" "$@" </dev/tty; fi
  exec bash "$_SELF" "$@" </dev/null
fi

# ── Auto-update si lancé directement (fichier local potentiellement ancien) ───
# On se télécharge dans /tmp et on compare ; si différent → relance la version fraîche.
# _NODYX_SELFUPDATE=1 empêche la récursion.
if [[ -z "${_NODYX_SELFUPDATE:-}" ]] && [[ -z "${_NODYX_NO_SELFUPDATE:-}" ]]; then
  _FRESH=$(mktemp /tmp/nodyx_install_XXXXXX.sh)
  if curl -fsSL --max-time 10 https://raw.githubusercontent.com/Pokled/nodyx/main/install.sh \
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
T_EN[bin_checksum_bad]="%s: the downloaded file does NOT match its pinned SHA-256 checksum. It was NOT installed. Please report it: https://github.com/Pokled/nodyx/issues"
T_FR[bin_checksum_bad]="%s : le fichier téléchargé NE correspond PAS à son empreinte SHA-256 épinglée. Il n'a PAS été installé. Signale-le : https://github.com/Pokled/nodyx/issues"
T_EN[bin_checksum_missing]="%s: no pinned SHA-256 checksum for this version: refusing to install an unverified binary."
T_FR[bin_checksum_missing]="%s : aucune empreinte SHA-256 épinglée pour cette version : refus d'installer un binaire non vérifié."
T_EN[ufw_no_ssh_port]="Could not find the port SSH listens on: the firewall was left UNTOUCHED (enabling it could lock you out of this server). Configure it yourself: sudo ufw allow <your-ssh-port>/tcp && sudo ufw enable"
T_FR[ufw_no_ssh_port]="Port SSH introuvable : pare-feu laissé TEL QUEL (l'activer pourrait t'enfermer dehors). Configure-le toi-même : sudo ufw allow <ton-port-ssh>/tcp && sudo ufw enable"
T_EN[ufw_kept_rules]="Firewall already active: your rules are kept, Nodyx only adds its own (copy: %s)"
T_FR[ufw_kept_rules]="Pare-feu déjà actif : tes règles sont conservées, Nodyx ajoute seulement les siennes (copie : %s)"
T_EN[ufw_ssh_rule_missing]="The SSH rule for port %s could not be added: firewall NOT enabled, so as not to lock you out."
T_FR[ufw_ssh_rule_missing]="La règle SSH du port %s n'a pas pu être ajoutée : pare-feu NON activé, pour ne pas t'enfermer dehors."
T_EN[ufw_configured_ssh]="Firewall active, SSH allowed on port(s): %s"
T_FR[ufw_configured_ssh]="Pare-feu actif, SSH autorisé sur le(s) port(s) : %s"
T_EN[ufw_not_active]="UFW did not come up as expected: check it yourself (sudo ufw status verbose)."
T_FR[ufw_not_active]="UFW ne s'est pas activé comme prévu : vérifie toi-même (sudo ufw status verbose)."
T_EN[caddy_invalid]="Generated Caddyfile rejected by caddy validate. Nothing was changed in Caddy. Please report it: https://github.com/Pokled/nodyx/issues"
T_FR[caddy_invalid]="Caddyfile généré refusé par caddy validate. Rien n'a été changé dans Caddy. Signale-le : https://github.com/Pokled/nodyx/issues"
T_EN[caddy_backup]="Previous Caddyfile saved: %s"
T_FR[caddy_backup]="Ancien Caddyfile sauvegardé : %s"
T_EN[install_lib_missing]="Installer library missing in the cloned repository: %s"
T_FR[install_lib_missing]="Bibliothèque de l'installeur absente du dépôt cloné : %s"
T_EN[relay_restarted]="Relay client restarted — tunnel to relay.nodyx.org active"
T_FR[relay_restarted]="Relay client redémarré — tunnel vers relay.nodyx.org actif"
T_EN[upgrade_done]='✔  Nodyx v%s operational'
T_FR[upgrade_done]='✔  Nodyx v%s opérationnel'
T_EN[upgrade_no_backup_confirm]='The database backup could not be verified. Update anyway, WITHOUT a backup?'
T_FR[upgrade_no_backup_confirm]="La sauvegarde de la base n'a pas pu être vérifiée. Mettre à jour quand même, SANS sauvegarde ?"
T_EN[upgrade_no_backup_auto]='The database backup could not be verified (--yes never updates without one).'
T_FR[upgrade_no_backup_auto]="La sauvegarde de la base n'a pas pu être vérifiée (--yes ne met jamais à jour sans)."
T_EN[upgrade_cancelled_untouched]='Update cancelled. Nothing was changed.'
T_FR[upgrade_cancelled_untouched]="Mise à jour annulée. Rien n'a été modifié."
T_EN[upgrade_lib_missing]='scripts/install/build.sh is missing from the updated code: update stopped, the site still runs the previous version.'
T_FR[upgrade_lib_missing]="scripts/install/build.sh manque dans le code mis à jour : mise à jour arrêtée, le site tourne toujours sur la version précédente."
T_EN[upgrade_workdir_fail]='Could not create the build directories (disk full?). The site still runs the previous version.'
T_FR[upgrade_workdir_fail]="Impossible de créer les dossiers de compilation (disque plein ?). Le site tourne toujours sur la version précédente."
T_EN[upgrade_site_untouched]='The site was NOT touched: it still runs the previous version.'
T_FR[upgrade_site_untouched]="Le site n'a PAS été touché : il tourne toujours sur la version précédente."
T_EN[upgrade_swap_fail]='Could not switch to the new version; the previous one was put back. Run sudo nodyx-doctor.'
T_FR[upgrade_swap_fail]="Impossible de basculer sur la nouvelle version ; la précédente a été remise en place. Lance sudo nodyx-doctor."
T_EN[pkg_install_failed]='Installing the system packages failed (apt). Check your connection and your apt sources (apt-get update), then run the installer again.'
T_FR[pkg_install_failed]="L'installation des paquets système a échoué (apt). Vérifie la connexion et les sources apt (apt-get update), puis relance l'installeur."
T_EN[openssl_missing]='openssl is still missing after installing the packages: secrets cannot be generated.'
T_FR[openssl_missing]="openssl manque toujours après l'installation des paquets : impossible de générer les secrets."
T_EN[creds_password_kept]='%s still holds the admin password in clear text. It is no longer needed (lost password: sudo nodyx-recover). Remove the "Admin password" line once you have noted it elsewhere.'
T_FR[creds_password_kept]="%s contient encore le mot de passe admin en clair. Il n'est plus nécessaire (mot de passe perdu : sudo nodyx-recover). Supprime la ligne « Admin password » une fois notée ailleurs."
T_EN[upgrade_already_running]='Another Nodyx update is already running. Nothing was changed.'
T_FR[upgrade_already_running]="Une autre mise à jour de Nodyx est déjà en cours. Rien n'a été modifié."

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
T_EN[db_autobackup_restore_hint]="warn 'Restore the DB if needed: gunzip -c %s | runuser -u postgres -- psql nodyx'"
T_FR[db_autobackup_restore_hint]="warn 'Restaurer la DB si besoin : gunzip -c %s | runuser -u postgres -- psql nodyx'"
T_EN[db_autobackup_fail]="DB backup failed (DB empty or inaccessible) — continuing."
T_FR[db_autobackup_fail]="Sauvegarde DB échouée (DB vide ou inaccessible) — on continue."
T_EN[wipe_backup_failed]="The database backup failed or could not be verified: wipe CANCELLED, nothing was deleted. Free some disk space in /root, then try again."
T_FR[wipe_backup_failed]="La sauvegarde de la base a échoué ou n'a pas pu être vérifiée : effacement ANNULÉ, rien n'a été supprimé. Libère de la place dans /root, puis recommence."

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
T_EN[help_admin_pass]='    --admin-password=PASS   Admin password (discouraged: readable by any local user via ps)'
T_FR[help_admin_pass]='    --admin-password=PASS   Mot de passe admin (déconseillé : lisible par tout utilisateur via ps)'
T_EN[help_admin_pass_file]='    --admin-password-file=FILE  Admin password read from a file (recommended). NODYX_ADMIN_PASSWORD also works, from a root shell only: "sudo VAR=..." puts it back on the command line'
T_FR[help_admin_pass_file]='    --admin-password-file=FICHIER  Mot de passe admin lu dans un fichier (recommandé). NODYX_ADMIN_PASSWORD marche aussi, depuis un shell root seulement : « sudo VAR=… » la remet dans la ligne de commande'
T_EN[help_network]='    --network=direct|relay|sslip  Network mode (--domain implies direct; --yes defaults to relay)'
T_FR[help_network]='    --network=direct|relay|sslip  Mode réseau (--domain implique direct ; --yes choisit le relais)'
T_EN[admin_pass_file_unreadable]='--admin-password-file: cannot read a password from %s.'
T_FR[admin_pass_file_unreadable]='--admin-password-file : impossible de lire un mot de passe dans %s.'
T_EN[admin_pass_argv_warn]='--admin-password is readable by every user of this server (ps) and stays in your shell history and the sudo log. Prefer --admin-password-file or NODYX_ADMIN_PASSWORD, and change this password after installation.'
T_FR[admin_pass_argv_warn]="--admin-password est lisible par tout utilisateur de ce serveur (ps) et reste dans l'historique du shell et le journal de sudo. Préfère --admin-password-file ou NODYX_ADMIN_PASSWORD, et change ce mot de passe après l'installation."
T_EN[no_tty_question]='No terminal to ask: « %s ». Give the matching option (see --help), add --yes to accept the defaults, or run the installer in a terminal. Nothing more was changed.'
T_FR[no_tty_question]="Aucun terminal pour poser la question : « %s ». Donne l'option correspondante (voir --help), ajoute --yes pour accepter les réponses par défaut, ou lance l'installeur dans un terminal. Rien de plus n'a été modifié."
T_EN[prompt_default_auto]='%s → %s (--yes, default)'
T_FR[prompt_default_auto]='%s → %s (--yes, défaut)'
T_EN[secret_preset]='%s: provided, kept'
T_FR[secret_preset]='%s : fourni, conservé'
T_EN[secret_preset_too_short]='The provided admin password is too short: at least %s characters.'
T_FR[secret_preset_too_short]='Le mot de passe admin fourni est trop court : %s caractères minimum.'
T_EN[network_invalid]='--network=%s: expected direct, relay or sslip.'
T_FR[network_invalid]='--network=%s : direct, relay ou sslip attendu.'
T_EN[network_domain_conflict]='--domain only goes with --network=direct (relay and sslip choose the address themselves).'
T_FR[network_domain_conflict]="--domain ne va qu'avec --network=direct (relais et sslip choisissent l'adresse eux-mêmes)."
T_EN[help_options_header]='  Options:'
T_FR[help_options_header]='  Options :'
T_EN[help_yes]='    --yes, -y          Auto-confirm all prompts'
T_FR[help_yes]='    --yes, -y          Répondre oui à toutes les confirmations'
T_EN[help_no_turn]='    --no-turn          Skip nodyx-turn installation'
T_FR[help_no_turn]='    --no-turn          Ne pas installer nodyx-turn'
T_EN[help_no_sfu]='    --no-sfu           Skip nodyx-sfud (voice stays in mesh mode)'
T_FR[help_no_sfu]='    --no-sfu           Ne pas installer nodyx-sfud (le vocal reste en mesh)'
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
T_EN[confirm_ny]='[y/N]'
T_FR[confirm_ny]='[o/N]'
T_EN[confirm_invalid]='Please answer yes or no (y/n).'
T_FR[confirm_invalid]='Réponds oui ou non (o/n).'
T_EN[env_unquotable]="The value of « %s » contains both ' and \` : it cannot be stored safely. Change it and run the installer again."
T_FR[env_unquotable]="La valeur de « %s » contient à la fois ' et \` : impossible de l'enregistrer sans risque. Modifie-la puis relance l'installeur."
T_EN[pg_datadir_kept]="A PostgreSQL data directory already exists (%s): it is kept, never recreated."
T_FR[pg_datadir_kept]="Un dossier de données PostgreSQL existe déjà (%s) : il est conservé, jamais recréé."
T_EN[caddy_other_sites]='Your Caddyfile also serves: %s. The installer writes its own Caddyfile: those sites would no longer be served (a copy of the file is kept).'
T_FR[caddy_other_sites]='Ton Caddyfile sert aussi : %s. L'"'"'installeur écrit son propre Caddyfile : ces sites ne seraient plus servis (une copie du fichier est gardée).'
T_EN[caddy_other_sites_q]='Replace it anyway?'
T_FR[caddy_other_sites_q]='Le remplacer quand même ?'
T_EN[caddy_other_sites_stop]='Installation stopped before any change. Install Nodyx on another server, or add its site block to your Caddyfile by hand (model: scripts/install/caddyfile.sh in the repository).'
T_FR[caddy_other_sites_stop]='Installation arrêtée avant toute modification. Installe Nodyx sur un autre serveur, ou ajoute son bloc de site à ton Caddyfile à la main (modèle : scripts/install/caddyfile.sh dans le dépôt).'
T_EN[caddy_other_sites_yes]='--yes cannot decide to stop serving other sites: run the installer interactively. Nothing was changed.'
T_FR[caddy_other_sites_yes]='--yes ne peut pas décider de couper d'"'"'autres sites : lance l'"'"'installeur en interactif. Rien n'"'"'a été modifié.'
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
T_EN[port_choice_prompt]='Choice [1-3] (default: 3):'
T_FR[port_choice_prompt]='Choix [1-3] (défaut : 3) :'
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
T_EN[relay_probe]='Checking that your network lets the tunnel out on port 7443...'
T_FR[relay_probe]='Vérification que votre réseau laisse sortir le tunnel sur le port 7443...'
T_EN[relay_probe_ok]='Outbound port 7443 is open. The tunnel will work.'
T_FR[relay_probe_ok]='Le port 7443 sort bien. Le tunnel fonctionnera.'
T_EN[relay_probe_v6]='Port 7443 is filtered over IPv4, but IPv6 works. Using %s instead.'
T_FR[relay_probe_v6]='Le port 7443 est filtré en IPv4, mais IPv6 fonctionne. Utilisation de %s à la place.'
T_EN[relay_probe_wss]='Port 7443 is blocked, but the tunnel goes through HTTPS on port 443. Using %s instead.'
T_FR[relay_probe_wss]='Le port 7443 est bloqué, mais le tunnel passe en HTTPS sur le port 443. Utilisation de %s à la place.'
T_EN[relay_probe_wss_try]='Port 7443 is blocked. Trying the tunnel over HTTPS, on port 443...'
T_FR[relay_probe_wss_try]='Le port 7443 est bloqué. Essai du tunnel en HTTPS, sur le port 443...'
T_EN[relay_probe_blocked]='Your network silently drops outbound port 7443. The tunnel cannot come up.'
T_FR[relay_probe_blocked]='Votre réseau bloque silencieusement le port 7443 en sortie. Le tunnel ne pourra pas monter.'
T_EN[relay_probe_hint]='This is a network restriction, not a mistake on your side. Company, university and institute networks often allow only 80 and 443.'
T_FR[relay_probe_hint]="C'est une restriction du réseau, pas une erreur de votre part. Les réseaux d'entreprise, d'université et d'institut n'autorisent souvent que 80 et 443."
T_EN[relay_probe_doc]='What to do, including a message to send to your network administrator: %s'
T_FR[relay_probe_doc]="Que faire, avec un message prêt à envoyer à votre administrateur réseau : %s"
T_EN[relay_probe_continue]='Continue anyway? The instance will install correctly but stay unreachable until the port is opened. [y/N]'
T_FR[relay_probe_continue]="Continuer quand même ? L'instance s'installera correctement mais restera injoignable tant que le port ne sera pas ouvert. [o/N]"
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
T_EN[node_installing]='Installing Node.js 22 LTS...'
T_FR[node_installing]='Installation de Node.js 22 LTS...'
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
T_EN[pm2_logrotate_set]='pm2-logrotate configured (50M, 7 days, compressed)'
T_FR[pm2_logrotate_set]='pm2-logrotate configuré (50M, 7 jours, compressé)'
T_EN[pm2_logrotate_fail]='pm2-logrotate could not be registered, PM2 logs will not be rotated'
T_FR[pm2_logrotate_fail]='pm2-logrotate non enregistré, les logs PM2 ne seront pas tournés'
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

# §18b — SFU (nodyx-sfud) : vocal et partage d'écran scalables
T_EN[step_sfu]='Installing nodyx-sfud (scalable voice & screen sharing)'
T_FR[step_sfu]="Installation de nodyx-sfud (vocal et partage d'écran scalables)"
T_EN[sfu_downloading]='Downloading nodyx-sfud %s (%s)...'
T_FR[sfu_downloading]='Téléchargement de nodyx-sfud %s (%s)...'
# Le SFU est un SUPPLÉMENT : s'il échoue, le vocal marche quand même (en mesh).
# On ne fait donc JAMAIS échouer l'installation à cause de lui — on avertit.
T_EN[sfu_skipped]="nodyx-sfud not installed — voice still works, in mesh mode.\nLimits: ~4 people in screen sharing, and screen sharing has no sound.\nReason: %s"
T_FR[sfu_skipped]="nodyx-sfud non installé — le vocal fonctionne quand même, en mode mesh.\nLimites : ~4 personnes en partage d'écran, et le partage se fait sans son.\nRaison : %s"
T_EN[sfu_reason_arch]='unsupported architecture (%s)'
T_FR[sfu_reason_arch]='architecture non supportée (%s)'
T_EN[sfu_reason_dl]='download failed (%s)'
T_FR[sfu_reason_dl]='téléchargement impossible (%s)'
T_EN[sfu_reason_notbin]='the downloaded file is not a valid binary'
T_FR[sfu_reason_notbin]="le fichier téléchargé n'est pas un binaire valide"
T_EN[sfu_reason_start]='the service did not start (see: journalctl -u nodyx-sfud)'
T_FR[sfu_reason_start]='le service ne démarre pas (voir : journalctl -u nodyx-sfud)'
# Serveur derrière NAT (mode Relay) : le SFU a besoin de ports média joignables de
# l'extérieur, ce qu'un tunnel ne fournit pas. On ne demandera JAMAIS d'ouvrir un
# port sur la box de l'utilisateur : c'est un engagement du projet.
T_EN[sfu_relay_skipped]="Relay mode: nodyx-sfud is not installed (media ports are not reachable through a tunnel).\nVoice works in mesh mode: ~4 people in screen sharing, and no sound while sharing.\nLifting this limit will NOT require opening any port on your router — it is being worked on."
T_FR[sfu_relay_skipped]="Mode Relay : nodyx-sfud n'est pas installé (les ports média ne sont pas joignables à travers un tunnel).\nLe vocal fonctionne en mode mesh : ~4 personnes en partage d'écran, et le partage se fait sans son.\nLever cette limite n'exigera AUCUNE ouverture de port sur ta box — c'est en cours."
T_EN[sfu_started]='nodyx-sfud started (media ports %s, announced IP: %s)'
T_FR[sfu_started]='nodyx-sfud démarré (ports média %s, IP annoncée : %s)'

T_EN[step_firewall]='Configuring the firewall'
T_FR[step_firewall]='Configuration du pare-feu'
T_EN[ufw_existing_saved]='Existing UFW rules saved to %s'
T_FR[ufw_existing_saved]='Règles UFW existantes sauvegardées dans %s'
T_EN[ufw_rollback_msg]="warn 'UFW: rules added by Nodyx are marked SSH or Nodyx, see: sudo ufw status numbered'"
T_FR[ufw_rollback_msg]="warn 'UFW : les règles ajoutées par Nodyx sont marquées SSH ou Nodyx, voir : sudo ufw status numbered'"
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
T_EN[sub_enable_q]='Enable %s?'
T_FR[sub_enable_q]='Activer %s ?'
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
T_EN[slug_checking]="Checking that %s.nodyx.org is available..."
T_FR[slug_checking]="Vérification que %s.nodyx.org est libre..."
T_EN[slug_available]="%s.nodyx.org is available"
T_FR[slug_available]="%s.nodyx.org est libre"
T_EN[slug_unavailable]="%s.nodyx.org is not available (%s): choose another name."
T_FR[slug_unavailable]="%s.nodyx.org n'est pas disponible (%s) : choisis un autre nom."
T_EN[slug_unavailable_yes]="%s.nodyx.org is not available (%s): run the installer again with --slug=another-name. Nothing was changed."
T_FR[slug_unavailable_yes]="%s.nodyx.org n'est pas disponible (%s) : relance l'installeur avec --slug=autre-nom. Rien n'a été modifié."
T_EN[slug_check_unknown]="Could not check the name with the directory (offline?): continuing; it will be checked again at registration."
T_FR[slug_check_unknown]="Impossible de vérifier le nom auprès de l'annuaire (hors ligne ?) : on continue, il sera revérifié à l'inscription."
T_EN[slug_taken_late]="%s.nodyx.org was taken by someone else during the installation. Nothing has been sent to that name. Run the installer again with --slug=another-name."
T_FR[slug_taken_late]="%s.nodyx.org a été pris par quelqu'un d'autre pendant l'installation. Rien n'a été envoyé vers ce nom. Relance l'installeur avec --slug=autre-nom."
T_EN[hc_dir_registered]='Directory  →  %s is registered'
T_FR[hc_dir_registered]='Annuaire  →  %s est inscrite'
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
T_EN[relay_client_started]='Nodyx Relay Client started — tunnel to %s active'
T_FR[relay_client_started]='Nodyx Relay Client démarré — tunnel vers %s actif'
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
T_EN[banner_online]='║    ✦   N O D Y X   ·   I N S T A N C E   O N L I N E   ✦     ║'
T_EN[banner_errors]='║     ✘   I N S T A L L E D ,   W I T H   E R R O R S   ✘      ║'
T_FR[banner_errors]='║    ✘   I N S T A L L É E ,   A V E C   E R R E U R S   ✘     ║'
T_EN[install_errors_exit]='Installation finished with %s error(s) in the health check (see above): exit code 1. Diagnosis: sudo nodyx-doctor'
T_FR[install_errors_exit]="Installation terminée avec %s erreur(s) au bilan de santé (voir ci-dessus) : code de sortie 1. Diagnostic : sudo nodyx-doctor"
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
T_EN[summ_recover_hint]='# lost admin access: reset link for an account'
T_FR[summ_recover_hint]="# accès admin perdu : lien de réinitialisation d'un compte"
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
  echo -e "  ${CYAN}║${RESET}  AGPL-3.0  ·  ${CYAN}github.com/Pokled/nodyx${RESET}            ${CYAN}║${RESET}"
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

# _env_quote <valeur> : la valeur entre délimiteurs, lue telle quelle par dotenv.
# Sans délimiteur, dotenv coupe au premier « # » (mot de passe SMTP « abc#123 »
# lu « abc », mesuré le 03/10/2026). On prend le premier délimiteur absent de
# la valeur, ' puis ` ; jamais " (dotenv y transforme \n en retour à la ligne).
# Échoue si la valeur contient les deux : l'appelant la refuse.
_env_quote() {
  local v="$1" q
  for q in "'" '`'; do
    if [[ "$v" != *"$q"* ]]; then printf '%s%s%s' "$q" "$v" "$q"; return 0; fi
  done
  return 1
}

# Retourne 0 (true) si $1 > $2 en semver
version_gt() { [[ "$(printf '%s\n' "$1" "$2" | sort -V | tail -1)" == "$1" ]] && [[ "$1" != "$2" ]]; }

# Rotation des logs PM2, sur le daemon 'nodyx' (celui qui fait tourner les apps).
#
# ATTENTION, piège vécu en production : "npm install -g pm2-logrotate" NE SUFFIT
# PAS. Il pose le paquet sur le disque mais n'enregistre AUCUN module dans PM2 :
# le daemon ne le lance jamais, "pm2 set pm2-logrotate:*" écrit dans le vide, et
# l'installeur affichait quand même "configuré". Panne 100% SILENCIEUSE : les
# logs grossissent jusqu'à saturer le disque (constaté sur nodyx.org, 1,2 Go pour
# le seul nodyx-core-out.log). Seul "pm2 install" enregistre et lance le module.
#
# Idempotent : ne fait rien si le module tourne déjà. Suppose l'utilisateur
# 'nodyx' déjà créé, donc à n'appeler qu'APRÈS la création de l'utilisateur.
_setup_pm2_logrotate() {
  local as_nodyx=(runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2)
  id -u nodyx &>/dev/null || return 0
  if "${as_nodyx[@]}" list 2>/dev/null | grep -q 'pm2-logrotate'; then
    return 0
  fi
  "${as_nodyx[@]}" install pm2-logrotate >/dev/null 2>&1 || true
  "${as_nodyx[@]}" set pm2-logrotate:max_size 50M   >/dev/null 2>&1 || true
  "${as_nodyx[@]}" set pm2-logrotate:retain   7     >/dev/null 2>&1 || true
  "${as_nodyx[@]}" set pm2-logrotate:compress true  >/dev/null 2>&1 || true
  # Ne déclarer le succès que si le module est RÉELLEMENT enregistré.
  "${as_nodyx[@]}" list 2>/dev/null | grep -q 'pm2-logrotate'
}

# ── Services nodyx-relay-client et nodyx-turn : secrets HORS de la ligne de ──
# commande (04/10/2026). Avant, le jeton de l'annuaire et le secret TURN étaient
# des arguments : lisibles par tout utilisateur via `ps`, et le jeton en clair
# dans l'unité systemd, lisible par tous. Les binaires publiés les lisent dans
# l'environnement (NODYX_RELAY_TOKEN, TURN_SECRET), chargé par systemd depuis un
# fichier en 600. Le serveur et le slug du relais (non secrets) restent des
# arguments, lus dans le même fichier : la mise à jour ne les perd plus (avant,
# elle remettait relay.nodyx.org:7443 et cassait les instances passées par wss://).
# NODYX_TEST_ROOT préfixe les chemins (tests seulement).
_nodyx_write_relay_unit() { # <serveur> <slug> <jeton>
  local r="${NODYX_TEST_ROOT:-}"
  install -d -m 755 "$r/etc/nodyx" "$r/etc/systemd/system"
  (umask 077; printf 'NODYX_RELAY_SERVER=%s\nNODYX_RELAY_SLUG=%s\nNODYX_RELAY_TOKEN=%s\n' "$1" "$2" "$3" > "$r/etc/nodyx/relay.env")
  chmod 600 "$r/etc/nodyx/relay.env"
  cat > "$r/etc/systemd/system/nodyx-relay-client.service" <<'_SVC'
[Unit]
Description=Nodyx Relay Client — tunnel vers relay.nodyx.org
After=network.target

[Service]
# Serveur, slug et jeton : /etc/nodyx/relay.env (600). Le jeton est lu par
# nodyx-relay dans son environnement, jamais passé en argument.
EnvironmentFile=/etc/nodyx/relay.env
ExecStart=/usr/local/bin/nodyx-relay client --server ${NODYX_RELAY_SERVER} --slug ${NODYX_RELAY_SLUG} --local-port 80
Restart=on-failure
RestartSec=5s
StartLimitIntervalSec=60
StartLimitBurst=5
User=nodyx

[Install]
WantedBy=multi-user.target
_SVC
}

_nodyx_write_turn_unit() {
  local r="${NODYX_TEST_ROOT:-}"
  install -d -m 755 "$r/etc/systemd/system"
  cat > "$r/etc/systemd/system/nodyx-turn.service" <<'_SVC'
[Unit]
Description=Nodyx TURN Server (WebRTC relay)
After=network.target

[Service]
# Port, IP publique, royaume, secret et durée : lus par nodyx-turn dans son
# environnement, chargé depuis /etc/nodyx-turn.env (600). Rien en argument.
EnvironmentFile=/etc/nodyx-turn.env
ExecStart=/usr/local/bin/nodyx-turn server
Restart=on-failure
RestartSec=5s
User=nodyx

[Install]
WantedBy=multi-user.target
_SVC
}

# _nodyx_migrate_service_secrets : réécrit les services à l'ancienne forme
# (secret en argument). Le serveur, le slug et le jeton du relais sont relus
# dans l'unité existante : rien n'est perdu, rien n'est inventé.
_nodyx_migrate_service_secrets() {
  local r="${NODYX_TEST_ROOT:-}" u srv slg tok changed=1
  u="$r/etc/systemd/system/nodyx-relay-client.service"
  if [[ -f "$u" ]] && grep -q -- '--token ' "$u"; then
    srv="$(grep -oE -- '--server [^ \\]+' "$u" | head -1 | awk '{print $2}')"
    slg="$(grep -oE -- '--slug [^ \\]+' "$u" | head -1 | awk '{print $2}')"
    tok="$(grep -oE -- '--token [^ \\]+' "$u" | head -1 | awk '{print $2}')"
    if [[ -n "$srv" && -n "$slg" && -n "$tok" ]]; then
      _nodyx_write_relay_unit "$srv" "$slg" "$tok"; changed=0
    fi
  fi
  u="$r/etc/systemd/system/nodyx-turn.service"
  if [[ -f "$u" && -f "$r/etc/nodyx-turn.env" ]] && grep -q -- '--secret' "$u"; then
    _nodyx_write_turn_unit; changed=0
  fi
  return $changed
}

# nodyx-recover : reprendre la main sur l'instance quand mot de passe et e-mail
# sont perdus (04/10/2026). L'outil existait dans le core mais n'était installé
# nulle part, et `npm run recover` (ts-node) plantait avec TypeScript 7 : on
# lance la version compilée. Le mot de passe admin n'est plus conservé en clair
# dans /root/nodyx-credentials.txt, c'est cet outil qui le remplace.
_nodyx_write_recover_script() { # <chemin> <dossier nodyx>
  cat > "$1" <<RECOVERSCRIPT
#!/usr/bin/env bash
# nodyx-recover : lien de réinitialisation pour un compte, depuis le serveur.
#   sudo nodyx-recover --list | --reset <utilisateur|email> | --promote <qui>
set -euo pipefail
[[ \$EUID -eq 0 ]] || { echo "Lance en root : sudo nodyx-recover" >&2; exit 1; }
cd "$2/nodyx-core"
exec node dist/scripts/recover.js "\$@"
RECOVERSCRIPT
  chmod 755 "$1"
}

# nodyx-update : un simple raccourci vers `install.sh --upgrade` (04/10/2026).
# Avant, c'était une 3e copie de la mise à jour, qui compilait dans le dossier
# servi, sans sauvegarde de la base ni remise des droits à nodyx.
_nodyx_write_update_script() { # <chemin> <dossier nodyx>
  cat > "$1" <<UPDATESCRIPT
#!/usr/bin/env bash
# nodyx-update : met à jour Nodyx (raccourci vers install.sh --upgrade).
set -euo pipefail
[[ \$EUID -eq 0 ]] || { echo "Lance en root : sudo nodyx-update" >&2; exit 1; }
exec bash "$2/install.sh" --upgrade "\$@"
UPDATESCRIPT
  chmod 755 "$1"
}

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
  _setup_pm2_logrotate || true

  # Une seule mise à jour à la fois : un nodyx-update en cron et un lancé à la
  # main feraient sinon git pull et bascule en même temps, dans un ordre imprévisible.
  exec {_NODYX_LOCK_FD}>/run/lock/nodyx-upgrade.lock
  flock -n "$_NODYX_LOCK_FD" || die "$(t upgrade_already_running)"

  # Sauvegarde de la base AVANT tout : au redémarrage, le nouveau core applique
  # ses migrations. Sans sauvegarde vérifiée, on demande (Entrée = non).
  _auto_backup_db upgrade
  if [[ "${_DB_EXISTS:-false}" == "true" && "${_AUTO_BACKUP_OK:-false}" != "true" ]]; then
    $_AUTO_YES && die "$(t upgrade_no_backup_auto) $(t upgrade_cancelled_untouched)"
    _confirm "$(t upgrade_no_backup_confirm)" n || die "$(t upgrade_cancelled_untouched)"
  fi

  info "$(t code_fetch)"
  git config --global --get-all safe.directory 2>/dev/null | grep -qxF "$dir" \
    || git config --global --add safe.directory "$dir" 2>/dev/null || true
  # Reset generated files (package-lock.json, ecosystem.config.js…) to unblock the pull
  # ecosystem.config.js is in the repo but rewritten by the installer — reset to avoid a git conflict
  git -C "$dir" checkout -- nodyx-core/package-lock.json nodyx-frontend/package-lock.json ecosystem.config.js 2>/dev/null || true
  git -C "$dir" pull --ff-only || die "$(t git_pull_fail)"
  ok "$(t code_uptodate)"

  # Migrations de configuration livrées avec le code (03/10/2026 : l'IP du
  # visiteur jusqu'au core, cf scripts/install/caddyfile.sh).
  if [[ -f "${dir}/scripts/install/caddyfile.sh" ]]; then
    # shellcheck source=scripts/install/caddyfile.sh
    . "${dir}/scripts/install/caddyfile.sh"
    nodyx_migrate_client_ip "$dir" || warn "$(t caddy_invalid)"
  fi

  # Compilation « à côté » (04/10/2026, scripts/install/build.sh) : l'ancienne
  # version continue de servir pendant la compilation, et rien ne bascule tant
  # que le core ET le frontend ne sont pas compilés. Avant, un `fuser -k` tuait
  # tout ce qui écoutait sur 3000/4173 puis on compilait dans le dossier servi :
  # une compilation ratée laissait le site à terre.
  [[ -f "${dir}/scripts/install/build.sh" ]] || die "$(t upgrade_lib_missing)"
  # shellcheck source=scripts/install/build.sh
  . "${dir}/scripts/install/build.sh"
  nodyx_purge_stale_work "$dir"
  local _wc _wf
  _wc="$(nodyx_work_dir "$dir" core)" && _wf="$(nodyx_work_dir "$dir" frontend)" \
    || die "$(t upgrade_workdir_fail)"
  _nodyx_upgrade_cleanup() { rm -rf -- "$_wc" "$_wf"; }

  info "$(t backend_rebuild)"
  if ! nodyx_build_aside "${dir}/nodyx-core" dist "$_wc/app"; then
    _nodyx_upgrade_cleanup; die "$(t backend_build_fail) $(t upgrade_site_untouched)"
  fi
  ok "$(t backend_built)"

  info "$(t frontend_rebuild)"
  # Heap cap scaled to total RAM (see fresh-install path for the rationale)
  _RB_RAM_MB=$(free -m 2>/dev/null | awk '/^Mem/{print $2}' || echo 4096)
  if   [[ "$_RB_RAM_MB" -lt 1500 ]]; then export NODE_OPTIONS="--max-old-space-size=768"
  elif [[ "$_RB_RAM_MB" -lt 3000 ]]; then export NODE_OPTIONS="--max-old-space-size=1536"
  elif [[ "$_RB_RAM_MB" -lt 8000 ]]; then export NODE_OPTIONS="--max-old-space-size=2048"
  else                                    export NODE_OPTIONS="--max-old-space-size=4096"
  fi
  if ! nodyx_build_aside "${dir}/nodyx-frontend" build "$_wf/app"; then
    unset NODE_OPTIONS; _nodyx_upgrade_cleanup
    die "$(t frontend_build_fail) $(t upgrade_site_untouched)"
  fi
  unset NODE_OPTIONS
  ok "$(t frontend_built)"

  # Bascule : deux `mv` par application. Si le frontend ne bascule pas, le
  # core revient à sa version précédente : jamais un core neuf avec un vieux
  # frontend.
  if ! nodyx_swap_outputs "${dir}/nodyx-core" dist "$_wc/app"; then
    _nodyx_upgrade_cleanup; die "$(t upgrade_swap_fail)"
  fi
  if ! nodyx_swap_outputs "${dir}/nodyx-frontend" build "$_wf/app"; then
    nodyx_swap_back "${dir}/nodyx-core" dist "$_wc/app"
    _nodyx_upgrade_cleanup; die "$(t upgrade_swap_fail)"
  fi

  # Anciens processus PM2 de root (migration nexus-* → nodyx-*), seulement si un
  # démon PM2 root existe : `pm2 delete` en démarrerait un sinon.
  if [[ -S /root/.pm2/rpc.sock ]]; then
    for _old_proc in nexus-core nexus-frontend nodyx-core nodyx-frontend; do
      PM2_HOME=/root/.pm2 pm2 delete "$_old_proc" 2>/dev/null || true
    done
  fi

  info "$(t services_restart)"
  chown -R nodyx:nodyx "$dir" 2>/dev/null || true
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 restart "${dir}/ecosystem.config.js" --update-env 2>/dev/null \
    || runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 startOrRestart "${dir}/ecosystem.config.js" --update-env
  runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 save
  _nodyx_upgrade_cleanup
  [[ -f /usr/local/bin/nodyx-update ]] && _nodyx_write_update_script /usr/local/bin/nodyx-update "$dir"
  _nodyx_write_recover_script /usr/local/bin/nodyx-recover "$dir"
  # Anciennes installations : le mot de passe admin en clair est signalé, jamais
  # retiré d'office (la personne ne l'a peut-être noté nulle part ailleurs).
  if grep -qE '^Admin password   : [^(]' /root/nodyx-credentials.txt 2>/dev/null; then
    warn "$(t creds_password_kept /root/nodyx-credentials.txt)"
  fi

  # ── Relay client : upgrade du binaire si version périmée ─────────────────────
  # Sans ça, un client v0.1.3 pouvait rester 13 jours connecté à un pipe mort
  # (pas de keepalive TCP, pas de read timeout). Corrigé en v0.1.4.
  if [[ -f /usr/local/bin/nodyx-relay ]]; then
    local _cur_relay; _cur_relay=$(/usr/local/bin/nodyx-relay --version 2>/dev/null | awk '{print $2}' || echo "")
    local _want_relay="${NODYX_RELAY_VERSION#v}"; _want_relay="${_want_relay%-p2p}"
    if [[ -n "$_cur_relay" && "$_cur_relay" != "$_want_relay" ]]; then
      info "Updating nodyx-relay binary: $_cur_relay → $_want_relay"
      local _ARCH; _ARCH=$(uname -m)
      local _RELAY_ARCH=""
      case "$_ARCH" in
        x86_64)  _RELAY_ARCH="amd64" ;;
        aarch64) _RELAY_ARCH="arm64" ;;
      esac
      if [[ -n "$_RELAY_ARCH" ]]; then
        if _nodyx_fetch_bin "$NODYX_RELAY_VERSION" "nodyx-relay-linux-${_RELAY_ARCH}" /usr/local/bin/nodyx-relay; then
          systemctl restart nodyx-relay-client 2>/dev/null || true
          ok "nodyx-relay upgraded to $(/usr/local/bin/nodyx-relay --version 2>&1 || echo '?')"
        else
          warn "Could not install a verified nodyx-relay ${NODYX_RELAY_VERSION} — kept current version"
        fi
      fi
    fi
  fi

  # ── Relay client : recréer le service s'il est absent (upgrade depuis ancienne install) ──
  local _env_file="${dir}/nodyx-core/.env"
  local _dir_token; _dir_token=$(grep '^DIRECTORY_TOKEN=' "$_env_file" 2>/dev/null | cut -d= -f2- || true)
  local _slug;      _slug=$(grep '^NODYX_COMMUNITY_SLUG=' "$_env_file" 2>/dev/null | cut -d= -f2- || true)
  # Secrets hors de la ligne de commande (04/10/2026) pour les services existants.
  if _nodyx_migrate_service_secrets; then
    systemctl daemon-reload
    systemctl is-active --quiet nodyx-relay-client 2>/dev/null && systemctl restart nodyx-relay-client 2>/dev/null || true
    systemctl is-active --quiet nodyx-turn 2>/dev/null && systemctl restart nodyx-turn 2>/dev/null || true
    ok "Services nodyx-relay-client / nodyx-turn : secrets moved out of the command line"
  fi
  if [[ -n "$_dir_token" && -n "$_slug" ]] && ! systemctl is-active --quiet nodyx-relay-client 2>/dev/null; then
    if [[ -f /usr/local/bin/nodyx-relay ]]; then
      info "$(t relay_recreate)"
      # Le serveur choisi à l'installation (7443, IPv6 ou wss://) est conservé
      # dans /etc/nodyx/relay.env ; à défaut seulement, le serveur par défaut.
      _srv="$(grep -m1 '^NODYX_RELAY_SERVER=' /etc/nodyx/relay.env 2>/dev/null | cut -d= -f2- || true)"
      _nodyx_write_relay_unit "${_srv:-${RELAY_SERVER:-relay.nodyx.org:7443}}" "$_slug" "$_dir_token"
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
    echo -e "${YELLOW}    • Logs : ${BOLD}runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 logs nodyx-core --lines 50${RESET}"
    echo -e "${YELLOW}    • DB   : ${BOLD}runuser -u postgres -- psql -c '\\l'${RESET}"
    echo -e "${YELLOW}$(t rollback_relaunch)${RESET}"
  fi
  echo ""
}
trap '_nodyx_rollback' EXIT

# ── Auto-backup DB avant action destructive ───────────────────────────────────
# _nodyx_prune_backups <motif> : ne garde que les 5 sauvegardes les plus récentes
# correspondant au motif. Réservé aux sauvegardes de MISE À JOUR (une par
# nodyx-update : sans ce ménage, un nodyx-update quotidien remplit le disque).
# Celles d'un --wipe ou d'une réinstallation ne sont jamais supprimées.
_nodyx_prune_backups() {
  local f n=0
  while IFS= read -r f; do
    n=$((n+1))
    [[ $n -le 5 ]] || rm -f -- "$f"
  done < <(ls -1t -- $1 2>/dev/null)
}

_auto_backup_db() {
  local reason="${1:-pre-action}"
  [[ "${_DB_EXISTS:-false}" == "true" ]] || return 0
  local bak
  if [[ "$reason" == upgrade ]]; then
    bak="/root/nodyx-db-backup-upgrade-$(date +%Y%m%d-%H%M%S).sql.gz"
  else
    bak="/root/nodyx-db-backup-$(date +%Y%m%d-%H%M%S).sql.gz"
  fi
  info "$(t db_autobackup "$reason")"
  # Réussie seulement si l'archive est intacte ET contient bien un dump : un
  # pg_dump coupé par un disque plein laisse un .gz valide mais tronqué.
  if (umask 077; runuser -u postgres -- pg_dump nodyx 2>/dev/null | gzip > "$bak") \
     && gzip -t "$bak" 2>/dev/null \
     && gzip -dc "$bak" 2>/dev/null | grep -q -m1 "PostgreSQL database dump complete"; then
    _AUTO_BACKUP_OK=true
    local sz; sz=$(du -sh "$bak" 2>/dev/null | cut -f1 || echo "?")
    ok "$(t db_autobackup_done "${BOLD}" "$bak" "${RESET}" "$sz")"
    _rollback_register "$(t db_autobackup_restore_hint "$bak")"
    [[ "$reason" == upgrade ]] && _nodyx_prune_backups '/root/nodyx-db-backup-upgrade-*.sql.gz'
  else
    warn "$(t db_autobackup_fail)"
    rm -f "$bak"
  fi
}

# ── Version ────────────────────────────────────────────────────────────────────
# Source unique de vérité : fichier VERSION à la racine du repo. Résolution
# en cascade pour couvrir les 3 modes d'invocation (local, curl|bash, wget).
#   1. VERSION à côté du script (mode local : `git clone && bash install.sh`)
#   2. raw.githubusercontent.com/.../main/VERSION (mode `curl|bash`)
#   3. GitHub API releases/latest tag_name (fallback si raw down)
#   4. "unknown" — l'installeur continue mais le badge sera dégradé
_resolve_version() {
  local script_dir local_ver raw_ver api_ver
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || script_dir=""

  if [[ -n "$script_dir" && -f "$script_dir/VERSION" ]]; then
    local_ver="$(tr -d '[:space:]' < "$script_dir/VERSION" 2>/dev/null || true)"
    if [[ -n "$local_ver" ]]; then echo "$local_ver"; return; fi
  fi

  raw_ver="$(curl -sf --max-time 5 https://raw.githubusercontent.com/Pokled/nodyx/main/VERSION 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ -n "$raw_ver" ]]; then echo "$raw_ver"; return; fi

  api_ver="$(curl -sf --max-time 5 \
    -H 'Accept: application/vnd.github+json' \
    https://api.github.com/repos/Pokled/nodyx/releases/latest 2>/dev/null \
    | grep -oE '"tag_name":[[:space:]]*"[^"]+"' | head -1 \
    | sed -E 's/.*"v?([^"]+)".*/\1/' || true)"
  if [[ -n "$api_ver" ]]; then echo "$api_ver"; return; fi

  echo "unknown"
}
NODYX_VERSION="$(_resolve_version)"
# Relay client binary — single source of truth, used by install AND nodyx-update
NODYX_RELAY_VERSION="v0.1.4-p2p"

# ── Empreintes SHA-256 des binaires téléchargés et exécutés en root ───────────
# Clé : « <version>/<fichier publié> ». Vérifiées le 04/10/2026 : empreinte
# calculée sur le fichier téléchargé == empreinte publiée par GitHub ; fichiers
# déposés par Pokled ou par la CI du dépôt, jamais modifiés depuis.
# Changer une version = ajouter son empreinte ICI, dans le même commit : sans
# elle, _nodyx_fetch_bin refuse d'installer (scripts/tests/install-binaries.test.sh).
declare -A NODYX_BIN_SHA256=(
  [v0.1.2-p2p/nexus-turn-linux-amd64]=37bad0141b28aa2bbbc70fffdb6dbd8541972c26c9a3e64db9a3b978b3717adb
  [v0.1.2-p2p/nexus-turn-linux-arm64]=c1d6f755cd45d3e207333adc2b7f82e55b0b999fe192eab30b94acdf541a9320
  [sfu-v0.1.0/nodyx-sfud-linux-amd64]=3f0a5c3704a56e6a87ff9e8d1c6499f58aaf3a33f6aef11c87bd12b3ac9aa564
  [sfu-v0.1.0/nodyx-sfud-linux-arm64]=15df9007a2f159ff17c1a3c851c72e29747af2677a91bec8400518a47d772ca6
  [v0.1.4-p2p/nodyx-relay-linux-amd64]=93432a3da431971a2f4dd559c324402fbd4d0f89d07a67667ba6fbbd426ef621
  [v0.1.4-p2p/nodyx-relay-linux-arm64]=e34308368253084948f047d10a36c7d681a7dfb3efe1d25e585b371387c435ef
)

# _nodyx_fetch_bin <version> <fichier publié> <destination>
# Télécharge depuis les publications GitHub de Nodyx, vérifie l'empreinte
# épinglée, et n'installe QUE si elle correspond (avant le 04/10/2026 : seul
# « c'est un ELF » était vérifié). Codes : 0 installé, 1 téléchargement
# impossible, 2 aucune empreinte épinglée, 3 empreinte différente.
_nodyx_fetch_bin() {
  local version="$1" asset="$2" dest="$3" want got tmp
  want="${NODYX_BIN_SHA256[$version/$asset]:-}"
  if [[ -z "$want" ]]; then warn "$(printf "$(t bin_checksum_missing)" "$version/$asset")"; return 2; fi
  tmp="$(mktemp /tmp/nodyx-bin.XXXXXX)"
  if ! curl -fsSL --max-time 180 "https://github.com/Pokled/nodyx/releases/download/${version}/${asset}" -o "$tmp"; then
    rm -f "$tmp"; return 1
  fi
  got="$(sha256sum "$tmp" | cut -d' ' -f1)"
  if [[ "$got" != "$want" ]]; then
    rm -f "$tmp"; warn "$(printf "$(t bin_checksum_bad)" "$version/$asset")"; return 3
  fi
  chmod 755 "$tmp"
  mv -f "$tmp" "$dest"   # mv atomique : fonctionne même si l'ancien binaire tourne
}

# ── CLI flags ─────────────────────────────────────────────────────────────────
_FORCE_MODE=""        # upgrade | repair | reinstall | wipe (bypass detection menu)
_AUTO_YES=false       # --yes : passer toutes les confirmations
SKIP_TURN=false       # --no-turn
SKIP_SFU=false        # --no-sfu
_SFU_INSTALLED=false  # vrai seulement si le daemon SFU tourne réellement
SKIP_SUBDOMAIN=false  # --no-subdomain
_ARG_DOMAIN=""  _ARG_SLUG=""  _ARG_NAME=""
_ARG_ADMIN_USER=""  _ARG_ADMIN_EMAIL=""  _ARG_ADMIN_PASS=""
_ARG_ADMIN_PASS_FILE=""  _ARG_ADMIN_PASS_ARGV=false  _ARG_NETWORK=""

for _arg in "$@"; do
  case "$_arg" in
    --upgrade)            _FORCE_MODE="upgrade"   ;;
    --repair)             _FORCE_MODE="repair"    ;;
    --reinstall)          _FORCE_MODE="reinstall" ;;
    --wipe)               _FORCE_MODE="wipe"      ;;
    --yes|-y)             _AUTO_YES=true           ;;
    --no-turn)            SKIP_TURN=true           ;;
    --no-sfu)             SKIP_SFU=true            ;;
    --no-subdomain)       SKIP_SUBDOMAIN=true      ;;
    --domain=*)           _ARG_DOMAIN="${_arg#*=}" ;;
    --slug=*)             _ARG_SLUG="${_arg#*=}"   ;;
    --name=*)             _ARG_NAME="${_arg#*=}"   ;;
    --admin-user=*)       _ARG_ADMIN_USER="${_arg#*=}"  ;;
    --admin-email=*)      _ARG_ADMIN_EMAIL="${_arg#*=}" ;;
    --admin-password=*)   _ARG_ADMIN_PASS="${_arg#*=}"; _ARG_ADMIN_PASS_ARGV=true ;;
    --admin-password-file=*) _ARG_ADMIN_PASS_FILE="${_arg#*=}" ;;
    --network=*)          _ARG_NETWORK="${_arg#*=}" ;;
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
      echo "$(t help_admin_pass_file)"
      echo "$(t help_network)"
      echo ""
      echo "$(t help_options_header)"
      echo "$(t help_yes)"
      echo "$(t help_no_turn)"
      echo "$(t help_no_sfu)"
      echo "$(t help_no_subdomain)"
      echo "$(t help_lang)"
      echo "$(t help_help)"
      echo ""
      exit 0 ;;
    --lang=*) ;;  # already handled at i18n init
    --*) warn "$(t unknown_flag "${_arg}")" ;;
  esac
done

# ── Secrets hors de la ligne de commande (04/10/2026) ─────────────────────────
# Un argument est lisible par tout utilisateur du serveur (ps), reste dans
# l'historique du shell et dans le journal de sudo. Le mot de passe se donne
# donc par fichier (--admin-password-file), ou par variable d'environnement
# depuis un shell root (NODYX_ADMIN_PASSWORD), effacée aussitôt lue pour ne pas suivre les
# programmes lancés ensuite. --admin-password=… reste accepté, avec un avertissement.
if [[ -n "$_ARG_ADMIN_PASS_FILE" ]]; then
  [[ -f "$_ARG_ADMIN_PASS_FILE" && -r "$_ARG_ADMIN_PASS_FILE" ]] \
    || die "$(t admin_pass_file_unreadable "$_ARG_ADMIN_PASS_FILE")"
  IFS= read -r _ARG_ADMIN_PASS < "$_ARG_ADMIN_PASS_FILE" || true
  _ARG_ADMIN_PASS="${_ARG_ADMIN_PASS%$'\r'}"
  [[ -n "$_ARG_ADMIN_PASS" ]] || die "$(t admin_pass_file_unreadable "$_ARG_ADMIN_PASS_FILE")"
elif [[ -n "${NODYX_ADMIN_PASSWORD:-}" ]]; then
  _ARG_ADMIN_PASS="$NODYX_ADMIN_PASSWORD"
elif $_ARG_ADMIN_PASS_ARGV; then
  warn "$(t admin_pass_argv_warn)"
fi
unset NODYX_ADMIN_PASSWORD

# ── Terminal disponible ? ─────────────────────────────────────────────────────
# Les questions sont posées sur le terminal (/dev/tty), jamais sur l'entrée
# standard. Sans terminal (cron, Ansible, ssh sans -t), une question qui n'a
# ni option ni réponse par défaut acceptée par --yes arrête l'installeur
# proprement, en disant laquelle : avant, il mourait sur une erreur de bash.
_NODYX_TTY="${_NODYX_TTY:-/dev/tty}"
_HAS_TTY=false
{ : <"$_NODYX_TTY"; } 2>/dev/null && _HAS_TTY=true
_tty_needed() { # <question>
  $_HAS_TTY || die "$(t no_tty_question "$1")"
}

# Shortcut: --yes auto-confirms (replaces read -rp for confirmations)
_confirm() {
  # Usage: _confirm "message" [défaut y|n]  → 0 si oui, 1 si non.
  # Seuls oui/yes/o/y et non/no/n sont compris ; Entrée prend le défaut ; toute
  # autre réponse fait REPOSER la question. Avant le 03/10/2026, tout ce qui
  # n'était pas exactement « n » valait OUI : « non » lançait l'installation.
  local msg="$1" default="${2:-y}" _c _fd _hint
  [[ "$default" == "o" ]] && default="y"
  if $_AUTO_YES; then info "$(t confirm_auto_yes "$msg")"; return 0; fi
  _tty_needed "$msg"
  [[ "$default" == "n" ]] && _hint="$(t confirm_ny)" || _hint="$(t confirm_yn)"
  exec {_fd}<"${_NODYX_TTY:-/dev/tty}"
  while true; do
    _c=""
    read -r -u "$_fd" -p "$(echo -e "  ${BOLD}${msg} ${_hint}: ${RESET}")" _c || { exec {_fd}<&-; return 1; }
    _c="${_c//[[:space:]]/}"
    _c="${_c:-$default}"
    case "${_c,,}" in
      y|yes|o|oui) exec {_fd}<&-; return 0 ;;
      n|no|non)    exec {_fd}<&-; return 1 ;;
      *)           warn "$(t confirm_invalid)" ;;
    esac
  done
}

#
# TODO — Phase 6 (quand RHEL/Rocky/Alma sera ajouté) :
#   Refacto modulaire en install/ (apt vs dnf, firewall, package names).
#   Un seul install.sh entry point, des modules sourcés par fonction.
#   NE PAS FAIRE avant d'avoir un vrai cas d'usage RHEL à tester.

# prompt <variable> <question> [défaut]
# Un 3e argument, même vide, est un défaut : Entrée l'accepte (avant le
# 04/10/2026, un défaut vide rendait obligatoires les champs « optionnels »).
# Avec --yes, le défaut est pris sans demander.
prompt() {
  local var="$1" msg="$2" default="${3:-}" has_default=false val=''
  [[ $# -ge 3 ]] && has_default=true
  # If the variable is already pre-filled (via CLI arg), skip the prompt
  local _preset="${!var:-}"
  if [[ -n "$_preset" ]]; then
    info "$(t prompt_preset "$msg" "${BOLD}" "${_preset}" "${RESET}" "${CYAN}" "${RESET}")"
    return
  fi
  if $has_default && $_AUTO_YES; then
    printf -v "$var" '%s' "$default"
    info "$(t prompt_default_auto "$msg" "${default:--}")"
    return
  fi
  _tty_needed "$msg"
  if $has_default; then
    read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg} [${default}]: ")" val <"$_NODYX_TTY"
    val="${val:-$default}"
  else
    while [[ -z "$val" ]]; do
      read -rp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val <"$_NODYX_TTY"
    done
  fi
  printf -v "$var" '%s' "$val"
}

prompt_secret() {
  local var="$1" msg="$2" minlen="${3:-1}"
  local val=''
  _tty_needed "$msg"
  while [[ ${#val} -lt $minlen ]]; do
    [[ -n "$val" ]] && echo -e "  ${YELLOW}⚠${RESET}  $(t secret_too_short "$minlen")"
    read -rsp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val <"$_NODYX_TTY"
    echo
  done
  printf -v "$var" '%s' "$val"
}

# Une valeur déjà fournie (fichier, variable, option) est vérifiée et gardée :
# avant le 04/10/2026, elle était ignorée et redemandée au terminal, ce qui
# rendait impossible l'installation silencieuse documentée en tête de fichier.
prompt_secret_confirm() {
  local var="$1" msg="$2" minlen="${3:-1}"
  local val='' val2=''
  local _preset="${!var:-}"
  if [[ -n "$_preset" ]]; then
    [[ ${#_preset} -ge $minlen ]] || die "$(t secret_preset_too_short "$minlen")"
    info "$(t secret_preset "$msg")"
    return
  fi
  _tty_needed "$msg"
  while true; do
    while [[ ${#val} -lt $minlen ]]; do
      [[ -n "$val" ]] && echo -e "  ${YELLOW}⚠${RESET}  $(t secret_too_short "$minlen")"
      read -rsp "$(echo -e "  ${CYAN}?${RESET} ${msg}: ")" val <"$_NODYX_TTY"
      echo
    done
    read -rsp "$(echo -e "  ${CYAN}?${RESET} $(t secret_confirm): ")" val2 <"$_NODYX_TTY"
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

# Priorité 1 : fichier VERSION à la racine du repo installé (source unique de
# vérité depuis v2.5.0). Priorité 2 : package.json (legacy installs antérieurs).
# Priorité 3 : API live /instance/info (mais peut renvoyer une valeur cachée
# dans le .env d'une vieille install, donc dernier recours).
if [[ -f "${_NODYX_CHECK_DIR}/VERSION" ]]; then
  _INSTALLED_VERSION=$(tr -d '[:space:]' < "${_NODYX_CHECK_DIR}/VERSION" 2>/dev/null || true)
fi
if [[ -z "$_INSTALLED_VERSION" ]] && [[ -f "${_NODYX_CHECK_DIR}/nodyx-core/package.json" ]]; then
  _INSTALLED_VERSION=$(node -p "require('${_NODYX_CHECK_DIR}/nodyx-core/package.json').version" 2>/dev/null || true)
fi
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
   && runuser -u postgres -- psql -tc "SELECT 1 FROM pg_database WHERE datname='nodyx'" 2>/dev/null | grep -q 1; then
  _EXISTING=true
  _DB_EXISTS=true
  _DB_TABLE_COUNT=$(runuser -u postgres -- psql -d nodyx -tc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d ' \n' || echo 0)
  _EXISTING_MSGS+=("$(t detect_db "${_DB_TABLE_COUNT}")")
fi

if $_EXISTING && [[ -z "$_FORCE_MODE" ]]; then
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
    _tty_needed "$(t menu_what_do) (--upgrade, --repair, --reinstall, --wipe)"
    read -rp "$(echo -e "  ${BOLD}$(t menu_choice_prompt "${_cancel_opt}" "1") ${RESET}")" _det_choice <"$_NODYX_TTY"
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
    _tty_needed "$(t menu_what_do) (--upgrade, --repair, --reinstall, --wipe)"
    read -rp "$(echo -e "  ${BOLD}$(t menu_choice_prompt "3" "3") ${RESET}")" _det_choice <"$_NODYX_TTY"
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
    _tty_needed "$(t menu_what_do) (--upgrade, --repair, --reinstall, --wipe)"
    read -rp "$(echo -e "  ${BOLD}$(t menu_choice_prompt "${_cancel_opt}" "${_cancel_opt}") ${RESET}")" _det_choice <"$_NODYX_TTY"
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

# ── Mode imposé en ligne de commande (--upgrade, --repair, --reinstall, --wipe)
# Traité ICI, avant les conflits de ports et la détection d'IP : avant le
# 03/10/2026 il venait APRÈS le menu interactif (qui s'affichait donc quand
# même) et après le contrôle des ports, qui prenait Nodyx lui-même, en train
# de tourner sur 3000/4173, pour un conflit à tuer.
if [[ -n "$_FORCE_MODE" ]]; then
  INSTALL_MODE="$_FORCE_MODE"
  info "$(printf "$(t force_mode_cli)" "${BOLD}" "${INSTALL_MODE}" "${RESET}")"
  if [[ "$INSTALL_MODE" == "upgrade" || "$INSTALL_MODE" == "repair" ]]; then
    [[ -d "$_NODYX_CHECK_DIR" ]] || die "$(printf "$(t force_no_install)" "${_NODYX_CHECK_DIR}" "${INSTALL_MODE}")"
    _nodyx_upgrade "${_INSTALLED_VERSION:-?}" "$NODYX_VERSION" "$_NODYX_CHECK_DIR"
    _INSTALL_COMPLETE=true
    exit 0
  fi
  [[ "$INSTALL_MODE" == "wipe" ]]      && warn "$(t wipe_warning)"
  [[ "$INSTALL_MODE" == "reinstall" ]] && warn "$(t reinstall_notice)"
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
    _tty_needed "$(t port_choice_prompt)"
    read -rp "$(echo -e "  ${BOLD}$(t port_choice_prompt) ${RESET}")" _port_choice <"$_NODYX_TTY"
    # Défaut = annuler : Entrée ne doit JAMAIS arrêter et désactiver le serveur
    # web existant (avant le 03/10/2026, c'était le choix par défaut).
    _port_choice="${_port_choice:-3}"
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
    _tty_needed "$(t port_force_prompt)"
    read -rp "$(echo -e "  ${BOLD}$(t port_force_prompt) ${RESET}")" _port_force <"$_NODYX_TTY"
    # Accept y/Y/o/O regardless of UI language
    [[ ! "${_port_force,,}" =~ ^(y|o)$ ]] && die "$(t install_cancelled)"
    # fuser vient de psmisc, absent d'une Debian minimale : sans lui, « libérer
    # les ports » ne faisait RIEN, en silence, et l'installation continuait.
    command -v fuser >/dev/null || apt-get install -y -q psmisc >/dev/null 2>&1 \
      || die "$(t pkg_install_failed)"
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
# Seules les options préremplissent : une variable du même nom héritée de
# l'environnement (ADMIN_PASSWORD, DOMAIN…) ne doit jamais être prise en silence.
COMMUNITY_NAME="" COMMUNITY_SLUG="" COMMUNITY_LANG="" COMMUNITY_DESC="" COMMUNITY_COUNTRY=""
ADMIN_USERNAME="" ADMIN_EMAIL="" ADMIN_PASSWORD="" DOMAIN=""
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
# Avant le 04/10/2026, la question était posée même avec --domain, sans option
# pour y répondre : aucune installation silencieuse ne pouvait aboutir.
case "$_ARG_NETWORK" in
  direct) NET_MODE=1 ;;
  relay)  NET_MODE=2 ;;
  sslip)  NET_MODE=3 ;;
  "")
    if [[ -n "$_ARG_DOMAIN" ]]; then
      NET_MODE=1
    elif $_AUTO_YES; then
      NET_MODE=2; info "$(t prompt_default_auto "$(t net_mode_prompt)" "2")"
    else
      _tty_needed "$(t net_mode_prompt) (--network=direct|relay|sslip)"
      read -rp "$(echo -e "  ${CYAN}?${RESET} $(t net_mode_prompt) ")" NET_MODE <"$_NODYX_TTY"
    fi ;;
  *) die "$(t network_invalid "$_ARG_NETWORK")" ;;
esac
[[ "$_ARG_NETWORK" == direct || -z "$_ARG_NETWORK" ]] || [[ -z "$_ARG_DOMAIN" ]] \
  || die "$(t network_domain_conflict)"
NET_MODE="${NET_MODE:-2}"

RELAY_MODE=false
DOMAIN_IS_AUTO=false

# ── La sonde qui évite une installation « réussie » mais injoignable ──────────
#
# Le relais n'a besoin que d'UNE sortie TCP sur 7443. Les connexions grand public
# l'autorisent, les réseaux d'entreprise, d'université et d'institut souvent pas,
# et ils ne le disent jamais. Sans ce contrôle, l'installeur se terminait en
# annonçant un succès, puis l'instance restait muette sans le moindre indice.
# Cas réel : une inscription en août 2026, tombée exactement là-dessus.
#
# Un port filtré ne REFUSE pas, il ne répond rien : on borne donc l'essai.
RELAY_SERVER="relay.nodyx.org:7443"

_relay_joignable() {
  timeout 8 bash -c "exec 3<>/dev/tcp/$1/$2" 2>/dev/null
}

# La porte WebSocket, en HTTPS sur 443.
#
# On n'accepte PAS une simple ouverture du port 443 comme preuve : un proxy
# d'entreprise peut accepter la connexion, puis refuser la montée en WebSocket ou
# la casser en inspectant le trafic. Le seul verdict qui engage est le 101
# Switching Protocols, c'est-à-dire la poignée de main réellement aboutie.
_relais_ws_joignable() {
  local cle code
  cle=$(head -c16 /dev/urandom | base64 2>/dev/null) || return 1

  # Attention au code de SORTIE de curl : il ne dit rien de la réussite ici.
  # curl n'est pas un client WebSocket. Une fois le 101 reçu il attend des
  # données qui ne viendront pas, jusqu'à expiration du délai, et sort alors en
  # code 28. Tester ce code de sortie faisait rejeter une porte parfaitement
  # ouverte. Seul le code HTTP imprimé fait foi.
  #
  # Le délai est donc atteint à chaque essai RÉUSSI, et non l'inverse : il est
  # court parce qu'il borne le succès, pas l'échec.
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 5 --http1.1 \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
    -H 'Sec-WebSocket-Version: 13' -H "Sec-WebSocket-Key: $cle" \
    "https://$1/tunnel" 2>/dev/null)

  [ "$code" = "101" ]
}

verifier_sortie_relais() {
  info "$(t relay_probe)"

  if _relay_joignable relay.nodyx.org 7443; then
    ok "$(t relay_probe_ok)"
    return 0
  fi

  # IPv4 filtrée. Certains réseaux laissent passer l'IPv6, et un réseau IPv6 seul
  # ne pouvait pas se connecter du tout avant que ce nom existe.
  if _relay_joignable relay6.nodyx.org 7443; then
    RELAY_SERVER="relay6.nodyx.org:7443"
    ok "$(printf "$(t relay_probe_v6)" "relay6.nodyx.org")"
    return 0
  fi

  # 7443 est muré dans les deux familles. C'est le cas des réseaux d'entreprise,
  # d'université et d'institut, qui ne laissent sortir que 80 et 443. Ce dernier
  # essai est précisément ce pour quoi la porte WebSocket existe : un réseau qui
  # bloque tout sauf le web laisse passer un tunnel déguisé en trafic web.
  info "$(t relay_probe_wss_try)"
  if _relais_ws_joignable tunnel.nodyx.org; then
    RELAY_SERVER="wss://tunnel.nodyx.org/tunnel"
    ok "$(printf "$(t relay_probe_wss)" "$RELAY_SERVER")"
    return 0
  fi

  warn "$(t relay_probe_blocked)"
  info "$(t relay_probe_hint)"
  info "$(printf "$(t relay_probe_doc)" "https://nodyx.dev/relay#the-tunnel-never-connects-the-port-7443-wall")"

  local reponse=""
  $_AUTO_YES && die "$(t relay_probe_blocked)"
  _tty_needed "$(t relay_probe_continue)"
  read -r -p "  $(t relay_probe_continue) " reponse <"$_NODYX_TTY" || true
  case "${reponse,,}" in
    y|yes|o|oui) return 0 ;;
    *) die "$(t relay_probe_blocked)" ;;
  esac
}

case "$NET_MODE" in
  1)
    prompt DOMAIN "$(t prompt_domain)"
    ;;
  2)
    RELAY_MODE=true
    DOMAIN="${COMMUNITY_SLUG}.nodyx.org"
    ok "$(printf "$(t relay_mode_url)" "${BOLD}" "https://${DOMAIN}" "${RESET}")"
    info "$(t relay_mode_no_port)"
    verifier_sortie_relais
    ;;
  3|*)
    DOMAIN="${PUBLIC_IP//./-}.sslip.io"
    DOMAIN_IS_AUTO=true
    ok "$(printf "$(t auto_domain)" "${BOLD}" "${DOMAIN}" "${RESET}")"
    info "$(printf "$(t sslip_resolves)" "${PUBLIC_IP}")"
    ;;
esac

# ── Le nom <slug>.nodyx.org est-il libre ? Avant de modifier quoi que ce soit ──
# Obligatoire en relais (c'est l'adresse de l'instance) et en mode automatique
# (adresse publique de l'instance). Avant le 04/10/2026, un nom déjà pris
# n'était découvert qu'à l'inscription, l'instance déjà compilée pour lui.
# _nodyx_slug_check <slug> : available | taken | reserved | invalid | unknown
_nodyx_slug_check() {
  local r
  r="$(curl -s --max-time 8 "https://nodyx.org/api/directory/check/$1" 2>/dev/null || true)"
  case "$r" in
    *'"available":true'*)    echo available ;;
    *'"reason":"taken"'*)    echo taken ;;
    *'"reason":"reserved"'*) echo reserved ;;
    *'"reason":"invalid"'*)  echo invalid ;;
    *)                       echo unknown ;;
  esac
}
if $RELAY_MODE || $DOMAIN_IS_AUTO; then
  while true; do
    info "$(printf "$(t slug_checking)" "$COMMUNITY_SLUG")"
    _SLUG_STATE="$(_nodyx_slug_check "$COMMUNITY_SLUG")"
    case "$_SLUG_STATE" in
      available) ok "$(printf "$(t slug_available)" "$COMMUNITY_SLUG")"; break ;;
      unknown)   warn "$(t slug_check_unknown)"; break ;;
    esac
    $_AUTO_YES && die "$(printf "$(t slug_unavailable_yes)" "$COMMUNITY_SLUG" "$_SLUG_STATE")"
    warn "$(printf "$(t slug_unavailable)" "$COMMUNITY_SLUG" "$_SLUG_STATE")"
    COMMUNITY_SLUG=""
    prompt COMMUNITY_SLUG "$(t sub_new_slug_prompt)"
    COMMUNITY_SLUG="$(slugify "$COMMUNITY_SLUG")"
    $RELAY_MODE && DOMAIN="${COMMUNITY_SLUG}.nodyx.org"
  done
fi

conf_section "$(t conf_admin)"
prompt        ADMIN_USERNAME "$(t prompt_admin_user)"
prompt        ADMIN_EMAIL    "$(t prompt_admin_email)"
prompt_secret_confirm ADMIN_PASSWORD "$(t prompt_admin_pass)" 8

conf_section "$(t conf_smtp)"
echo -e "  $(t smtp_use)"
echo -e "  $(printf "$(t smtp_compat)" "${BOLD}" "${RESET}")"
echo ""
want_smtp=""
if ! $_AUTO_YES; then
  _tty_needed "$(t smtp_now)"
  read -rp "$(echo -e "  ${CYAN}?${RESET} $(t smtp_now) ")" want_smtp <"$_NODYX_TTY"
fi
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
  read -rp "$(echo -e "  ${CYAN}?${RESET} $(t smtp_force_tls) ")" _smtp_tls <"$_NODYX_TTY"
  [[ "${_smtp_tls,,}" =~ ^(o|y)$ ]] && SMTP_SECURE="true" && SMTP_PORT="465"
  prompt   SMTP_USER   "$(t prompt_smtp_user)"
  prompt_secret SMTP_PASS "$(t prompt_smtp_pass)" 1
  prompt   SMTP_FROM   "$(t prompt_smtp_from)"
  ok "$(printf "$(t smtp_configured)" "${SMTP_HOST}" "${SMTP_PORT}")"
else
  info "$(t smtp_skipped)"
fi

# ── DNS pre-check (Let's Encrypt will fail if DNS doesn't point here) ───────
# Family-aware : on compare A↔IPv4 et AAAA↔IPv6 séparément. Avant ce fix,
# `getent hosts` retournait du mixed-family (A ou AAAA selon nsswitch.conf),
# ce qui causait des faux mismatchs sur les machines dual-stack avec un
# domaine résolvant à la fois A et AAAA (cf. issue #29).
if ! $RELAY_MODE && ! $DOMAIN_IS_AUTO && [[ -n "${DOMAIN:-}" ]]; then
  info "$(printf "$(t dns_checking)" "${BOLD}" "${DOMAIN}" "${RESET}")"

  # Résoudre A et AAAA séparément. `ahostsv4` / `ahostsv6` sont fournis
  # par glibc (Debian/Ubuntu/Fedora) et par musl (Alpine récent).
  _dns_v4=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk '{print $1}' | sort -u || true)
  _dns_v6=$(getent ahostsv6 "$DOMAIN" 2>/dev/null | awk '{print $1}' | grep -v '^::1$' | sort -u || true)

  # Détecter optionnellement l'IPv6 publique du serveur. Si pas d'IPv6,
  # le curl -6 échoue silencieusement et _public_v6 reste vide.
  _public_v6=$(curl -s --max-time 5 -6 https://api64.ipify.org 2>/dev/null || true)

  # Match family-aware : OK si IPv4 publique ∈ A OU IPv6 publique ∈ AAAA.
  _match=false
  if [[ -n "$PUBLIC_IP"  && -n "$_dns_v4" ]] && grep -qFx "$PUBLIC_IP"  <<<"$_dns_v4"; then _match=true; fi
  if [[ -n "$_public_v6" && -n "$_dns_v6" ]] && grep -qFx "$_public_v6" <<<"$_dns_v6"; then _match=true; fi

  if [[ -z "$_dns_v4" && -z "$_dns_v6" ]]; then
    echo ""
    warn "$(printf "$(t dns_unresolved)" "${BOLD}" "${DOMAIN}" "${RESET}")"
    warn "$(t dns_le_will_fail)"
    echo -e "  ${CYAN}$(printf "$(t dns_set_a)" "${BOLD}" "${DOMAIN}" "${RESET}" "${CYAN}" "${PUBLIC_IP}" "${RESET}")"
    _confirm "$(t continue_q)" \
      || die "$(printf "$(t dns_fix_first)" "${DOMAIN}" "${PUBLIC_IP}")"
  elif ! $_match; then
    echo ""
    # Affichage : on remonte la première IP de la même famille que le
    # serveur si possible, sinon ce qu'on a trouvé.
    _shown_ip="${_dns_v4%%$'\n'*}"
    [[ -z "$_shown_ip" ]] && _shown_ip="${_dns_v6%%$'\n'*}"
    warn "$(printf "$(t dns_mismatch)" "${BOLD}" "${DOMAIN}" "${RESET}" "${RED}" "${_shown_ip}" "${RESET}" "${PUBLIC_IP}")"
    warn "$(t dns_le_mismatch_fail)"
    echo -e "  ${CYAN}$(t dns_update_a)${RESET}"
    _confirm "$(t continue_q)" \
      || die "$(printf "$(t dns_fix_correct)" "${DOMAIN}" "${PUBLIC_IP}")"
  else
    # On affiche l'IP qui a matché, en priorité IPv4 si elle correspond.
    _shown_ip="$PUBLIC_IP"
    if [[ -n "$_dns_v4" ]] && grep -qFx "$PUBLIC_IP" <<<"$_dns_v4"; then
      _shown_ip="$PUBLIC_IP"
    elif [[ -n "$_public_v6" ]] && grep -qFx "$_public_v6" <<<"$_dns_v6"; then
      _shown_ip="$_public_v6"
    fi
    ok "$(printf "$(t dns_ok)" "${DOMAIN}" "${_shown_ip}")"
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
# ── Valeurs libres : toutes doivent pouvoir s'écrire dans le .env ─────────────
for _v in COMMUNITY_NAME COMMUNITY_DESC COMMUNITY_LANG COMMUNITY_COUNTRY SMTP_HOST SMTP_USER SMTP_PASS SMTP_FROM; do
  _env_quote "${!_v:-}" >/dev/null || die "$(printf "$(t env_unquotable)" "$_v")"
done

# ── Un Caddyfile qui sert d'autres sites : décider AVANT de commencer ────────
# Lecture des sites identique à nodyx_caddy_sites (scripts/install/caddyfile.sh,
# vérifié par scripts/tests/install-prompts.test.sh) : la bibliothèque n'est
# chargée qu'après le clonage, trop tard pour cette décision.
_nodyx_caddy_other_sites() { # <fichier> <domaine>
  [[ -f "$1" ]] || return 0
  awk -v dom="$2" '
    { line=$0; sub(/#.*/, "", line) }
    depth==0 && line ~ /\{[[:space:]]*$/ {
      head=line; sub(/\{[[:space:]]*$/, "", head); gsub(/^[[:space:]]+|[[:space:]]+$/, "", head)
      if (head != "" && head !~ /^\(/) { n=split(head, a, /[ ,]+/); for (i=1;i<=n;i++) {
        h=a[i]; sub(/^https?:\/\//, "", h)
        if (a[i] != "" && h != ":80" && h != dom) printf "%s ", a[i] } }
    }
    { o=gsub(/\{/, "{", line); c=gsub(/\}/, "}", line); depth+=o-c }
  ' "$1"
}
_CADDY_OTHER_SITES="$(_nodyx_caddy_other_sites /etc/caddy/Caddyfile "$DOMAIN")"
if [[ -n "$_CADDY_OTHER_SITES" ]]; then
  warn "$(printf "$(t caddy_other_sites)" "${_CADDY_OTHER_SITES% }")"
  $_AUTO_YES && die "$(t caddy_other_sites_yes)"
  _confirm "$(t caddy_other_sites_q)" n || die "$(t caddy_other_sites_stop)"
fi

_confirm "$(t start_install)" || die "$(t install_cancelled)"

# ═══════════════════════════════════════════════════════════════════════════════
#  GENERATED SECRETS
# ═══════════════════════════════════════════════════════════════════════════════
DB_NAME="nodyx"
DB_USER="nodyx_user"
NODYX_DIR="/opt/nodyx"
REPO_URL="https://github.com/Pokled/nodyx.git"

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
apt-get install -y -q $_SYS_PKGS 2>/dev/null || die "$(t pkg_install_failed)"
ok "$(t deps_installed)"

# Secrets générés APRÈS les paquets (05/10/2026) : openssl n'est pas dans une
# Debian minimale et n'était installé qu'ici, alors que les secrets étaient
# générés avant (même famille que l'issue #784, sudo absent de Debian 13).
command -v openssl >/dev/null || die "$(t openssl_missing)"
DB_PASSWORD=$(gen_pass)
JWT_SECRET=$(gen_secret)
TURN_SECRET=$(gen_secret)
# Secret partagé frontend <-> core : le rendu serveur s'en sert pour transmettre
# l'IP du visiteur et être exempté de la limitation de débit (rateLimit.ts).
INTERNAL_API_SECRET=$(gen_secret)

# Node.js 22 LTS — mediasoup-client/awaitqueue (voice) require >=22 (#642)
_NODE_MAJOR=$(node --version 2>/dev/null | sed 's/v//;s/\..*//' || echo 0)
if ! command -v node &>/dev/null || [[ "$_NODE_MAJOR" -lt 22 ]]; then
  info "$(t node_installing)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null 2>&1
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

# Rotation des logs PM2 — APRÈS la création de l'utilisateur nodyx (ce bloc était
# exécuté avant, donc sur une install neuve il tournait sans utilisateur cible :
# toutes les commandes échouaient en silence et l'installeur affichait "configuré").
if _setup_pm2_logrotate; then
  ok "$(t pm2_logrotate_set)"
else
  warn "$(t pm2_logrotate_fail)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  POSTGRESQL
# ═══════════════════════════════════════════════════════════════════════════════
#
# Why PostgreSQL 16 and not the latest (17 or 18) ?
#   On Ubuntu 24.04 LTS, `apt install postgresql` installs PG 16 by default
#   from the official Ubuntu repos. We DELIBERATELY stick to the distro default
#   instead of pinning a newer version via the apt.postgresql.org PPA :
#     - Less moving parts at install time = fewer surprises on real VPSes
#     - PG 16 is supported by upstream until November 2028 (5-year window)
#     - Nodyx uses zero features specific to PG 17/18 ; our migrations only
#       rely on standard SQL + JSONB, UUID, tsvector, partial indexes,
#       CREATE INDEX CONCURRENTLY — all stable since PG 12+
#     - The perf gains in PG 17/18 (streaming I/O, JSON path vectorization)
#       target multi-TB workloads, not a per-instance community platform
#   The plan is to skip PG 17 and adopt PG 18 once Ubuntu 26.04 LTS ships it
#   as the default. Details in docs/en/ARCHITECTURE.md § 3.
#
# Detect installed PostgreSQL version below — we accept whatever the distro
# offers, including newer if the admin installed a PPA on their own.
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_pg)"

# _pg_datadir <version> : le dossier de données CONFIGURÉ du cluster « main »
# (celui que pg_dropcluster supprimerait), à défaut l'emplacement standard.
_pg_datadir() {
  local d
  d="$(pg_conftool -s "$1" main show data_directory 2>/dev/null || true)"
  printf '%s' "${d:-/var/lib/postgresql/$1/main}"
}

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
  runuser -u postgres -- pg_isready -q 2>/dev/null && { _PG_READY=true; break; }
  sleep 2
done

if ! $_PG_READY; then
  info "$(t pg_init)"

  # Ensure server binaries (initdb) are present — some ARM packages omit them
  if ! command -v "/usr/lib/postgresql/${_PG_VER}/bin/initdb" &>/dev/null; then
    info "$(printf "$(t pg_install_pkg)" "${_PG_VER}")"
    apt-get install -y -q "postgresql-${_PG_VER}" >/dev/null 2>&1 || true
  fi

  # Recréer le cluster SEULEMENT si son dossier de données (celui qui est
  # CONFIGURÉ, pas seulement l'emplacement par défaut) est absent ou vide.
  # pg_dropcluster supprime ce dossier : avant le 03/10/2026, un PostgreSQL
  # existant mais arrêté, aux données rangées ailleurs, était effacé ici.
  _PG_DATADIR="$(_pg_datadir "${_PG_VER}")"
  if [[ -d "$_PG_DATADIR" && -n "$(ls -A "$_PG_DATADIR" 2>/dev/null)" ]]; then
    info "$(printf "$(t pg_datadir_kept)" "$_PG_DATADIR")"
  else
    info "$(t pg_recreate_cluster)"
    pg_dropcluster   "${_PG_VER}" main 2>/dev/null || true
    pg_createcluster "${_PG_VER}" main 2>/dev/null || true
  fi

  # Start the cluster (pg_ctlcluster bypasses systemd, works even without a unit)
  pg_ctlcluster "${_PG_VER}" main start 2>/dev/null || true
  systemctl restart "postgresql@${_PG_VER}-main" 2>/dev/null || true

  for _pg_i in {1..15}; do
    runuser -u postgres -- pg_isready -q 2>/dev/null && { _PG_READY=true; break; }
    sleep 2
  done
fi

$_PG_READY || die "$(printf "$(t pg_did_not_start)" "${_PG_VER}")"
ok "$(printf "$(t pg_ready)" "${_PG_VER}")"

# Create role + database (idempotent)
runuser -u postgres -- psql -c "
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
  # Jamais d'effacement sans sauvegarde relue (avant le 03/10/2026, un échec de
  # sauvegarde affichait un avertissement puis la base était supprimée quand même).
  if [[ "${_DB_EXISTS:-false}" == "true" && "${_AUTO_BACKUP_OK:-false}" != "true" ]]; then
    die "$(t wipe_backup_failed)"
  fi
  info "$(t pg_wipe_dropping)"
  runuser -u postgres -- psql -c \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='${DB_NAME}' AND pid <> pg_backend_pid();" \
    >/dev/null 2>/dev/null || true
  runuser -u postgres -- psql -c "DROP DATABASE IF EXISTS ${DB_NAME};" >/dev/null
  ok "$(printf "$(t pg_db_dropped)" "${DB_NAME}")"
fi

runuser -u postgres -- psql -tc "SELECT 1 FROM pg_database WHERE datname = '${DB_NAME}'" \
  | grep -q 1 \
  || runuser -u postgres -- psql -c "CREATE DATABASE ${DB_NAME} OWNER ${DB_USER};" >/dev/null

runuser -u postgres -- psql -d "$DB_NAME" -c "GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};" >/dev/null
# PG15+ revokes CREATE on public schema by default — grant it explicitly for migrations
runuser -u postgres -- psql -d "$DB_NAME" -c "GRANT CREATE ON SCHEMA public TO ${DB_USER};" >/dev/null
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
  _TURN_URL="https://github.com/Pokled/nodyx/releases/download/${_TURN_VERSION}/nexus-turn-linux-${_TURN_ARCH}"
  info "$(printf "$(t turn_downloading)" "${_TURN_VERSION}" "${_TURN_ARCH}")"
  _nodyx_fetch_bin "$_TURN_VERSION" "nexus-turn-linux-${_TURN_ARCH}" /usr/local/bin/nodyx-turn && _rc=0 || _rc=$?
  case $_rc in
    0) ;;
    1) die "$(printf "$(t turn_dl_fail)" "${_TURN_URL}" "${_TURN_VERSION}")" ;;
    *) die "$(t bin_checksum_bad "nodyx-turn")" ;;
  esac

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
  _nodyx_write_turn_unit

  systemctl daemon-reload
  systemctl enable nodyx-turn --quiet
  systemctl restart nodyx-turn
  ok "$(printf "$(t turn_started)" "${PUBLIC_IP}")"
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-SFUD (SFU mediasoup) — vocal et partage d'écran scalables
# ═══════════════════════════════════════════════════════════════════════════════
#
#  Sans lui : le vocal fonctionne en MESH. Chacun envoie son flux à chacun, donc le
#  partage d'écran plafonne vers 4 personnes (le partageur uploade UNE COPIE PAR
#  SPECTATEUR) et se fait sans son.
#  Avec lui : le partageur envoie UNE SEULE FOIS, le serveur recopie. Plus de mur,
#  et le partage emporte son son.
#
#  ⚠ MODE RELAY : le SFU a besoin de ports média joignables depuis l'extérieur, ce
#  qu'un tunnel ne fournit pas. On ne l'installe donc pas, et on ne demandera JAMAIS
#  à l'utilisateur d'ouvrir un port sur sa box : c'est un engagement du projet. La
#  levée passera par une pile ICE complète (perçage de NAT), pas par sa box.
#
#  Le SFU est un SUPPLÉMENT : s'il échoue, on AVERTIT et on continue. Le vocal marche
#  sans lui. Faire échouer toute l'installation pour un bonus serait absurde.
# ═══════════════════════════════════════════════════════════════════════════════
_sfu_skip() { warn "$(printf "$(t sfu_skipped)" "$1")"; }

if $RELAY_MODE; then
  warn "$(t sfu_relay_skipped)"
elif ! $SKIP_SFU; then
  step "$(t step_sfu)"

  _SFU_ARCH=""
  case "$(uname -m)" in
    x86_64)  _SFU_ARCH="amd64" ;;
    aarch64) _SFU_ARCH="arm64" ;;
  esac

  if [[ -z "$_SFU_ARCH" ]]; then
    _sfu_skip "$(printf "$(t sfu_reason_arch)" "$(uname -m)")"
  else
    _SFU_VERSION="sfu-v0.1.0"
    _SFU_URL="https://github.com/Pokled/nodyx/releases/download/${_SFU_VERSION}/nodyx-sfud-linux-${_SFU_ARCH}"
    info "$(printf "$(t sfu_downloading)" "${_SFU_VERSION}" "${_SFU_ARCH}")"
    _nodyx_fetch_bin "$_SFU_VERSION" "nodyx-sfud-linux-${_SFU_ARCH}" /usr/local/bin/nodyx-sfud && _rc=0 || _rc=$?
    if [[ $_rc -eq 1 ]]; then
      _sfu_skip "$(printf "$(t sfu_reason_dl)" "${_SFU_URL}")"
    elif [[ $_rc -ne 0 ]]; then
      _sfu_skip "$(t sfu_reason_notbin)"
    else

      SFU_TOKEN="$(openssl rand -hex 32)"

      # Le média écoute sur toutes les interfaces et ANNONCE l'IP publique : certains
      # hébergeurs (AWS, GCP…) ne montrent jamais l'IP publique à la machine, un bind
      # direct dessus échouerait.
      cat > /etc/nodyx-sfud.env <<SFUENV
# Généré par install.sh — le secret est partagé avec nodyx-core (VOICE_SFU_TOKEN)
SFU_TOKEN=${SFU_TOKEN}

# API interne : JAMAIS exposée, seul nodyx-core la contacte, en local.
SFU_HTTP_ADDR=127.0.0.1:3901

# Média : on écoute partout, on annonce l'IP publique aux navigateurs.
SFU_LISTEN_IP=0.0.0.0
SFU_ANNOUNCED_IP=${PUBLIC_IP}

# Plage de ports média (ouverte dans le pare-feu, en UDP ET en TCP : le TCP est le
# repli des réseaux qui bloquent l'UDP — entreprises, hôtels, certains opérateurs).
SFU_RTC_MIN_PORT=40000
SFU_RTC_MAX_PORT=40999

# Le nombre de workers s'adapte tout seul à la machine (cœurs - réservés). Un cœur
# reste hors de portée du média pour le reste des services.
SFU_RESERVED_CORES=1

# 0 = toute session passe par le SFU dès que nodyx-core le décide. C'est nodyx-core
# qui arbitre mesh/SFU (VOICE_SFU_MESH_THRESHOLD), pas le daemon.
SFU_MESH_THRESHOLD=0
SFUENV
      chown root:nodyx /etc/nodyx-sfud.env
      chmod 640 /etc/nodyx-sfud.env

      cat > /etc/systemd/system/nodyx-sfud.service <<SFUSVC
[Unit]
Description=Nodyx SFU daemon (mediasoup) — scalable voice & screen sharing
After=network.target

[Service]
EnvironmentFile=/etc/nodyx-sfud.env
ExecStart=/usr/local/bin/nodyx-sfud
Restart=on-failure
RestartSec=5s
User=nodyx
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SFUSVC

      systemctl daemon-reload
      systemctl enable nodyx-sfud --quiet
      systemctl restart nodyx-sfud
      sleep 2

      if systemctl is-active --quiet nodyx-sfud; then
        _SFU_INSTALLED=true
        ok "$(printf "$(t sfu_started)" "40000-40999" "${PUBLIC_IP}")"
      else
        _sfu_skip "$(t sfu_reason_start)"
      fi
    fi
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  FIREWALL (UFW)
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_firewall)"

# ── Ports SSH réels ──────────────────────────────────────────────────────────
# Les ports TCP par lesquels on peut VRAIMENT se connecter en SSH :
#   - sshd en écoute, quel que soit son port ;
#   - ssh.socket actif (systemd écoute à la place de sshd : Ubuntu 24.04+) ;
#   - la configuration de sshd (sshd -T) ;
#   - la connexion SSH en cours, celle qui lance peut-être cet installeur.
# Avant le 03/10/2026, seul le port 22 était ouvert : un serveur dont SSH écoute
# ailleurs se retrouvait fermé à son propre administrateur.
# Copie IDENTIQUE dans install.sh et install_tunnel.sh (vérifié par
# scripts/tests/firewall-ssh.test.sh) : les deux règlent le pare-feu avant
# d'avoir cloné le dépôt, ils ne peuvent pas partager une bibliothèque.
# Ne fait jamais échouer l'appelant : aucun port trouvé = sortie vide.
_nodyx_ssh_ports() {
  {
    ss -Htlnp 2>/dev/null | awk '/"sshd"/ { n = split($4, a, ":"); print a[n] }'
    if systemctl is-active --quiet ssh.socket 2>/dev/null; then
      systemctl show ssh.socket -p Listen 2>/dev/null | sed -nE 's/^Listen=.*:([0-9]+) \(Stream\)$/\1/p'
    fi
    sshd -T 2>/dev/null | awk '$1 == "port" { print $2 }'
    ss -Htnp state established 2>/dev/null | awk '/"sshd"/ { n = split($3, a, ":"); print a[n] }'
    if [[ -n "${SSH_CONNECTION:-}" ]]; then awk '{ print $4 }' <<<"$SSH_CONNECTION"; fi
    true
  } | { grep -E '^[0-9]{1,5}$' || true; } | sort -un
}

# _nodyx_firewall <relais:true|false> <sans-turn:true|false> <sfu:true|false>
# - ne réinitialise JAMAIS les règles existantes (avant : `ufw --force reset`
#   effaçait silencieusement les règles de l'administrateur) ;
# - ouvre les VRAIS ports SSH, puis vérifie que chacun figure dans les règles
#   AVANT d'activer le pare-feu ;
# - ne touche à rien si aucun port SSH n'est trouvé.
# Code 0 : pare-feu actif avec SSH autorisé. Code 1 : pare-feu non activé
# (l'installation continue, l'administrateur est prévenu).
_nodyx_firewall() {
  local relay="$1" skip_turn="$2" sfu="$3" ports p bak active=false
  ports="$(_nodyx_ssh_ports)"
  if [[ -z "$ports" ]]; then
    warn "$(t ufw_no_ssh_port)"
    return 1
  fi
  if ufw status 2>/dev/null | grep -q 'Status: active'; then active=true; fi
  if $active; then
    bak="/root/ufw-backup-$(date +%Y%m%d-%H%M%S).rules"
    ufw status verbose > "$bak" 2>/dev/null || true
    info "$(printf "$(t ufw_kept_rules)" "$bak")"
  else
    ufw default deny incoming  >/dev/null 2>&1 || true
    ufw default allow outgoing >/dev/null 2>&1 || true
  fi
  for p in $ports; do ufw allow "${p}/tcp" comment 'SSH' >/dev/null 2>&1 || true; done
  if ! $relay; then
    ufw allow 80/tcp  comment 'Nodyx web' >/dev/null 2>&1 || true
    ufw allow 443/tcp comment 'Nodyx web' >/dev/null 2>&1 || true
    if ! $skip_turn; then
      for p in 3478/tcp 3478/udp 5349/tcp 5349/udp 49152:65535/udp; do
        ufw allow "$p" comment 'Nodyx TURN' >/dev/null 2>&1 || true
      done
    fi
    # Ports média du SFU. Le TCP n'est PAS un luxe : c'est le repli des réseaux qui
    # bloquent l'UDP (entreprises, hôtels, certains opérateurs). Sans lui, ces
    # utilisateurs ne se connectent PAS DU TOUT au vocal — pas « moins bien » : rien,
    # avec un écran noir et aucun message.
    if $sfu; then
      ufw allow 40000:40999/udp comment 'Nodyx SFU' >/dev/null 2>&1 || true
      ufw allow 40000:40999/tcp comment 'Nodyx SFU' >/dev/null 2>&1 || true
    fi
  fi
  # Chaque port SSH doit figurer dans les règles AVANT toute activation.
  for p in $ports; do
    if ! ufw show added 2>/dev/null | grep -qE "^ufw allow ${p}/tcp( |$)"; then
      warn "$(printf "$(t ufw_ssh_rule_missing)" "$p")"
      return 1
    fi
  done
  $active || ufw --force enable >/dev/null 2>&1 || true
  if ufw status 2>/dev/null | grep -q 'Status: active'; then
    ok "$(printf "$(t ufw_configured_ssh)" "$(echo $ports)")"
    return 0
  fi
  warn "$(t ufw_not_active)"
  return 1
}

_rollback_register "$(t ufw_rollback_msg)"
_nodyx_firewall "$RELAY_MODE" "$SKIP_TURN" "$_SFU_INSTALLED" || true

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

  _RELAY_VERSION="${NODYX_RELAY_VERSION}"
  _RELAY_URL="https://github.com/Pokled/nodyx/releases/download/${_RELAY_VERSION}/nodyx-relay-linux-${_RELAY_ARCH}"

  info "$(printf "$(t relay_downloading)" "${_RELAY_VERSION}" "${_RELAY_ARCH}")"
  _nodyx_fetch_bin "$_RELAY_VERSION" "nodyx-relay-linux-${_RELAY_ARCH}" /usr/local/bin/nodyx-relay && _rc=0 || _rc=$?
  case $_rc in
    0) ;;
    1) die "$(printf "$(t relay_dl_fail)" "${_RELAY_URL}" "${_RELAY_VERSION}")" ;;
    *) die "$(t bin_checksum_bad "nodyx-relay")" ;;
  esac
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

# Bibliothèque de l'installeur, livrée avec le code : génération du Caddyfile
# (testée par scripts/tests/caddyfile.test.sh avec un vrai Caddy).
_INSTALL_LIB="${NODYX_DIR}/scripts/install/caddyfile.sh"
[[ -f "$_INSTALL_LIB" ]] || die "$(printf "$(t install_lib_missing)" "$_INSTALL_LIB")"
# shellcheck source=scripts/install/caddyfile.sh
. "$_INSTALL_LIB"

# Réconciliation : si le repo cloné contient un fichier VERSION, on s'y aligne
# (priorité absolue car c'est ce que le code Nodyx lira au boot). Sinon on
# garde la valeur résolue avant clone (via _resolve_version).
if [[ -f "${NODYX_DIR}/VERSION" ]]; then
  _REPO_VER="$(tr -d '[:space:]' < "${NODYX_DIR}/VERSION" 2>/dev/null || true)"
  if [[ -n "$_REPO_VER" && "$_REPO_VER" != "$NODYX_VERSION" ]]; then
    NODYX_VERSION="$_REPO_VER"
    info "$(printf "$(t ver_from_repo)" "${NODYX_VERSION}")"
  fi
fi

# ═══════════════════════════════════════════════════════════════════════════════
#  NODYX-CORE — .env + build
# ═══════════════════════════════════════════════════════════════════════════════
step "$(t step_backend)"

cat > "${NODYX_DIR}/nodyx-core/.env" <<COREENV
# Généré par install.sh — ne pas modifier manuellement

# Identité de la communauté
NODYX_COMMUNITY_NAME=$(_env_quote "${COMMUNITY_NAME}")
NODYX_COMMUNITY_SLUG=${COMMUNITY_SLUG}
NODYX_COMMUNITY_DESCRIPTION=$(_env_quote "${COMMUNITY_DESC}")
NODYX_COMMUNITY_LANGUAGE=$(_env_quote "${COMMUNITY_LANG}")
NODYX_COMMUNITY_COUNTRY=$(_env_quote "${COMMUNITY_COUNTRY}")
# Note: NODYX_VERSION ci-dessous est purement informationnel depuis v2.5.0.
# La version réelle est lue par nodyx-core depuis le fichier VERSION à la
# racine du repo (cf src/utils/version.ts). Cette ligne reste pour les
# outils externes (monitoring, scripts) qui parseraient le .env.
NODYX_VERSION=${NODYX_VERSION}

# Serveur
PORT=3000
# Loopback, volontairement. Caddy tourne sur la même machine et mandate vers
# localhost:3000 : écouter sur toutes les interfaces publierait l'API sur
# Internet, et il ne resterait qu'une règle de pare-feu entre elle et le monde.
# Une ligne de défense n'en fait pas deux.
#
# À changer seulement si votre mandataire vit sur une AUTRE machine.
HOST=127.0.0.1
NODE_ENV=production

# JWT
JWT_SECRET=${JWT_SECRET}

# Secret partagé avec le frontend (appels internes du rendu serveur)
INTERNAL_API_SECRET=${INTERNAL_API_SECRET}

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
SMTP_HOST=$(_env_quote "${SMTP_HOST}")
SMTP_PORT=${SMTP_PORT}
SMTP_SECURE=${SMTP_SECURE}
SMTP_USER=$(_env_quote "${SMTP_USER}")
SMTP_PASS=$(_env_quote "${SMTP_PASS}")
SMTP_FROM=$(_env_quote "${SMTP_FROM:-noreply@${DOMAIN}}")
COREENV
# En mode Relay, ajouter des STUN publics en fallback (pas de nodyx-turn)
if $RELAY_MODE; then
  printf "\n# Fallback STUN (relay mode — nodyx-turn non installé)\nSTUN_FALLBACK_URLS=stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302\n" \
    >> "${NODYX_DIR}/nodyx-core/.env"
fi

# Brancher nodyx-core sur le SFU. Sans ces variables, le daemon tournerait pour rien :
# le core ne lui parlerait jamais et tout le vocal resterait en mesh.
if $_SFU_INSTALLED; then
  cat >> "${NODYX_DIR}/nodyx-core/.env" <<SFUCORE

# ── SFU (nodyx-sfud) : vocal et partage d'écran scalables ──────────────────────
# Le secret est le même que dans /etc/nodyx-sfud.env.
VOICE_SFU_URL=http://127.0.0.1:3901
VOICE_SFU_TOKEN=${SFU_TOKEN}

# Bascule automatique mesh → SFU.
VOICE_SFU_AUTO=true

# Vide = TOUS les canaux vocaux. (Renseigner des UUID pour limiter à certains.)
VOICE_SFU_AUTO_CHANNELS=

# À partir de combien de personnes un canal bascule tout seul. En dessous, le mesh
# suffit et évite un aller-retour par le serveur.
# ⚠ Un PARTAGE D'ÉCRAN bascule TOUJOURS, quel que soit ce seuil : c'est précisément
# le moment où le mesh s'écroule (une copie envoyée PAR SPECTATEUR).
VOICE_SFU_MESH_THRESHOLD=6
SFUCORE
fi

cd "${NODYX_DIR}/nodyx-core"
run_bg "$(t backend_npm_install_label)" npm ci --no-fund --no-audit \
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
run_bg "$(t front_npm_install_label)" npm ci --no-fund --no-audit \
  || die "$(t front_npm_install_fail2)"

# On ARM64: ensure native Rollup binary is present
# (avoids "traceVariable / tick from svelte" error with the JS fallback)
if [[ "$(uname -m)" == "aarch64" ]]; then
  if [[ ! -f "node_modules/@rollup/rollup-linux-arm64-gnu/rollup.linux-arm64-gnu.node" ]]; then
    info "$(t rollup_arm64_force)"
    npm install @rollup/rollup-linux-arm64-gnu --no-save --no-fund --no-audit 2>/dev/null || true
  fi
fi

# Node heap cap adapté à la RAM totale. SvelteKit 5 + Vite (4500+ modules)
# dépasse facilement 1 Go de heap : il faut au moins 1.5 Go pour finir le
# build sans OOM. On scale linéairement selon ce que la machine a.
#  < 1.5 GB  → 768 MB  (RPi 1 GB, build lent mais possible avec swap)
#  1.5–3 GB  → 1536 MB (RPi 4 2-4 GB / micro-VPS)
#  3–8 GB    → 2048 MB (VPS standard 4 GB)
#  ≥ 8 GB    → 4096 MB (machines modernes, build rapide sans contention)
if [[ "$_RAM_TOTAL_MB" -lt 1500 ]]; then
  export NODE_OPTIONS="--max-old-space-size=768"
  info "$(printf "$(t front_low_ram_node_cap)" "${_RAM_TOTAL_MB}")"
  _RPI_LABEL="$(t front_build_label_rpi)"
elif [[ "$_RAM_TOTAL_MB" -lt 3000 ]]; then
  export NODE_OPTIONS="--max-old-space-size=1536"
  _RPI_LABEL=""
elif [[ "$_RAM_TOTAL_MB" -lt 8000 ]]; then
  export NODE_OPTIONS="--max-old-space-size=2048"
  _RPI_LABEL=""
else
  export NODE_OPTIONS="--max-old-space-size=4096"
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

# Deux formes, générées par scripts/install/caddyfile.sh :
#   relais          → :80 (HTTP en boucle locale, le TLS est fait en amont)
#   domaine direct  → ${DOMAIN} (Caddy obtient lui-même le certificat)
# Dans les deux cas, Caddy calcule l'IP du visiteur et l'impose au core :
# aucun en-tête écrit par le visiteur ne peut s'y substituer.
_CADDY_MODE=direct
$RELAY_MODE && _CADDY_MODE=relay
_NEW_CADDYFILE="$(mktemp /etc/caddy/.Caddyfile.nodyx.XXXXXX)"
nodyx_caddyfile "$_CADDY_MODE" "$DOMAIN" > "$_NEW_CADDYFILE"
if ! caddy validate --config "$_NEW_CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  rm -f "$_NEW_CADDYFILE"
  die "$(t caddy_invalid)"
fi
if [[ -s /etc/caddy/Caddyfile ]]; then
  _CADDY_BAK="/etc/caddy/Caddyfile.avant-nodyx-$(date +%Y%m%d-%H%M%S)"
  cp -p /etc/caddy/Caddyfile "$_CADDY_BAK"
  info "$(printf "$(t caddy_backup)" "$_CADDY_BAK")"
fi
install -m 644 "$_NEW_CADDYFILE" /etc/caddy/Caddyfile
rm -f "$_NEW_CADDYFILE"

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
      env: { NODE_ENV: 'production', PORT: '4173', HOST: '127.0.0.1', ORIGIN: 'https://${DOMAIN}', PRIVATE_API_SSR_URL: 'http://127.0.0.1:3000/api/v1', INTERNAL_API_SECRET: '${INTERNAL_API_SECRET}', ADDRESS_HEADER: 'x-forwarded-for', XFF_DEPTH: '1' },
    },
  ],
}
PM2

# Donner la propriété du répertoire à l'utilisateur nodyx
chown -R nodyx:nodyx "${NODYX_DIR}"
# Les fichiers de secrets (JWT, base, SMTP, secret interne) ne sont lisibles
# que par nodyx : avant le 03/10/2026, le .env du core était en 644.
chmod 600 "${NODYX_DIR}/ecosystem.config.js" "${NODYX_DIR}/nodyx-core/.env" "${NODYX_DIR}/nodyx-frontend/.env"

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
_REG_OUT="$(mktemp)"
for _reg_try in 1 2 3; do
  # Le mot de passe ne passe JAMAIS en argument d'une commande (visible de tous
  # via `ps`) : Node le lit dans son environnement, curl le lit sur son entrée.
  HTTP_CODE=$(NX_U="$ADMIN_USERNAME" NX_E="$ADMIN_EMAIL" NX_P="$ADMIN_PASSWORD" \
    node -e 'process.stdout.write(JSON.stringify({username: process.env.NX_U, email: process.env.NX_E, password: process.env.NX_P}))' \
    | curl -s -o "$_REG_OUT" -w "%{http_code}" \
        -X POST http://localhost:3000/api/v1/auth/register \
        -H "Content-Type: application/json" \
        --data-binary @- 2>/dev/null || echo "000")
  if [[ "$HTTP_CODE" == "201" || "$HTTP_CODE" == "200" ]]; then
    ok "$(printf "$(t admin_created)" "${ADMIN_USERNAME}")"
    _REGISTER_OK=true; break
  elif [[ "$HTTP_CODE" == "409" ]]; then
    ok "$(printf "$(t admin_exists)" "${ADMIN_USERNAME}")"
    _REGISTER_OK=true; break
  else
    warn "$(printf "$(t admin_try_n)" "${_reg_try}" "${HTTP_CODE}" "$(head -c 200 "$_REG_OUT" 2>/dev/null)")"
    [[ $_reg_try -lt 3 ]] && { info "$(t admin_retry_in)"; sleep 8; }
  fi
done

rm -f "$_REG_OUT"
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

USER_ID=$(runuser -u postgres -- psql -d "$DB_NAME" -tc \
  "SELECT id FROM users WHERE lower(email)=lower('${ADMIN_EMAIL_SQL}');" 2>/dev/null | tr -d ' \n')

if [[ -n "$USER_ID" ]]; then
  runuser -u postgres -- psql -d "$DB_NAME" <<SQL >/dev/null
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

# _nodyx_directory_json <url> : le corps JSON de l'inscription à l'annuaire,
# construit par Node (un « " » dans le nom de la communauté cassait l'ancien
# JSON concaténé à la main).
_nodyx_directory_json() {
  NX_NAME="$COMMUNITY_NAME" NX_SLUG="$COMMUNITY_SLUG" NX_URL="$1" NX_LANG="$COMMUNITY_LANG" NX_VER="$NODYX_VERSION" \
    node -e 'const e = process.env; process.stdout.write(JSON.stringify({name: e.NX_NAME, slug: e.NX_SLUG, url: e.NX_URL, language: e.NX_LANG, version: e.NX_VER}))'
}
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
  # _confirm : avant le 04/10/2026, toute réponse autre que « n » valait oui,
  # « non » compris, et inscrivait l'instance dans l'annuaire public.
  want_subdomain="n"
  _confirm "$(t sub_enable_q "${COMMUNITY_SLUG}.nodyx.org")" y && want_subdomain="o"
fi

if [[ "${want_subdomain,,}" != "n" ]]; then
  info "$(t sub_registering)"

  REGISTER_HTTP_CODE=""
  REGISTER_RESPONSE=$(_nodyx_directory_json "https://${DOMAIN}" \
    | curl -s -w '\n__HTTP_CODE__:%{http_code}' -X POST "${NODYX_DIRECTORY_URL}/register" \
        -H "Content-Type: application/json" --data-binary @- 2>/dev/null || true)
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
        # Le nom a été pris PENDANT l'installation (il était libre à la
        # vérification du début). On n'essaie plus de changer de nom après coup :
        # le frontend est compilé pour celui-ci (PUBLIC_API_URL), il appellerait
        # le domaine d'une AUTRE communauté. Arrêt propre, rien n'a été envoyé.
        die "$(printf "$(t slug_taken_late)" "${COMMUNITY_SLUG}")"
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

  _nodyx_write_relay_unit "${RELAY_SERVER:-relay.nodyx.org:7443}" "$COMMUNITY_SLUG" "$NODYX_DIRECTORY_TOKEN"

  systemctl daemon-reload
  systemctl enable nodyx-relay-client --quiet
  systemctl restart nodyx-relay-client
  ok "$(printf "$(t relay_client_started)" "${RELAY_SERVER:-relay.nodyx.org:7443}")"
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
Admin password   : (non conservé : celui choisi à l'installation. Perdu ? sudo nodyx-recover --reset ${ADMIN_USERNAME})

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
_nodyx_write_update_script "$UPDATE_SCRIPT" "$NODYX_DIR"
_nodyx_write_recover_script /usr/local/bin/nodyx-recover "$NODYX_DIR"

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
if runuser -u postgres -- pg_isready -q 2>/dev/null; then
  _tables=$(runuser -u postgres -- psql -d "$DB_NAME" -tc \
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'" \
    2>/dev/null | tr -d ' \n' || echo "?")
  _dbsz=$(runuser -u postgres -- psql -d "$DB_NAME" -tc \
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
_smtp=$(grep '^SMTP_HOST=' "${NODYX_DIR}/nodyx-core/.env" 2>/dev/null | cut -d= -f2- | tr -d "'\`" || echo "")
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
# Le vocal : contrôlé dès qu'il a été installé (avant le 04/10/2026, jamais).
if $_SFU_INSTALLED; then _HC_SVCS="$_HC_SVCS nodyx-sfud"; fi
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

  # (Avant le 04/10/2026 : /instances/<slug>, une route qui n'existe pas.
  # Ce contrôle ne pouvait jamais réussir.)
  _dir_state="$(_nodyx_slug_check "$COMMUNITY_SLUG")"
  if [[ "$_dir_state" == "taken" ]]; then
    _hc_pass "$(printf "$(t hc_dir_registered)" "${NODYX_SUBDOMAIN}")"
  elif [[ "$_dir_state" == "unknown" ]]; then
    _hc_warn "$(printf "$(t hc_dir_unreachable)" "${YELLOW}" "${RESET}")"
  else
    _hc_warn "$(printf "$(t hc_dir_status)" "${_dir_state}")"
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
# Le verdict du bilan décide de la bannière ET du code de sortie (04/10/2026) :
# avant, « INSTANCE ONLINE » en vert et code 0 s'affichaient même avec des
# erreurs, et une automatisation (Ansible, CI) croyait à un succès.
_BANNER="$GREEN"; _BANNER_TXT="$(t banner_online)"
if [[ $HC_FAIL -gt 0 ]]; then _BANNER="$RED"; _BANNER_TXT="$(t banner_errors)"; fi
echo -e "${_BANNER}${BOLD}"
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "  ║                                                              ║"
echo "  ${_BANNER_TXT}"
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
  echo -e "     ${BOLD}$(t summ_relay)   ${RESET}tunnel → ${RELAY_SERVER:-relay.nodyx.org:7443}"
fi
echo -e "     ${BOLD}$(t summ_version)   ${RESET}${NODYX_VERSION}"
echo -e "     ${BOLD}$(t summ_dir)   ${RESET}${NODYX_DIR}"
echo ""
echo -e "${_BANNER}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${RESET}"
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
echo -e "       runuser -u postgres -- psql ${DB_NAME}"
echo -e "       runuser -u postgres -- pg_dump ${DB_NAME} > backup_\$(date +%F).sql"
echo ""
echo -e "     ${BOLD}${CYAN}$(t summ_diag)${RESET}"
echo -e "       sudo nodyx-doctor               $(t summ_diag_hint)"
echo -e "       sudo nodyx-recover --list       $(t summ_recover_hint)"
echo -e "       systemctl status caddy"
echo -e "       curl -s http://localhost:3000/api/v1/instance/info | python3 -m json.tool"
if $RELAY_MODE; then
  echo ""
  echo -e "     ${BOLD}${CYAN}$(t summ_relay_tunnel)${RESET}"
  echo -e "       systemctl status nodyx-relay-client"
  echo -e "       journalctl -u nodyx-relay-client -f"
fi
echo ""
echo -e "${_BANNER}${BOLD}  ╠══════════════════════════════════════════════════════════════╣${RESET}"
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
echo -e "${_BANNER}${BOLD}  ╚══════════════════════════════════════════════════════════════╝${RESET}"
echo ""

# Marquer l'installation comme complète — désactive le rollback trap
_INSTALL_COMPLETE=true

# Installée mais pas en bonne santé : code 1, pour qu'aucune automatisation ne
# prenne ça pour un succès. Le retour arrière reste désactivé (ligne ci-dessus) :
# l'installation est là, elle se diagnostique, elle ne se défait pas.
if [[ $HC_FAIL -gt 0 ]]; then
  echo -e "${RED}${BOLD}  $(t install_errors_exit "$HC_FAIL")${RESET}"
  echo ""
  exit 1
fi
