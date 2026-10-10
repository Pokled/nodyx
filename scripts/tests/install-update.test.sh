#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc de la mise à jour (install.sh --upgrade, install_tunnel.sh --upgrade,
#  nodyx-update).
#
#  Avant le 04/10/2026 : `fuser -k` tuait tout ce qui écoutait sur 3000/4173,
#  puis on compilait DANS le dossier servi. Une compilation ratée laissait le
#  site à terre (sortie effacée par le compilateur, dépendances à moitié
#  réinstallées). install.sh ne sauvegardait pas la base. nodyx-update était
#  une 3e copie, sans sauvegarde ni remise des droits.
#
#  La vraie fonction _nodyx_upgrade est extraite de chaque installeur (jusqu'à
#  la partie relais/Caddy, hors sujet ici) et jouée sur une fausse installation,
#  avec de faux git, npm, pm2, fuser. Le faux `npm run build` vide la sortie
#  avant de compiler, comme tsc et vite : c'est ce qui rend l'ancien code fatal.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
LIB="$ROOT/scripts/install/build.sh"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

# ── Faux outils ───────────────────────────────────────────────────────────────
mkdir -p "$W/bin"
# npm : `ci` pose node_modules/version ; `run build` VIDE d'abord la sortie
# (comme tsc/vite), puis échoue si la source contient ECHEC.
cat > "$W/bin/npm" <<'EOF'
#!/bin/bash
echo "npm $* ($PWD)" >> "$JOURNAL"
out="$(cat .sortie)"
case "$1" in
  ci) rm -rf node_modules; mkdir -p node_modules; cat version > node_modules/version ;;
  run) rm -rf "$out"; [[ -f ECHEC ]] && { echo "erreur de compilation" >&2; exit 1; }
       mkdir -p "$out"; cat version > "$out/version" ;;
esac
EOF
for outil in git fuser pm2 runuser chown id useradd systemctl; do
  printf '#!/bin/bash\necho "%s $*" >> "$JOURNAL"\n' "$outil" > "$W/bin/$outil"
done
printf '#!/bin/bash\necho "Mem: 4096 0 0"\n' > "$W/bin/free"
chmod +x "$W/bin"/*

# fausse_install <dossier> : une installation qui sert la version « v1 ».
fausse_install() {
  local d="$1" app out
  mkdir -p "$d/scripts/install"; cp "$LIB" "$d/scripts/install/build.sh"
  for app in nodyx-core:dist nodyx-frontend:build; do
    out="${app#*:}"; app="$d/${app%:*}"
    mkdir -p "$app/$out" "$app/node_modules"
    echo "$out" > "$app/.sortie"; echo v2 > "$app/version"      # la source est déjà « tirée »
    echo v1 > "$app/$out/version"; echo v1 > "$app/node_modules/version"
  done
}
sert() { [[ "$(cat "$1/nodyx-core/dist/version" 2>/dev/null)/$(cat "$1/nodyx-core/node_modules/version" 2>/dev/null)/$(cat "$1/nodyx-frontend/build/version" 2>/dev/null)/$(cat "$1/nodyx-frontend/node_modules/version" 2>/dev/null)" == "$2/$2/$2/$2" ]]; }

# extrait <installeur> : _nodyx_upgrade (sans la partie relais / Caddy), avec
# ses chemins système redirigés dans le banc.
extrait() {
  awk '$0 == "_nodyx_upgrade() {" {p=1}
       p && (index($0, "  # ── Relay client : upgrade du binaire") == 1 || index($0, "  local _persisted_mode=") == 1) {print "}"; exit}
       p {print}' "$1" \
    | sed -e "s#/home/nodyx#$W/home#g" -e "s#/usr/local/bin/#$W/usr-local-bin/#g" -e "s#/root/#$W/root/#g" \
          -e "s#/run/lock/nodyx-upgrade.lock#$W/verrou#g"
}
fn() { awk -v f="$2() {" -v g="$2() { #" '$0 == f || index($0, g) == 1 {p=1} p {print} p && $0 == "}" {exit}' "$1"; }

# maj <installeur> <dossier> <sauvegarde ok: true|false> <réponse au terminal> <--yes: true|false>
maj() {
  local inst="$1" d="$2" bk="$3" rep="$4" auto="$5" appel
  : > "$W/journal"; printf '%s\n' "$rep" > "$W/tty"
  if [[ "$inst" == "$TUNNEL" ]]; then appel="NODYX_DIR='$d'; _nodyx_upgrade"; else appel="_nodyx_upgrade v1 v2 '$d'"; fi
  GOT="$(cd "$W" && PATH="$W/bin:$PATH" JOURNAL="$W/journal" _NODYX_TTY="$W/tty" bash -c "
    set -euo pipefail
    t() { printf '%s' \"\$1\"; }; info() { echo \"INFO \$*\"; }; ok() { echo \"OK \$*\"; }
    warn() { echo \"WARN \$*\"; }; die() { echo \"DIE \$*\"; exit 1; }; step() { :; }
    _setup_pm2_logrotate() { :; }; _HC_SPIN=(. . . . . . . . . .)
    BOLD=''; RESET=''; GREEN=''; CYAN=''; RED=''; YELLOW=''
    _auto_backup_db() { echo \"backup \$1\" >> \"\$JOURNAL\"; _AUTO_BACKUP_OK=$bk; }
    _DB_EXISTS=true; _AUTO_YES=$auto; DB_NAME=nodyx
    _NODYX_TTY="$W/tty"; _HAS_TTY=true
    $(fn "$inst" _tty_needed)
    $(fn "$inst" _confirm)
    $(fn "$inst" run_bg)
    $(fn "$inst" _nodyx_write_update_script)
    $(fn "$inst" _nodyx_write_recover_script)
    $(extrait "$inst")
    $appel; echo FIN" 2>&1)"; CODE=$?
}
journal() { cat "$W/journal"; }
restes() { find "$(dirname "$1")" -maxdepth 1 -name '.nodyx-maj-*' | wc -l; }

for INST in "$INSTALL" "$TUNNEL"; do
  N="$(basename "$INST")"
  echo "── $N : la fonction de mise à jour est trouvée"
  extrait "$INST" > "$W/f"
  check "$N : _nodyx_upgrade extraite" '[[ $(wc -l < "$W/f") -gt 20 ]]'

  echo "── $N : mise à jour réussie"
  D="$W/$N/ok/opt/nodyx"; fausse_install "$D"; mkdir -p "$W/usr-local-bin" "$W/root"; echo ancien > "$W/usr-local-bin/nodyx-update"
  maj "$INST" "$D" true "" false
  check "$N : le site sert la nouvelle version (core, frontend, dépendances)" '[[ "$GOT" == *FIN* ]] && sert "$D" v2'
  check "$N : services redémarrés" 'journal | grep -q "pm2 .*restart\|pm2 .*startOrRestart"'
  check "$N : AUCUN fuser -k" '! journal | grep -q "^fuser"'
  check "$N : rien compilé dans le dossier servi" '! journal | grep -q "($D/nodyx-"'
  B="$(journal | grep -n "^backup upgrade" | head -1 | cut -d: -f1)"; P="$(journal | grep -n "^git .*pull\|^npm" | head -1 | cut -d: -f1)"
  GOT="sauvegarde ligne ${B:-AUCUNE}, code ligne ${P:-?}"
  check "$N : base sauvegardée AVANT de tirer le code" '[[ -n "$B" && -n "$P" && $B -lt $P ]]'
  check "$N : dossiers de travail effacés" '[[ $(restes "$D") -eq 0 ]]'
  GOT="$(cat "$W/usr-local-bin/nodyx-update")"
  check "$N : nodyx-recover installé, vers la bonne instance" 'grep -qF "cd \"$D/nodyx-core\"" "$W/usr-local-bin/nodyx-recover"'
  check "$N : nodyx-update régénéré en raccourci vers l'installeur" 'grep -qxF "exec bash \"$D/$N\" --upgrade \"\$@\"" "$W/usr-local-bin/nodyx-update" && ! grep -q "npm" "$W/usr-local-bin/nodyx-update" && bash -n "$W/usr-local-bin/nodyx-update"'

  for casse in nodyx-frontend nodyx-core; do
    echo "── $N : compilation de $casse ratée"
    D="$W/$N/echec-$casse/opt/nodyx"; fausse_install "$D"; touch "$D/$casse/ECHEC"
    maj "$INST" "$D" true "" false
    check "$N/$casse : arrêt avec erreur" '[[ $CODE -ne 0 && "$GOT" != *FIN* ]]'
    check "$N/$casse : le site sert TOUJOURS l'ancienne version, intacte" 'sert "$D" v1'
    check "$N/$casse : services NON redémarrés" '! journal | grep -q "pm2 .*restart\|pm2 .*startOrRestart"'
    check "$N/$casse : le message dit que le site n'a pas été touché" '[[ "$GOT" == *upgrade_site_untouched* ]]'
    check "$N/$casse : dossiers de travail effacés" '[[ $(restes "$D") -eq 0 ]]'
  done

  echo "── $N : verrou et restes d'une mise à jour interrompue"
  D="$W/$N/verrou/opt/nodyx"; fausse_install "$D"
  # Le porteur du verrou EST le sleep (exec) : le tuer libère vraiment le verrou.
  ( exec 9>"$W/verrou"; flock 9; exec sleep 30 ) & PORTEUR=$!
  until ! flock -n "$W/verrou" true; do :; done
  maj "$INST" "$D" true "" false
  check "$N : une autre mise à jour en cours : refus, rien tiré ni compilé" '[[ $CODE -ne 0 && "$GOT" == *upgrade_already_running* ]] && ! journal | grep -q "^git .*pull\|^npm" && sert "$D" v1'
  kill "$PORTEUR" 2>/dev/null; wait "$PORTEUR" 2>/dev/null
  mkdir -p "$(dirname "$D")/.nodyx-maj-core.ABANDON"; echo "SECRET=x" > "$(dirname "$D")/.nodyx-maj-core.ABANDON/.env"
  mkdir -p "$(dirname "$D")/autre-dossier"
  maj "$INST" "$D" true "" false
  check "$N : dossiers abandonnés par une mise à jour interrompue effacés" '[[ "$GOT" == *FIN* && $(restes "$D") -eq 0 && -d "$(dirname "$D")/autre-dossier" ]]'

  echo "── $N : sauvegarde de la base impossible"
  D="$W/$N/sansbk/opt/nodyx"; fausse_install "$D"
  maj "$INST" "$D" false "" false
  check "$N : Entrée = NON, rien n'est tiré ni compilé" '[[ $CODE -ne 0 ]] && ! journal | grep -q "^git .*pull\|^npm" && sert "$D" v1'
  maj "$INST" "$D" false "" true
  check "$N : --yes ne met JAMAIS à jour sans sauvegarde" '[[ $CODE -ne 0 && "$GOT" == *upgrade_no_backup_auto* ]] && ! journal | grep -q "^npm"'
  maj "$INST" "$D" false "oui" false
  check "$N : « oui » explicite : la mise à jour se fait" '[[ "$GOT" == *FIN* ]] && sert "$D" v2'
done

echo "── sauvegardes de mise à jour : les 5 plus récentes, jamais les autres"
mkdir -p "$W/bk/bin"; printf '#!/bin/bash\nprintf -- "-- PostgreSQL database dump\\n-- PostgreSQL database dump complete\\n"\n' > "$W/bk/bin/runuser"; chmod +x "$W/bk/bin/runuser"
prepare_bk() { # <dossier> <préfixe> : 7 vieilles sauvegardes de mise à jour + 1 d'un --wipe
  local i; mkdir -p "$1"
  for i in 1 2 3 4 5 6 7; do echo x > "$1/$2$i.sql.gz"; touch -d "2026-01-0$i" "$1/$2$i.sql.gz"; done
  echo w > "$1/AVANT-WIPE.sql.gz"; touch -d 2025-01-01 "$1/AVANT-WIPE.sql.gz"
}
D="$W/bk/i"; prepare_bk "$D" nodyx-db-backup-upgrade-ancienne
GOT="$(PATH="$W/bk/bin:$PATH" bash -c "set -euo pipefail; t() { printf '%s' \"\$1\"; }; info() { :; }; ok() { :; }; warn() { echo WARN; }
  _rollback_register() { :; }; _DB_EXISTS=true; BOLD=''; RESET=''
  $(fn "$INSTALL" _nodyx_prune_backups | sed "s#/root/#$D/#g")
  $(fn "$INSTALL" _auto_backup_db | sed "s#/root/#$D/#g")
  _auto_backup_db upgrade; echo OK=\$_AUTO_BACKUP_OK" 2>&1)"
check "install.sh : 5 sauvegardes de mise à jour gardées, la nouvelle comprise" '[[ "$GOT" == *OK=true* && $(ls "$D"/nodyx-db-backup-upgrade-* | wc -l) -eq 5 && ! -e "$D/nodyx-db-backup-upgrade-ancienne1.sql.gz" && -e "$D/nodyx-db-backup-upgrade-ancienne7.sql.gz" ]]'
check "install.sh : la sauvegarde d'avant --wipe n'est jamais supprimée" '[[ -e "$D/AVANT-WIPE.sql.gz" ]]'
D="$W/bk/t"; prepare_bk "$D" nodyx_upgrade_ancienne
GOT="$(PATH="$W/bk/bin:$PATH" bash -c "set -euo pipefail; t() { printf '%s' \"\$1\"; }; warn() { echo WARN; }; CYAN=''; GREEN=''; RESET=''; DB_NAME=nodyx
  $(fn "$TUNNEL" _nodyx_prune_backups)
  $(fn "$TUNNEL" _auto_backup_db | sed "s#/var/backups/nodyx#$D#")
  _auto_backup_db upgrade; echo OK=\$_AUTO_BACKUP_OK" 2>&1)"
check "tunnel : 5 sauvegardes de mise à jour gardées, celle d'avant --wipe intacte" '[[ "$GOT" == *OK=true* && $(ls "$D"/nodyx_upgrade_* | wc -l) -eq 5 && -e "$D/AVANT-WIPE.sql.gz" ]]'

echo "── bibliothèque : bascule tout ou rien"
# shellcheck source=scripts/install/build.sh
. "$LIB"
D="$W/lib/app"; mkdir -p "$D/dist" "$D/node_modules" "$W/lib/w/node_modules"
echo v1 > "$D/dist/version"; echo v1 > "$D/node_modules/version"; echo v2 > "$W/lib/w/node_modules/version"
nodyx_swap_outputs "$D" dist "$W/lib/w"; c=$?
check "sortie neuve absente : refus AVANT tout déplacement" '[[ $c -ne 0 ]] && [[ "$(cat "$D/node_modules/version")" == v1 ]]'
mkdir -p "$W/lib/w/dist"; echo v2 > "$W/lib/w/dist/version"
nodyx_swap_outputs "$D" dist "$W/lib/w" && nodyx_swap_back "$D" dist "$W/lib/w"; c=$?
check "retour arrière : l'ancienne version revient entière" '[[ $c -eq 0 && "$(cat "$D/dist/version")/$(cat "$D/node_modules/version")" == v1/v1 ]]'
D="$W/lib/src"; mkdir -p "$D/node_modules/lourd" "$D/build/vieux" "$D/.svelte-kit" "$D/src" "$D/uploads/avatars" "$D/backups" "$D/static"
echo photo > "$D/uploads/avatars/a.png"; echo archive > "$D/backups/b.tar.gz"; echo verif > "$D/static/BingSiteAuth.xml"
echo build > "$D/.sortie"; echo v2 > "$D/version"
PATH="$W/bin:$PATH" JOURNAL="$W/journal" nodyx_build_aside "$D" build "$W/lib/t"; c=$?
check "copie de travail sans node_modules, ancienne sortie ni .svelte-kit" '[[ $c -eq 0 && -d "$W/lib/t/src" && ! -e "$W/lib/t/node_modules/lourd" && ! -e "$W/lib/t/build/vieux" && ! -e "$W/lib/t/.svelte-kit" ]]'
check "copie de travail SANS les données vivantes (uploads, backups)" '[[ ! -e "$W/lib/t/uploads" && ! -e "$W/lib/t/backups" ]]'
check "mais AVEC les fichiers propres à l'instance (static/ non suivi)" '[[ -f "$W/lib/t/static/BingSiteAuth.xml" ]]'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
