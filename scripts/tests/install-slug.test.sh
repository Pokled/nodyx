#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc : le nom <slug>.nodyx.org est vérifié AVANT toute modification.
#
#  Avant le 04/10/2026, en mode relais, un nom déjà pris n'était découvert
#  qu'à l'inscription, le frontend déjà compilé pour lui. L'installeur changeait
#  alors de nom sans recompiler : PUBLIC_API_URL (gravé au build) désignait
#  toujours l'ancien domaine, qui appartient à une AUTRE communauté.
#
#  Le bloc de vérification est extrait tel quel d'install.sh et joué contre un
#  faux curl (l'annuaire) et un faux prompt (l'utilisateur).
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
mkdir -p "$W/bin"

awk 'index($0, "# ── Le nom <slug>.nodyx.org est-il libre ?") == 1 {p=1} $0 == "conf_section \"$(t conf_admin)\"" {exit} p' "$INSTALL" > "$W/block"

# Faux annuaire : la réponse dépend du slug demandé (fichier slug=réponse).
cat > "$W/bin/curl" <<'EOF'
#!/bin/bash
url="${*: -1}"; slug="${url##*/}"
echo "$slug" >> "$DIR/demandes"
r="$(grep -m1 "^$slug=" "$DIR/annuaire" | cut -d= -f2-)"
[[ -n "$r" ]] && printf '%s' "$r" || exit 7
EOF
chmod +x "$W/bin/curl"

PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }

# jouer <relais|auto> <auto-yes> <slug initial> <saisies…>
jouer() {
  local mode="$1" yes="$2" slug="$3"; shift 3
  printf '%s\n' "$@" > "$W/saisies"; : > "$W/demandes"
  GOT="$(PATH="$W/bin:$PATH" DIR="$W" bash -c "
    t() { printf '%s' \"\$1\"; }; info() { :; }; ok() { :; }; warn() { echo \"WARN \$1\"; }; die() { echo \"DIE \$1\"; exit 1; }
    slugify() { echo \"\$1\" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g'; }
    prompt() { local v; v=\"\$(head -1 '$W/saisies')\"; sed -i 1d '$W/saisies'; printf -v \"\$1\" '%s' \"\$v\"; }
    RELAY_MODE=$([[ $mode == relais ]] && echo true || echo false); DOMAIN_IS_AUTO=$([[ $mode == auto ]] && echo true || echo false)
    _AUTO_YES=$yes; COMMUNITY_SLUG='$slug'; DOMAIN='$slug.nodyx.org'
    $(cat "$W/block")
    echo \"FIN slug=\$COMMUNITY_SLUG domaine=\$DOMAIN\"" 2>&1)"; CODE=$?
}

check "bloc de vérification trouvé dans install.sh" '[[ -s "$W/block" ]]'
cat > "$W/annuaire" <<'EOF'
pris={"slug":"pris","available":false,"reason":"taken"}
relay={"slug":"relay","available":false,"reason":"reserved"}
libre={"slug":"libre","available":true}
autre-libre={"slug":"autre-libre","available":true}
EOF

echo "── relais"
jouer relais false libre
check "nom libre : accepté tel quel" '[[ $CODE -eq 0 && "$GOT" == *"FIN slug=libre domaine=libre.nodyx.org"* ]]'
jouer relais false pris "Autre Libre"
check "nom pris : un autre est demandé, puis DOMAINE recalculé avec lui" '[[ $CODE -eq 0 && "$GOT" == *"FIN slug=autre-libre domaine=autre-libre.nodyx.org"* ]]'
check "le nouveau nom est lui aussi vérifié" '[[ "$(cat "$W/demandes" | tr "\n" " ")" == "pris autre-libre " ]]'
jouer relais false relay libre
check "nom réservé (infrastructure) : refusé, un autre est demandé puis vérifié" '[[ "$GOT" == *"FIN slug=libre"* && "$(tr "\n" " " < "$W/demandes")" == "relay libre " ]]'
jouer relais true pris
check "--yes et nom pris : arrêt AVANT toute modification" '[[ $CODE -ne 0 && "$GOT" == *"DIE slug_unavailable_yes"* ]]'
jouer relais false inconnu
check "annuaire injoignable : on continue (revérifié à l'inscription)" '[[ $CODE -eq 0 && "$GOT" == *slug_check_unknown* && "$GOT" == *"FIN slug=inconnu"* ]]'

echo "── mode automatique (sslip.io) : le domaine de l'instance ne change pas"
jouer auto false pris libre
check "nom pris : un autre est demandé, le domaine sslip reste" '[[ "$GOT" == *"FIN slug=libre domaine=pris.nodyx.org"* ]]'

echo "── plus aucun changement de nom APRÈS la compilation"
check "plus de sed sur PUBLIC_API_URL / FRONTEND_URL / ORIGIN après coup" '! grep -qE "sed -i \"s\\|\\^(PUBLIC_API_URL|FRONTEND_URL)=|sed -i \"s\\|ORIGIN:" "$INSTALL"'
check "conflit tardif en relais : arrêt propre (slug_taken_late)" 'grep -qF "die \"\$(printf \"\$(t slug_taken_late)\"" "$INSTALL"'
check "le bilan de santé n'interroge plus la route inexistante /instances/<slug>" '! grep -qF "/instances/\${COMMUNITY_SLUG}" "$INSTALL"'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
