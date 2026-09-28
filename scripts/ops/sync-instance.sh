#!/usr/bin/env bash
# ─── Nodyx — mise à jour git d'une instance secondaire, overlay compris ──────
#
#   sudo bash scripts/ops/sync-instance.sh /opt/<instance> [dossier-overlay]
#
# Amène le clone git d'une instance (/opt/demo, /opt/vieuxlooters...) sur
# origin/main SANS perdre ce qui lui est propre, puis rend la main. Ne build
# rien, ne redémarre rien : c'est le travail de deploy-all.sh, qui appelle ce
# script avant de construire.
#
# ─── Pourquoi (2026-09-28) ───────────────────────────────────────────────────
# Le branding d'une instance (favicon, icônes, og-image) vit dans des fichiers
# SUIVIS par git. Le personnaliser rend l'arbre sale en permanence, et
# `git pull --ff-only` refuse alors de passer : deploy-all.sh échouait sur
# vieuxlooters à chaque fois. Résultat mesuré le 28/09 : les 3 instances
# secondaires avaient 131 commits de retard, et le seul correctif récent y
# avait été posé à la main, en root, laissant des fichiers root:root qui ont
# fait planter `npm ci` (EACCES) en plein milieu, node_modules à moitié vidé.
#
# ─── L'overlay ───────────────────────────────────────────────────────────────
# Ce qui est propre à une instance vit HORS de son arbre git, dans
# /opt/overlays/<instance>/ (ou le dossier passé en 2e argument) :
#
#   files/<chemin dans le dépôt>   copié par-dessus après le pull (branding)
#   patches/*.patch                appliqués dans l'ordre après le pull
#                                  (retouches de code, prototype en essai)
#
# Déroulé, et garantie à chaque étape :
#   1. propriétaires remis à l'utilisateur de l'instance (plus de root égaré)
#   2. à BLANC, dans un worktree jetable : les patches s'appliquent-ils sur le
#      nouveau origin/main ? Non → arrêt, instance intacte.
#   3. overlay retiré (patches dépliés à l'envers, fichiers restaurés), arbre
#      vérifié propre. Sale → overlay reposé, arrêt, instance intacte.
#   4. pull --ff-only, overlay reposé.
# Toute modification locale qui n'est PAS dans l'overlay bloque la mise à
# jour : on ne jette jamais un travail qu'on ne connaît pas.

set -uo pipefail

DIR="${1:?usage: sync-instance.sh /opt/<instance> [dossier-overlay]}"
DIR="${DIR%/}"
NAME="$(basename "$DIR")"
OVERLAY="${2:-${OVERLAY_ROOT:-/opt/overlays}/$NAME}"
AS="${INSTANCE_USER:-nodyx}"

say()  { echo "  [$NAME] $*"; }
die()  { echo "  [$NAME] ÉCHEC : $*" >&2; exit 1; }

# Toute action dans l'arbre se fait sous l'utilisateur de l'instance : c'est
# un git lancé en root qui a laissé les fichiers root:root du 23/09.
as_user() {
  if [[ "$(id -un)" == "$AS" ]]; then "$@"; else sudo -u "$AS" "$@"; fi
}
# safe.directory limité à cet appel, jamais dans la config globale
g() { as_user git -C "$DIR" -c safe.directory="$DIR" "$@"; }

[[ -d "$DIR/.git" ]] || die "$DIR n'est pas un clone git"

PATCHES=()
if [[ -d "$OVERLAY/patches" ]]; then
  while IFS= read -r p; do PATCHES+=("$p"); done \
    < <(find "$OVERLAY/patches" -maxdepth 1 -name '*.patch' | sort)
fi
FILES=()
if [[ -d "$OVERLAY/files" ]]; then
  while IFS= read -r f; do FILES+=("${f#"$OVERLAY/files/"}"); done \
    < <(find "$OVERLAY/files" -type f | sort)
fi

# ── 1. Propriétaires ─────────────────────────────────────────────────────────
if [[ "$(id -u)" == 0 ]]; then
  n="$(find "$DIR" -not -user "$AS" | wc -l)"
  if [[ "$n" -gt 0 ]]; then
    find "$DIR" -not -user "$AS" -exec chown -h "$AS:$AS" {} +
    say "$n élément(s) rendus à $AS (posés par un autre utilisateur)"
  fi
fi

# ── 2. Essai à blanc sur le nouveau main ─────────────────────────────────────
g fetch -q origin main || die "git fetch impossible"
TARGET="$(g rev-parse origin/main)"
if [[ ${#PATCHES[@]} -gt 0 ]]; then
  TRY="$(as_user mktemp -d)" || die "dossier d'essai impossible"
  g worktree add -q --detach "$TRY" "$TARGET" || die "worktree d'essai impossible"
  ok_try=1
  for p in "${PATCHES[@]}"; do
    if ! g -C "$TRY" apply "$p" 2>/dev/null; then
      ok_try=0; say "le patch $(basename "$p") ne s'applique plus sur ${TARGET:0:7}"
      break
    fi
  done
  g worktree remove --force "$TRY"
  [[ $ok_try == 1 ]] || die "overlay à mettre à jour avant de déployer, instance NON touchée"
fi

# ── 3. Retrait de l'overlay ──────────────────────────────────────────────────
# Les patches se retirent en ordre inverse. S'ils ne se déplient pas, c'est
# que quelqu'un a retouché ces fichiers à la main : on ne devine pas.
for (( i=${#PATCHES[@]}-1; i>=0; i-- )); do
  g apply -R --check "${PATCHES[$i]}" 2>/dev/null \
    || die "le patch $(basename "${PATCHES[$i]}") n'est pas appliqué tel quel (fichiers retouchés à la main ?), instance NON touchée"
done
for (( i=${#PATCHES[@]}-1; i>=0; i-- )); do g apply -R "${PATCHES[$i]}"; done
for f in "${FILES[@]}"; do
  if g ls-files --error-unmatch -- "$f" >/dev/null 2>&1; then
    g checkout -q -- "$f"
  else
    rm -f "$DIR/$f"
  fi
done

reapply_overlay() {
  for p in "${PATCHES[@]}"; do g apply "$p" || return 1; done
  for f in "${FILES[@]}"; do
    install -D -o "$AS" -g "$AS" -m 644 "$OVERLAY/files/$f" "$DIR/$f" || return 1
  done
}

DIRTY="$(g status --porcelain)"
if [[ -n "$DIRTY" ]]; then
  reapply_overlay
  say "modifications locales HORS overlay :"
  echo "$DIRTY" | sed 's/^/      /' >&2
  die "à ranger dans $OVERLAY ou à jeter à la main, instance NON touchée"
fi

# ── 4. Mise à jour + overlay reposé ──────────────────────────────────────────
BEFORE="$(g rev-parse --short HEAD)"
if ! g pull -q --ff-only origin main; then
  reapply_overlay
  die "pull --ff-only refusé, overlay reposé sur ${BEFORE}"
fi
[[ "$(g rev-parse HEAD)" == "$TARGET" ]] || { reapply_overlay; die "HEAD ne correspond pas à origin/main après pull"; }
reapply_overlay || die "overlay NON reposé après le pull : NE PAS builder, intervenir à la main"

say "à jour : ${BEFORE} → ${TARGET:0:7} (overlay : ${#FILES[@]} fichier(s), ${#PATCHES[@]} patch(es))"
