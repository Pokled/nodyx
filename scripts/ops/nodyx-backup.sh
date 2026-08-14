#!/usr/bin/env bash
# ─── Nodyx — sauvegarde quotidienne, vérifiée ────────────────────────────────
#
#   sudo /usr/local/bin/nodyx-backup           sauvegarde toutes les instances
#   sudo /usr/local/bin/nodyx-backup --verify   revérifie les archives existantes
#
# ─── Pourquoi ce script existe (2026-08-07) ──────────────────────────────────
# Le produit expose un panneau « Sauvegardes » dans l'administration, mais RIEN
# ne le déclenche : `'scheduled'` n'existe que comme valeur de type dans
# `backupService.ts`, aucun code ne la produit, et aucun installeur ne pose de
# tâche planifiée. Autrement dit, sur CHAQUE instance Nodyx, les sauvegardes
# sont entièrement manuelles, et l'admin qui a cliqué une fois croit être
# couvert. Sur nodyx.org, la dernière datait de 48 jours, sur le même disque
# que les données.
#
# Ce script est volontairement INDÉPENDANT du produit : il n'a besoin ni de
# l'API, ni que l'application tourne. Il fonctionne même quand tout est cassé,
# ce qui est précisément le moment où une sauvegarde compte.
#
# ─── La règle de la maison ───────────────────────────────────────────────────
# On ne déclare jamais un succès qu'on n'a pas constaté. Chaque archive est
# donc RELUE après écriture : le dump doit être listable par `pg_restore`,
# l'archive des uploads doit être parcourable par `tar -t`, et la copie SQLite
# doit répondre « ok » à `pragma integrity_check`. Une archive qu'on ne sait
# pas relire ne compte pas comme une sauvegarde.
#
# ─── Les bases SQLite (ajout 2026-08-14) ─────────────────────────────────────
# Le script ne couvrait que PostgreSQL et les uploads. Deux bases SQLite
# passaient donc entre les mailles depuis leur création : `mediatheque.db`
# (229 œuvres, 229 notes de curation, du travail humain irremplaçable) et
# `hub.db`. Aucune sauvegarde, nulle part. Découvert en faisant le ménage des
# branches, pas par une alerte : c'est bien le problème.

set -uo pipefail

DEST="${NODYX_BACKUP_DIR:-/var/backups/nodyx}"
RETAIN_DAYS="${NODYX_BACKUP_RETAIN_DAYS:-14}"
STAMP="$(date +%Y-%m-%dT%H-%M-%S)"

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
bad()  { echo -e "${RED}✘${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }

FAILURES=0
fail() { bad "$*"; FAILURES=$((FAILURES + 1)); }

# instance:base_de_donnees:racine_du_depot
INSTANCES=(
  "nodyx.org:nexus:/var/www/nexus"
  "sleemstudio:sleemstudio:/opt/sleemstudio"
  "demo:demo:/opt/demo"
  "vieuxlooters:vieuxlooters:/opt/vieuxlooters"
)

# Bases SQLite des satellites, hors du modèle une-instance-un-PostgreSQL.
# nom:chemin
SQLITE_DBS=(
  "mediatheque:/var/www/nexus/nodyx-mediatheque/mediatheque.db"
  "hub:/var/www/nexus/nodyx-hub/hub.db"
)

mkdir -p "$DEST"
chmod 700 "$DEST"   # les dumps contiennent des données personnelles

# ── Sauvegarde d'une base, puis relecture pour preuve ────────────────────────
backup_db() {
  local label="$1" db="$2"
  local out="$DEST/${db}-${STAMP}.dump"

  if ! sudo -u postgres psql -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$db"; then
    warn "$label : base '$db' introuvable, ignorée"
    return 0
  fi

  # Format custom (-Fc) : compressé, et surtout relisible par `pg_restore -l`,
  # ce qui permet de PROUVER l'intégrité sans restaurer quoi que ce soit.
  if ! sudo -u postgres pg_dump -Fc "$db" > "$out" 2>/dev/null; then
    fail "$label : pg_dump en échec"
    rm -f "$out"
    return 1
  fi

  local tables
  # Pas de `|| echo 0` ici : `grep -c` imprime deja 0 quand il ne trouve rien,
  # et sort en 1. Le repli ajoutait donc une SECONDE ligne, le test numerique
  # tombait en erreur... et le script annoncait quand meme le succes. Le defaut
  # exact que ce script est cense empecher, commis dans le script lui-meme.
  # Relecture en root, PAS en postgres : l'archive est ecrite en 600 root, donc
  # `sudo -u postgres pg_restore` echouait sur un simple « Permission denied »,
  # et le controle d'integrite accusait a tort des archives parfaitement saines.
  # `pg_restore --list` ne fait que LIRE un fichier, il n'a besoin d'aucun droit
  # sur la base.
  tables="$(pg_restore --list "$out" 2>/dev/null | grep -c 'TABLE DATA')"
  if [[ "$tables" -lt 1 ]]; then
    fail "$label : archive illisible ou vide, elle ne compte pas comme une sauvegarde"
    rm -f "$out"
    return 1
  fi

  chmod 600 "$out"
  ok "$label : base sauvegardée ($(du -h "$out" | cut -f1), $tables tables relues)"
}

# ── Sauvegarde des fichiers envoyés par les utilisateurs ────────────────────
backup_uploads() {
  local label="$1" db="$2" root="$3"
  local src="$root/nodyx-core/uploads"
  local out="$DEST/${db}-uploads-${STAMP}.tar.gz"

  [[ -d "$src" ]] || { warn "$label : pas de dossier uploads, ignoré"; return 0; }

  if ! tar czf "$out" -C "$root/nodyx-core" uploads 2>/dev/null; then
    fail "$label : archive des uploads en échec"
    rm -f "$out"
    return 1
  fi

  local n
  n="$(tar tzf "$out" 2>/dev/null | wc -l)"
  if [[ "$n" -lt 1 ]]; then
    fail "$label : archive des uploads illisible"
    rm -f "$out"
    return 1
  fi

  chmod 600 "$out"
  ok "$label : uploads sauvegardés ($(du -h "$out" | cut -f1), $n entrées relues)"
}

# ── Sauvegarde d'une base SQLite, puis relecture pour preuve ────────────────
backup_sqlite() {
  local label="$1" src="$2"
  local out="$DEST/${label}-${STAMP}.sqlite"

  [[ -f "$src" ]] || { warn "$label : base introuvable, ignorée"; return 0; }

  if ! command -v sqlite3 >/dev/null 2>&1; then
    fail "$label : sqlite3 absent, base NON sauvegardée"
    return 1
  fi

  # `-readonly` n'est pas un détail de confort, c'est la sûreté du service.
  # Ces bases sont en mode WAL et tournent sous l'utilisateur `nodyx`, alors
  # que ce script s'exécute en root. Un `sqlite3` ouvert en écriture fusionne
  # le WAL dans la base et peut laisser des `-wal`/`-shm` appartenant à root :
  # au redémarrage suivant, le service ne peut plus recréer son WAL et sert des
  # « readonly database ». C'est exactement la panne déjà vue sur nodyx-hub.
  # Un simple `cp` est pire encore : il copie la base sans le WAL, donc sans
  # les dernières écritures, et produit une sauvegarde silencieusement tronquée.
  if ! sqlite3 -readonly "$src" ".backup '$out'" 2>/dev/null; then
    fail "$label : .backup en échec"
    rm -f "$out"
    return 1
  fi

  # Relecture : `integrity_check` doit répondre « ok » ET la copie doit contenir
  # au moins une table. Les deux, parce qu'un fichier vide passe le premier test.
  #
  # Ce que `integrity_check` attrape, mesuré sur une vraie base (2026-08-14) :
  # en-tête abîmé et champ « taille de page » abîmé → « file is not a database » ;
  # page de données abîmée → « database disk image is malformed ». Il répond « ok »
  # quand la corruption tombe dans l'espace libre, et c'est CORRECT : dump avant
  # et après vérifiés strictement identiques, aucune donnée perdue. Le contrôle
  # signale la perte de données, pas le bruit sans conséquence.
  local integrity tables
  integrity="$(sqlite3 "$out" 'pragma integrity_check;' 2>/dev/null | head -1)"
  tables="$(sqlite3 "$out" "select count(*) from sqlite_master where type='table';" 2>/dev/null)"
  if [[ "$integrity" != "ok" || "${tables:-0}" -lt 1 ]]; then
    fail "$label : copie illisible (integrity=${integrity:-néant}, tables=${tables:-0})"
    rm -f "$out"
    return 1
  fi

  chmod 600 "$out"
  ok "$label : base SQLite sauvegardée ($(du -h "$out" | cut -f1), $tables tables, integrity ok)"
}

# ── Revérification des archives déjà présentes ──────────────────────────────
verify_existing() {
  echo -e "\n${BOLD}Relecture des archives présentes${RESET}"
  local n=0
  for f in "$DEST"/*.dump; do
    [[ -e "$f" ]] || continue
    n=$((n + 1))
    if pg_restore --list "$f" >/dev/null 2>&1; then
      ok "lisible : $(basename "$f")"
    else
      fail "ILLISIBLE : $(basename "$f")"
    fi
  done
  for f in "$DEST"/*.tar.gz; do
    [[ -e "$f" ]] || continue
    n=$((n + 1))
    if tar tzf "$f" >/dev/null 2>&1; then
      ok "lisible : $(basename "$f")"
    else
      fail "ILLISIBLE : $(basename "$f")"
    fi
  done
  for f in "$DEST"/*.sqlite; do
    [[ -e "$f" ]] || continue
    n=$((n + 1))
    if [[ "$(sqlite3 "$f" 'pragma integrity_check;' 2>/dev/null | head -1)" == "ok" ]]; then
      ok "lisible : $(basename "$f")"
    else
      fail "ILLISIBLE : $(basename "$f")"
    fi
  done
  [[ $n -eq 0 ]] && warn "aucune archive dans $DEST"
}

# ── Exécution ───────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--verify" ]]; then
  verify_existing
else
  echo -e "${BOLD}Sauvegarde Nodyx — $STAMP${RESET}"
  for entry in "${INSTANCES[@]}"; do
    IFS=':' read -r label db root <<< "$entry"
    echo -e "\n${BOLD}### $label${RESET}"
    backup_db      "$label" "$db"
    backup_uploads "$label" "$db" "$root"
  done

  echo -e "\n${BOLD}### Bases SQLite${RESET}"
  for entry in "${SQLITE_DBS[@]}"; do
    IFS=':' read -r label path <<< "$entry"
    backup_sqlite "$label" "$path"
  done

  # Purge : uniquement les archives plus vieilles que la rétention, et
  # seulement si la sauvegarde du jour a réussi. Sinon on garde tout : mieux
  # vaut du vieux que rien.
  echo -e "\n${BOLD}### Rétention${RESET}"
  if [[ $FAILURES -eq 0 ]]; then
    purged="$(find "$DEST" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.tar.gz' -o -name '*.sqlite' \) -mtime "+$RETAIN_DAYS" -print -delete | wc -l)"
    ok "archives de plus de $RETAIN_DAYS jours supprimées : $purged"
  else
    warn "purge annulée : la sauvegarde du jour a échoué, on conserve l'ancien"
  fi
fi

echo
total="$(du -sh "$DEST" 2>/dev/null | cut -f1)"
if [[ $FAILURES -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}✓ Sauvegarde vérifiée. $DEST occupe $total.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}✘ $FAILURES problème(s). Les données NE SONT PAS sauvegardées de façon fiable.${RESET}"
  exit 1
fi
