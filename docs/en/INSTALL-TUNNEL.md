# 🌐 Nodyx — Tunnel Installation Guide

> **TL;DR** Got a server behind NAT (homelab, RPi, LXC) and no public IP? `install_tunnel.sh` configures Caddy + the rest of the stack so a reverse tunnel can point at it. Three modes: **Cloudflare Tunnel**, **Pangolin/newt**, or **custom** (frp, rathole, headscale, your own VPS proxy). No port 80/443 forwarding required. ☕

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash
```

---

## Table of Contents

- [When to use this installer](#-when-to-use-this-installer)
- [Pick your mode](#-pick-your-mode)
- [Mode A — Cloudflare Tunnel](#-mode-a-cloudflare-tunnel)
- [Mode B — Pangolin (newt)](#-mode-b-pangolin-newt)
- [Mode C — Custom reverse tunnel](#-mode-c-custom-reverse-tunnel)
- [Troubleshooting](#-troubleshooting)
- [What the installer hardens](#-what-the-installer-hardens)
- [Re-running, upgrading, repairing](#-re-running-upgrading-repairing)

---

## 🎯 When to use this installer

Use `install_tunnel.sh` when **any** of these is true:

- Your server has no public IPv4 (CGNAT, behind a residential router)
- You can't or don't want to forward ports 80/443
- You want TLS to terminate at someone else's edge (Cloudflare, your VPS)
- You're hosting on a RPi, an LXC, or behind a corporate firewall

If your server has a public IP and you can open ports 80/443, use [`install.sh`](INSTALL.md) instead. It does Let's Encrypt itself and is one less moving part.

---

## 🧭 Pick your mode

| Your situation | Mode | Why |
|---|---|---|
| You already use Cloudflare DNS | **CF** | Easiest. cloudflared runs on your server, dials out to Cloudflare's edge, TLS terminates there |
| You self-host a Pangolin VPS | **Pangolin** | Keeps everything in your hands. Uses `newt` Docker container as the tunnel client |
| You have your own reverse tunnel (frp, rathole, headscale, ...) | **None** | Caddy listens on `127.0.0.1:80` — wire your tunnel client to it manually |

You don't have to decide before running the script — it asks you and explains the tradeoffs.

---

## 🌩 Mode A — Cloudflare Tunnel

**What you need**

- A domain on Cloudflare nameservers
- A Cloudflare Tunnel install token (from `https://one.dash.cloudflare.com → Networks → Tunnels`)

**Steps**

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash
# Pick: 1 (Cloudflare Tunnel)
# Paste your install token when prompted.
```

**After install** — in your Cloudflare dashboard:

1. Open your tunnel → **Public Hostname** → **Add**
2. Subdomain: empty | Domain: `your-domain.com` | Service: `HTTP` | URL: `localhost:80`
3. Save. Visit `https://your-domain.com`. ✅

**Voice/UDP** Voice and webcam will use public STUN servers — Cloudflare Tunnel doesn't carry UDP. If you need self-hosted TURN, see the [RELAY](RELAY.md) doc.

---

## 🦔 Mode B — Pangolin (newt)

This is the mode that surprised the most operators (see [discussion #23](https://github.com/Pokled/nodyx/discussions/23)). The script now handles it cleanly, but the topology is worth understanding.

### Two ways to run newt

```
                 ╔══════════════════════════════════════════════════╗
                 ║  Method A — newt with --network host (RECOMMENDED) ║
                 ╚══════════════════════════════════════════════════╝

   ┌─────────────────────────────────────┐         ┌──────────────┐
   │  Your server (LXC / VM / metal)     │         │   Internet   │
   │                                      │         │              │
   │   ┌──────────┐         ┌──────────┐ │  HTTPS  │  Pangolin    │
   │   │  Caddy   │ ◄─loop─ │   newt   │ ┼────────►│   VPS        │
   │   │  :80     │         │ (host    │ │  +TLS   │              │
   │   │          │         │  netns)  │ │         │              │
   │   └──────────┘         └──────────┘ │         └──────────────┘
   │                                      │
   └─────────────────────────────────────┘

   newt shares the host's network namespace.
   "localhost" inside newt == the host. Caddy reachable on 127.0.0.1:80.
   Pangolin resource target → http://localhost:80
```

```
                 ╔════════════════════════════════════════════╗
                 ║  Method B — newt in default Docker bridge   ║
                 ╚════════════════════════════════════════════╝

   ┌─────────────────────────────────────┐         ┌──────────────┐
   │  Your server                        │         │   Internet   │
   │                                      │         │              │
   │   ┌──────────┐                      │         │              │
   │   │  Caddy   │ ◄── 192.168.X.Y:80 ──┼─┐ HTTPS │  Pangolin    │
   │   │ 127.0.0.1│                      │ │       │   VPS        │
   │   │ +LAN IP  │       ┌──────────┐   │ │+TLS   │              │
   │   └──────────┘       │   newt   │ ──┼─┘──────►│              │
   │                       │ (bridge  │   │       │              │
   │                       │  172.X)  │   │       │              │
   │                       └──────────┘   │       └──────────────┘
   └─────────────────────────────────────┘

   newt is in its own netns. "localhost" inside newt is newt itself, NOT the host.
   newt must reach Caddy via the host's LAN IP.
   Pangolin resource target → http://<host-LAN-IP>:80
```

### Why both modes work

The installer binds Caddy on **both** `127.0.0.1:80` and the host's primary LAN IP (auto-detected). Pick whichever method fits your setup; the resource target in your Pangolin dashboard changes accordingly.

> 💡 **Method A is preferred** because it doesn't depend on the host's LAN address being stable. If your DHCP lease changes, Method B would need re-pointing in Pangolin.

### Method A — `--network host`

```bash
docker run -d --name newt --network host --restart unless-stopped \
  -e PANGOLIN_ENDPOINT=https://your-pangolin.example.com \
  -e NEWT_ID=your_newt_id \
  -e NEWT_SECRET=your_newt_secret \
  fosrl/newt:latest
```

Pangolin → HTTP resource → `your-domain.com → http://localhost:80`

### Method B — default bridge

```bash
docker run -d --name newt --restart unless-stopped \
  -e PANGOLIN_ENDPOINT=https://your-pangolin.example.com \
  -e NEWT_ID=your_newt_id \
  -e NEWT_SECRET=your_newt_secret \
  fosrl/newt:latest
```

Pangolin → HTTP resource → `your-domain.com → http://<host-LAN-IP>:80`

The installer prints the auto-detected LAN IP at the end of the run. You can also see it via `ip -4 route get 1.1.1.1`.

### Smoke test before going live

```bash
# Method A
docker exec newt wget -qO- http://localhost/api/v1/instance/info

# Method B (replace the IP)
docker exec newt wget -qO- http://192.168.1.42/api/v1/instance/info
```

A response body with a JSON instance description means newt can reach Caddy. Anything else, see [Troubleshooting](#-troubleshooting).

**Voice/UDP** Pangolin can carry UDP via "raw resources" — see Pangolin's docs. Without it, voice falls back to public STUN.

---

## 🔧 Mode C — Custom reverse tunnel

Caddy listens on `127.0.0.1:80` and trusts `X-Forwarded-For` from the loopback / RFC1918 ranges. Wire any of these to it:

- `frp` (frpc)
- `rathole`
- `headscale` + `tailscale serve`
- A reverse-proxy on your own VPS (nginx/Caddy/HAProxy) that proxies to your home server over a Tailscale/Wireguard tunnel

**Real client IP** is read from `X-Forwarded-For`. Make sure your tunnel client forwards it.

---

## 🐛 Troubleshooting

### `Bad Gateway` from the Pangolin domain

`newt` can't reach Caddy. Two likely causes:

| Symptom | Cause | Fix |
|---|---|---|
| newt is in default Docker bridge (`docker inspect newt -f '{{.HostConfig.NetworkMode}}'` returns `bridge`) and you targeted `localhost:80` in Pangolin | `localhost` inside newt is the newt container, not your host | Either switch to `--network host` (Method A) **or** change the Pangolin target to `http://<host-LAN-IP>:80` (Method B) |
| Caddy isn't listening at all (`ss -ltn | grep :80` empty) | Service didn't start | `sudo nodyx-doctor` — it tells you exactly what's wrong |

### Page loads forever (spinning loader)

Caddy answered Pangolin but the routing inside Caddy is wrong. Run:

```bash
sudo nodyx-doctor
```

In Pangolin mode it now shows which addresses Caddy is bound on, and verifies that the LAN IP is among them.

If you applied a custom Caddyfile by hand and it diverged, re-run:

```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install_tunnel.sh | sudo bash -s -- --repair
```

`--repair` rebuilds Caddyfile, frontend, backend without touching the database.

### `cloudflared service install` failed

The token may be expired or for a different account. Regenerate it from the Cloudflare dashboard, then:

```bash
sudo bash install_tunnel.sh --repair
# Re-paste the new token when prompted.
```

### `npm install` failed mid-way

The script now does a connectivity preflight (DNS + outbound HTTPS to github.com) before starting. If it still fails, your container or VPS is rate-limiting outbound or has a corporate proxy. Set `npm_config_registry` if needed.

### `ufw` complains about not running

You're inside an unprivileged LXC or Docker container without `NET_ADMIN`. The script now warns about this in preflight and asks for explicit confirmation. UFW won't work, but Nodyx itself will — your hypervisor must enforce the firewall instead.

---

## 🔐 What the installer hardens

A short tour for operators who want to know what they're getting (or maintainers who'll touch this script later).

### Caddyfile

- **Bind addresses are mode-aware.** Loopback always; the LAN IP is added in Pangolin mode so newt-in-bridge can reach Caddy.
- **`max_header_size 16KB`.** Default is 1MB and lets slow-header DoS chew workers. 16KB still fits CF Tunnel headers + cookies + JWT comfortably.
- **`reverse_proxy` timeouts.** `dial_timeout 5s` (loopback should connect in <100ms), `response_header_timeout 30s` (covers Socket.IO long-poll without cutting WebSocket upgrades). No `read_timeout` — that would silently break WebSockets.
- **Real-IP forwarding is mode-aware.** CF Tunnel uses `CF-Connecting-IP`; Pangolin and custom modes use `X-Forwarded-For`. Trusted only from loopback + RFC1918.
- **Honeypot.** Common scanner paths (`/.env`, `/wp-admin`, `/.git/`, etc.) get rewritten to `/api/v1/_hp` so the backend can ban the source IP.
- **Snippets** factor out `(security_headers)`, `(proxy_backend)`, `(proxy_frontend)` so `/api`, `/uploads`, `/socket.io`, the honeypot, and the SPA fallback all share the same hardening — drift between them is impossible.

### No HSTS in tunnel modes

HSTS would lock visitors out for up to a year if your tunnel ever falls back to plain HTTP for debugging. Tunnel modes can't guarantee TLS end-to-end the way a Caddy-direct install can. We err on the side of recoverability. (The direct-install Caddyfile in `install.sh` does ship HSTS.)

### Secrets are written mode 600 atomically

`/root/nodyx-credentials.txt`, `nodyx-core/.env`, and `nodyx-frontend/.env` are written with `umask 077`, so they're never world-readable even for the milliseconds between create and chmod.

### SQL is parameterized

Bootstrap inserts (admin user, community) use `psql --set` with `:'var'` substitution. Apostrophes in your community name (`L'Étoile`) no longer break the install or open a SQL-injection hole.

### UFW is idempotent

If UFW is already active when you run the installer (upgrade, repair, custom rules), the script leaves your rules untouched and warns you to verify SSH access. The previous behavior (`ufw --force reset`) silently wiped operator-added rules.

### Auto-backup before destructive runs

`--upgrade`, `--repair`, `--reinstall`, and `--wipe` all snapshot the database to `/var/backups/nodyx/` before doing anything. If a migration explodes mid-run, the .sql.gz is your rollback point.

### Trap on EXIT

Tempfiles registered via `_register_temp` are wiped whether the script succeeds, fails, or is Ctrl-C'd. Multiple `--upgrade` runs no longer leak `/tmp/*.log`.

### `pm2-logrotate` runs under the right user

The previous installer ran `pm2 install pm2-logrotate` as root, into `/root/.pm2/`. The Nodyx daemon runs under user `nodyx` with `PM2_HOME=/home/nodyx/.pm2`, so logrotate was effectively never enabled and logs grew until disk-full. The fix runs the install via `runuser -u nodyx`.

---

## 🔁 Re-running, upgrading, repairing

The same script handles all maintenance:

```bash
sudo bash install_tunnel.sh --upgrade    # git pull + rebuild + restart
sudo bash install_tunnel.sh --repair     # rebuild + restart (no git pull, no config change)
sudo bash install_tunnel.sh --reinstall  # clean install, keep the database
sudo bash install_tunnel.sh --wipe       # reinstall + ERASE the database (DANGER)
```

A DB snapshot is taken automatically before any of these. Backups land in `/var/backups/nodyx/` as `nodyx_<mode>_YYYYMMDD_HHMMSS.sql.gz`.

To run the doctor at any time:

```bash
sudo nodyx-doctor
```

It checks every layer (system services, PM2, backend HTTP, Caddy bind addresses, tunnel client) and prints a green/yellow/red summary.

---

## 📚 See also

- [INSTALL.md](INSTALL.md) — VPS-direct install (Caddy does Let's Encrypt itself)
- [DOMAIN.md](DOMAIN.md) — domain setup walkthrough
- [RELAY.md](RELAY.md) — Nodyx Relay (no domain needed, `your-slug.nodyx.org`)
- [GitHub discussion #23](https://github.com/Pokled/nodyx/discussions/23) — original Pangolin Bad Gateway report

---

<div align="center">
  <em>Stuck? Open a Q&A discussion on GitHub. We answer.</em>
</div>
