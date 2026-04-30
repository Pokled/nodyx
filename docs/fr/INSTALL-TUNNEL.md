# 🌐 Nodyx — Guide d'installation Tunnel

> **TL;DR** Serveur derrière du NAT (homelab, RPi, LXC) sans IP publique ? `install_tunnel.sh` configure Caddy + le reste de la stack pour qu'un tunnel inverse pointe dessus. Trois modes : **Cloudflare Tunnel**, **Pangolin/newt**, ou **custom** (frp, rathole, headscale, ton propre proxy VPS). Aucun forwarding port 80/443 nécessaire. ☕

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash
```

---

## Sommaire

- [Quand utiliser cet installeur](#-quand-utiliser-cet-installeur)
- [Choisir son mode](#-choisir-son-mode)
- [Mode A — Cloudflare Tunnel](#-mode-a-cloudflare-tunnel)
- [Mode B — Pangolin (newt)](#-mode-b-pangolin-newt)
- [Mode C — Tunnel custom](#-mode-c-tunnel-custom)
- [Dépannage](#-dépannage)
- [Ce que l'installeur durcit](#-ce-que-linstalleur-durcit)
- [Re-run, upgrade, repair](#-re-run-upgrade-repair)

---

## 🎯 Quand utiliser cet installeur

Utilise `install_tunnel.sh` si **au moins une** de ces conditions est vraie :

- Ton serveur n'a pas d'IPv4 publique (CGNAT, derrière une box résidentielle)
- Tu ne peux pas / ne veux pas ouvrir les ports 80/443
- Tu veux que le TLS termine ailleurs (Cloudflare, ton VPS)
- Tu héberges sur un RPi, un LXC, ou derrière un firewall corporate

Si ton serveur a une IP publique et tu peux ouvrir les ports 80/443, utilise plutôt [`install.sh`](INSTALL.md). Il fait le Let's Encrypt lui-même, c'est une pièce mobile en moins.

---

## 🧭 Choisir son mode

| Ta situation | Mode | Pourquoi |
|---|---|---|
| Tu utilises déjà Cloudflare DNS | **CF** | Le plus simple. cloudflared tourne sur ton serveur, ouvre un tunnel sortant vers le edge Cloudflare, TLS termine là-bas |
| Tu auto-héberges un VPS Pangolin | **Pangolin** | Tout reste chez toi. Utilise un container Docker `newt` comme client de tunnel |
| Tu as ton propre tunnel inverse (frp, rathole, headscale, ...) | **None** | Caddy écoute sur `127.0.0.1:80`, branche ton client dessus à la main |

Tu n'as pas à décider avant de lancer le script — il pose la question et explique les arbitrages.

---

## 🌩 Mode A — Cloudflare Tunnel

**Prérequis**

- Un domaine sur les nameservers Cloudflare
- Un token d'installation Cloudflare Tunnel (depuis `https://one.dash.cloudflare.com → Networks → Tunnels`)

**Étapes**

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash
# Choix : 1 (Cloudflare Tunnel)
# Colle ton token quand demandé.
```

**Après l'install** — dans ton dashboard Cloudflare :

1. Ouvre ton tunnel → **Public Hostname** → **Add**
2. Subdomain : vide | Domain : `ton-domaine.com` | Service : `HTTP` | URL : `localhost:80`
3. Save. Visite `https://ton-domaine.com`. ✅

**Voix/UDP** Voix et webcam utilisent les serveurs STUN publics : Cloudflare Tunnel ne transporte pas l'UDP. Si tu veux du TURN auto-hébergé, voir la doc [RELAY](RELAY.md).

---

## 🦔 Mode B — Pangolin (newt)

C'est le mode qui a piégé le plus d'admins (voir [discussion #23](https://github.com/Pokled/nodyx/discussions/23)). Le script gère ça proprement maintenant, mais comprendre la topologie aide.

### Deux façons de lancer newt

```
                 ╔══════════════════════════════════════════════════╗
                 ║  Méthode A — newt en --network host (RECOMMANDÉ) ║
                 ╚══════════════════════════════════════════════════╝

   ┌─────────────────────────────────────┐         ┌──────────────┐
   │  Ton serveur (LXC / VM / metal)     │         │   Internet   │
   │                                      │         │              │
   │   ┌──────────┐         ┌──────────┐ │  HTTPS  │  Pangolin    │
   │   │  Caddy   │ ◄─loop─ │   newt   │ ┼────────►│   VPS        │
   │   │  :80     │         │ (host    │ │  +TLS   │              │
   │   │          │         │  netns)  │ │         │              │
   │   └──────────┘         └──────────┘ │         └──────────────┘
   │                                      │
   └─────────────────────────────────────┘

   newt partage le netns de l'hôte.
   "localhost" dans newt == l'hôte. Caddy joignable sur 127.0.0.1:80.
   Cible Pangolin → http://localhost:80
```

```
                 ╔════════════════════════════════════════════╗
                 ║  Méthode B — newt en bridge Docker (défaut)║
                 ╚════════════════════════════════════════════╝

   ┌─────────────────────────────────────┐         ┌──────────────┐
   │  Ton serveur                         │         │   Internet   │
   │                                      │         │              │
   │   ┌──────────┐                      │         │              │
   │   │  Caddy   │ ◄── 192.168.X.Y:80 ──┼─┐ HTTPS │  Pangolin    │
   │   │ 127.0.0.1│                      │ │       │   VPS        │
   │   │ +IP LAN  │       ┌──────────┐   │ │+TLS   │              │
   │   └──────────┘       │   newt   │ ──┼─┘──────►│              │
   │                       │ (bridge  │   │       │              │
   │                       │  172.X)  │   │       │              │
   │                       └──────────┘   │       └──────────────┘
   └─────────────────────────────────────┘

   newt est dans son propre netns. "localhost" dans newt = newt, PAS l'hôte.
   newt doit atteindre Caddy via l'IP LAN du host.
   Cible Pangolin → http://<IP-LAN-du-host>:80
```

### Pourquoi les deux méthodes marchent

L'installeur bind Caddy **à la fois** sur `127.0.0.1:80` ET sur l'IP LAN principale du host (auto-détectée). Tu choisis la méthode qui colle à ta config ; la cible dans Pangolin change en conséquence.

> 💡 **La méthode A est préférée** car elle ne dépend pas de la stabilité de l'IP LAN. Si ton bail DHCP change, la méthode B doit être re-pointée dans Pangolin.

### Méthode A — `--network host`

```bash
docker run -d --name newt --network host --restart unless-stopped \
  -e PANGOLIN_ENDPOINT=https://ton-pangolin.example.com \
  -e NEWT_ID=ton_newt_id \
  -e NEWT_SECRET=ton_newt_secret \
  fosrl/newt:latest
```

Pangolin → ressource HTTP → `ton-domaine.com → http://localhost:80`

### Méthode B — bridge par défaut

```bash
docker run -d --name newt --restart unless-stopped \
  -e PANGOLIN_ENDPOINT=https://ton-pangolin.example.com \
  -e NEWT_ID=ton_newt_id \
  -e NEWT_SECRET=ton_newt_secret \
  fosrl/newt:latest
```

Pangolin → ressource HTTP → `ton-domaine.com → http://<IP-LAN-du-host>:80`

L'installeur affiche l'IP LAN auto-détectée à la fin de l'install. Tu peux aussi la voir via `ip -4 route get 1.1.1.1`.

### Test de connectivité avant la mise en prod

```bash
# Méthode A
docker exec newt wget -qO- http://localhost/api/v1/instance/info

# Méthode B (remplace l'IP)
docker exec newt wget -qO- http://192.168.1.42/api/v1/instance/info
```

Une réponse JSON décrivant ton instance = newt atteint Caddy. Sinon → [Dépannage](#-dépannage).

**Voix/UDP** Pangolin peut transporter l'UDP via les "raw resources" — voir la doc Pangolin. Sans ça, voix retombe sur les STUN publics.

---

## 🔧 Mode C — Tunnel custom

Caddy écoute sur `127.0.0.1:80` et fait confiance au `X-Forwarded-For` venu des ranges loopback / RFC1918. Branche n'importe lequel de ces clients dessus :

- `frp` (frpc)
- `rathole`
- `headscale` + `tailscale serve`
- Un reverse-proxy sur ton propre VPS (nginx/Caddy/HAProxy) qui proxie vers ton home server via Tailscale/Wireguard

**L'IP client réelle** est lue depuis `X-Forwarded-For`. Vérifie que ton client de tunnel le forward.

---

## 🐛 Dépannage

### `Bad Gateway` depuis le domaine Pangolin

`newt` n'arrive pas à atteindre Caddy. Deux causes probables :

| Symptôme | Cause | Fix |
|---|---|---|
| newt est en bridge Docker (`docker inspect newt -f '{{.HostConfig.NetworkMode}}'` retourne `bridge`) et tu as ciblé `localhost:80` dans Pangolin | `localhost` dans newt = le container newt, pas ton hôte | Soit passe en `--network host` (Méthode A), **soit** change la cible Pangolin en `http://<IP-LAN-du-host>:80` (Méthode B) |
| Caddy n'écoute pas (`ss -ltn \| grep :80` vide) | Le service n'a pas démarré | `sudo nodyx-doctor` — il dit exactement ce qui cloche |

### Page qui charge à l'infini (loader qui tourne)

Caddy a répondu à Pangolin, mais le routage interne Caddy est foireux. Lance :

```bash
sudo nodyx-doctor
```

En mode Pangolin, il affiche maintenant les adresses sur lesquelles Caddy bind, et vérifie que l'IP LAN est dedans.

Si tu as customisé un Caddyfile à la main et qu'il a divergé, re-run :

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash -s -- --repair
```

`--repair` rebuild Caddyfile, frontend, backend sans toucher à la base de données.

### `cloudflared service install` failed

Le token est peut-être expiré ou pour un autre compte. Régénère-le depuis le dashboard Cloudflare, puis :

```bash
sudo bash install_tunnel.sh --repair
# Re-colle le nouveau token quand demandé.
```

### `npm install` échoue en cours

Le script fait maintenant un preflight de connectivité (DNS + HTTPS sortant vers github.com) avant de démarrer. Si ça plante encore, ton container ou VPS rate-limit le sortant ou a un proxy corporate. Set `npm_config_registry` si besoin.

### `ufw` se plaint qu'il ne tourne pas

Tu es dans un LXC unprivileged ou un container Docker sans `NET_ADMIN`. Le script warn maintenant en preflight et demande confirmation explicite. UFW ne marchera pas, mais Nodyx oui : ton hyperviseur doit s'occuper du firewall à sa place.

---

## 🔐 Ce que l'installeur durcit

Petite visite pour les admins qui veulent savoir ce qu'ils prennent (ou les mainteneurs qui toucheront à ce script plus tard).

### Caddyfile

- **Bind addresses dépendent du mode.** Loopback toujours ; l'IP LAN est ajoutée en mode Pangolin pour que newt-en-bridge puisse atteindre Caddy.
- **`max_header_size 16KB`.** Le défaut 1MB laisse le slow-header DoS bouffer les workers. 16KB tient les headers CF Tunnel + cookies + JWT large.
- **Timeouts `reverse_proxy`.** `dial_timeout 5s` (loopback connecte en <100ms), `response_header_timeout 30s` (couvre le long-poll Socket.IO sans casser les WebSockets). Pas de `read_timeout` — ça casserait silencieusement les WS.
- **Forwarding de la vraie IP dépend du mode.** CF Tunnel utilise `CF-Connecting-IP` ; Pangolin et custom utilisent `X-Forwarded-For`. Trusté seulement depuis loopback + RFC1918.
- **Honeypot.** Les paths classiques de scanners (`/.env`, `/wp-admin`, `/.git/`, etc.) sont rewrited vers `/api/v1/_hp` pour que le backend bannisse l'IP source.
- **Snippets** factorisent `(security_headers)`, `(proxy_backend)`, `(proxy_frontend)` : `/api`, `/uploads`, `/socket.io`, le honeypot, et le fallback SPA partagent le même hardening, drift impossible.

### Pas de HSTS en mode tunnel

HSTS lock-out les visiteurs jusqu'à un an si ton tunnel retombe en HTTP plain pour debug. Les modes tunnel ne peuvent pas garantir TLS bout en bout comme un Caddy direct. On joue safe sur la récupérabilité. (Le Caddyfile direct dans `install.sh` ship bien HSTS, lui.)

### Les secrets sont écrits mode 600 atomiquement

`/root/nodyx-credentials.txt`, `nodyx-core/.env`, et `nodyx-frontend/.env` sont écrits avec `umask 077`, donc jamais world-readable même pendant les millisecondes entre create et chmod.

### Le SQL est paramétré

Les inserts de bootstrap (admin, communauté) utilisent `psql --set` avec substitution `:'var'`. Une apostrophe dans ton nom de communauté (`L'Étoile`) ne casse plus l'install et n'ouvre plus de faille SQLi.

### UFW est idempotent

Si UFW est déjà actif quand tu lances l'installeur (upgrade, repair, règles custom), le script laisse tes règles intactes et te warn de vérifier l'accès SSH. L'ancien comportement (`ufw --force reset`) wipait silencieusement les règles ajoutées par l'admin.

### Auto-backup avant les runs destructifs

`--upgrade`, `--repair`, `--reinstall`, et `--wipe` snapshot tous la base avant toute action. Si une migration explose en plein milieu, le `.sql.gz` est ton point de rollback.

### Trap sur EXIT

Les tempfiles enregistrés via `_register_temp` sont nettoyés que le script finisse, plante, ou soit Ctrl-C'd. Plusieurs `--upgrade` n'oublient plus de `/tmp/*.log`.

### `pm2-logrotate` tourne sous le bon user

L'ancien installeur lançait `pm2 install pm2-logrotate` en root, vers `/root/.pm2/`. Le daemon Nodyx tourne sous user `nodyx` avec `PM2_HOME=/home/nodyx/.pm2`, donc logrotate n'était jamais activé et les logs grossissaient jusqu'au disque plein. Le fix lance via `runuser -u nodyx`.

---

## 🔁 Re-run, upgrade, repair

Le même script gère toute la maintenance :

```bash
sudo bash install_tunnel.sh --upgrade    # git pull + rebuild + restart
sudo bash install_tunnel.sh --repair     # rebuild + restart (sans git pull, sans config change)
sudo bash install_tunnel.sh --reinstall  # install propre, garde la base
sudo bash install_tunnel.sh --wipe       # reinstall + EFFACE la base (DANGER)
```

Un snapshot DB est pris automatiquement avant ces actions. Les sauvegardes atterrissent dans `/var/backups/nodyx/` sous le nom `nodyx_<mode>_YYYYMMDD_HHMMSS.sql.gz`.

Pour lancer le doctor à tout moment :

```bash
sudo nodyx-doctor
```

Il check chaque couche (services système, PM2, backend HTTP, addresses Caddy, client tunnel) et imprime un résumé vert / jaune / rouge.

---

## 📚 Voir aussi

- [INSTALL.md](INSTALL.md) — install VPS direct (Caddy fait Let's Encrypt lui-même)
- [DOMAIN.md](DOMAIN.md) — guide setup domaine
- [RELAY.md](RELAY.md) — Nodyx Relay (pas besoin de domaine, `ton-slug.nodyx.org`)
- [Discussion GitHub #23](https://github.com/Pokled/nodyx/discussions/23) — le rapport originel du Bad Gateway Pangolin

---

<div align="center">
  <em>Bloqué ? Ouvre une Q&A discussion sur GitHub. On répond.</em>
</div>
