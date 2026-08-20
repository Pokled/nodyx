#!/usr/bin/env bash
# Remet les règles ufw telles qu'elles étaient avant une consolidation.
#
# Le pare-feu est la seule chose qui se trompe sans prévenir et coupe l'accès
# administratif en même temps que le reste. Ce retour arrière existe pour être
# lancé sans réfléchir.
#
#   ufw-restaurer.sh            restaure la sauvegarde la plus récente
#   ufw-restaurer.sh <fichier>  restaure celle-là, en donnant le fichier v4
set -euo pipefail

SAUVE="${UFW_SAUVE:-/var/backups/nodyx/durcir}"

V4="${1:-$(ls -1t "$SAUVE"/ufw-user.rules.avant-* 2>/dev/null | head -1)}"
if [ -z "$V4" ] || [ ! -f "$V4" ]; then
  echo "  Aucune sauvegarde de règles trouvée dans $SAUVE" >&2
  ls -1t "$SAUVE"/ufw-user*.rules.avant-* 2>/dev/null | head -5 | sed 's/^/    /' >&2
  exit 1
fi
V6="${V4/ufw-user.rules/ufw-user6.rules}"

echo "  v4 : $V4"
echo "  v6 : $V6"
[ -f "$V6" ] || { echo "  La sauvegarde v6 correspondante manque, on n'en restaure aucune." >&2; exit 1; }

# Une restauration qui laisserait tomber SSH transformerait un incident en perte
# d'accès. On refuse plutôt que de le découvrir après.
if ! grep -q 'dport 22' "$V4"; then
  echo "  ARRET : la sauvegarde v4 ne contient aucune règle pour le port 22." >&2
  echo "          La restaurer couperait l'accès administratif." >&2
  exit 1
fi

cp -a /etc/ufw/user.rules  "$SAUVE/ufw-user.rules.remplacee-$(date -u +%Y%m%dT%H%M%SZ)"
cp -a /etc/ufw/user6.rules "$SAUVE/ufw-user6.rules.remplacee-$(date -u +%Y%m%dT%H%M%SZ)"

install -m 640 -o root -g root "$V4" /etc/ufw/user.rules
install -m 640 -o root -g root "$V6" /etc/ufw/user6.rules
ufw reload >/dev/null

echo "  Restauré."
echo
ufw status numbered 2>/dev/null | sed 's/^/  /'
