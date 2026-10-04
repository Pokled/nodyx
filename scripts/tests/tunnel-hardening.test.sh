#!/usr/bin/env bash
# Variables lues dans les conditions passées à check (eval).
# shellcheck disable=SC2034
# ═══════════════════════════════════════════════════════════════════════════════
#  Banc du durcissement d'install_tunnel.sh (04/10/2026), défauts trouvés à la
#  lecture complète du script :
#   - le core écoutait sur 0.0.0.0 (API publiée, Caddy contourné) ;
#   - Node 20 installé alors que le vocal exige Node >= 22 ;
#   - _confirm : toute réponse autre que n/no/non valait OUI ;
#   - mot de passe admin d'un seul caractère accepté, sans confirmation ;
#   - slug non nettoyé, --domain ni normalisé ni validé ;
#   - pg_dropcluster sur l'emplacement par défaut seulement ;
#   - --wipe effaçait la base même si la sauvegarde avait échoué ;
#   - cloudflared arm64 : .deb « latest » installé en root sans vérification ;
#     jeton du tunnel lisible par tous dans l'unité systemd.
#  Les fonctions et blocs sont extraits tels quels et EXÉCUTÉS.
# ═══════════════════════════════════════════════════════════════════════════════
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
INSTALL="${INSTALL_SH:-$ROOT/install.sh}"
TUNNEL="${INSTALL_TUNNEL_SH:-$ROOT/install_tunnel.sh}"
W="$(mktemp -d)"; trap 'rm -rf "$W"' EXIT
PASS=0; FAIL=0
check() { if eval "$2"; then PASS=$((PASS+1)); echo "  ✔ $1"; else FAIL=$((FAIL+1)); echo "  ✘ $1"; echo "      reçu : ${GOT:-}"; fi; }
fn() { awk -v f="$2() {" '$0 == f {p=1} p {print} p && $0 == "}" {exit}' "$1"; }
# block <fichier> <première ligne exacte> <dernière ligne exacte> : bloc en ligne.
block() { awk -v a="$2" -v b="$3" '$0 == a {p=1} p {print} p && $0 == b {exit}' "$1"; }

echo "── copies identiques à install.sh"
fn "$INSTALL" _confirm > "$W/c.i"; fn "$TUNNEL" _confirm > "$W/c.t"
check "_confirm identique (la version robuste)" '[[ -s "$W/c.i" ]] && cmp -s "$W/c.i" "$W/c.t"'
fn "$INSTALL" _pg_datadir > "$W/p.i"; fn "$TUNNEL" _pg_datadir > "$W/p.t"
check "_pg_datadir identique" '[[ -s "$W/p.i" ]] && cmp -s "$W/p.i" "$W/p.t"'
check "_confirm voit --yes (AUTO_YES relayé à _AUTO_YES)" 'grep -qF -- "--yes|-y)               AUTO_YES=true; _AUTO_YES=true ;;" "$TUNNEL"'

echo "── le core n'écoute qu'en boucle locale"
check "installation neuve : HOST=127.0.0.1" 'grep -qx "HOST=127.0.0.1" "$TUNNEL" && ! grep -qx "HOST=0.0.0.0" "$TUNNEL"'
printf 'PORT=3000\nHOST=0.0.0.0\nNODE_ENV=production\n' > "$W/env"
sed -i 's/^HOST=0\.0\.0\.0$/HOST=127.0.0.1/' "$W/env"   # la commande de la mise à jour, vérifiée ci-dessous
check "mise à jour : la migration 0.0.0.0 → 127.0.0.1 est présente et fonctionne" 'grep -qF "sed -i '"'"'s/^HOST=0\\.0\\.0\\.0\$/HOST=127.0.0.1/'"'"'" "$TUNNEL" && grep -qx "HOST=127.0.0.1" "$W/env"'

echo "── Node.js"
check "Node 22 dans les deux installeurs, plus jamais Node 20" 'grep -q "setup_22.x" "$TUNNEL" && grep -q "setup_22.x" "$INSTALL" && ! grep -q "setup_20.x" "$TUNNEL"'
check "refus explicite si Node reste < 22 après installation" 'grep -q "Nodyx needs Node >= 22" "$TUNNEL"'

echo "── mot de passe administrateur"
block "$TUNNEL" 'if [[ -n "$ADMIN_PASS_FLAG" ]]; then' 'fi' > "$W/pw"
pw() { # <option> <saisies…>
  local flag="$1"; shift; printf '%s\n' "$@" > "$W/saisies"
  GOT="$(bash -c "
    die() { echo \"DIE \$*\"; exit 1; }; warn() { echo \"WARN \$*\"; }; t() { printf '%s' \"\$1\"; }
    prompt_secret() { local v; v=\"\$(head -1 '$W/saisies')\"; sed -i 1d '$W/saisies'; printf -v \"\$1\" '%s' \"\$v\"; }
    ADMIN_PASS_FLAG='$flag'
    $(cat "$W/pw")
    echo \"FIN \$ADMIN_PASSWORD\"" 2>&1)"; CODE=$?
}
pw "" court "MotDePasse1" "MotDePasse1"
check "trop court : redemandé" '[[ "$GOT" == *"At least 8"* && "$GOT" == *"FIN MotDePasse1"* ]]'
pw "" "MotDePasse1" "Different22" "MotDePasse1" "MotDePasse1"
check "confirmation différente : redemandé" '[[ "$GOT" == *"do not match"* && "$GOT" == *"FIN MotDePasse1"* ]]'
pw "abc"
check "--admin-password trop court : refusé" '[[ $CODE -ne 0 && "$GOT" == *"at least 8"* ]]'

echo "── slug et domaine"
grep -E '^_valid_domain\(\) \{' "$TUNNEL" > "$W/d"   # fonction sur une ligne
for ok in communaute.example.org a-b.c.fr x1.io; do
  bash -c "$(cat "$W/d"); _valid_domain '$ok'"; c=$?
  check "domaine valide accepté : $ok" '[[ $c -eq 0 ]]'
done
for bad in "localhost" "evil.org'; x" "a b.org" "-x.org" 'x.org/chemin' '$(id).org'; do
  bash -c "$(cat "$W/d"); _valid_domain \"\$1\"" _ "$bad"; c=$?
  check "domaine refusé : $bad" '[[ $c -ne 0 ]]'
done
check "--domain passe par la même validation" 'grep -qF "_valid_domain \"\$DOMAIN\" || die" "$TUNNEL"'
check "slug toujours nettoyé (slugify) puis vérifié" 'grep -qF "COMMUNITY_SLUG=\"\$(slugify \"\$COMMUNITY_SLUG\")\"" "$TUNNEL"'

echo "── sauvegarde et effacement"
fn "$TUNNEL" _auto_backup_db > "$W/bk"
backup() { # <contenu du dump simulé>
  printf '%s' "$1" > "$W/dump"; mkdir -p "$W/bin"
  printf '#!/bin/bash\ncat "%s"\n' "$W/dump" > "$W/bin/runuser"; chmod +x "$W/bin/runuser"
  GOT="$(PATH="$W/bin:$PATH" bash -c "
    t() { printf '%s' \"\$1\"; }; warn() { echo \"WARN \$*\"; }; CYAN=''; GREEN=''; RESET=''; DB_NAME=nodyx
    $(sed "s#/var/backups/nodyx#$W/backups#" "$W/bk")
    _auto_backup_db wipe; echo \"OK=\${_AUTO_BACKUP_OK:-false}\"" 2>&1)"
}
backup $'-- PostgreSQL database dump\nCREATE TABLE x();\n-- PostgreSQL database dump complete\n'
check "dump complet : sauvegarde validée" '[[ "$GOT" == *"OK=true"* ]]'
backup $'-- PostgreSQL database dump\nCREATE TABLE x();\nINSERT INTO x VALUES (1'
check "dump TRONQUÉ (non vide) : sauvegarde NON validée" '[[ "$GOT" == *"OK=false"* ]]'
check "--wipe refusé tant que la sauvegarde n'est pas validée" 'grep -qF "wipe CANCELLED, nothing was deleted" "$TUNNEL"'

echo "── cloudflared"
check "plus aucun .deb « latest » installé sans vérification" '! grep -q "releases/latest/download/cloudflared" "$TUNNEL"'
check "dépôt APT signé pour toutes les architectures" 'grep -q "signed-by=/usr/share/keyrings/cloudflare-main.gpg" "$TUNNEL" && ! grep -q "CF_ARCH\" == \"amd64\"" "$TUNNEL"'
check "jeton jamais passé à cloudflared en argument (cf install-noninteractive.test.sh)" '! grep -vE "^[[:space:]]*#" "$TUNNEL" | grep -qE "cloudflared service install|--token \\\$"'

echo ""
echo "Résultat : $PASS réussis, $FAIL échoués"
[[ $FAIL -eq 0 ]]
