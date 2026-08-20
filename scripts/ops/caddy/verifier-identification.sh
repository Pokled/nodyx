#!/usr/bin/env bash
# Un visiteur légitime est-il encore identifié par sa vraie adresse ?
#
# `verifier.sh` regarde des codes de retour. Il ne verrait PAS la panne que ce
# contrôle cherche : un filtre trop large qui retirerait `CF-Connecting-IP` au
# trafic Cloudflare lui-même. Le site répondrait 200 partout, et tous les
# visiteurs de la Terre se retrouveraient dans le même seau de limitation, sous
# `127.0.0.1`. Panne silencieuse, exactement celle du 8 août 2026.
#
# Méthode : on se comporte en vrai visiteur, on sort par Cloudflare et on
# revient, puis on vérifie que le coeur nous a rangés sous NOTRE adresse
# publique et non sous du loopback.
set -euo pipefail

CIBLE="${CIBLE:-https://nodyx.org/api/v1/instance/info}"

echo "--- adresses publiques de cette machine ---"
V4=$(curl -s -m 8 https://api.ipify.org 2>/dev/null || echo "")
V6=$(curl -s -m 8 https://api64.ipify.org 2>/dev/null || echo "")
echo "  v4 : ${V4:-indisponible}"
echo "  v6 : ${V6:-indisponible}"

if [ -z "$V4" ] && [ -z "$V6" ]; then
  echo "  Impossible de connaître notre propre adresse, contrôle non concluant." >&2
  exit 2
fi

echo "--- appel légitime, par Cloudflare ---"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -m 15 "$CIBLE" 2>/dev/null || echo 000)
echo "  $CIBLE -> HTTP $CODE"
if [ "$CODE" = "000" ]; then
  echo "  Aucune réponse : le contrôle ne peut rien conclure." >&2
  exit 2
fi

sleep 1

echo "--- sous quelle adresse le coeur nous a-t-il rangés ? ---"
TROUVE=""
for ip in "$V6" "$V4"; do
  [ -z "$ip" ] && continue
  if [ "$(redis-cli EXISTS "nodyx:rate:$ip" 2>/dev/null)" = "1" ]; then
    TROUVE="$ip"
    break
  fi
done

echo
if [ -n "$TROUVE" ]; then
  echo "VERDICT : identifié sous $TROUVE, l'identification des visiteurs est intacte"
  exit 0
fi

echo "VERDICT : AUCUNE clé pour notre adresse publique."
echo "          Les visiteurs sont probablement tous rangés sous 127.0.0.1."
echo "          Faire machine arrière : $(dirname "$0")/annuler-filtre-entetes.sh"
exit 1
