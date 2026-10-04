#!/usr/bin/env bash
# BK, OUT, CODE, R, LOG sont lus dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Tests de uninstall.sh, sans JAMAIS toucher au vrai système :
#   - faux système de fichiers (NODYX_UNINSTALL_ROOT) ;
#   - PATH hermétique : des doublures pour systemctl, ufw, psql, redis-cli,
#     apt-get, pm2… qui notent ce qu'on leur demande, plus une liste fermée
#     d'outils inoffensifs. Une commande oubliée échoue (« command not found »)
#     au lieu d'agir ;
#   - lancé en root, le banc se relance sous l'utilisateur « nobody ».
#  Usage : bash scripts/tests/uninstall.test.sh
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail

SCRIPT="${UNINSTALL_SCRIPT:-$(cd "$(dirname "$0")/../.." && pwd)/uninstall.sh}"
if [[ $EUID -eq 0 ]]; then
  exec runuser -u nobody -- bash "$0" "$@"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BIN="$WORK/bin"; mkdir -p "$BIN"

# ── Outils réels autorisés (lecture/écriture DANS le faux système seulement) ──
for t in bash sh env cat cp rm mkdir chmod install mv tar gzip realpath du df awk sed grep cut tr \
         date mktemp wc xargs sort head tail printf node basename dirname ls find md5sum stat touch; do
  p="$(command -v "$t")" && ln -s "$p" "$BIN/$t"
done

# ── Doublures : une seule, aiguillée par son nom ──────────────────────────────
cat > "$WORK/shim" <<'SHIM'
#!/bin/bash
name="$(basename "$0")"
echo "$name $*" >> "$SHIM_LOG"
case "$name" in
  runuser)
    shift 2; [[ "$1" == "--" ]] && shift            # -u USER --
    [[ "$1" == "env" ]] && { shift; while [[ "$1" == *=* ]]; do shift; done; }
    exec "$SHIM_BIN/$1" "${@:2}" ;;
  id)        [[ "${NO_NODYX_USER:-}" == 1 ]] && exit 1; exit 0 ;;
  pgrep)     exit 1 ;;
  pm2)
    case "$1" in
      jlist)    # Pas de ${PM2_JLIST:-…} : les « } » du JSON fermeraient l'expansion.
                if [[ -n "${PM2_JLIST:-}" ]]; then printf '%s' "$PM2_JLIST"
                else printf '%s' '[{"name":"nodyx-core","pm2_env":{}},{"name":"nodyx-frontend","pm2_env":{}},{"name":"pm2-logrotate","pm2_env":{"pmx_module":true}}]'; fi ;;
      describe) exit 0 ;;
    esac ;;
  psql)
    sql="${*: -1}"
    case "$sql" in
      *"SELECT 1 FROM pg_database"*) echo 1 ;;
      *string_agg*)                  echo "" ;;
    esac ;;
  pg_dump)    [[ "${PGDUMP_FAIL:-}" == 1 ]] && exit 1; printf 'PGDMP-fausse-sauvegarde' ;;
  pg_restore) [[ "$(head -c5 "${@: -1}")" == PGDMP ]] ;;
  redis-cli)
    if [[ " $* " == *" ping "* ]]; then echo PONG
    elif [[ " $* " == *" --scan "* ]]; then
      case "${*: -1}" in
        'nodyx:*')   printf 'nodyx:session:a\nnodyx:heartbeat:b\n' ;;
        'session:*') printf 'session:AUTRE-APPLI\n' ;;
      esac
    fi ;;
  ufw)
    if [[ "$1" == status ]]; then
      printf 'Status: active\n\nTo                         Action      From\n--                         ------      ----\n'
      for r in 22/tcp 80/tcp 443/tcp 3478/tcp 3478/udp 5349/tcp 5349/udp 49152:65535/udp 40000:40999/udp 40000:40999/tcp; do
        printf '%-26s ALLOW       Anywhere\n' "$r"
      done
    fi ;;
  systemctl)
    if [[ "$1" == cat && "$2" == caddy ]]; then
      echo "ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile${SHIM_CADDY_RESUME:+ --resume}"
    fi ;;
  caddy)      exit 0 ;;   # validate : accepté
esac
exit 0
SHIM
chmod +x "$WORK/shim"
for c in runuser id pgrep pm2 psql pg_dump pg_restore redis-cli ufw systemctl caddy apt-get cloudflared userdel; do
  ln -s "$WORK/shim" "$BIN/$c"
done

# ── Faux système d'une installation standard ──────────────────────────────────
make_root() {
  local R="$1"
  mkdir -p "$R"/opt/nodyx/nodyx-core/{uploads/avatars,backups} "$R"/opt/nodyx/nodyx-frontend \
           "$R"/etc/caddy "$R"/etc/systemd/system "$R"/usr/local/bin "$R"/root
  echo '{ "name": "nodyx-core", "version": "2.12.0" }' > "$R/opt/nodyx/nodyx-core/package.json"
  printf 'DB_NAME=nodyx\nDB_USER=nodyx_user\nREDIS_HOST=127.0.0.1\nREDIS_PORT=6379\nFRONTEND_URL=https://ma-commu.example.org\n' > "$R/opt/nodyx/nodyx-core/.env"
  echo 'PUBLIC_API_URL=x' > "$R/opt/nodyx/nodyx-frontend/.env"
  echo avatar > "$R/opt/nodyx/nodyx-core/uploads/avatars/a.png"
  echo archive > "$R/opt/nodyx/nodyx-core/backups/nodyx-2026.tar.gz"
  printf '{\n  servers {\n  }\n}\n\n(security_headers) {\n  header X a\n}\n\nma-commu.example.org {\n  import security_headers\n  reverse_proxy 127.0.0.1:3000\n}\n' > "$R/etc/caddy/Caddyfile"
  for s in nodyx-turn nodyx-sfud nodyx-relay-client pm2-nodyx; do echo "[Unit]" > "$R/etc/systemd/system/$s.service"; done
  for b in nodyx-turn nodyx-sfud nodyx-relay nodyx-doctor nodyx-update; do echo bin > "$R/usr/local/bin/$b"; done
  echo 'TURN=x' > "$R/etc/nodyx-turn.env"
  echo 'admin:secret' > "$R/root/nodyx-credentials.txt"
}

PASS=0; FAILN=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAILN=$((FAILN+1)); echo "  ✘ $1"; fi; }
MUTATING='pm2 (delete|kill|save)|systemctl (disable|reload|daemon-reload|stop)|apt-get|ufw --force delete|ufw (reset|default|enable)|DROP|pg_terminate|unlink|userdel|cloudflared service'

# run_case <nom> <réponses…> -- [options du script]
run_case() {
  CASE="$1"; shift
  R="$WORK/$CASE"; make_root "$R"
  local answers=(); while [[ $# -gt 0 && "$1" != "--" ]]; do answers+=("$1"); shift; done; [[ "${1:-}" == "--" ]] && shift
  printf '%s\n' "${answers[@]}" > "$WORK/$CASE.tty"
  LOG="$WORK/$CASE.log"; : > "$LOG"
  ( for _hook in ${PRE_HOOK:-}; do "$_hook" "$R"; done )
  BEFORE="$(cd "$R" && find . -type f -exec md5sum {} + | sort | md5sum)"
  OUT="$(env -i PATH="$BIN" HOME="$WORK" LANG=fr_FR.UTF-8 SHIM_LOG="$LOG" SHIM_BIN="$BIN" \
         NODYX_UNINSTALL_ROOT="$R" NODYX_UNINSTALL_TTY="$WORK/$CASE.tty" \
         PM2_JLIST="${PM2_JLIST:-}" PGDUMP_FAIL="${PGDUMP_FAIL:-}" SHIM_CADDY_RESUME="${SHIM_CADDY_RESUME:-}" \
         bash "$SCRIPT" "$@" 2>&1)"; CODE=$?
  AFTER="$(cd "$R" && find . -type f -exec md5sum {} + | sort | md5sum)"
  echo ""; echo "── $CASE (sortie $CODE)"
  [[ "${UNINSTALL_TEST_DEBUG:-}" == "$CASE" ]] && { echo "$OUT"; echo "── journal des doublures :"; cat "$LOG"; }
}
unchanged() { [[ "$BEFORE" == "$AFTER" ]] && ! grep -qE "$MUTATING" "$LOG"; }

# ═══ 1. Désinstallation complète, réponses « oui » sauf garder Caddy et 80/443 ═
#      confirmer, sauvegarde, paquet caddy, base, ports web, dossier, identifiants, utilisateur
run_case complet ma-commu.example.org o n o n o o o
check "termine sans échec" '[[ $CODE -eq 0 ]] && grep -q "retiré de ce serveur" <<<"$OUT"'
check "PM2 arrêté SOUS l'utilisateur nodyx" 'grep -q "runuser -u nodyx -- env PM2_HOME=/home/nodyx/.pm2 pm2 delete nodyx-core" "$LOG"'
check "sauvegarde AVANT la suppression de la base" '[[ $(grep -n "^pg_dump" "$LOG" | head -1 | cut -d: -f1) -lt $(grep -n "DROP DATABASE" "$LOG" | head -1 | cut -d: -f1) ]]'
BK="$(ls -d "$R"/root/nodyx-uninstall-* 2>/dev/null | head -1)"
check "sauvegarde complète (base, uploads, .env, archives, Caddyfile)" '[[ -s "$BK/base.dump" && -s "$BK/uploads.tar.gz" && -f "$BK/nodyx-core_.env" && -f "$BK/archives-nodyx/nodyx-2026.tar.gz" && -f "$BK/Caddyfile" ]]'
check "Redis : seulement les clés nodyx:" 'grep -q "unlink nodyx:session:a nodyx:heartbeat:b" "$LOG" && ! grep -q "AUTRE-APPLI" "$LOG" && ! grep -q "pattern session:" "$LOG"'
check "pare-feu : ports voix/TURN retirés" 'grep -q "ufw --force delete allow 3478/udp" "$LOG" && grep -q "ufw --force delete allow 40000:40999/tcp" "$LOG"'
check "pare-feu : JAMAIS reset, politique, SSH" '! grep -qE "ufw (--force )?(reset|default|enable)|delete allow (22|ssh)" "$LOG"'
check "pare-feu : 80/443 gardés (réponse non)" '! grep -qE "delete allow (80|443)/tcp" "$LOG"'
check "Caddyfile ramené à la page par défaut, sans le domaine" 'grep -q "^:80" "$R/etc/caddy/Caddyfile" && ! grep -q "ma-commu" "$R/etc/caddy/Caddyfile"'
check "services, programmes et configuration retirés" '[[ ! -e "$R/etc/systemd/system/nodyx-sfud.service" && ! -e "$R/etc/systemd/system/pm2-nodyx.service" && ! -e "$R/usr/local/bin/nodyx-doctor" && ! -e "$R/etc/nodyx-turn.env" ]]'
check "dossier Nodyx supprimé" '[[ ! -e "$R/opt/nodyx" ]]'
check "utilisateur nodyx supprimé" 'grep -q "userdel -r nodyx" "$LOG"'

# ═══ 2. Simulation : tout « oui », rien ne doit bouger ═══════════════════════
run_case simulation ma-commu.example.org o o o o o o o -- --dry-run
check "simulation : aucun fichier modifié, aucune commande destructive" 'unchanged'
check "simulation : annoncée comme telle" '[[ $CODE -eq 0 ]] && grep -q "rien n.a été modifié" <<<"$OUT"'

# ═══ 3. Mauvaise confirmation ════════════════════════════════════════════════
run_case annule autre-chose
check "confirmation fausse : annulé, rien touché" '[[ $CODE -eq 0 ]] && unchanged'

# ═══ 4. Pas une installation Nodyx ═══════════════════════════════════════════
no_pkg() { rm -f "$1/opt/nodyx/nodyx-core/package.json"; }
PRE_HOOK=no_pkg run_case pas_nodyx ma-commu.example.org o o o o o o o
check "dossier non reconnu : refus, rien touché" '[[ $CODE -ne 0 ]] && unchanged'
check "dossier non reconnu : la raison est AFFICHÉE" 'grep -q "ne ressemble pas à une installation Nodyx" <<<"$OUT"'

# ═══ 5. Dossiers interdits ═══════════════════════════════════════════════════
for d in / /opt /var/www /root; do
  run_case "dir_${d//\//_}" x -- --dir="$d"
  check "--dir=$d refusé, rien touché" '[[ $CODE -ne 0 ]] && unchanged'
done

# ═══ 6. Nom de base piégé dans le .env ═══════════════════════════════════════
bad_db() { sed -i 's/^DB_NAME=.*/DB_NAME=nodyx; DROP DATABASE postgres/' "$1/opt/nodyx/nodyx-core/.env"; }
PRE_HOOK=bad_db run_case base_piegee ma-commu.example.org o o o o o o o
check "nom de base piégé : refus, rien touché" '[[ $CODE -ne 0 ]] && unchanged'
check "nom de base piégé : la raison est AFFICHÉE" 'grep -q "Nom de base" <<<"$OUT"'

# ═══ 7. La sauvegarde de la base échoue ═════════════════════════════════════
PGDUMP_FAIL=1 run_case dump_rate ma-commu.example.org o o o o o o o
check "sauvegarde ratée : la raison est AFFICHÉE" 'grep -q "sauvegarde de la base a échoué" <<<"$OUT"'
check "sauvegarde ratée : arrêt avant toute destruction" '[[ $CODE -ne 0 ]] && ! grep -qE "$MUTATING" "$LOG" && [[ -d "$R/opt/nodyx" ]]'

# ═══ 8. Un autre site dans le Caddyfile ═════════════════════════════════════
other_site() { printf '\nautre-site.example.com {\n  respond "ok"\n}\n' >> "$1/etc/caddy/Caddyfile"; }
PRE_HOOK=other_site run_case autre_site ma-commu.example.org o n o n o o o
check "autre site : Caddyfile intact, pas de rechargement" 'grep -q "autre-site.example.com" "$R/etc/caddy/Caddyfile" && grep -q "ma-commu" "$R/etc/caddy/Caddyfile" && ! grep -q "systemctl reload caddy" "$LOG"'

# ═══ 9. Caddy piloté par une configuration sauvegardée (--resume) ═══════════
SHIM_CADDY_RESUME=1 run_case caddy_resume ma-commu.example.org o n o n o o o
check "--resume : Caddyfile intact, pas de rechargement" 'grep -q "ma-commu" "$R/etc/caddy/Caddyfile" && ! grep -q "systemctl reload caddy" "$LOG"'

# ═══ 10. D'autres applications PM2 sous nodyx ═══════════════════════════════
PM2_JLIST='[{"name":"nodyx-core","pm2_env":{}},{"name":"mon-autre-site","pm2_env":{}}]' \
  run_case autres_pm2 ma-commu.example.org o n o n o o o
check "autres apps PM2 : démon, pm2-nodyx et utilisateur conservés" '! grep -q "pm2 kill" "$LOG" && [[ -e "$R/etc/systemd/system/pm2-nodyx.service" ]] && ! grep -q userdel "$LOG"'

# ═══ 10b. D'autres instances Nodyx sur la machine (cas de notre VPS) ════════
PM2_JLIST='[{"name":"nodyx-core","pm2_env":{}},{"name":"demo-core","pm2_env":{}},{"name":"demo-frontend","pm2_env":{}}]' \
  run_case autres_instances ma-commu.example.org o o o o o o o
check "autres instances Nodyx : refus affiché, rien touché" '[[ $CODE -ne 0 ]] && grep -q "autres instances Nodyx" <<<"$OUT" && unchanged'

# ═══ 10c. Installation en tunnel Cloudflare ══════════════════════════════════
# Depuis le 04/10/2026 le jeton vit dans /etc/cloudflared/tunnel.env, un fichier
# que `cloudflared service uninstall` ne connaît pas (doublure : ne fait rien).
tunnel_cf() {
  mkdir -p "$1/etc/nodyx" "$1/etc/cloudflared"; echo cf > "$1/etc/nodyx/tunnel-mode"
  printf '[Service]\nEnvironmentFile=/etc/cloudflared/tunnel.env\nExecStart=/usr/bin/cloudflared --no-autoupdate tunnel run\n' > "$1/etc/systemd/system/cloudflared.service"
  echo 'TUNNEL_TOKEN=eyJjeton' > "$1/etc/cloudflared/tunnel.env"
}
PRE_HOOK=tunnel_cf run_case tunnel_cf ma-commu.example.org o o n o n o o o
check "tunnel Cloudflare : unité ET fichier du jeton retirés" '[[ $CODE -eq 0 && ! -e "$R/etc/systemd/system/cloudflared.service" && ! -e "$R/etc/cloudflared/tunnel.env" ]]'

# ═══ 11. Pas de terminal ═════════════════════════════════════════════════════
R="$WORK/sans_tty"; make_root "$R"; LOG="$WORK/sans_tty.log"; : > "$LOG"
OUT="$(env -i PATH="$BIN" LANG=fr_FR.UTF-8 SHIM_LOG="$LOG" SHIM_BIN="$BIN" NODYX_UNINSTALL_ROOT="$R" \
       NODYX_UNINSTALL_TTY="$WORK/nexiste-pas" bash "$SCRIPT" 2>&1)"; CODE=$?
echo ""; echo "── sans_tty (sortie $CODE)"
check "sans terminal : refus explicite, rien touché" '[[ $CODE -ne 0 ]] && grep -q "terminal" <<<"$OUT" && [[ ! -s "$LOG" ]]'

echo ""
echo "Résultat : $PASS réussis, $FAILN échoués"
[[ $FAILN -eq 0 ]]
