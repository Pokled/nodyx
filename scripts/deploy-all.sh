#!/usr/bin/env bash
# ─── Nodyx — déploiement de toutes les applications du serveur ───────────────
#
# À lancer en root :  sudo /opt/deploy-all.sh
#
# Ce script vit DANS le dépôt. La copie de /opt/deploy-all.sh n'est qu'un
# lanceur : elle fait le `git pull` puis exécute cette version-ci. Sans cette
# séparation, bash relirait le script pendant que le pull le réécrit sous lui.
#
# ─── Pourquoi cette réécriture (2026-08-07) ──────────────────────────────────
# L'ancienne version couvrait 4 applications sur 9, et se terminait par
# « ✓ Les deux instances sont à jour » sans avoir rien vérifié. Concrètement :
#   · demo.nodyx.org n'était jamais déployée (il fallait y penser à la main)
#   · nodyx.dev, start.nodyx.org et le hub n'étaient JAMAIS redéployés
#   · un build en échec n'empêchait pas le message de succès
# Même famille de défaut que le bug pm2-logrotate : une étape qui annonce le
# succès sans l'avoir constaté. D'où la règle appliquée ici : on ne déclare
# rien qu'on n'ait vérifié, et on sort en erreur si un point de contrôle tombe.
#
# ─── Attention ownership ─────────────────────────────────────────────────────
# /var/www/nexus appartient à root (source + node_modules + dist). PM2 tourne
# sous l'utilisateur `nodyx` mais n'a besoin que de LIRE dist/ pour exécuter
# node : on build donc en root ici, et on redémarre en `nodyx`.
# /opt/sleemstudio et /opt/demo appartiennent à `nodyx` : tout s'y fait en nodyx.

set -uo pipefail

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
bad()  { echo -e "${RED}✘${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
head_() { echo -e "\n${BOLD}### $*${RESET}"; }

FAILURES=0
fail() { bad "$*"; FAILURES=$((FAILURES + 1)); }

git config --global --add safe.directory /var/www/nexus 2>/dev/null || true

# ── Helpers ──────────────────────────────────────────────────────────────────

# build_app <libellé> <répertoire> [utilisateur]
# Installe et build une app. Toute erreur est comptée, jamais avalée.
build_app() {
  local label="$1" dir="$2" as="${3:-root}"
  local cmd="cd '$dir' && npm ci --no-audit --no-fund && npm run build"
  local rc=0

  # rc capturé explicitement : lire $? après un bloc if/fi est ambigu, et un
  # script de déploiement qui se trompe sur un code de retour ment sur son
  # propre résultat. C'est exactement le défaut qu'on corrige ici.
  if [[ "$as" == "root" ]]; then
    bash -c "$cmd" >/dev/null 2>&1 || rc=$?
  else
    sudo -u "$as" bash -lc "$cmd" >/dev/null 2>&1 || rc=$?
  fi

  if [[ $rc -eq 0 ]]; then
    ok "$label construite"
    return 0
  fi
  fail "$label : BUILD EN ÉCHEC"
  return 1
}

# restart_if_built <ok|ko> <nom pm2...>
# Ne redémarre QUE si tous les builds du groupe ont réussi : redémarrer sur un
# build à moitié écrit servirait du code cassé aux visiteurs.
restart_if_built() {
  local built="$1"; shift
  if [[ "$built" == "ok" ]]; then
    restart_app "$@"
  else
    warn "redémarrage ignoré ($*) : un build du groupe a échoué, l'ancienne version reste en ligne"
  fi
}

# restart_app <nom pm2...>
restart_app() {
  sudo -u nodyx pm2 restart "$@" --update-env >/dev/null 2>&1 \
    && ok "redémarré : $*" \
    || fail "redémarrage EN ÉCHEC : $*"
}

# check_url <libellé> <url>
check_url() {
  local label="$1" url="$2"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "$url" || echo 000)"
  case "$code" in
    200|301|302|303) ok "$label répond $code" ;;
    *)               fail "$label répond $code" ;;
  esac
}

# ── 1. Dépôt principal ───────────────────────────────────────────────────────
head_ "Mise à jour du dépôt principal"
cd /var/www/nexus || { bad "/var/www/nexus introuvable"; exit 1; }
if git pull --ff-only; then
  ok "dépôt à jour sur $(git rev-parse --short HEAD)"
else
  bad "git pull impossible, déploiement interrompu"
  exit 1
fi

# ── 2. nodyx.org ─────────────────────────────────────────────────────────────
head_ "nodyx.org (build en root)"
G=ok
build_app "nodyx-core"     /var/www/nexus/nodyx-core     || G=ko
build_app "nodyx-frontend" /var/www/nexus/nodyx-frontend || G=ko
restart_if_built "$G" nodyx-core nodyx-frontend

# ── 3. Applications satellites (même dépôt, même commit) ─────────────────────
# Elles vivent dans le dépôt principal : sans redémarrage ici, elles servent
# indéfiniment le build d'avant, sans que personne ne s'en aperçoive.
head_ "Satellites : nodyx.dev, start.nodyx.org, hub"
G=ok
build_app "nodyx-docs"    /var/www/nexus/nodyx-docs    || G=ko
build_app "nodyx-hub"     /var/www/nexus/nodyx-hub     || G=ko
build_app "nodyx-landing" /var/www/nexus/nodyx-landing || G=ko

# nodyx-hub écrit une base SQLite (hub.db) DANS son dossier, et tourne en `nodyx`.
# SQLite en mode WAL recrée hub.db-wal/-shm au démarrage : il lui faut donc un
# dossier inscriptible par nodyx. Le build ci-dessus tourne en root et laisse le
# dossier root:root → au restart, le hub tombait en « readonly database » (500).
# On rend le dossier + la base inscriptibles par le groupe nodyx AVANT le restart.
if [[ -d /var/www/nexus/nodyx-hub ]]; then
  chgrp nodyx /var/www/nexus/nodyx-hub && chmod 775 /var/www/nexus/nodyx-hub
  chown nodyx:nodyx /var/www/nexus/nodyx-hub/hub.db* 2>/dev/null || true
  ok "nodyx-hub : dossier de données inscriptible par nodyx (SQLite WAL)"
fi

restart_if_built "$G" nodyx-docs nodyx-hub nodyx-landing

# ── 4. sleemstudio.nodyx.org (dépôt dédié, build figé sur son domaine) ───────
head_ "sleemstudio.nodyx.org (build en nodyx)"
if sudo -u nodyx bash -lc 'cd /opt/sleemstudio && git pull --ff-only' >/dev/null 2>&1; then
  ok "dépôt sleemstudio à jour"
  G=ok
  build_app "sleemstudio-core"     /opt/sleemstudio/nodyx-core     nodyx || G=ko
  build_app "sleemstudio-frontend" /opt/sleemstudio/nodyx-frontend nodyx || G=ko
  restart_if_built "$G" sleemstudio-core sleemstudio-frontend
else
  fail "git pull sleemstudio en échec, instance NON déployée"
fi

# ── 5. demo.nodyx.org (oubliée par l'ancien script) ──────────────────────────
head_ "demo.nodyx.org (build en nodyx)"
if sudo -u nodyx bash -lc 'cd /opt/demo && git pull --ff-only' >/dev/null 2>&1; then
  ok "dépôt demo à jour"
  G=ok
  build_app "demo-core"     /opt/demo/nodyx-core     nodyx || G=ko
  build_app "demo-frontend" /opt/demo/nodyx-frontend nodyx || G=ko
  restart_if_built "$G" demo-core demo-frontend
else
  fail "git pull demo en échec, instance NON déployée"
fi

# ── 6. Vérification : on ne déclare le succès qu'après l'avoir constaté ──────
head_ "Vérification des services"
sleep 8
check_url "nodyx.org"             "https://nodyx.org/"
check_url "nodyx.org/translate"   "https://nodyx.org/translate"
check_url "sleemstudio.nodyx.org" "https://sleemstudio.nodyx.org/"
check_url "demo.nodyx.org"        "https://demo.nodyx.org/"
check_url "nodyx.dev"             "https://nodyx.dev/"
check_url "start.nodyx.org"       "https://start.nodyx.org/"

# Toute application PM2 qui ne serait plus en ligne
BROKEN="$(sudo -u nodyx pm2 jlist 2>/dev/null \
  | python3 -c "import sys,json;print(' '.join(p['name'] for p in json.load(sys.stdin) if p.get('pm2_env',{}).get('status')!='online'))" 2>/dev/null || echo '')"
if [[ -n "$BROKEN" ]]; then
  fail "applications PM2 hors ligne : $BROKEN"
else
  ok "toutes les applications PM2 sont en ligne"
fi

# ── 7. Verdict ───────────────────────────────────────────────────────────────
echo
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✓ Déploiement terminé : 9 applications à jour et vérifiées.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}✘ Déploiement terminé avec $FAILURES problème(s). Voir ci-dessus.${RESET}"
  exit 1
fi
