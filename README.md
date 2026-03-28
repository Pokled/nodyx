<div align="center">

<img src="docs/img/nodyx-icon.svg" alt="Nodyx" width="80"/>

# Nodyx

### *"The network is the people."*

**The community platform that no one can take from you.**
Forum + Chat + Voice + P2P Canvas — on your server, under your control, forever.

[![Version](https://img.shields.io/badge/version-v1.9.4-7c3aed)](CHANGELOG.md)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml)
[![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20SvelteKit%20%2B%20PostgreSQL%20%2B%20Rust-green)](docs/en/ARCHITECTURE.md)

<sub>⭐ If Nodyx resonates with you, a star helps others find it — and keeps us going.</sub>

</div>

---

<div align="center">

**[📖 Documentation → nodyx.dev](https://nodyx.dev)** &nbsp;·&nbsp;
**[🚀 Live demo → nodyx.org](https://nodyx.org)** &nbsp;·&nbsp;
<a href="README.md"><img src="https://flagcdn.com/16x12/gb.png" alt="EN"> English</a> · <a href="docs/fr/README.md"><img src="https://flagcdn.com/16x12/fr.png" alt="FR"> Français</a>

</div>

---

<div align="center">
  <img src="docs/img/hero.png" alt="Nodyx — community home" width="860"/>
</div>

---

## Why Nodyx

- **Discord** locks communities inside a private platform — your 10 years of history vanish if they close or ban you
- **Forums** are slow and fragmented — no voice, no real-time, invisible to your members' daily workflow
- **Self-hosted tools** rarely combine chat + voice + searchable knowledge in a single install

Nodyx brings them together. One command. Your server. Forever.

---

## The internet broke something.

Discord, Facebook, Slack — they didn't build communities. They captured them.

Ten years of discussions. Tutorials. Collective knowledge. Memories.
Locked in silos. Invisible to search engines. Gone when the platform decides.

**You never owned any of it.**

---

## Nodyx gives it back.

One command. Your server. Your rules. Your community — permanently.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Works on a Raspberry Pi behind a home router. No domain. No open ports. No cloud account.

---

## What makes Nodyx different

### The only platform with all of this in a single install

| | **Nodyx** | Discord | Matrix | Discourse | Lemmy |
|---|:---:|:---:|:---:|:---:|:---:|
| Self-hosted | ✅ | ❌ | ✅ | ✅ | ✅ |
| Open source | ✅ AGPL | ❌ | ✅ | ✅ | ✅ |
| Forum indexed by Google | ✅ | ❌ | ❌ | ✅ | ✅ |
| Real-time chat | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Voice channels | ✅ | ✅ | ✅ | ❌ | ❌ |
| Screen sharing | ✅ | ✅ | ✅ | ❌ | ❌ |
| P2P voice — zero Big Tech relay | ✅ | ❌ | ❌ | ❌ | ❌ |
| Collaborative P2P canvas | ✅ | ❌ | ❌ | ❌ | ❌ |
| P2P DataChannels (instant typing, reactions) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Home server (no port forwarding) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Federated community directory | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| Asset library (frames, badges, banners) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Ephemeral whisper rooms | ✅ | ❌ | ❌ | ❌ | ❌ |
| Passwordless login (ECDSA P-256 PWA) | ✅ | ❌ | ❌ | ❌ | ❌ |
| P2P collaborative Jukebox (YouTube queue) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Event calendar (OSM maps, RSVP, SEO) | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| Cross-instance global search | ✅ | ❌ | ❌ | ❌ | ✅ |
| Per-user profile themes (app-wide) | ✅ | ❌ | ❌ | ❌ | ❌ |

> Nodyx is the only self-hosted platform combining an **indexed forum**, **real-time chat**, **P2P voice**, **collaborative canvas**, and a **federated directory** in a single install.

---

## The P2P Stack — 100% handwritten Rust

This is where Nodyx goes further than anyone else.

### nodyx-turn — Rust STUN/TURN server *(replaces coturn)*

coturn is the industry standard — a mature C server used by Signal, Jitsi, Matrix.
We replaced it with a **2.9MB Rust binary** that does exactly what Nodyx needs. Nothing more.

```
RFC 5389 (STUN) + RFC 5766 (TURN) + RFC 6062 (TURN-over-TCP)
HMAC-SHA1 time-based credentials (username={expires}:{userId})
MESSAGE-INTEGRITY on all responses (RFC 5389 §10.3) — Firefox/Chrome compliant
Rate limiting + allocation quotas (MAX_LIFETIME=300s) + ban map
tokio async runtime — UDP:3478 + TCP:3478 (VPN/firewall bypass)
Zero coturn dependency on production
```

### nodyx-relay — Rust P2P TCP tunnel *(no domain, no open ports)*

A Raspberry Pi under your desk. No domain. No router port forwarding. No Cloudflare account.
Run Nodyx anyway.

```
nodyx-relay server  →  listens TCP:7443 + HTTP:7001
nodyx-relay client  →  persistent TCP tunnel → exposes local port 80
```

- Automatic reconnection with exponential backoff (1s → 30s max)
- JWT authentication per instance
- Routing by slug: `yourclub.nodyx.org` → proxied to the Pi behind your router
- Validated on a real Raspberry Pi 4 with zero open ports ✅

### WebRTC DataChannels — P2P without the server

Messages between peers that never touch the server.

- **Instant typing indicators** — < 5ms local latency (vs 80–200ms via server)
- **Optimistic emoji reactions** — appear instantly, server confirms in background
- **P2P file transfer** — assets shared directly between peers
- **Graceful fallback** — if DataChannel unavailable (strict NAT), Socket.IO takes over transparently

### NodyxCanvas — Collaborative P2P whiteboard

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
    <td><img src="docs/img/Index_Api-Nodyx.png" alt="Community home page" width="460"/></td>
    <td><img src="docs/img/Forum_Api-Nodyx.png" alt="Forum category" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Real-time Chat</b></td>
    <td align="center"><b>Voice Channels — WebRTC P2P</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Chat-Texte_Api-Nodyx.png" alt="Text chat" width="460"/></td>
    <td><img src="docs/img/Salon-vocal_Api-Nodyx.png" alt="Voice channel with P2P mesh visualization" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Admin Panel</b></td>
    <td align="center"><b>Instance Directory</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/AdminPanel_Instance_Api-Nodyx.png" alt="Admin dashboard" width="460"/></td>
    <td><img src="docs/img/Annuaire_instances_Api-Nodyx.png" alt="Instance directory" width="460"/></td>
  </tr>
</table>

---

## Quick Start

### Prerequisites

The installer handles everything automatically. Your system only needs **`curl`** and **`git`** to get started.

```bash
# Ubuntu / Debian
apt-get install -y git curl
```

### One-click install

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Or clone first:

```bash
git clone https://github.com/Pokled/Nodyx.git && cd Nodyx && sudo bash install.sh
```

The installer offers **three network modes**:

| Mode | Requirements | Result |
|---|---|---|
| **Nodyx Relay** ⭐ | Nothing — outbound TCP only | `yourclub.nodyx.org` in minutes |
| **Open ports** | Ports 80 + 443, domain or IP | Let's Encrypt HTTPS, full control |
| **Cloudflare Tunnel** | CF account + own domain | Your custom domain, no open ports |

> **Nodyx Relay** is the recommended default — works on a Raspberry Pi behind a home router.
> No domain. No port forwarding. No cloud account. Just run the script.

Installs automatically: Node.js, PostgreSQL, Redis, nodyx-turn (Rust STUN/TURN), Caddy (HTTPS), PM2.
Generates secrets, bootstraps the database, creates your admin account. **No manual configuration.**

> Supported: Ubuntu 22.04 / 24.04, Debian 11 / 12 / 13.

→ **[Complete installation guide (EN)](docs/en/INSTALL.md)**
→ **[Guide d'installation complet (FR)](docs/fr/INSTALL.md)**

### Updating an existing instance

```bash
cd /opt/nodyx && git pull && \
  cd nodyx-core && npm run build && pm2 restart nodyx-core && \
  cd ../nodyx-frontend && npm run build && pm2 restart nodyx-frontend
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
│   nodyx-core (Fastify)   │    │  Direct peer connection     │
│   nodyx-frontend (Svelte)│    │  DataChannels + Canvas      │
│   PostgreSQL + Redis      │    │  Voice + Screen share       │
└──────────────────────────┘    └────────────────────────────┘
               │                             │
        ┌──────┴──────┐               ┌──────┴──────┐
        │ nodyx-relay │               │ nodyx-turn  │
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
| TURN relay | **nodyx-turn** — Rust, self-hosted, hardened |
| P2P relay | **nodyx-relay** — Rust, tokio + hyper |
| Collaborative canvas | **NodyxCanvas** — CRDT LWW, P2P DataChannels |

---

## What's built. What's coming.

<details>
<summary><b>v0.1 → v1.3 — Foundation</b></summary>

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
| nodyx-relay — Rust P2P TCP tunnel | v0.5 |
| Community asset library (frames, banners, badges) | v0.6 |
| Feature Garden — community voting | v0.6 |
| Federated asset directory (cross-instance sharing) | v0.7 |
| Whispers — ephemeral encrypted chat rooms (1h TTL) | v0.7 |
| P2P DataChannels — instant typing, optimistic reactions | v0.8 |
| nodyx-turn — Rust STUN/TURN replacing coturn | v0.9 |
| NodyxCanvas — collaborative P2P whiteboard | v0.9 |
| Profile theme system — 6 presets, per-user app-wide CSS engine | v1.0 |
| Mobile-responsive UI | v1.0 |
| Chat — Reply/quote, pinned messages, link previews, @mention badge | v1.1 |
| Presence — Custom status + offline members list | v1.1 |
| Direct Messages (DMs) — private 1:1 conversations | v1.2 |
| Polls — in chat and forum, 3 types, real-time results | v1.2 |
| Ban system — IP ban, email ban, multi-layer enforcement | v1.2 |
| nodyx-turn — TURN-over-TCP (RFC 6062) | v1.3 |
| Voice — Relay failover + Opus tuning | v1.3 |

</details>

<details>
<summary><b>v1.4 → v1.9 — Current</b></summary>

| Feature | Version |
|---|---|
| Thread slug URLs + full SEO (canonical, OG, JSON-LD, sitemap) | v1.4 |
| Category slugs + subcategories | v1.5 |
| Global Search — cross-instance FTS index, /discover UI | v1.5 |
| Event Calendar — CRUD, RSVP, OSM maps, cover image, rich snippets | v1.6 |
| Gossip Protocol — event federation across instances | v1.6 |
| Nodyx Signet — passwordless ECDSA P-256 auth PWA | v1.7 |
| QR enrollment + Optimistic UI + Notification center | v1.7 |
| Tasks / Kanban — per-community boards, drag & drop, deadlines | v1.8 |
| Update alert + Instance version display | v1.8 |
| Full paranoid security audit — 38 vulnerabilities fixed | v1.8.2 |
| Honeypot — 25+ scanner paths trapped; tarpit; geolocation; DB logging | v1.9.0 |
| fail2ban — 5 jails: SSH, brute force, honeypot (7d), permanent blacklist | v1.9.0 |
| Argon2id — OWASP 2026 password hashing | v1.9.0 |
| 2FA TOTP (RFC 6238) + 2FA via Nodyx Signet | v1.9.1 |
| Credential harvesting traps + Canary files + Canvas fingerprint | v1.9.2 |
| Slowloris inverse — byte-by-byte streaming burns attacker threads 45–90s | v1.9.2 |
| Olympus Hub security dashboard | v1.9.2 |

</details>

### Coming

| Feature | Notes |
|---|---|
| **Nodes** — durable structured knowledge, community-validated via Garden | [SPEC 013](docs/en/specs/013-node/SPEC.md) |
| **DMs end-to-end encrypted** — ECDH key exchange + AES-256-GCM | [Spec](docs/ideas/DM_ARCHITECTURE.md) |
| **Plugin system** — external contributor API (fullstack hooks) | [Spec](docs/ideas/PLUGIN_SYSTEM.md) |
| Mobile (Capacitor) / Desktop (Tauri) | — |
| Rust migration — nodyx-server (Axum) replacing nodyx-core progressively | — |

---

## The Vision

Nodyx is not a Discord alternative.

It is a different answer to a different question.

Discord asked: *"How do we grow fast and capture communities?"*
Nodyx asks: *"How do we give communities sovereignty over their own existence?"*

Every Nodyx instance is a sovereign node. It runs where you run it — a VPS, a Pi, a spare laptop. It stores what you choose to store. It shares what you choose to share. It shuts down when you decide — not when a company pivots.

The internet was decentralized by design. SMTP, IRC, NNTP — anyone could run a server and talk to anyone else's server. That was the promise. Big Tech centralized it into silos over two decades.

**Nodyx is the promise, kept.**

And it spreads the same way. Each instance that goes live exposes others to the idea. Each public event indexed by Google brings in someone new. Each community that chooses sovereignty inspires another.

> *"Fork us if we betray you."* — AGPL-3.0

---

## Documentation

| Language | Docs |
|---|---|
| <img src="https://flagcdn.com/16x12/gb.png" alt="EN"> English | [nodyx.dev](https://nodyx.dev) · [docs/en/](docs/en/) |
| <img src="https://flagcdn.com/16x12/fr.png" alt="FR"> Français | [docs/fr/](docs/fr/) |
| <img src="https://flagcdn.com/16x12/es.png" alt="ES"> Español | *coming soon* |
| <img src="https://flagcdn.com/16x12/de.png" alt="DE"> Deutsch | *coming soon* |

- [**nodyx.dev**](https://nodyx.dev) — Full documentation wiki
- [Manifesto](docs/en/MANIFESTO.md) — Why Nodyx exists
- [Architecture](docs/en/ARCHITECTURE.md) — How it's built
- [Roadmap](docs/en/ROADMAP.md) — Where we're going
- [Audio Engine](docs/en/AUDIO.md) — Broadcast EQ, RNNoise, full audio chain
- [Neural Engine](docs/en/NEURAL-ENGINE.md) — Local AI with Ollama
- [**NODYX-ETHER**](docs/ideas/NODYX-ETHER.md) — The physical layer vision (LoRa / HF radio / ionosphere)

---

## Contributing

Nodyx belongs to its community.

1. Browse [open Issues](https://github.com/Pokled/Nodyx/issues) or open a [Discussion](https://github.com/Pokled/Nodyx/discussions)
2. Read [CONTRIBUTING.md](docs/en/CONTRIBUTING.md) before opening a PR
3. Commits follow [Conventional Commits](https://www.conventionalcommits.org/), written in English

Contribute freely — no prior validation required:

```
docs/        →  improve or translate documentation
docs/ideas/  →  design thinking, UX proposals, new ideas
```

The core (`nodyx-core/src/`) requires discussion first — open an Issue.

---

## License

**AGPL-3.0** — The strongest open source license for networked software.

If you use Nodyx, even over a network, your modifications must be open source.
If Nodyx ever betrays its principles, this license lets anyone fork it and continue in the spirit of the [Manifesto](docs/en/MANIFESTO.md).

---

<div align="center">
  <p><em>Born February 18, 2026.</em></p>
  <p><strong>"Fork us if we betray you."</strong></p>
</div>
