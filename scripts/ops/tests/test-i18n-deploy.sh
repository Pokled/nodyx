#!/usr/bin/env bash
# Banc de scripts/ops/i18n-deploy.sh, sur un frontend jetable (jamais /var/www/nexus).
#   bash scripts/ops/tests/test-i18n-deploy.sh
# `npm` est remplacé par un faux qui « construit » en un instant, ou échoue à la
# demande (FAUX_ECHEC=1, FAUX_SANS_INDEX=1) : on teste la mécanique, pas Vite.
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
set -uo pipefail
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/i18n-deploy.sh"
T="$(mktemp -d)" && [[ -d "$T" ]] || exit 1; trap 'rm -rf "$T"' EXIT
PASS=0; FAILN=0
check() { if eval "$2"; then echo "  ok   $1"; PASS=$((PASS+1)); else echo "  FAIL $1"; FAILN=$((FAILN+1)); fi; }

F="$T/repo/nodyx-frontend"
mkdir -p "$T/bin" "$F"
cat > "$T/bin/npm" <<'NPM'
#!/usr/bin/env bash
echo "$*" >> "$JOURNAL"
case "$1" in
  ci)  mkdir -p node_modules ;;
  run) [[ "${FAUX_ECHEC:-}" == 1 ]] && exit 1
       mkdir -p "$NODYX_BUILD_OUT"
       [[ "${FAUX_SANS_INDEX:-}" == 1 ]] || echo "version" > "$NODYX_BUILD_OUT/index.js" ;;
esac
NPM
chmod +x "$T/bin/npm"
git -C "$T/repo" init -q -b main
echo '{"lock":1}' > "$F/package-lock.json"
git -C "$T/repo" add -A && git -C "$T/repo" -c user.email=t@t -c user.name=t commit -qm init
export JOURNAL="$T/npm.log" NODYX_RESTART_CMD="echo redemarre >> $T/restart.log"
lance() { PATH="$T/bin:$PATH" bash "$SCRIPT" "$F" >/dev/null 2>&1; }
nb() { grep -c "^$1" "$JOURNAL" 2>/dev/null || true; }
redemarrages() { wc -l < "$T/restart.log" 2>/dev/null || echo 0; }
cible() { readlink "$F/build"; }

echo "T1 premier passage, depuis l'ancien état (build = vrai dossier servi)"
mkdir -p "$F/build" && echo ancien > "$F/build/index.js"
check "sortie 0" "lance"
check "build est maintenant un lien" "[[ -L $F/build ]]"
check "le lien vise une version neuve complète" "[[ \$(cible) == .builds/*-* && -f $F/\$(cible)/index.js ]]"
check "l'ancien dossier est rangé, pas détruit" "grep -q ancien $F/.builds/avant-liens-*/index.js"
check "npm ci une fois (pas d'empreinte)" "[[ \$(nb ci) == 1 ]]"
check "redémarré une fois" "[[ \$(redemarrages) == 1 ]]"
V1="$(cible)"

echo "T2 dépendances inchangées : pas de npm ci, nouvelle version servie"
sleep 1
check "sortie 0" "lance"
check "npm ci toujours une seule fois" "[[ \$(nb ci) == 1 ]]"
check "le lien a changé de version" "[[ \$(cible) != $V1 && -f $F/\$(cible)/index.js ]]"
check "redémarré deux fois" "[[ \$(redemarrages) == 2 ]]"

echo "T3 package-lock.json change : npm ci relancé"
echo '{"lock":2}' > "$F/package-lock.json"; sleep 1
check "sortie 0" "lance"
check "npm ci deux fois" "[[ \$(nb ci) == 2 ]]"

echo "T4 construction en échec : le site garde sa version, pas de redémarrage"
V3="$(cible)"; avant="$(ls -1d "$F"/.builds/*/ | wc -l)"; sleep 1
check "sortie en erreur" "! FAUX_ECHEC=1 lance"
check "le lien n'a pas bougé" "[[ \$(cible) == $V3 ]]"
check "aucune version à moitié laissée" "[[ \$(ls -1d $F/.builds/*/ | wc -l) == $avant ]]"
check "pas de redémarrage" "[[ \$(redemarrages) == 3 ]]"

echo "T5 construction qui « réussit » sans index.js : traitée comme un échec"
sleep 1
check "sortie en erreur" "! FAUX_SANS_INDEX=1 lance"
check "le lien n'a pas bougé" "[[ \$(cible) == $V3 ]]"
check "pas de redémarrage" "[[ \$(redemarrages) == 3 ]]"

echo "T6 ménage : trois versions gardées au plus, dont celle servie"
for _ in 1 2 3; do sleep 1; lance; done
check "au plus trois dossiers dans .builds" "[[ \$(ls -1d $F/.builds/*/ | wc -l) -le 3 ]]"
check "la version servie existe" "[[ -f $F/\$(cible)/index.js ]]"

echo
echo "$PASS ok, $FAILN en échec"
[[ $FAILN -eq 0 ]]
