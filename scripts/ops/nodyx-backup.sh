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
# donc RELUE après écriture : le dump doit être listable par `pg_restore`, et
# l'archive des uploads doit être parcourable par `tar -t`. Une archive qu'on
# ne sait pas relire ne compte pas comme une sauvegarde.

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

  # Purge : uniquement les archives plus vieilles que la rétention, et
  # seulement si la sauvegarde du jour a réussi. Sinon on garde tout : mieux
  # vaut du vieux que rien.
  echo -e "\n${BOLD}### Rétention${RESET}"
  if [[ $FAILURES -eq 0 ]]; then
    purged="$(find "$DEST" -maxdepth 1 -type f \( -name '*.dump' -o -name '*.tar.gz' \) -mtime "+$RETAIN_DAYS" -print -delete | wc -l)"
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
