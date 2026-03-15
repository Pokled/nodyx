<div align="center">
  <img src="docs/img/nexus-logo.png" alt="Nexus" width="220"/>

  <h3><em>"The network is the people."</em></h3>

  <p><strong>The community platform that no one can take from you.<br/>Forum + Chat + Voice + P2P Canvas — on your server, under your control, forever.</strong></p>

  [![Version](https://img.shields.io/badge/version-v1.8.1-7c3aed)](CHANGELOG.md)
  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
  [![CI](https://github.com/Pokled/Nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nexus/actions/workflows/ci.yml)
  [![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20SvelteKit%20%2B%20PostgreSQL%20%2B%20Rust-green)](docs/en/ARCHITECTURE.md)

  <sub>⭐ If Nexus resonates with you, a star helps others find it — and keeps us going.</sub>
</div>

---

<div align="center">

[🇬🇧 English](README.md) · [🇫🇷 Français](docs/fr/README.md)

</div>

---

> **[→ Live demo: nexusnode.app](https://nexusnode.app)** — official instance, production VPS

---

## The internet broke something.

Discord, Facebook, Slack — they didn't build communities. They captured them.

Ten years of discussions. Tutorials. Collective knowledge. Memories.
Locked in silos. Invisible to search engines. Gone when the platform decides.

**You never owned any of it.**

---

## Nexus gives it back.

One command. Your server. Your rules. Your community — permanently.

```bash
git clone https://github.com/Pokled/Nexus.git && cd Nexus && sudo bash install.sh
```

Works on a Raspberry Pi behind a home router. No domain. No open ports. No cloud account.

---

## What makes Nexus different

### It's the only platform with all of this in a single install

| | **Nexus** | Discord | Matrix | Discourse | Lemmy |
|---|:---:|:---:|:---:|:---:|:---:|
| Self-hosted | ✅ | ❌ | ✅ | ✅ | ✅ |
| Forum indexed by Google | ✅ | ❌ | ❌ | ✅ | ✅ |
| Real-time chat | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Voice channels | ✅ | ✅ | ✅ | ❌ | ❌ |
| Screen sharing | ✅ | ✅ | ✅ | ❌ | ❌ |
| **P2P voice — zero Big Tech relay** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Collaborative P2P canvas** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **P2P DataChannels (instant typing, reactions)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Home server (no port forwarding)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Federated community directory** | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| **Asset library (frames, badges, banners)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Ephemeral whisper rooms** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Passwordless login (ECDSA P-256 PWA)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **P2P collaborative Jukebox (YouTube queue)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Event calendar (OSM maps, RSVP, SEO)** | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| **Cross-instance global search** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Per-user profile themes (app-wide)** | ✅ | ❌ | ❌ | ❌ | ❌ |

| Open source | ✅ AGPL | ❌ | ✅ | ✅ | ✅ |

> Nexus is the only self-hosted platform combining an **indexed forum**, **real-time chat**, **P2P voice**, **collaborative canvas**, and a **federated directory** in a single install.

---

## The P2P Stack — 100% handwritten Rust

This is where Nexus goes further than anyone else.

### nexus-turn — Rust STUN/TURN server *(replaces coturn)*

coturn is the industry standard — a mature C server used by Signal, Jitsi, Matrix.
We replaced it with a **2.9MB Rust binary** that does exactly what Nexus needs. Nothing more.

```
RFC 5389 (STUN) + RFC 5766 (TURN) + RFC 6062 (TURN-over-TCP)
HMAC-SHA1 time-based credentials (username={expires}:{userId})
MESSAGE-INTEGRITY on all responses (RFC 5389 §10.3) — Firefox/Chrome compliant
Rate limiting + allocation quotas (MAX_LIFETIME=300s) + ban map
tokio async runtime — UDP:3478 + TCP:3478 (VPN/firewall bypass)
Zero coturn dependency on production
```

### nexus-relay — Rust P2P TCP tunnel *(no domain, no open ports)*

A Raspberry Pi under your desk. No domain. No router port forwarding. No Cloudflare account.
Run Nexus anyway.

```
nexus-relay server  →  listens TCP:7443 + HTTP:7001
nexus-relay client  →  persistent TCP tunnel → exposes local port 80
```

- Automatic reconnection with exponential backoff (1s → 30s max)
- JWT authentication per instance
- Routing by slug: `yourclub.nexusnode.app` → proxied to the Pi behind your router
- Validated on a real Raspberry Pi 4 with zero open ports ✅

### WebRTC DataChannels — P2P without the server

Messages between peers that never touch the server.

- **Instant typing indicators** — < 5ms local latency (vs 80-200ms via server)
- **Optimistic emoji reactions** — appear instantly, server confirms in background
- **P2P file transfer** — assets shared directly between peers
- **Graceful fallback** — if DataChannel unavailable (strict NAT), Socket.IO takes over transparently

### NexusCanvas — Collaborative P2P whiteboard

Draw together in real time. Synchronized via existing DataChannels.
No server touches the data. Session-only by default.

```
CRDT Last-Write-Wins per element (UUID + timestamp)
canvas:op / canvas:clear / canvas:cursor  →  P2P DataChannels
Voice-aware cursors: peer cursor pulses when they're speaking
PNG export (browser-native) + text recap posted to chat channel
```

---

## Screenshots

<table>
  <tr>
    <td align="center"><b>Community Home</b></td>
    <td align="center"><b>Forum</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Index_Api-Nexus.png" alt="Community home page" width="460"/></td>
    <td><img src="docs/img/Forum_Api-Nexus.png" alt="Forum category" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Real-time Chat</b></td>
    <td align="center"><b>Voice Channels — WebRTC P2P</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Chat-Texte_Api-Nexus.png" alt="Text chat" width="460"/></td>
    <td><img src="docs/img/Salon-vocal_Api-Nexus.png" alt="Voice channel with P2P mesh visualization" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Admin Panel</b></td>
    <td align="center"><b>Instance Directory</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/AdminPanel_Instance_Api-Nexus.png" alt="Admin dashboard" width="460"/></td>
    <td><img src="docs/img/Annuaire_instances_Api-Nexus.png" alt="Instance directory" width="460"/></td>
  </tr>
</table>

---

## Quick Start

### Prerequisites

The installer handles everything automatically, but your system needs at least **`curl`** or **`wget`** to download and start it, and **`git`** if you clone the repo manually.

On a **fresh Ubuntu / Debian server** these are often missing:

```bash
# Ubuntu / Debian
apt-get install -y git curl
```

> `git` and `curl` are the **only two things** you need to install manually.
> Everything else (Node.js, PostgreSQL, Redis, Caddy, PM2…) is installed by the script.

### One-click install (recommended)

**Option A — clone first, then run:**
```bash
git clone https://github.com/Pokled/Nexus.git
cd Nexus
sudo bash install.sh
```

**Option B — single command with `curl` (no `git` needed):**
```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh | sudo bash
```

**Option C — single command with `wget` (if `curl` is not installed):**
```bash
wget -qO- https://raw.githubusercontent.com/Pokled/Nexus/main/install.sh | sudo bash
```

The installer offers **three network modes**:

| Mode | Requirements | Result |
|---|---|---|
| **Open ports** | Ports 80 + 443, domain or IP | Let's Encrypt HTTPS, full control |
| **Nexus Relay** ⭐ | Nothing — outbound TCP only | `yourclub.nexusnode.app` in minutes |
| **Cloudflare Tunnel** | CF account + own domain | Your custom domain, no open ports |

> **Nexus Relay** is the recommended default — works on a Raspberry Pi behind a home router.
> No domain. No port forwarding. No cloud account. Just run the script.

Installs automatically: Node.js, PostgreSQL, Redis, nexus-turn (Rust STUN/TURN), Caddy (HTTPS), PM2.
Generates secrets, bootstraps the database, creates your admin account.
**No manual configuration.**

> Supported: Ubuntu 22.04 / 24.04, Debian 11 / 12 / 13. Windows → [WSL guide](docs/en/INSTALL.md#windows)

→ **[Complete installation guide (EN)](docs/en/INSTALL.md)**
→ **[Guide d'installation complet (FR)](docs/fr/INSTALL.md)**

### Docker

```bash
git clone https://github.com/Pokled/Nexus.git
cd Nexus
cp nexus-core/.env.example nexus-core/.env
docker-compose up -d
```

### Updating an existing instance

Run this single command from the Nexus directory on your server:

```bash
# If installed in ~/nexus
cd ~/nexus && git pull && \
  cd nexus-core && npm run build && sudo pm2 restart nexus-core && \
  cd ../nexus-frontend && npm run build && sudo pm2 restart nexus-frontend
```

```bash
# If installed in /opt/nexus
cd /opt/nexus && git pull && \
  cd nexus-core && npm run build && sudo pm2 restart nexus-core && \
  cd ../nexus-frontend && npm run build && sudo pm2 restart nexus-frontend
```

Database migrations are applied automatically on startup — no manual SQL needed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Your Browser                         │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP / WebSocket             │ WebRTC P2P
               ▼                             ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│   nexus-core (Fastify)   │    │  Direct peer connection     │
│   nexus-frontend (Svelte)│    │  DataChannels + Canvas      │
│   PostgreSQL + Redis      │    │  Voice + Screen share       │
└──────────────────────────┘    └────────────────────────────┘
               │                             │
        ┌──────┴──────┐               ┌──────┴──────┐
        │ nexus-relay │               │ nexus-turn  │
        │ (Rust TCP)  │               │ (Rust TURN) │
        │ home server │               │ NAT bypass  │
        └─────────────┘               └─────────────┘
```

| Layer | Technology |
|---|---|
| API | TypeScript + Fastify v5 |
| Database | PostgreSQL 16 |
| Cache / Sessions | Redis 7 |
| Full-text search | PostgreSQL FTS (tsvector + GIN) |
| Frontend | SvelteKit 5 + Tailwind v4 |
| Editor | TipTap (WYSIWYG) |
| Real-time | Socket.IO |
| Voice | WebRTC P2P mesh |
| TURN relay | **nexus-turn** — Rust, self-hosted, hardened |
| P2P relay | **nexus-relay** — Rust, tokio + hyper |
| Collaborative canvas | **NexusCanvas** — CRDT LWW, P2P DataChannels |

---

## What's built. What's coming.

### Done

| Feature | Version |
|---|---|
| Forum (categories, threads, posts, reactions, tags) | v0.1 |
| Full-text search (PostgreSQL FTS) | v0.1 |
| Real-time chat (Socket.IO) | v0.1 |
| Voice channels (WebRTC P2P) | v0.1 |
| Screen sharing + clip recording | v0.2 |
| Admin panel | v0.2 |
| SEO (sitemap, RSS, JSON-LD) | v0.3 |
| One-click installer | v0.4 |
| Instance directory + auto DNS | v0.5 |
| nexus-relay — Rust P2P TCP tunnel | v0.5 |
| Community asset library (frames, banners, badges) | v0.6 |
| Feature Garden — community voting with organic growth stages | v0.6 |
| Federated asset directory (cross-instance sharing) | v0.7 |
| Whispers — ephemeral encrypted chat rooms (1h TTL) | v0.7 |
| P2P DataChannels — instant typing, optimistic reactions | v0.8 |
| nexus-turn — Rust STUN/TURN replacing coturn | v0.9 |
| **NexusCanvas — collaborative P2P whiteboard in voice channels** | **v0.9** |
| **Profile theme system** — 6 presets, per-user app-wide CSS engine, live editor | **v1.0** |
| **Mobile-responsive UI** — chat drawer, bottom nav, voice accessible on mobile | **v1.0** |
| **Asset library 12 MB** + per-type upload design guidelines | **v1.0** |
| **Chat — Reply/quote, pinned messages, link previews, @mention badge** | **v1.1** |
| **Presence — Custom status** (emoji + text, 8 presets) **+ offline members list** | **v1.1** |
| **Direct Messages (DMs)** — private 1:1 conversations with unread badge | **v1.2** |
| **Polls** — in chat and forum, 3 types (choice/schedule/ranking), real-time results | **v1.2** |
| **Ban system** — IP ban, email ban, multi-layer enforcement | **v1.2** |
| **nexus-turn — TURN-over-TCP** (RFC 6062) — voice works through VPNs and strict firewalls | **v1.3** |
| **nexus-turn — MESSAGE-INTEGRITY** fix — relay candidates now accepted by all browsers | **v1.3** |
| **Voice — Relay failover** — auto-switches to TURN relay on sustained packet loss | **v1.3** |
| **Voice — Opus tuning** — 32 kbps default, DTX off, mono for high-loss links | **v1.3** |

### v1.4 → v1.7

| Feature | Version |
|---|---|
| **Thread slug URLs + full SEO** (canonical, OG, JSON-LD, sitemap) | v1.4 |
| **Category slugs** + subcategories display on parent page | v1.5 |
| **Global Search** — cross-instance FTS index, `/discover` UI | v1.5 |
| **Event Calendar** — CRUD, RSVP, OSM maps, cover image, rich snippets | v1.6 |
| **Gossip Protocol** — event federation across instances | v1.6 |
| **Nexus Signet** — passwordless ECDSA P-256 auth PWA at `signet.nexusnode.app` | v1.7 |
| **QR enrollment** — scan from settings to skip manual token entry | v1.7 |
| **Optimistic UI** — all mutations update local state instantly (no page re-fetches) | v1.7 |
| **Notification center** — purge automatique 30j + effacer les lues | v1.7 |

### v1.8

| Feature | Version |
|---|---|
| **Tasks / Kanban** — per-community boards, drag & drop, assignees, priorities, deadlines | v1.8 |
| **Update alert** — admin banner when a new GitHub release is available (Redis-cached 6h) | v1.8 |
| **Instance version display** — "Nexus v1.8.x" shown on home page from `NEXUS_VERSION` env | v1.8 |
| **Security audit** — PATCH /cards permission fix, health 503, HOST binding, enrollment adminOnly, rate limit on /announcement, moderators can manage tags | v1.8.1 |

### Coming

| Feature | Notes |
|---|---|
| **Nodes** — durable structured knowledge, community-validated via Garden | [SPEC 013](docs/en/specs/013-node/SPEC.md) |
| Mobile (Capacitor) / Desktop (Tauri) | — |

---

## The Vision

Nexus is not a Discord alternative.

It is a different answer to a different question.

Discord asked: *"How do we grow fast and capture communities?"*
Nexus asks: *"How do we give communities sovereignty over their own existence?"*

Every Nexus instance is a sovereign node. It runs where you run it — a VPS, a Pi, a spare laptop. It stores what you choose to store. It shares what you choose to share. It shuts down when you decide — not when a company pivots.

The internet was decentralized by design. SMTP, IRC, NNTP — anyone could run a server and talk to anyone else's server. That was the promise. Big Tech centralized it into silos over two decades.

**Nexus is the promise, kept.**

And it spreads the same way. Each instance that goes live exposes others to the idea. Each public event indexed by Google brings in someone new. Each community that chooses sovereignty inspires another. The R0 is in the architecture.

We are not building a product. We are rebuilding infrastructure for human communities.

> *"Fork us if we betray you."* — AGPL-3.0

---

## Documentation

| Language | Docs |
|---|---|
| 🇬🇧 English | [docs/en/](docs/en/) |
| 🇫🇷 Français | [docs/fr/](docs/fr/) |
| 🇪🇸 Español | *coming soon* |
| 🇮🇹 Italiano | *coming soon* |
| 🇩🇪 Deutsch | *coming soon* |

- [Manifesto](docs/en/MANIFESTO.md) — Why Nexus exists
- [Architecture](docs/en/ARCHITECTURE.md) — How it's built
- [Roadmap](docs/en/ROADMAP.md) — Where we're going
- [Audio Engine](docs/en/AUDIO.md) — Broadcast EQ, RNNoise, full audio chain
- [Neural Engine](docs/en/NEURAL-ENGINE.md) — Local AI with Ollama
- [Specs](docs/en/specs/) — All functional specifications
- [Ideas](docs/ideas/) — Design thinking in progress
- [**NEXUS-ETHER**](docs/ideas/NEXUS-ETHER.md) — The physical layer vision (LoRa / HF radio / ionosphere)
- [**NEXUS-ETHER Guide**](docs/ideas/NEXUS-ETHER-GUIDE.md) — How to participate: CB, HAM radio, LoRa, regional radio revival
- [**NEXUS-RADIO**](docs/ideas/NEXUS-RADIO.md) — Nexus as a radio tuner: new stations born because they finally have a community

---

## Contributing

Nexus belongs to its community.

1. Browse [open Issues](https://github.com/Pokled/Nexus/issues) or open a [Discussion](https://github.com/Pokled/Nexus/discussions)
2. Read [CONTRIBUTING.md](docs/en/CONTRIBUTING.md) before opening a PR
3. Commits follow [Conventional Commits](https://www.conventionalcommits.org/), written in English

Contribute freely — no prior validation required:

```
docs/        →  improve or translate documentation
docs/ideas/  →  design thinking, UX proposals, new ideas
```

The core (`nexus-core/src/`) requires discussion first — open an Issue.

---

## License

**AGPL-3.0** — The strongest open source license for networked software.

If you use Nexus, even over a network, your modifications must be open source.
If Nexus ever betrays its principles, this license lets anyone fork it and continue in the spirit of the [Manifesto](docs/en/MANIFESTO.md).

---

<div align="center">
  <p><em>Born February 18, 2026.</em></p>
  <p><strong>"Fork us if we betray you."</strong></p>
</div>
