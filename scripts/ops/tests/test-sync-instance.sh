#!/usr/bin/env bash
# Test de sync-instance.sh sur des dépôts jetables (jamais sur /opt).
#   sudo bash scripts/ops/tests/test-sync-instance.sh
# Doit tourner en root : il vérifie aussi la reprise des fichiers root:root.
set -uo pipefail
SYNC="$(cd "$(dirname "$0")/.." && pwd)/sync-instance.sh"
AS="${INSTANCE_USER:-nodyx}"
T="$(sudo -u "$AS" mktemp -d)" && [[ -d "$T" ]] || exit 1; trap 'rm -rf "$T"' EXIT
PASS=0; FAILN=0
check() { if eval "$2"; then echo "  ok   $1"; PASS=$((PASS+1)); else echo "  FAIL $1"; FAILN=$((FAILN+1)); fi; }
u() { sudo -u "$AS" "$@"; }
gi() { u git -C "$1" -c safe.directory="$1" "${@:2}"; }

# origine + instance clonée, overlay (branding + patch qui crée ET modifie)
setup() {
  rm -rf "${T:?}"/*; u mkdir -p "$T/up" "$T/ov/files/static" "$T/ov/patches"
  u git -C "$T/up" init -q -b main
  u bash -c "cd $T/up && mkdir static && printf 'a\nb\nc\n' > layout.svelte && echo generique > static/logo && echo x > autre.txt && echo 1 > VERSION; git add -A && git -c user.email=t@t -c user.name=t commit -qm init"
  u git clone -q "$T/up" "$T/inst"
  echo BRANDING > "$T/ov/files/static/logo"
  u bash -c "cd $T/inst && sed -i 's/^b$/b-proto/' layout.svelte && echo neuf > theme.ts && git add -N theme.ts && git diff > $T/ov/patches/01-proto.patch && git reset -q && git checkout -q -- . && rm theme.ts"
  # état « déployé » : overlay posé
  gi "$T/inst" apply "$T/ov/patches/01-proto.patch"; cp "$T/ov/files/static/logo" "$T/inst/static/logo"; chown "$AS:$AS" "$T/inst/static/logo"
}
upstream() { u bash -c "cd $T/up && $1 && git -c user.email=t@t -c user.name=t commit -qam up"; }
snapshot() { (cd "$T/inst" && git -c safe.directory="$T/inst" rev-parse HEAD; cat static/logo layout.svelte theme.ts 2>&1); }

echo "T0 témoin : l'ancienne méthode (pull seul) échoue sur une instance brandée"
setup; upstream "echo 2 > VERSION && echo nouveau > static/logo"
check "git pull --ff-only refuse" "! gi $T/inst pull -q --ff-only 2>/dev/null"

echo "T1 overlay + main avancé ailleurs : mis à jour, overlay intact"
setup; upstream "echo 2 > VERSION"
check "sortie 0" "INSTANCE_USER=$AS bash $SYNC $T/inst $T/ov >/dev/null 2>&1"
check "HEAD = origin/main" "[[ \$(gi $T/inst rev-parse HEAD) == \$(gi $T/up rev-parse HEAD) ]]"
check "VERSION nouvelle" "[[ \$(cat $T/inst/VERSION) == 2 ]]"
check "branding conservé" "[[ \$(cat $T/inst/static/logo) == BRANDING ]]"
check "patch reposé (modif)" "grep -q b-proto $T/inst/layout.svelte"
check "patch reposé (création)" "[[ -f $T/inst/theme.ts ]]"
check "idempotent (2e passage)" "INSTANCE_USER=$AS bash $SYNC $T/inst $T/ov >/dev/null 2>&1 && grep -q b-proto $T/inst/layout.svelte"

echo "T2 main modifie les lignes du patch : arrêt, instance intacte"
setup; upstream "sed -i 's/^b\$/B-amont/' layout.svelte"; before="$(snapshot)"
check "sortie ≠ 0" "! INSTANCE_USER=$AS bash $SYNC $T/inst $T/ov >/dev/null 2>&1"
check "rien n'a bougé" "[[ \"\$(snapshot)\" == \"\$before\" ]]"
check "pas de worktree orphelin" "[[ \$(gi $T/inst worktree list | wc -l) == 1 ]]"

echo "T3 modif locale hors overlay : arrêt, instance intacte"
setup; upstream "echo 2 > VERSION"; u bash -c "echo bricole >> $T/inst/autre.txt"; before="$(snapshot; cat $T/inst/autre.txt)"
check "sortie ≠ 0" "! INSTANCE_USER=$AS bash $SYNC $T/inst $T/ov >/dev/null 2>&1"
check "rien n'a bougé" "[[ \"\$(snapshot; cat $T/inst/autre.txt)\" == \"\$before\" ]]"

echo "T4 patch retouché à la main : arrêt, instance intacte"
setup; upstream "echo 2 > VERSION"; u bash -c "echo retouche >> $T/inst/theme.ts"; before="$(snapshot)"
check "sortie ≠ 0" "! INSTANCE_USER=$AS bash $SYNC $T/inst $T/ov >/dev/null 2>&1"
check "rien n'a bougé" "[[ \"\$(snapshot)\" == \"\$before\" ]]"

echo "T5 fichier root:root dans l'instance : rendu à $AS, mise à jour passe"
setup; upstream "echo 2 > VERSION"; touch "$T/inst/.git/index"; chown root:root "$T/inst/.git/index" "$T/inst/layout.svelte"
check "sortie 0" "INSTANCE_USER=$AS bash $SYNC $T/inst $T/ov >/dev/null 2>&1"
check "plus aucun fichier root" "[[ \$(find $T/inst -user root | wc -l) == 0 ]]"

echo "T6 sans overlay, arbre propre : simple pull"
setup; gi "$T/inst" apply -R "$T/ov/patches/01-proto.patch"; gi "$T/inst" checkout -q -- static/logo; upstream "echo 2 > VERSION"
check "sortie 0" "INSTANCE_USER=$AS bash $SYNC $T/inst $T/vide >/dev/null 2>&1"
check "VERSION nouvelle" "[[ \$(cat $T/inst/VERSION) == 2 ]]"

echo; echo "$PASS réussi(s), $FAILN échec(s)"; [[ $FAILN == 0 ]]
