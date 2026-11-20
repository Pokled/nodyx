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
# /opt/<instance> appartiennent à `nodyx` : tout s'y fait en nodyx, et
# sync-instance.sh rend à nodyx tout fichier qu'un passage en root y aurait laissé.

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

# deps_cmd : n'efface et ne réinstalle node_modules (npm ci) QUE si les dépendances ont
# changé. npm ci vide node_modules pendant que l'application en service s'en sert, et le
# faisait pour 13 applications à chaque déploiement. L'empreinte couvre package-lock.json
# ET la version de Node (un module natif comme re2 se recompile quand Node change).
# Écrite seulement après un npm ci réussi : une installation ratée sera refaite.
deps_cmd() {
  cat <<'SH'
sum="$(cat package-lock.json; node -v)"; sum="$(printf '%s' "$sum" | sha256sum | cut -c1-64)"
if [ -d node_modules ] && [ "$(cat node_modules/.nodyx-deps 2>/dev/null)" = "$sum" ]; then
  echo "dépendances inchangées, npm ci évité"
else
  npm ci --no-audit --no-fund && printf '%s' "$sum" > node_modules/.nodyx-deps
fi
SH
}

# build_app <libellé> <répertoire> [utilisateur]
# Installe (si besoin) et build une app. Toute erreur est comptée, jamais avalée.
build_app() {
  local label="$1" dir="$2" as="${3:-root}"
  local cmd="cd '$dir' && { $(deps_cmd); } && npm run build"
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

# build_frontend <libellé> <répertoire> [utilisateur]
# Le frontend SvelteKit ne se construit plus DANS build/ pendant qu'il le sert (vu le 20/11 :
# « Cannot find module build/server/nodes/110.js » ; mesuré au banc : 8,4 s pendant
# lesquelles les fichiers du site en service manquaient). On construit dans un dossier
# neuf, .builds/<date>-<commit>. La BASCULE (« build » devient un lien vers lui, mv -T :
# atomique) n'a lieu qu'au redémarrage, et seulement si tout le groupe s'est construit
# (restart_if_built) : un cœur raté ne laisse jamais un frontend neuf prêt à démarrer
# seul. Le processus en service a résolu ses fichiers par leur vrai chemin : il garde
# l'ancienne version intacte jusqu'à son redémarrage. Les 3 versions les plus récentes
# restent (retour arrière : un ln -sfn).
PENDING=()
# as_user <utilisateur|root> <commande> : exécute en root, ou sous l'utilisateur de l'instance.
as_user() { if [[ "$1" == "root" ]]; then bash -c "$2"; else sudo -u "$1" bash -c "$2"; fi; }
build_frontend() {
  local label="$1" dir="$2" as="${3:-root}"
  local rel=".builds/$(date +%Y%m%d-%H%M%S)-$(git -C "$dir" rev-parse --short HEAD 2>/dev/null || echo local)"
  local cmd="cd '$dir' && { $(deps_cmd); } && NODYX_BUILD_OUT='$rel' npm run build && test -f '$rel/index.js'"
  local rc=0
  # Dans le dossier d'une instance (à nodyx), on n'agit JAMAIS en root : un .builds remplacé
  # par un lien ferait suivre à root un chown ou un rm -rf hors du dossier (revue du 20/11).
  as_user "$as" "mkdir -p '$dir/.builds'"
  if [[ "$as" == "root" ]]; then
    bash -c "$cmd" >/dev/null 2>&1 || rc=$?
  else
    sudo -u "$as" bash -lc "$cmd" >/dev/null 2>&1 || rc=$?
  fi
  if [[ $rc -eq 0 ]]; then
    PENDING+=("$dir|$rel|$as")
    ok "$label construite à côté ($rel), bascule au redémarrage"
    return 0
  fi
  as_user "$as" "rm -rf '${dir:?}/$rel'"
  fail "$label : BUILD EN ÉCHEC (la version en service n'a pas été touchée)"
  return 1
}

# swap_pending : bascule les frontends construits du groupe, juste avant leur redémarrage.
swap_pending() {
  local item dir rel as cmd
  for item in "${PENDING[@]}"; do
    IFS='|' read -r dir rel as <<<"$item"
    cmd="cd '$dir' && {
      if [ -d build ] && [ ! -L build ]; then mv build \".builds/avant-liens-\$(date +%Y%m%d-%H%M%S)\"; fi
      ln -sfn '$rel' build.next && mv -T build.next build
      ls -1dt .builds/*/ | tail -n +4 | xargs -r rm -rf
    }"
    if [[ "$as" == "root" ]]; then bash -c "$cmd" || fail "bascule EN ÉCHEC : $dir"
    else sudo -u "$as" bash -c "$cmd" || fail "bascule EN ÉCHEC : $dir"; fi
  done
  PENDING=()
}

# drop_pending : un build du groupe a échoué, les frontends neufs ne serviront jamais.
drop_pending() {
  local item dir rel as
  for item in "${PENDING[@]}"; do IFS='|' read -r dir rel as <<<"$item"; as_user "$as" "rm -rf '${dir:?}/$rel'"; done
  PENDING=()
}

# restart_if_built <ok|ko> <nom pm2...>
# Ne redémarre QUE si tous les builds du groupe ont réussi : redémarrer sur un
# build à moitié écrit servirait du code cassé aux visiteurs.
restart_if_built() {
  local built="$1"; shift
  if [[ "$built" == "ok" ]]; then
    swap_pending
    restart_app "$@"
  else
    drop_pending
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
build_frontend "nodyx-frontend" /var/www/nexus/nodyx-frontend || G=ko
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

# Le store (extensions.nodyx.org, PM2) et Signet (signet.nodyx.org, fichiers
# statiques servis par Caddy depuis build/) : oubliés jusqu'au 20/11/2026, leurs
# builds dataient du 29/10 et une PR fusionnée sur l'un d'eux restait invisible.
# Groupe à part : un build raté ici ne bloque pas les trois satellites ci-dessus.
head_ "Satellites : extensions.nodyx.org, signet.nodyx.org"
G=ok
build_app "nodyx-store"         /var/www/nexus/nodyx-store         || G=ko
build_app "nodyx-authenticator" /var/www/nexus/nodyx-authenticator || G=ko
restart_if_built "$G" nodyx-store

# ── 4-6. Instances secondaires (un clone git chacune, build en nodyx) ────────
# sync-instance.sh amène le clone sur origin/main en préservant l'overlay de
# l'instance (/opt/overlays/<instance> : branding, patches en essai) et remet
# d'aplomb les fichiers posés en root. S'il refuse, l'instance reste
# exactement comme avant et on ne build rien : l'ancienne version reste en ligne.
deploy_instance() {
  local name="$1"
  head_ "${name}.nodyx.org (build en nodyx)"
  if bash /var/www/nexus/scripts/ops/sync-instance.sh "/opt/${name}"; then
    ok "dépôt ${name} à jour"
    local G=ok
    build_app "${name}-core"     "/opt/${name}/nodyx-core"     nodyx || G=ko
    build_frontend "${name}-frontend" "/opt/${name}/nodyx-frontend" nodyx || G=ko
    restart_if_built "$G" "${name}-core" "${name}-frontend"
  else
    fail "mise à jour git de ${name} refusée (détail ci-dessus), instance NON déployée"
  fi
}

deploy_instance sleemstudio
deploy_instance demo
deploy_instance vieuxlooters

# ── 7. Vérification : on ne déclare le succès qu'après l'avoir constaté ──────
head_ "Vérification des services"
sleep 8
check_url "nodyx.org"             "https://nodyx.org/"
check_url "nodyx.org/translate"   "https://nodyx.org/translate"
check_url "sleemstudio.nodyx.org" "https://sleemstudio.nodyx.org/"
check_url "demo.nodyx.org"        "https://demo.nodyx.org/"
check_url "vieuxlooters.nodyx.org" "https://vieuxlooters.nodyx.org/"
check_url "nodyx.dev"             "https://nodyx.dev/"
check_url "start.nodyx.org"       "https://start.nodyx.org/"
check_url "extensions.nodyx.org"  "https://extensions.nodyx.org/"
check_url "signet.nodyx.org"      "https://signet.nodyx.org/"

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
