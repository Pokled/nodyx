#!/usr/bin/env bash
# Détecte un service vivant mais muet, et le relance.
#
# Le défaut qu'il corrige, observé le 22/08/2026 : `unattended-upgrade` a
# redémarré PostgreSQL (coupure de 5 secondes). demo-core, sleemstudio-core et
# vieuxlooters-core s'y sont pris juste au mauvais moment pendant leurs
# migrations de démarrage. Leur processus n'a jamais planté : il est resté
# bloqué avant `server.listen()`. PM2 les affichait "online" sans discontinuer,
# rien ne les a jamais relancés. Injoignables pendant près de 5 heures, sans
# la moindre alerte.
#
# ÉLARGI le 12/09/2026 (audit de stabilité, F-042) : ce gardien ne surveillait
# que 4 cœurs Node/PM2, jamais nodyx-frontend, ni nodyx-relay/nodyx-server
# (Rust, systemd, pas PM2) — alors que nodyx-relay porte la promesse « zéro
# port ouvert » (project_promesse_zero_port) : s'il se fige, silencieusement,
# tous les auto-hébergeurs qui en dépendent pour franchir leur NAT perdent
# leur vocal sans que personne ne le sache. Chaque cible porte maintenant son
# TYPE (pm2 ou systemd) pour savoir COMMENT la relancer : `pm2 restart <nom>`
# pour les cœurs Node, `systemctl restart <nom>.service` pour les daemons Rust.
#
# Un `pm2 restart`/`systemctl restart` planifié ne suffit pas : le symptôme
# est spécifique, un processus vivant qui n'écoute plus. On ne redémarre QUE
# ce cas précis, jamais un service qui fonctionne.
#
# Deux passages consécutifs en échec avant d'agir : un redémarrage légitime en
# cours laisse aussi le port muet une poignée de secondes, et ne doit pas
# déclencher une intervention.
set -euo pipefail

ETAT="${VEILLE_ETAT:-/var/backups/nodyx/veille}"
mkdir -p "$ETAT"

# nom = "port:type", en loopback : type pm2 = coeur Node relance par
# `pm2 restart <nom>` ; type systemd = daemon Rust relance par
# `systemctl restart <nom>.service`. Le nom PM2/systemd doit etre exactement
# celui de l'ecosysteme/l'unite (ecosystem.config.js, /etc/systemd/system/*).
declare -A CIBLES=(
  [nodyx-core]="3000:pm2"
  [demo-core]="3001:pm2"
  [sleemstudio-core]="3002:pm2"
  [vieuxlooters-core]="3003:pm2"
  [nodyx-frontend]="5173:pm2"
  [nodyx-relay]="7001:systemd"
  [nodyx-server]="3100:systemd"
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

statut_avant() {
  local nom="$1" type="$2"
  if [ "$type" = "pm2" ]; then
    sudo -u nodyx PM2_HOME=/home/nodyx/.pm2 pm2 jlist 2>/dev/null \
      | python3 -c "
import json, sys
for p in json.load(sys.stdin):
    if p['name'] == '$nom':
        print(f\"statut={p['pm2_env']['status']} redemarrages={p['pm2_env']['restart_time']}\")
        break
" 2>/dev/null || echo "inconnu"
  else
    systemctl show "$nom.service" -p ActiveState -p SubState -p NRestarts 2>/dev/null \
      | tr '\n' ' ' || echo "inconnu"
  fi
}

relancer() {
  local nom="$1" type="$2"
  if [ "$type" = "pm2" ]; then
    sudo -u nodyx PM2_HOME=/home/nodyx/.pm2 pm2 restart "$nom" >/dev/null 2>&1 || true
  else
    systemctl restart "$nom.service" >/dev/null 2>&1 || true
  fi
}

ECHECS_DETECTES=0
for nom in "${!CIBLES[@]}"; do
  cible="${CIBLES[$nom]}"
  port="${cible%%:*}"
  type="${cible##*:}"
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
  echo "  $nom : muet sur le port $port DEPUIS DEUX PASSAGES, relance ($type)"

  STATUT_AVANT=$(statut_avant "$nom" "$type")
  relancer "$nom" "$type"
  rm -f "$FICHIER"

  sleep 5
  if timeout 3 bash -c "</dev/tcp/127.0.0.1/$port" 2>/dev/null; then
    echo "    -> relance reussie, $nom ecoute a nouveau"
    alerter "🔧 $nom relancé automatiquement" \
      "Bloqué sur le port $port sans écouter ($STATUT_AVANT). Relance réussie." 3066993
  else
    echo "    -> ENCORE MUET apres relance, ceci depasse ce script"
    alerter "🚨 $nom injoignable, la relance automatique a échoué" \
      "Toujours muet sur le port $port après relance ($type). Intervention manuelle nécessaire." 15158332
  fi
done

exit 0
