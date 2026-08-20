#!/usr/bin/env bash
# Retire le filtre des en-têtes de transfert.
#
# La route est retrouvée par son CONTENU, jamais par un index noté quelque part :
# entre la pose et l'annulation, une autre opération a pu décaler les routes, et
# supprimer l'index 0 par habitude reviendrait à supprimer ce qui s'y trouve
# maintenant.
#
# Attention à ce que cette annulation rouvre : sans ce filtre, n'importe qui
# atteignant l'origine sur 443 peut se faire passer pour l'adresse de son choix,
# et contourner aussi bien le bannissement du relais que la limitation de débit
# de l'API. À n'annuler que si le filtre casse quelque chose de pire.
set -euo pipefail

API="${CADDY_API:-http://localhost:2019}"
TEMOIN=CF-Connecting-IP

INDEX=$(curl -sf -m 15 "$API/config/apps/http/servers/srv1/routes" | python3 -c "
import json, sys
routes = json.load(sys.stdin)
trouves = []
for i, r in enumerate(routes):
    for h in r.get('handle', []):
        if h.get('handler') == 'headers':
            if '$TEMOIN' in (h.get('request', {}).get('delete') or []):
                trouves.append(i)
                break
if len(trouves) != 1:
    sys.exit(f'{len(trouves)}')
print(trouves[0])
") || {
  echo "  Aucune route unique de filtrage des en-tetes. Rien annule." >&2
  echo "  Inspecter : curl -s $API/config/apps/http/servers/srv1/routes | python3 -m json.tool" >&2
  exit 1
}

echo "  Filtre trouve a l'index $INDEX"
curl -sf -X DELETE "$API/config/apps/http/servers/srv1/routes/$INDEX" \
  && echo "  Retire. L'usurpation d'adresse redevient possible depuis l'origine." \
  || { echo "  ECHEC de la suppression, configuration intacte" >&2; exit 1; }

echo
"$(dirname "$0")/verifier.sh" || true
