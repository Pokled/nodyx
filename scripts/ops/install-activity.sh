#!/usr/bin/env bash
# Installe (ou met a jour) une activite d'extension sur CETTE instance, depuis
# un paquet .nyx local. Enchaine : installExtension -> chown -> purge des
# anciennes versions -> verification HTTP.
#
#   sudo bash /var/www/nexus/scripts/ops/install-activity.sh [chemin/vers/x.nyx]
#
# Sans argument : prend le .nyx le plus recent de /opt/nodyx-battle/dist/.
#
# Le bundle applicatif (le gros zip wasm) est recupere par nodyx-core depuis
# manifest.app.url (release GitHub), empreinte verifiee. Il faut donc que la
# release soit publiee AVANT (cf tools/release.sh cote jeu).
set -euo pipefail

CORE="/var/www/nexus/nodyx-core"
GAME_DIST="/opt/nodyx-battle/dist"
BASE_URL="${BASE_URL:-https://nodyx.org}"

NYX="${1:-}"
if [ -z "$NYX" ]; then
	NYX="$(ls -t "$GAME_DIST"/*.nyx 2>/dev/null | head -1 || true)"
fi
[ -n "$NYX" ] && [ -f "$NYX" ] || { echo "!! .nyx introuvable (arg ou $GAME_DIST/*.nyx)"; exit 1; }
echo "── paquet : $NYX ──"

cd "$CORE"
# dotenvx bavarde sur stdout : on ne garde que la ligne JSON (prefixe __RESULT__).
RESULT="$(node -e '
const { readFileSync } = require("fs");
const { installExtension } = require("./dist/extensions/installer.js");
const { db } = require("./dist/config/database.js");
(async () => {
  const res = await installExtension(
    { archive: readFileSync(process.argv[1]), origin: "file", installedBy: null },
    { query: (s, p) => db.query(s, p) },
  );
  if (!res.ok) { console.error("ISSUES " + JSON.stringify(res.issues)); process.exit(1); }
  console.log("__RESULT__" + JSON.stringify(res.result));
  process.exit(0);
})();
' "$NYX" | sed -n 's/^__RESULT__//p')"
[ -n "$RESULT" ] || { echo "!! installation echouee (voir ci-dessus)"; exit 1; }

ID="$(echo "$RESULT" | python3 -c "import json,sys;r=json.load(sys.stdin);print(r['id'])")"
VER="$(echo "$RESULT" | python3 -c "import json,sys;r=json.load(sys.stdin);print(r['version'])")"
GRANTS="$(echo "$RESULT" | python3 -c "import json,sys;print(','.join(json.load(sys.stdin)['granted']))")"
echo "  installe : $ID $VER"
echo "  accorde  : $GRANTS"

DIR="$CORE/uploads/extensions/$ID"
chown -R nodyx:nodyx "$DIR"

# Purge des versions autres que celle qu'on vient de poser.
for d in "$DIR"/*/; do
	v="$(basename "$d")"
	if [ "$v" != "$VER" ]; then
		rm -rf "$d"
		echo "  purge    : $v"
	fi
done

# Verification : l'instance sert bien le bundle de la nouvelle version.
ENTRY="$(curl -s "$BASE_URL/api/v1/extensions/public" | python3 -c "
import json,sys
for e in json.load(sys.stdin).get('extensions', []):
    for s in e.get('surfaces', []):
        if s.get('type') == 'activity' and s.get('id'):
            print(s.get('appUrl',''))
" | head -1)"
CODE="$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL$ENTRY" || echo 000)"
echo "  HTTP     : $CODE  $ENTRY"
[ "$CODE" = "200" ] || { echo "!! le bundle ne repond pas 200"; exit 1; }

echo "✔ $ID $VER en ligne. Recharger $BASE_URL/chat (le ?v= casse le cache)."
