# NEXUS — Roadmap
### Version 1.4 — The realistic path

---

> *"A project that tries to do everything at once does nothing well."*
> The Nexus roadmap is built on one simple rule:
> each phase must work perfectly before moving to the next.

---

## CURRENT STATE — March 2026

| Phase | Title | Status |
|---|---|---|
| **Phase 1** | Forum MVP + Admin | ✅ Complete |
| **Phase 2** | Real-time Chat + Directory + Network Identity | ✅ Complete |
| **Phase 2.5** | Community customization + Light federation | ✅ Complete |
| **Phase 3** | P2P Infrastructure + Rust Foundation | 🔨 In Progress |
| **Phase 4** | Platform enrichment | 🔨 In Progress (v1.7) |
| Phase 5 | Mobile and reputation | ⏳ Planned |
| **Phase Horizon** | NEXUS-ETHER — Physical layer sovereignty | 🌌 Vision |
| **Phase Radio** | NEXUS-RADIO — Internet radio tuner + cooperative ad network | 📻 Vision |

---

## PHASE 1 — Forum MVP + Admin ✅ COMPLETE
### Goal: A community can install, configure, and live on Nexus

### 1.1 Forum Backend
- [x] Initial SQL migration (users, communities, categories, threads, posts)
- [x] Migration 002 — user_profiles (bio, avatar, tags, links, social fields)
- [x] Migration 003 — grades (grades, community_grades, community_members.grade_id)
- [x] Migration 004 — social links (github, youtube, twitter, instagram, website)
- [x] Migration 005 — categories.parent_id (infinite categories, recursive CTE)
- [x] Migration 006 — threads.is_featured (featured articles)
- [x] Migration 007 — post_reactions + post_thanks (emoji reactions + karma)
- [x] Migration 008 — tags + thread_tags (community-scoped tags)
- [x] Migration 009 — search_vector + GIN triggers (full-text search)
- [x] Migration 010 — notifications (thread_reply, post_thanks, mention)
- [x] Route POST /api/v1/auth/register
- [x] Route POST /api/v1/auth/login + logout
- [x] Route GET  /api/v1/communities + /communities/:slug
- [x] Route POST /api/v1/communities/:slug/members (join/leave)
- [x] Forum routes (categories, threads, posts) — full CRUD
- [x] Thread title editing (author + mods)
- [x] Emoji reactions on posts (6 emojis, toggle)
- [x] Thanks button (+5 karma to author, 1 per user/post)
- [x] Thread tags (admin creates, selected at creation)
- [x] PostgreSQL full-text search (ts_headline, community filter)
- [x] Notifications (reply, thanks received, @mention)
- [x] JWT authentication middleware
- [x] Redis rate limiting middleware
- [x] Zod validation on all routes
- [x] "Online" tracking — Redis heartbeat 900s TTL
- [x] Instance routes — /instance/info, /instance/categories, /instance/threads/recent
- [x] Admin routes — stats, members, threads (pin/lock/delete), categories, tags

### 1.2 SEO and indexing
- [x] Forum routes rendered as static HTML (SvelteKit SSR)
- [x] Dynamic meta tags (title, description, og:*)
- [x] Automatic sitemap.xml
- [x] Configurable robots.txt
- [x] RSS feed
- [x] JSON-LD Schema.org (Forum, DiscussionForumPosting)
- [x] llms.txt (for AI agents)

### 1.3 Frontend
- [x] SvelteKit initialized + Tailwind v4
- [x] Homepage = instance community (NEXUS_COMMUNITY_NAME via .env)
- [x] Recursive category tree (CategoryTree.svelte)
- [x] Category + thread list page (with tag pills)
- [x] Thread + posts page + reply form
- [x] WYSIWYG editor (Tiptap — bold, code, tables, images, iframes)
- [x] Registration / login form
- [x] Complete user profiles (bio, tags, links, GitHub widget)
- [x] Grade system (admin CRUD + colored badge)
- [x] Instance directory (/communities — powered by nexusnode.app)
- [x] Full admin panel (/admin — 9 pages including Tags)
- [x] Adaptive navbar (search, notifications bell, Admin link)
- [x] /search page — Threads/Posts tabs, highlighted excerpts
- [x] /notifications page — list + mark read + 30s polling

### 1.4 Self-hosting
- [x] `install.sh` — one-click VPS installer (ports 80/443, Let's Encrypt via Caddy, PM2, coturn, PostgreSQL, Redis)
- [x] `install_tunnel.sh` — home server installer via Cloudflare Tunnel (no open ports, Raspberry Pi, home box)
- [x] docker-compose.yml (Nexus + PostgreSQL + Redis)
- [x] Multi-stage Dockerfile
- [x] Seed script (demo data)
- [x] PowerShell "Nexus-Easy-Install" script — automates Node/PostgreSQL/Redis on Windows Server without Docker
- [x] Visual post-installation health check (braille spinner, PASS/WARN/FAIL score)
- [x] 15-minute installation documentation
- [x] Complete domain name guide (DOMAIN.md — types, compatibility, FAQ)
- [x] Documented .env.example

### Phase 1 success criteria ✅
A non-developer can:
1. Install Nexus on their server in under 15 minutes ✅
2. Configure their instance via the interactive installer ✅
3. Create categories, threads, and tags ✅
4. Manage their community via the admin panel ✅
5. Be found on search engines (Google, Bing, Brave, Qwant...) ✅

---

## PHASE 2 — Real-time Chat + Directory + Network Identity ✅ COMPLETE
### Goal: Members communicate live, the directory is real, each instance has its URL

### 2.1 Real-time chat ✅
- [x] WebSocket (Socket.io) integrated into Fastify v5
- [x] Text channels configurable by admin
- [x] Real-time notifications (WebSocket — replaces 30s polling)
- [x] Message history persisted in PostgreSQL

### 2.2 nexusnode.app — Directory ✅
- [x] Real global directory service — instance registration API
- [x] /communities page fed by the real directory (end of mock)
- [x] Automatic instance registration on first startup
- [x] Automatic ping every 5 minutes (live member count, online stats)

### 2.3 Network identity — `slug.nexusnode.app` ✅
- [x] Each instance chooses a unique slug at installation
- [x] The slug is reserved with the nexusnode.app directory (REST API)
- [x] Wildcard DNS `*.nexusnode.app` managed by our Cloudflare
- [x] Caddy routes `slug.nexusnode.app → node IP` (Cloudflare Origin Certificate)
- [x] Admin has no DNS to configure — clean URL in 1 click

### 2.4 Voice channels — Network layer ✅
- [x] coturn server (STUN/TURN) configured and started by `install.sh`
- [x] WebRTC signaling via Socket.io (`src/socket/voice.ts`)
- [x] VoicePanel.svelte — floating bar + mic/camera/screen share controls
- [x] VoiceSettings.svelte — configurable AudioContext chain
- [x] MediaCenter.svelte — screen sharing + clips

---

## PHASE 2.5 — Community customization + Light federation ✅ COMPLETE
### Goal: Each instance is unique, and instances can share their creations

### v0.6 — Asset library & Feature Garden ✅

- [x] Migration 017 — `community_assets` (frames, banners, badges, stickers, avatars, wallpapers)
- [x] Migration 018 — `user_equipped_assets` (profile customization slots)
- [x] Migration 019 — `feature_seeds` (feature proposals)
- [x] Migration 020 — `user_seed_balance` (3 seeds/week per user)
- [x] Route `POST /api/v1/assets` — multipart upload with Sharp compression (WebP)
- [x] Full CRUD + like + equip/unequip routes for community assets
- [x] `assetService.ts` — automatic thumbnails, resize, slot management
- [x] `/library` page — asset gallery with category/tag/popularity filters
- [x] `/library/[id]` page — asset detail with like, equip, Whisper button
- [x] `/api/v1/garden` routes — proposals + seed voting + status change (admin)
- [x] `/garden` page — proposal list, visual voting with seed counter
- [x] User profile — display equipped assets (frame, banner, badge, wallpaper)
- [x] `/users/me/edit` — manage asset slots on your own profile

### v0.7 — Federated assets + Whispers ✅

- [x] Migration 021 — `directory_assets` (federated asset snapshot from other instances)
- [x] Migration 022 — `whisper_rooms` + `whisper_messages` (ephemeral rooms)
- [x] Route `POST /api/directory/assets` — push assets to registry (Bearer token)
- [x] Route `GET /api/directory/assets/search` — public multi-instance search
- [x] Scheduler — push assets to `nexusnode.app` every hour
- [x] Scheduler — clean up expired whisper rooms every 10 minutes
- [x] "🌐 All instances" tab in `/library` — federated assets from the directory
- [x] `/api/v1/whispers` routes — create, retrieve, delete ephemeral rooms
- [x] Socket.IO — `whisper:*` events (join, leave, message, typing, history, expired)
- [x] `/whisper/[id]` page — real-time whisper room (iMessage-style, TTL displayed)
- [x] "🤫 Whisper" button on asset pages — contextual room creation
- [x] "🔗 Share" button — copies link with "✅ Copied!" feedback
- [x] `linkify.ts` — clickable URLs in chat (`linkifyHtml`) and whispers (`linkifyText`)

---

## PHASE 3 — P2P Infrastructure + Rust Foundation
### Goal: Break free from third-party network dependencies. Build the decentralized core.

> *"P2P is the soul. Rust is the body."*
>
> Nexus will not replace Node.js or SvelteKit — they do their job perfectly.
> Rust will come **underneath**, invisible to the user, to handle the parts
> that JavaScript can't do well: low-level networking, encryption, WireGuard, DHT.
> The Rust layer communicates with nexus-core via a local Unix socket — simple and decoupled.

---

### 3.0 — `nexus-p2p`: The Rust Foundation 🔨 IN PROGRESS

#### Why Rust here?

Today, a user without a domain and without open ports must:
1. Create a Cloudflare account
2. Add their domain to Cloudflare (requires owning one, ~$1/year)
3. Configure `cloudflared` manually or via `install_tunnel.sh`

That's too much friction. And more importantly: **it's a dependency on a third-party service**,
contrary to Nexus's philosophy.

The Rust layer solves this radically and progressively.

#### Architecture

```
nexus-frontend (SvelteKit) ──────────────────────┐
nexus-core    (Fastify/Node.js) ─────────────────┤
                                                  │ IPC (Unix socket)
                                                  ▼
                                    ┌─────────────────────┐
                                    │     nexus-p2p       │
                                    │       (Rust)        │
                                    │                     │
                                    │  ┌───────────────┐  │
                                    │  │ Relay Client  │  │
                                    │  │ (TCP/tokio)   │  │
                                    │  └───────────────┘  │
                                    │  ┌───────────────┐  │
                                    │  │ STUN/TURN     │  │
                                    │  │ (replaces     │  │
                                    │  │  coturn)      │  │
                                    │  └───────────────┘  │
                                    │  ┌───────────────┐  │
                                    │  │ DHT Kademlia  │  │
                                    │  │ + WireGuard   │  │
                                    │  │ (mesh network │  │
                                    │  │  between nodes│  │
                                    │  └───────────────┘  │
                                    └─────────────────────┘
```

#### Phase 3.0-A — `nexus-relay-client` ✅ VALIDATED — March 1, 2026

> Replaces `install_tunnel.sh` + Cloudflare Tunnel. Zero domain required. Zero open ports.
> **Tested in real conditions: Raspberry Pi 4, no open ports, no Cloudflare account.**

- [x] Static Rust binary (9MB) — `tokio` + `hyper` + `tokio-postgres` + `clap` + `dashmap`
- [x] Outbound TCP connection to `relay.nexusnode.app:7443` (our infrastructure)
- [x] Bidirectional HTTP forwarding (JSON framing, 4-byte length prefix)
- [x] Automatic `slug.nexusnode.app` registration without DNS or CF account
- [x] Automatic reconnection with exponential backoff (1s → 2s → 4s → max 30s)
- [x] GitHub Release `v0.1.1-relay` — amd64 + arm64 binaries (fix: concurrent request handling)
- [x] Integration in `install.sh`: option 2 "Nexus Relay (recommended)"
- [x] Client-side systemd service (`nexus-relay-client.service`)

**User result:** `bash install.sh` → choose "Relay" → get `mycommunity.nexusnode.app` **with zero network configuration**.

#### Phase 3.0-B — Browser P2P Nodes (WebRTC DataChannels) ✅ POC VALIDATED — March 2, 2026

> Users' browsers become active relay nodes.
> Direct peer-to-peer communication without server intermediary.
> **Reuses the existing `voice.ts` signaling** — zero new server infrastructure needed.

**Approach:** Native WebRTC DataChannels + existing Socket.IO signaling (voice.ts pattern)
**Not in this POC:** libp2p (overkill), DHT (2027+)

**v0.8 — Two-browser POC ✅:**
- [x] Add `p2p:offer`, `p2p:answer`, `p2p:ice` events to `voice.ts` (3 lines — same pattern as `voice:offer/answer/ice`)
- [x] Create `nexus-frontend/src/lib/p2p.ts` — RTCPeerConnection + DataChannel manager
- [x] Peer discovery via existing Socket.IO (polite/impolite handshake — single initiator only)
- [x] Use instance's own coturn (already installed) — no third-party STUN
- [x] `ondatachannel` handler on responder side (critical — without it, responder never receives the channel)
- [x] UI indicator "⚡ P2P · N" in the text channel header (yellow when active, pulsing gray while connecting)
- [x] Validated test: two browsers, direct DataChannel confirmed, messages not going through server

**User result:** join any text channel → the ⚡ P2P indicator appears automatically when another member is present. Zero configuration.

**v0.9 — 1-N Mesh ✅ DELIVERED — March 2, 2026:**
- [x] Handle multiple simultaneous peer connections (Map of RTCPeerConnections — already in p2p.ts)
- [x] Instant P2P typing indicators (~1–5ms, animated Discord-style bouncing dots)
- [x] Optimistic reactions + spring physics pop animation (arrives before server roundtrip)
- [x] Graceful fallback if WebRTC fails (12s ICE timeout, subtle toast, _hadAttempt/_hadSuccess flags)
- [x] Asset transfer between peers (32 KB chunks, p2p:asset:* protocol, p2pAssetPeers store, ⚡ yellow button)

#### Phase 3.0-C — `nexus-turn` (replaces coturn) ✅ VALIDATED — March 4, 2026 / Updated March 8, 2026

> coturn is a 2000s C project. Complex to configure, significant attack surface.
> **Replaced by a 2.9MB Rust binary — zero dependency, dynamic credentials.**

- [x] STUN/TURN server in Rust — RFC 5389 (STUN) + RFC 5766 (TURN)
- [x] HMAC-SHA1 time-based credentials (username={expires}:{userId})
- [x] MESSAGE-INTEGRITY on all TURN success responses (RFC 5389 §10.3) — required for Firefox/Chrome relay
- [x] **TURN-over-TCP (RFC 6062)** — TCP:3478 alongside UDP:3478, shared allocation registry
- [x] RFC 4571 framing (2-byte big-endian length prefix per TCP message)
- [x] `ResponseSink` abstraction — all TURN handlers transport-agnostic (UDP and TCP unified)
- [x] Rate limiter UDP per IP (30 pkt/sec) + allocation quotas (MAX_LIFETIME=300s) + ban map
- [x] 2.9MB static binary, integrated in `install.sh`, systemd service
- [x] Validated: STUN Binding Request → 0x0101 Binding Success ✅
- [x] **Voice — Relay failover**: auto-switches to `iceTransportPolicy: relay` after sustained high packet loss (>25% × 3 polls)
- [x] **Voice — Opus tuning**: 32 kbps default, DTX off, mono, FEC on — optimized for VPN/lossy links

#### Phase 3.0-D — `nexus-p2p` core (long-term vision 2027-2028)

> The distributed core. When a node wants to contact another node directly, without going through us.
> Immortal network: every piece of data replicated on 3+ nodes, auto-healing.

- [ ] Kademlia DHT (via `libp2p`) — peer discovery without central server
- [ ] WireGuard (via `wireguard-rs`) — encrypted direct tunnel between voluntary instances
- [ ] Native ICE/STUN — NAT traversal without coturn for P2P connections
- [ ] IPC API exposed to nexus-core: `relay.register(slug)`, `peer.connect(slug)`, `network.peers()`
- [ ] Gossip protocol — natural state propagation across the network
- [ ] CRDTs — conflict-free distributed data (like counters, presence)
- [ ] Replication factor 3 — auto-healing if a node goes down
- [ ] If `nexusnode.app` is unreachable, nodes find each other via DHT (resilience)

---

### 3.1 — Voice Channels — Interface & Advanced Modes
*(network layer already in place — Phase 2.4)*

- [x] VoicePanel sidebar — fixed-position left panel with participant list (Galaxy Bar layout)
- [x] Voice member interaction panel — click any member → real-time network stats (RTT / jitter / packet loss) + volume slider
- [x] Self-monitoring panel — click yourself → live audio level meter, muted / deafened / PTT status badges
- [x] VoiceSettings popup — large fixed-position modal (360px), escapes sidebar overflow with backdrop overlay
- [x] Interaction buttons per peer — Profile link, Direct Message, File sharing + Mini-game (coming soon)
- [ ] Amphitheater mode — 1→N broadcast (9 to 25+ people, video on "screen")
- [ ] Nodes-as-a-Service — a Raspberry Pi can become a media relay to relieve the main server

#### v1.0 — Collaborative Table ⏳ PLANNED
*(P2P DataChannels foundation operational — v0.9)*

> *The voice channel becomes a living space: play, work, listen to music, share files — all in one window. First self-hosted open-source to combine all four use cases.*

**Visual Foundation**
- [ ] SVG oval table — avatars positioned on ellipse (me = always at bottom, `getAvatarPositions` algorithm)
- [ ] Clear central zone (drag & drop, same SVG plane)
- [ ] Avatar click → context menu (whisper, profile, challenge, mute)
- [ ] `table:*` protocol in DataChannels (state, event, object:move/add/remove)
- [ ] Host arbitrator — single source of truth, automatic election when host leaves
- [ ] State persistence in DB (30s snapshot) + restore on reconnect
- [ ] Audio waves on avatars (AnalyserNode + CSS custom property `--voice-intensity`)

**Files & Presence**
- [ ] Drag & drop file → shared on table for everyone (temporary)
- [ ] Pin 📎 — file stays visible even when owner is offline
- [ ] Drag file onto avatar → opens a Whisper with the file attached
- [ ] Presence states: 🎙️ in voice / 🪑 at table / 🎮 in game

**Widgets**
- [ ] Random spin "Who goes first?" (CSS animation, result visible to all)
- [ ] Shared timer — Pomodoro / Blitz / Custom (AudioContext for end sound)
- [ ] Persistent session scoreboard
- [ ] Stage mode — "Take the floor" (quick vote, priority mic, others -20dB)
- [ ] Spectator mode — forum members observe without participating (separate Socket.IO room)
- [ ] Exportable session history (text or PDF)

**Collaborative Jukebox**
- [ ] Web Audio API player (play/pause/next) — P2P sync, original quality, no compression
- [ ] Individual volume (GainNode + localStorage, never broadcast to others)
- [ ] Cover art: ID3 tags → MusicBrainz → Apple iTunes → IndexedDB cache
- [ ] Collaborative playlists saved to DB
- [ ] 👍👎 votes + smart priority queue
- [ ] Crossfade between tracks (two overlapping GainNodes)
- [ ] Timecode reactions (SoundCloud-style) — stored in DB, reappear on replay
- [ ] Sleep timer with progressive fadeout

**Templates & Plugins**
- [ ] Template selector (host picks, broadcasts `table:theme:set` to all)
- [ ] 3 official templates: Brasserie de Nuit, Table de Feutre, Pierre & Braise
- [ ] Plugin system `plugins/table-templates/` — first example for community developers

**Games (sequential progression)**
- [ ] RPG dice (d4–d100) — 3D CSS animation + roll history visible to all
- [ ] Chess — `chess.js` + SVG board + FEN state sync via DataChannel
- [ ] Poker — state machine + per-player AES-GCM hand encryption
- [ ] RPG / Warhammer — hex map, tokens (Library assets), fog of war *(long term)*

### 3.2 — Inter-instance mesh network
*(depends on Phase 3.0-C)*

- [ ] WireGuard mesh between voluntary instances — end-to-end encrypted tunnel
- [ ] DHT for peer discovery without a central server
- [ ] Gossip protocol — lightweight metadata synchronization between nodes
- [ ] Distributed backup directory — if `nexusnode.app` goes down, nodes maintain the directory
- [ ] Automatic transition to direct P2P connection when available
- [ ] Lightweight federation — a member of community A can interact with community B

---

## PHASE 4 — Platform enrichment
### Goal: Nexus becomes the complete community platform

**Already delivered early:**
- [x] **NexusCanvas** (v0.9) — P2P collaborative whiteboard in voice channels (CRDT LWW, voice-aware cursors, PNG export)
- [x] **Profile theme system** (v1.0) — 6 built-in presets (Défaut, Minuit, Forêt, Chaleur, Rose, Verre), CSS variable engine (`--p-bg`, `--p-card-bg`, `--p-accent`…), live editor with color pickers, app-wide propagation (nav, sidebars, background)
- [x] **Mobile-responsive UI** (v1.0) — chat channel drawer, bottom navigation bar, VoicePanel accessible on mobile, responsive forum + admin pages
- [x] **Asset library 12 MB** (v1.0) — raised from 5 MB, per-type upload design guidelines
- [x] **Chat — Reply/quote system** (v1.1) — reply_to_id on messages, preview bar in input, inline quote in message
- [x] **Chat — Pinned messages** (v1.1) — sticky banner in channel header, admin pin/unpin
- [x] **Chat — Link previews** (v1.1) — server-side Open Graph unfurl, Redis cache 1h, preview cards below messages
- [x] **Chat — Mention badge** (v1.1) — red bubble on Chat nav icon when @mentioned, separate from notification bell
- [x] **Presence — Custom user status** (v1.1) — emoji + text, 8 presets, persisted in Redis 24h, visible in sidebar
- [x] **Presence — Offline members list** (v1.1) — collapsible section in sidebar, grayscale avatars
- [x] **Plugins** (v1.1) — `plugins/` foundation with 3 official table-templates (Brasserie de Nuit, Table de Feutre, Pierre & Braise)
- [x] **Direct Messages (DMs)** (v1.2) — private 1:1 conversations, `dm_conversations` + `dm_messages`, unread badge, Socket.IO `dm:send/typing/read`
- [x] **Polls** (v1.2) — in chat (📊 button) and forum (thread creation + standalone), 3 types: choice / schedule / ranking, real-time Socket.IO results
- [x] **Ban system** (v1.2) — IP ban, email ban, multi-layer enforcement (register, login, middleware), admin UI
- [x] **nexus-turn — TURN-over-TCP** (v1.3) — RFC 6062, TCP:3478, VPN/firewall bypass for voice
- [x] **nexus-turn — MESSAGE-INTEGRITY fix** (v1.3) — RFC 5389 §10.3, relay now works in Firefox, Chrome, all WebRTC clients
- [x] **Voice — Relay failover** (v1.3) — auto-restart ICE with `iceTransportPolicy: relay` after 3 consecutive high-loss polls
- [x] **Voice — Opus optimized** (v1.3) — 32 kbps default, DTX off, mono, FEC on
- [x] **Event Calendar** (v1.6) — full CRUD, RSVP, cover upload, `/calendar` + `/calendar/[id]` + edit pages, `can_manage` (author OR mod/admin), extended sanitize-html — [SPEC 011](../en/specs/011-nexus-event-calendar/SPEC.md)
- [x] **Gossip Protocol** (v1.6) — `announceEventsToDirectory()` every 10 min, `/discover` multi-type (communities + threads + events)
- [x] **Global Search Gossip-based** (v1.5) — `network_index` FTS GIN PostgreSQL, `announceThreadsToDirectory()`, `/discover` with search bar and cross-instance cards, opt-in `NEXUS_GLOBAL_INDEXING=true` — [SPEC 010](../en/specs/010-nexus-global-search/SPEC.md)
- [x] **Admin — Enriched Dashboard** (v1.7) — extended stats (events/polls/assets/chat/DMs), dual 7-day activity chart (posts + new members), top 5 contributors, recent registrations
- [x] **System Announcements** (v1.7) — color-coded banners (6 variants) admin-created, user-dismissible, optional expiry, live preview — `/admin/announcements`
- [x] **Moderation Log** (v1.7) — audit trail for 11 admin action types, action/actor filters, pagination — `/admin/audit-log`, migrations 045-046

**Knowledge & Discovery:**
- [ ] **Nodes** — durable structured knowledge, Anchors, community-validated via Garden — [SPEC 013](../en/specs/013-node/SPEC.md)
- [ ] **Galaxy Bar** — multi-instance switcher, decentralized SSO, bio-luminescent notifications — [SPEC 012](../en/specs/012-nexus-galaxy-bar/SPEC.md)

**Tools:**
- [ ] File sharing (hosted on the node, no central CDN)
- [x] **Lightweight task system** (v1.8) — community Kanban boards, configurable columns, cards with assignee/due date/priority, native HTML5 drag & drop, `/tasks`
- [ ] Local Ollama AI — knowledge assistant (indexes local forum)
- [ ] **Nexus Guard Protocol** — toxicity scoring middleware in `chat:send`, configurable threshold, DB logs
- [ ] Plugin marketplace — stable API for third-party extensions (foundations in `plugins/`)

---

## PHASE 5 — Mobile and reputation
### Goal: Nexus in everyone's pocket

- [ ] iOS app via Capacitor
- [ ] Android app via Capacitor
- [ ] Desktop via Tauri (.exe/.app/.sh ~10MB, standalone)
- [ ] NexusPoints — inter-instance community reputation system
- [ ] Badges and levels
- [ ] Documented public API for third-party developers

---

## ROADMAP RULES

1. Don't start a phase without the previous one being stable and in use
2. Don't break what works — propose alternatives (e.g. Relay vs CF Tunnel vs open ports)
3. Complexity is hidden: the user sees a button, the Rust layer handles the complexity
4. Every addition must be consistent with the decentralized and sovereign aspect
5. The core stays simple. Complexity goes into plugins.
6. The community can vote to reprioritize future phases

---

## WHAT'S NEVER IN THE ROADMAP

- Advertising
- Data selling
- Features that require a **mandatory** central server (`nexusnode.app` is optional — without it, the instance remains fully functional on its own domain)
- Backdoors of any kind
- Permanent dependency on a proprietary third-party service
- Replacing Node.js or SvelteKit with Rust (every tool in its place)

---

---

## PHASE HORIZON — NEXUS-ETHER
### The physical layer. The last frontier.

> *"Radio waves don't need permission."*

Nexus decentralizes the application layer.
But we still depend on one thing: the physical internet infrastructure.
Fiber cables controlled by ISPs. Satellites controlled by corporations.

**NEXUS-ETHER decentralizes the physical layer itself.**

The bridge that makes it possible: **CRDTs**.
Already in Nexus (NexusCanvas). Already in production.
The same CRDT that synchronizes a whiteboard stroke can synchronize a forum post
over a LoRa link at 250 bps — even with a 2-hour delay.

```
Layer 1 — Local mesh     LoRa / Wi-Fi ad-hoc   0–50 km     no infrastructure
Layer 2 — Regional radio HF / NVIS             500–3000 km  ionospheric bounce
Layer 3 — Ionosphere     HF shortwave          Global       no cables, no satellites
```

```
nexus-p2p/
└── nexus-ether/          ← future workspace
    ├── nexus-modem/      ← software modem (HF / LoRa encoding in Rust)
    ├── nexus-mesh/       ← LoRa / Wi-Fi ad-hoc mesh relay
    └── nexus-sync/       ← CRDT delta serialization (Cap'n Proto / FlatBuffers)
```

**nexus-relay becomes a multi-path orchestrator:**
`ethernet → wifi-mesh → lora → hf-radio` — automatic fallback, CRDT handles convergence.

**What this means in practice:**
A community in a disaster zone. Fiber cut. 4G destroyed.
A Raspberry Pi on a battery. A LoRa module on the roof. €55 total.
The community continues. Announcements get through. People know who is alive.

**That is sovereignty.**

This is not a tomorrow feature. It is a **call to contributors:**
→ Amateur radio operators, LoRa makers, Meshtastic contributors, embedded Rust developers.
→ The architecture is here. The CRDT foundation is shipped.
→ The radio layer is waiting for the right hands.

→ **[Full spec: docs/ideas/NEXUS-ETHER.md](../ideas/NEXUS-ETHER.md)**

---

## PHASE RADIO — NEXUS-RADIO
### Internet radio that finally has a reason to exist.

> *"50,000 internet radio operators broadcasting into the void. Nexus is the signal back."*

The problem no one solved: 100,000+ internet radio stations existed at their peak.
Less than 5% had more than 10 simultaneous listeners.
Not because the programs were bad. Because there was no structure to turn simultaneous listeners into a community.

**Stations that survived** had a community layer structurally attached.
**Stations that died** had audiences but not communities.

The inversion Nexus makes possible:
```
Dead stations   :  broadcast → hope for community
Living stations :  community → broadcast as expression
```

**A Nexus instance IS the community layer.** A radio station that runs Nexus gets:
- Forum (archives, discussions, show notes — indexed by all search engines)
- Live chat (listeners react in real-time during broadcasts)
- Voice channels (open studio, backstage, listener Q&A)
- Garden (community votes on upcoming programs)

**The cooperative ad network — the missing economic model:**

A small station with 80 listeners can't negotiate with advertisers alone.
But 200 Nexus-Radio stations with 80 listeners each = **16,000 local listeners**.
A local baker, artisan, or event can pay for that reach.

```
nexusnode.app/radio
  → cooperative advertising network
  → local/regional advertisers deposit audio spots
  → spots distributed to stations in the targeted region
  → revenue split: 80% station / 20% nexusnode.app infrastructure
```

No tracking. No user profiling. Geographic targeting only.
The baker from the village funds the village radio that runs on a Raspberry Pi in the village.
**The money stays local. The infrastructure stays free.**

New stations will emerge because they finally have a community.
And because they can finally sustain themselves.

→ **[Full vision: docs/ideas/NEXUS-RADIO.md](../ideas/NEXUS-RADIO.md)**

---

*Version 2.1 — March 8, 2026*
*"P2P is the soul. Rust is the body. Radio is the resilience. Community is the reason."*
