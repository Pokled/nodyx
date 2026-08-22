#!/usr/bin/env bash
# Détecte un cœur PM2 vivant mais muet, et le relance.
#
# Le défaut qu'il corrige, observé le 22/08/2026 : `unattended-upgrade` a
# redémarré PostgreSQL (coupure de 5 secondes). demo-core, sleemstudio-core et
# vieuxlooters-core s'y sont pris juste au mauvais moment pendant leurs
# migrations de démarrage. Leur processus n'a jamais planté : il est resté
# bloqué avant `server.listen()`. PM2 les affichait "online" sans discontinuer,
# rien ne les a jamais relancés. Injoignables pendant près de 5 heures, sans
# la moindre alerte.
#
# Un `pm2 restart` planifié ne suffit pas : le symptôme est spécifique, un
# processus vivant qui n'écoute plus. On ne redémarre QUE ce cas précis, jamais
# une instance qui fonctionne.
#
# Deux passages consécutifs en échec avant d'agir : un redémarrage légitime en
# cours laisse aussi le port muet une poignée de secondes, et ne doit pas
# déclencher une intervention.
set -euo pipefail

ETAT="${VEILLE_ETAT:-/var/backups/nodyx/veille}"
mkdir -p "$ETAT"

# name pm2 = port a verifier, en loopback : ce sont les quatre coeurs durcis le
# 20/08/2026, injoignables depuis l'exterieur mais tous locaux a cette machine.
declare -A CIBLES=(
  [nodyx-core]=3000
  [demo-core]=3001
  [sleemstudio-core]=3002
  [vieuxlooters-core]=3003
)

alerter() {
  local titre="$1" description="$2" couleur="$3"
  local url="${SECURITY_DISCORD_WEBHOOK:-}"
  # Lu depuis le .env du coeur principal : c'est deja le canal des alertes de
  # securite existantes (src/routes/auth.ts), on n'en cree pas un second.
  [ -z "$url" ] && url=$(grep -h '^SECURITY_DISCORD_WEBHOOK=' /var/www/nexus/nodyx-core/.env 2>/dev/null | cut -d= -f2-)
  [ -z "$url" ] && return 0
  curl -sf -m 8 -X POST "$url" -H 'Content-Type: application/json' \
    -d "$(python3 -c "
import json, sys
print(json.dumps({'embeds': [{'title': sys.argv[1], 'description': sys.argv[2], 'color': int(sys.argv[3])}]}))
" "$titre" "$description" "$couleur")" \
    >/dev/null 2>&1 || true
}

ECHECS_DETECTES=0
for nom in "${!CIBLES[@]}"; do
  port="${CIBLES[$nom]}"
  FICHIER="$ETAT/$nom.echecs"

  if timeout 3 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null; then
    # Vivant et joignable : on efface tout historique d'echec.
    rm -f "$FICHIER"
    continue
  fi

  # Muet. Est-ce la premiere fois, ou la seconde de suite ?
  N=0
  [ -f "$FICHIER" ] && N=$(cat "$FICHIER" 2>/dev/null || echo 0)
  N=$((N + 1))
  echo "$N" > "$FICHIER"

  if [ "$N" -lt 2 ]; then
    echo "  $nom : muet sur le port $port (1er constat, on attend confirmation)"
    continue
  fi

  ECHECS_DETECTES=$((ECHECS_DETECTES + 1))
  echo "  $nom : muet sur le port $port DEPUIS DEUX PASSAGES, relance"

  STATUT_AVANT=$(sudo -u nodyx PM2_HOME=/home/nodyx/.pm2 pm2 jlist 2>/dev/null \
    | python3 -c "
import json, sys
for p in json.load(sys.stdin):
    if p['name'] == '$nom':
        print(f\"statut={p['pm2_env']['status']} redemarrages={p['pm2_env']['restart_time']}\")
        break
" 2>/dev/null || echo "inconnu")

  sudo -u nodyx PM2_HOME=/home/nodyx/.pm2 pm2 restart "$nom" >/dev/null 2>&1 || true
  rm -f "$FICHIER"

  sleep 5
  if timeout 3 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null; then
    echo "    -> relance reussie, $nom ecoute a nouveau"
    alerter "🔧 $nom relancé automatiquement" \
      "Bloqué sur le port $port sans écouter ($STATUT_AVANT). Relance réussie." 3066993
  else
    echo "    -> ENCORE MUET apres relance, ceci depasse ce script"
    alerter "🚨 $nom injoignable, la relance automatique a échoué" \
      "Toujours muet sur le port $port après \`pm2 restart\`. Intervention manuelle nécessaire." 15158332
  fi
done

exit 0
