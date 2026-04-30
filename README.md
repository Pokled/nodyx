<div align="center">

<img src="https://nodyx.org/uploads/assets/36644490ed9ac75ec1fb64b027c8cade8c1d0673e695b29d2bc0492102173d8f.webp" alt="Nodyx" width="80"/>

# Nodyx

### *"The network is the people."*

**The self-hosted community platform you actually own.**  
Forum + Chat + Voice + P2P + Canvas + Homepage Builder + Widget SDK — one server, one community, forever.

[![Version](https://img.shields.io/badge/version-v2.2.0-7c3aed)](CHANGELOG.md)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml)
[![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20SvelteKit%20%2B%20PostgreSQL%20%2B%20Rust-green)](docs/en/ARCHITECTURE.md)
[![Ko-fi](https://img.shields.io/badge/Support-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/Pokled)

<sub>⭐ If Nodyx resonates with you, a star helps others find it — and keeps us going.</sub>

</div>

---

<div align="center">

**[📖 Documentation → nodyx.dev](https://nodyx.dev)** &nbsp;·&nbsp;
**[🚀 Live demo → nodyx.org](https://nodyx.org)** &nbsp;·&nbsp;
<a href="README.md"><img src="https://flagcdn.com/16x12/gb.png" alt="EN"> English</a> · <a href="docs/fr/README.md"><img src="https://flagcdn.com/16x12/fr.png" alt="FR"> Français</a>

</div>

---

> **Hey, before you scroll.** Nodyx isn't trying to fight Discord, and it isn't trying to be the only open alternative. There are great projects out there. Matrix, Stoat, Fluxer, Mattermost, Rocket.Chat, Discourse, Haven and others. And we genuinely want you to know about them. We list them, with their GitHub repos, on a page we wrote ourselves: **[→ Why Nodyx (and the other alternatives we respect)](https://nodyx.dev/why-nodyx)**.
>
> *The fight isn't between us. It's between locked silos and communities that actually own themselves. Pick the tool that fits you. We'll cheer either way.*

---

<div align="center">
  <img src="docs/img/nodyx_home_page.png" alt="Nodyx — Homepage Builder" width="860"/>
</div>

---

## Why Nodyx

- **Most communities don't own where they live.** Years of history, knowledge, and memories sit on platforms that can change rules, ban accounts, or disappear. That's not malice, that's how closed systems work by default.
- **Self-hosting today is fragmented.** Forum, real-time chat, voice, and a public homepage usually mean stitching five separate tools together.
- **Nodyx ships them in one install** so a community can fully own its presence — text, voice, and homepage — on hardware its admins control.

One command. Your server. Forever.

### Built on

| Layer | Technology |
|---|---|
| Backend API | **TypeScript** + **Fastify v5** + Socket.IO — `nodyx-core/` |
| Frontend | **SvelteKit 5** + Tailwind v4 + TipTap editor — `nodyx-frontend/` |
| Database | **PostgreSQL 16** (FTS, migrations) + **Redis 7** (sessions, presence) |
| Voice relay | **nodyx-turn** — Rust STUN/TURN (replaces coturn, 2.9 MB binary) |
| P2P tunneling | **nodyx-relay** — Rust TCP tunnel (home server, no open ports) |
| Real-time | WebRTC P2P mesh + Socket.IO fallback |
| Auth (optional) | **Nodyx Signet** — ECDSA P-256 passwordless PWA — `nodyx-authenticator/` |
| Process manager | **PM2** under a dedicated `nodyx` system user |
| Reverse proxy | **Caddy** — automatic Let's Encrypt TLS |

> **No Docker required.** The installer deploys Node.js + PostgreSQL + Redis + Caddy + PM2 natively. `docker-compose.yml` is provided for local development only.

---

## The internet broke something.

Closed platforms ended up holding more conversations than the open web ever did. Not by malice — by default. They were free, easy, and everyone was already there.

But ten years of discussions, tutorials, and collective knowledge now sit behind login walls. Invisible to search engines. Bound to terms of service written in a Delaware courtroom. Gone when the platform decides.

**You never owned any of it.**

---

## Nodyx gives it back.

One command. Your server. Your rules. Your community — permanently.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Works on a Raspberry Pi behind a home router. No domain. No open ports. No cloud account.

---

## Where each project shines

The community-tools landscape isn't a battle. Each project optimizes for different things, and the right pick depends on what you're building. Here's how we'd recommend it to a friend:

| Project | What it does best | Where it fits |
|---|---|---|
| **Discord** | Real-time voice + chat for closed groups, mobile-first, 10+ years of bot ecosystem | If your community is private and ad-hoc |
| **Matrix** ([Element](https://github.com/element-hq/element-web)) | Federated protocol with bridges to almost everything (Discord, Slack, Telegram, IRC, ...) | If interoperability is non-negotiable |
| **[Discourse](https://github.com/discourse/discourse)** | Indexed, searchable forums and knowledge bases | If long-form async discussion is your core |
| **[Mattermost](https://github.com/mattermost/mattermost)** / **[Rocket.Chat](https://github.com/RocketChat/Rocket.Chat)** | Enterprise compliance, Slack-replacement at scale | If you have a procurement team |
| **[Haven](https://github.com/ancsemi/Haven)** | Privacy-first chat, zero cloud, native Windows/Linux/Android clients, no telemetry | If keeping every byte on your own machine matters most |
| **[Stoat](https://github.com/stoatchat/self-hosted)** (ex-Revolt) / **[Fluxer](https://github.com/fluxerapp/fluxer)** | Discord-shaped UI, easy migration | If your members already know Discord |
| **Lemmy** | Federated, Reddit-style threaded forums | If you want a fediverse-native presence |
| **Nodyx** | Forum + chat + voice + canvas + homepage builder, in one self-hosted install with a P2P relay for home servers | If you want to fully own a multi-format community on your own hardware |

> Nodyx is **the only project** combining all of those formats in a single install — but if you only need one or two, another tool above may fit you better.
>
> [Read our honest take, including the alternatives we respect →](https://nodyx.dev/why-nodyx)

### What's inside the Nodyx single install

- Indexed forum (canonical URLs, JSON-LD, sitemap, Google-friendly)
- Real-time chat with replies, pins, reactions, unfurls
- P2P voice channels — zero Big Tech relay
- Collaborative P2P canvas (whiteboard)
- WebRTC DataChannels for instant typing/reactions
- Home server support — no port forwarding, no domain required
- Federated community directory + cross-instance global search
- Asset library (frames, badges, banners, profile themes)
- Ephemeral whisper rooms
- Passwordless login (ECDSA P-256 PWA — Nodyx Signet)
- Collaborative jukebox (YouTube queue)
- Event calendar (OSM maps, RSVP, SEO)
- **Homepage Builder** with 11 layout zones, drag & drop
- **Widget Store** — install external widgets via .zip
- **Widget SDK** — build custom widgets, no framework needed

---

## Homepage Builder + Widget SDK

Nodyx ships with a **drag-and-drop Homepage Builder** and a complete **Widget SDK** — two features that no other self-hosted community platform offers.

### 11 layout zones

Place widgets anywhere on your homepage. Positions include:

```
banner          → full-width top announcement strip
hero            → main hero section
stats-bar       → community counters (members, online, posts)
main            → above main content
sidebar         → right column (join card, etc.)
half-1 / half-2 → 2-column grid
trio-1/2/3      → 3-column grid
footer-1/2/3    → footer columns
footer-bar      → full-width footer strip
```

### 4 native widgets (Phase 1)

| Widget | Description |
|---|---|
| **Hero Banner** | Animated hero with live/event/night variants resolved server-side |
| **Stats Bar** | Live member count, online count, thread count with animated counters |
| **Join Card** | CTA card for guests, hidden for logged-in members |
| **Announcement Banner** | Closeable info/warning/error strip with icon |

### Widget Store — install in one click

Any developer can package a widget as a `.zip` and install it on any Nodyx instance:

```
my-widget-1.0.0.zip
├── manifest.json     ← id, label, version, schema (config fields)
└── widget.iife.js    ← Web Component — Shadow DOM isolated
```

The admin panel handles upload, validation, extraction and activation. No rebuild, no deploy.

### Widget SDK — build your own, zero build tools

Widgets are standard **Custom Elements** (Web Components). Plain JavaScript, no React, no Vue, no npm.

```javascript
class MyWidget extends HTMLElement {
  connectedCallback() { this._render() }

  _render() {
    var cfg = JSON.parse(this.dataset.config || '{}')
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = `<div>Hello ${cfg.title}</div>`
  }
}
customElements.define('nodyx-widget-my-widget', MyWidget)
```

→ **[Full step-by-step guide for non-developers → nodyx.dev/create-widget](https://nodyx.dev/create-widget)**

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

### NodyxCanvas — Collaborative whiteboard (v2.2)

<div align="center">
  <img src="docs/img/Nodyx_canvas_alternative_Mural.png" alt="NodyxCanvas — collaborative whiteboard" width="860"/>
</div>

Draw, annotate, and build together in real time — directly inside voice channels.
Synced via Socket.IO CRDT. Every op is persistent (PostgreSQL JSONB snapshot).

```
CRDT Last-Write-Wins per element (UUID + timestamp)
canvas:op / canvas:clear / canvas:cursor / canvas:chat  →  Socket.IO
Voice-aware cursors: peer cursor pulses when they're speaking
Real-time participants panel with live tool + avatar
Board-scoped chat (independent from the voice channel chat)
```

**Tools (v2.2):**

| Tool | Key | Description |
|---|---|---|
| Select | V | Move + resize with 8 handles (corners + midpoints) |
| Pen | P | Freehand drawing — color, width, opacity |
| Text | T | Rich inline text — bold/italic/underline/strike, align, font, size |
| Sticky | N | Post-it note — 8 colors, multiline |
| Rect / Circle | R / C | Fill + stroke with independent colors and width |
| Shape | S | Advanced shapes — triangle, diamond, star, hexagon, cloud |
| Arrow | A | Styled arrows — solid/dashed/dotted, 3 cap types |
| Connector | X | Smart connectors — straight/bezier/elbow, independent start+end caps |
| Image | I | Drag & drop or file picker → uploaded to `/assets`, rendered on canvas |
| Frame | F | Named section — label + dashed border, groups elements visually |
| Eraser | E | Point eraser |

**Canvas features:**
- Undo / Redo — 50-op stack per session, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
- Snap to grid — 28px world grid, toggleable (G)
- Zoom — Ctrl+Scroll, pinch, or toolbar buttons (5% → 1000%)
- Pan — Space+drag or middle-click drag
- Minibar bottom — zoom %, grid toggle, snap toggle
- Export PNG — downloads full canvas, posts recap to chat channel

---

## Screenshots

<div align="center"><sub>Community · Builder · Admin · Features — all running on a single install</sub></div>

<br/>

<div align="center"><b>— Community Experience —</b></div>

<table>
  <tr>
    <td align="center"><b>Homepage — Grid Builder</b></td>
    <td align="center"><b>Forum</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/nodyx_home_page.png" alt="Homepage with Grid Builder widgets" width="460"/></td>
    <td><img src="docs/img/Nodyx_Forum.png" alt="Forum — categories, threads, rich editor" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Real-time Chat</b></td>
    <td align="center"><b>Voice Channels — P2P WebRTC</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Nodyx_chat.png" alt="Real-time text chat" width="460"/></td>
    <td><img src="docs/img/Vocal_Nodyx_salon.png" alt="Voice channel with P2P mesh" width="460"/></td>
  </tr>
</table>

<br/>

<div align="center">

<b>— Homepage Builder —</b>

<img src="docs/img/Nodyx_grid_builder_home_page_website.png" alt="Homepage Builder — drag & drop, 11 zones, live preview" width="940"/>

<sub>Drag-and-drop grid editor — 11 layout zones, live preview, per-widget audience rules and scheduling</sub>

</div>

<br/>

<table>
  <tr>
    <td align="center"><b>Widget Store — install via .zip</b></td>
    <td align="center"><b>Module Management</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/widget_store_nodyx.png" alt="Widget Store — one-click .zip install" width="460"/></td>
    <td><img src="docs/img/Nodyx_gestion_des_modules.png" alt="Module management — 26 activatable modules" width="460"/></td>
  </tr>
</table>

<br/>

<div align="center"><b>— Features —</b></div>

<table>
  <tr>
    <td align="center"><b>Cross-Instance Search</b></td>
    <td align="center"><b>Polls — Forum & Chat</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Nodyx_Moteur_de_recherche_inter_reseau.png" alt="Cross-instance federated search engine" width="460"/></td>
    <td><img src="docs/img/Nodyx_sondage.png" alt="Polls with real-time results" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Wiki</b></td>
    <td align="center"><b>Asset Library</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Nodyx_wiki.png" alt="Community wiki" width="460"/></td>
    <td><img src="docs/img/Asset_nodyx.png" alt="Asset library — frames, badges, banners" width="460"/></td>
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

**PM2 memory limits are automatically tuned to your machine:**

| Total RAM | nodyx-core | nodyx-frontend | Auto-swap | Works on |
|---|---|---|---|---|
| < 1.5 GB | 256 MB | 192 MB | 2 GB created | Raspberry Pi 1 GB |
| 1.5 – 3 GB | 384 MB | 256 MB | 1 GB if needed | RPi 4 / small VPS |
| ≥ 3 GB | 512 MB | 512 MB | 1 GB if needed | Standard VPS ⭐ |

> Raspberry Pi: use a **64-bit OS** (Raspberry Pi OS 64-bit or Ubuntu ARM64). 32-bit is not supported.

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

Installs automatically: **Node.js 20, PostgreSQL 16, Redis 7, Caddy (HTTPS), PM2, nodyx-turn** (Rust STUN/TURN).  
Generates secrets, runs all DB migrations, creates your admin account. **No Docker. No manual configuration.**

> Supported: Ubuntu 22.04 / 24.04, Debian 11 / 12 / 13.

→ **[Complete installation guide (EN)](docs/en/INSTALL.md)**  
→ **[Guide d'installation complet (FR)](docs/fr/INSTALL.md)**

### Updating an existing instance

```bash
cd /var/www/nexus && git pull && \
  cd nodyx-core && npm run build && sudo -u nodyx pm2 restart nodyx-core && \
  cd ../nodyx-frontend && npm run build && sudo -u nodyx pm2 restart nodyx-frontend
```

Database migrations are applied automatically on startup — no manual SQL needed.

---

## Architecture

### Repository layout

```
nodyx/
├── nodyx-core/          → Fastify v5 + TypeScript REST API, Socket.IO, DB migrations
├── nodyx-frontend/      → SvelteKit 5 + Tailwind v4 SPA (SSR + client hydration)
├── nodyx-p2p/           → Rust workspace: nodyx-relay (TCP tunnel) + nexus-turn (STUN/TURN)
├── nodyx-authenticator/ → Nodyx Signet — ECDSA P-256 passwordless auth PWA (SvelteKit 5)
├── nodyx-hub/           → Olympus Hub — internal admin dashboard (SvelteKit 5)
├── nodyx-docs/          → nodyx.dev documentation site (SvelteKit 5)
├── docs/                → Markdown docs (EN + FR) — served by nodyx-docs
├── install.sh           → One-click installer (Node + PG + Redis + Caddy + PM2, no Docker)
├── ecosystem.config.js  → PM2 process config (production)
└── docker-compose.yml   → Local development only — not used in production installs
```

### Federation — how it works

Each Nodyx instance runs a **Gossip Protocol** scheduler that periodically pings the central directory (`nodyx.org/api/directory`). Instances share their public metadata (name, slug, URL, member count) and are discoverable via the `/discover` page on any instance. Events (calendar) federate across instances through the same gossip mechanism. There is no dependency on ActivityPub — the protocol is intentionally minimal and self-contained.

### Runtime diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Your Browser                         │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP / WebSocket             │ WebRTC P2P
               ▼                             ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│   nodyx-core (Fastify)   │    │  Direct peer connection    │
│   nodyx-frontend (Svelte)│    │  DataChannels + Canvas     │
│   PostgreSQL + Redis     │    │  Voice + Screen share      │
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
| API | TypeScript + Fastify v5 — `nodyx-core/` |
| Database | PostgreSQL 16 · 53 migrations — automatic on startup |
| Cache / Sessions | Redis 7 — JWT sessions, presence, rate-limiting |
| Full-text search | PostgreSQL FTS (tsvector + GIN) — cross-instance via Gossip |
| Frontend | SvelteKit 5 + Tailwind v4 — `nodyx-frontend/` |
| Editor | TipTap (WYSIWYG) |
| Real-time | Socket.IO (polling-first, WebSocket upgrade) |
| Voice | WebRTC P2P mesh — no central audio relay |
| TURN relay | **nodyx-turn** — Rust 2.9 MB, replaces coturn |
| P2P relay | **nodyx-relay** — Rust TCP tunnel, runs on home servers |
| Collaborative canvas | **NodyxCanvas** — CRDT LWW, Socket.IO sync, 11 tools, resize handles, undo/redo |
| Homepage | **Homepage Builder** — 11 zones, drag & drop, visibility rules |
| Widgets | **Widget Store** — .zip install + **Widget SDK** (Web Components) |
| Passwordless auth | **Nodyx Signet** — ECDSA P-256 PWA — `nodyx-authenticator/` |

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
<summary><b>v1.4 → v1.9 — Security & Polish</b></summary>

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
| Process isolation — all processes under `nodyx` system user | v1.9.4 |
| 181 Node.js tests + 18 Rust unit tests + CI pipeline | v1.9.4 |
| Living Profile — Generative banner (Lissajous/FNV-1a), Reputation rings (SVG animated), Activity heatmap | v1.9.5 |
| Parallax hero, rotating avatar arcs, Timeline, `/reputation` transparent formulas | v1.9.5 |
| Forum redesign — flat design, zero radius, full-width content | v1.9.5 |

</details>

<details>
<summary><b>v2.0 — Private & Sovereign Communications 🔒</b></summary>

| Feature | Version |
|---|---|
| **DM E2E encryption** — ECDH P-256 + AES-256-GCM, private key never leaves the browser (IndexedDB non-extractable) | v2.0 |
| **ESY Barbare layer** — per-instance byte-permutation obfuscation on top of AES-GCM, server sees only opaque ciphertext | v2.0 |
| **E2E shield** — live indicator in DM header (green pulse = active, orange = partial), ESY fingerprint tooltip | v2.0 |
| **Barbarize animation** — sender sees obfuscated text during encryption, receiver sees it decipher in real-time | v2.0 |
| **DM message edit** — inline edit with re-encryption for E2E messages, real-time propagation via socket | v2.0 |
| **DM message delete** — real-time soft-delete propagated to all participants instantly | v2.0 |
| **DM full-width redesign** — split layout, glassmorphism sidebar, iMessage-style bubbles, grouped messages | v2.0 |
| **AudioContext shared** — single context for all peer VAD (Chrome 6-context limit fix) | v2.0 |

</details>

<details open>
<summary><b>v2.2 — NodyxCanvas major upgrade 🎨</b></summary>

| Feature | Version |
|---|---|
| **Canvas UI refactor** — 4 dedicated components: CanvasLeftToolbar, CanvasTopBar (contextual per tool), CanvasBottomBar, CanvasRightPanel | v2.2 |
| **Undo / Redo** — 50-op stack, Ctrl+Z/Y/Shift+Z, buttons with active/disabled state. Fixed CRDT LWW timestamp so undo always applies | v2.2 |
| **Snap to grid** — 28px world grid, toggle (G key), visual grid overlay | v2.2 |
| **Rich text** — bold, italic, underline, strikethrough, alignment (left/center/right), 3 font families (sans/serif/mono), 12 font sizes | v2.2 |
| **Advanced shapes** — triangle, diamond (losange), star, hexagon, cloud — rendered via Path2D, fill + stroke + label | v2.2 |
| **Connectors** — straight / bezier / elbow lines, independent start & end caps (arrow/dot/none), solid/dashed/dotted style, 2-click creation | v2.2 |
| **Frames / Sections** — named rectangular regions with dashed border, label rendered above, inline name input on creation | v2.2 |
| **Image insertion** — drag & drop from desktop or file picker, uploaded to `/api/v1/assets`, cached and rendered on canvas, proportional sizing | v2.2 |
| **Resize handles** — 8 handles (corners + midpoints) on selected rect/circle/shape/frame/image/sticky elements, live preview, snap-aware | v2.2 |
| **Real user avatars** — participant panel shows real user avatars (with initials fallback) and their active tool | v2.2 |
| **Board chat** — real-time chat scoped to the canvas board, independent from the voice channel chat | v2.2 |
| **Full keyboard shortcuts** — V P T N R C S A X I F E (tools) + G (grid) + Ctrl+Z/Y/Shift+Z (undo/redo) + Delete + Escape | v2.2 |
| **Portal rendering** — canvas mounted on `document.body` via portal action, bypasses CSS `transform` ancestors that break `position:fixed` | v2.2 |

</details>

<details>
<summary><b>v2.1 — Homepage Builder + Widget SDK 🧩</b></summary>

| Feature | Version |
|---|---|
| **Homepage Builder** — drag-and-drop admin, 11 layout zones (banner, hero, stats-bar, main, sidebar, half ×2, trio ×3, footer ×4) | v2.1 |
| **Plugin registry** — each native widget is a self-contained file, zero core changes to add new ones | v2.1 |
| **4 native widgets Phase 1** — Hero Banner (live/event/night variants), Stats Bar (animated counters), Join Card, Announcement Banner | v2.1 |
| **Visibility rules** — per-widget audience (all / guests / members) + scheduled start/end dates | v2.1 |
| **Widget Store** — install external widgets via `.zip` upload (XHR progress bar, 4-step validation, extraction whitelist) | v2.1 |
| **Dynamic Widget Loader** — Web Components loaded at runtime, no rebuild, no deploy | v2.1 |
| **Widget SDK** — plain JS Custom Elements (Shadow DOM), `manifest.json` schema → auto-generated config fields in builder | v2.1 |
| **Demo widget: Video Player** — YouTube / Vimeo / MP4 with live preview, source viewer, one-click install | v2.1 |
| **nodyx.dev/create-widget** — step-by-step guide for non-developers (7 steps, EN) | v2.1 |

</details>

### Coming

| Feature | Notes |
|---|---|
| **Canvas — Brainwave Sync** — host broadcasts pan+zoom to all participants in real time, followers stay synchronized | Sprint C |
| **Canvas — Ghost Mode** — anonymous brainstorming: contributions appear under random pseudonyms, author revealed at end | Sprint C |
| **Canvas — Minimap** — 160×120 thumbnail in bottom-right, click to navigate | Sprint C |
| **Canvas — Multi-selection** — Shift+click or lasso to select + move + delete multiple elements | Sprint C |
| **Canvas — Audio Stickies** — voice note recorded directly on the canvas, waveform rendered as post-it | Sprint D |
| **Canvas — Contextual Chat** — threaded discussion anchored to a canvas zone, spatially indexed | Sprint D |
| **More native widgets** — Countdown, Leaderboard, Latest Threads, Featured Events, Jukebox Player | Phase 2 |
| **Widget marketplace** — community-published widgets, ratings, one-click install from directory | — |
| **Nodes** — durable structured knowledge, community-validated via Garden | [SPEC 013](docs/en/specs/013-node/SPEC.md) |
| **Module system** — 26 activatable modules from admin panel (Joomla-style CMS) | [Spec](.claude/ideas/MODULE_SYSTEM.md) |
| **DM reactions** — emoji reactions on private messages | — |
| **Discord import** — bulk import channels, threads, reactions, avatars | — |
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
- [**Create a Widget**](https://nodyx.dev/create-widget) — Step-by-step Widget SDK guide
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

## 🌟 Nodyx Stars — Contributors

Every external contribution earns a star. Every Star goes on [our Hall of Fame](CONTRIBUTORS.md) — with avatar, profile link, and rank.

**Recognition is not optional here.** Open source without recognition is just free labor, and that's not how we roll.

### 🏆 First external contributor

<a href="https://github.com/Pranto2003"><img src="https://github.com/Pranto2003.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="Pranto"/></a>

**[Pranto Goswamee](https://github.com/Pranto2003)** : 🌟 × 1, added `Ctrl/Cmd + D` canvas duplication ([PR #11](https://github.com/Pokled/nodyx/pull/11)).

*First external contribution to Nodyx ever. Thank you 🙏*

<br/>

### 🎯 First Regular

<a href="https://github.com/waazaa-fr"><img src="https://github.com/waazaa-fr.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="waazaa-fr"/></a>

**[waazaa-fr](https://github.com/waazaa-fr)** : 🌟 × 2, found and reported two installer bugs back to back ([#14](https://github.com/Pokled/nodyx/issues/14), [#15](https://github.com/Pokled/nodyx/issues/15)), both fixed within hours.

*Reliable bug hunters keep the installer honest. Merci waazaa 🙏*

<br/>

### 🇪🇸 Hablas español? Now Nodyx does too

<a href="https://github.com/naranco66"><img src="https://github.com/naranco66.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="naranco66"/></a>

**[naranco66](https://github.com/naranco66)** : 🌟 × 3, brought Spanish (es-ES) to Nodyx via [PR #16](https://github.com/Pokled/nodyx/pull/16) (719 strings, full key + placeholder parity), came back with [PR #19](https://github.com/Pokled/nodyx/pull/19) for a native review of the community pulse strings, then jumped from i18n to ops with [PR #22](https://github.com/Pokled/nodyx/pull/22) : fixed orphaned `nexus-*` references in `docker-compose.yml` and an Alpine font path mismatch that broke the frontend Docker build.

*Third locale, third bridge to the world, and a Docker setup that actually works out of the box. Gracias naranco 🙏*

<br/>

### 🇩🇪 Sprichst du Deutsch? Now Nodyx does too

<a href="https://github.com/forke24x7"><img src="https://github.com/forke24x7.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="forke24x7"/></a>

**[forke24x7](https://github.com/forke24x7)** : 🌟 × 3, brought German (de) to Nodyx by attaching a hand-reviewed `de.json` (741 strings, native review) on [issue #5](https://github.com/Pokled/nodyx/issues/5), triggered the Pangolin / alternative-tunnel support work via [issue #18](https://github.com/Pokled/nodyx/issues/18), and caught a frontend build regression in `install_tunnel.sh` on day-one Pangolin testing ([#21](https://github.com/Pokled/nodyx/issues/21)).

*Fourth locale, a feature request that made the installer better for the whole self-hosting community, and a same-day regression hunt. Danke forke 🙏*

<br/>

👉 **[See all contributors →](CONTRIBUTORS.md)**

---

## Support Nodyx

Nodyx is built by one developer, with no VC money and no strings attached. If the project is useful to you, consider supporting it:

<a href="https://ko-fi.com/Pokled"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Support on Ko-fi"/></a>

Your support helps cover server costs and keeps Nodyx 100% free and open-source.

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
