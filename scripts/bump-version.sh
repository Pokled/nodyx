#!/usr/bin/env bash
# ─── Nodyx — bump version helper ─────────────────────────────────────────────
#
# Sync les 3 fichiers qui doivent rester alignés à chaque release :
#   - VERSION                          (source unique de vérité, lue au runtime)
#   - nodyx-core/package.json          (cohérence npm)
#   - nodyx-frontend/package.json      (cohérence npm)
#
# Optionnellement, déplace [Unreleased] → [X.Y.Z] — YYYY-MM-DD dans CHANGELOG.md
# si l'entrée existe.
#
# Usage : ./scripts/bump-version.sh 2.6.0
#
# Après l'exécution, vérifier git diff puis :
#   git commit -am "chore(release): bump v2.6.0"
#   git tag v2.6.0
#   git push --follow-tags

set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; RESET='\033[0m'

die()  { echo -e "${RED}✘  $*${RESET}" >&2; exit 1; }
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }

[[ $# -eq 1 ]] || die "Usage: $0 <new_version>  (ex: 2.6.0)"

NEW_VER="$1"

if ! [[ "$NEW_VER" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  die "Format invalide: '$NEW_VER'. Attendu: X.Y.Z ou X.Y.Z-suffix (semver)."
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

[[ -f VERSION ]] || die "VERSION introuvable à la racine du repo."
[[ -f nodyx-core/package.json ]] || die "nodyx-core/package.json introuvable."
[[ -f nodyx-frontend/package.json ]] || die "nodyx-frontend/package.json introuvable."

OLD_VER="$(tr -d '[:space:]' < VERSION)"

if [[ "$OLD_VER" == "$NEW_VER" ]]; then
  warn "VERSION déjà à $NEW_VER. Re-sync quand même pour package.json."
fi

echo -e "Bump $OLD_VER → ${BOLD}$NEW_VER${RESET}"
echo ""

# 1. VERSION
echo "$NEW_VER" > VERSION
ok "VERSION mis à jour"

# 2. package.json (sed conservateur : on cible une ligne avec "version": "x.y.z")
sed -i "s/\"version\": \"$OLD_VER\"/\"version\": \"$NEW_VER\"/" nodyx-core/package.json nodyx-frontend/package.json

# Sanity check : si OLD_VER n'était pas synced, on tente le bump générique
_core_ver="$(node -p "require('./nodyx-core/package.json').version")"
_front_ver="$(node -p "require('./nodyx-frontend/package.json').version")"
if [[ "$_core_ver" != "$NEW_VER" ]]; then
  warn "nodyx-core/package.json contient $_core_ver, pas $NEW_VER (était désaligné)"
  warn "Fallback: bump générique via sed."
  sed -i "s/\"version\":[[:space:]]*\"[^\"]*\"/\"version\": \"$NEW_VER\"/" nodyx-core/package.json
fi
if [[ "$_front_ver" != "$NEW_VER" ]]; then
  warn "nodyx-frontend/package.json contient $_front_ver, pas $NEW_VER (était désaligné)"
  sed -i "s/\"version\":[[:space:]]*\"[^\"]*\"/\"version\": \"$NEW_VER\"/" nodyx-frontend/package.json
fi
ok "nodyx-core/package.json + nodyx-frontend/package.json sync à $NEW_VER"

# 3. CHANGELOG.md — bouge [Unreleased] → [X.Y.Z] si l'entrée existe
if [[ -f CHANGELOG.md ]]; then
  TODAY="$(date +%Y-%m-%d)"
  if grep -q "^## \[$NEW_VER\]" CHANGELOG.md; then
    ok "CHANGELOG.md a déjà une entrée [$NEW_VER] (rien à faire)"
  elif grep -q "^## \[Unreleased\]$" CHANGELOG.md; then
    # Insère une entrée [X.Y.Z] — DATE après [Unreleased] et son séparateur,
    # sans supprimer [Unreleased] (qui reste pour les futurs ajouts).
    awk -v ver="$NEW_VER" -v date="$TODAY" '
      /^## \[Unreleased\]$/ { print; in_unreleased=1; next }
      in_unreleased && /^---$/ {
        print
        print ""
        print "## [" ver "] — " date
        in_unreleased=0
        next
      }
      { print }
    ' CHANGELOG.md > CHANGELOG.md.tmp && mv CHANGELOG.md.tmp CHANGELOG.md
    ok "CHANGELOG.md : entrée [$NEW_VER] — $TODAY insérée"
    warn "→ Édite manuellement CHANGELOG.md pour ajouter le contenu de la release."
  else
    warn "CHANGELOG.md sans section [Unreleased] : aucune insertion automatique."
  fi
fi

echo ""
echo -e "${BOLD}Récap :${RESET}"
echo "  VERSION                      : $(cat VERSION)"
echo "  nodyx-core/package.json      : $(node -p "require('./nodyx-core/package.json').version")"
echo "  nodyx-frontend/package.json  : $(node -p "require('./nodyx-frontend/package.json').version")"
echo ""
echo -e "${BOLD}Prochaines étapes :${RESET}"
echo "  1. git diff                                 # vérifier"
echo "  2. (édite CHANGELOG.md si besoin)"
echo "  3. git commit -am 'chore(release): bump v$NEW_VER'"
echo "  4. git tag v$NEW_VER"
echo "  5. git push --follow-tags"
