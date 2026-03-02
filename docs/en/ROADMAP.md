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
| Phase 4 | Platform enrichment | ⏳ Planned |
| Phase 5 | Mobile and reputation | ⏳ Planned |

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
5. Be found on Google ✅

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

#### Phase 3.0-C — `nexus-turn` (replaces coturn)

> coturn is a 2000s C project. Complex to configure, significant attack surface.

- [ ] STUN/TURN server in Rust — RFC 5766 + RFC 8656
- [ ] Dynamic credentials provided by nexus-core via IPC (no static config)
- [ ] Structured logs (JSON), Prometheus metrics
- [ ] ~5MB static, zero configuration at install

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
- [ ] Round Table mode — direct WebRTC P2P (2 to 8 people, low latency)
- [ ] Amphitheater mode — 1→N broadcast (9 to 25+ people, video on "screen")
- [ ] Member mini-games — lightweight in-voice games between two members (first: TBD)
- [ ] File sharing between voice members — direct P2P transfer in voice channel
- [ ] Nodes-as-a-Service — a Raspberry Pi can become a media relay to relieve the main server

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

- [ ] File sharing (hosted on the node, no central CDN)
- [ ] Collaborative whiteboard (real-time via WebSocket)
- [ ] Lightweight task system (Trello-like, per community)
- [ ] Local Ollama AI — knowledge assistant (indexes local forum)
- [ ] **Nexus Guard Protocol — TypeScript integration**: migrate toxicity scoring engine into `nexus-core/src/socket/index.ts` as a `chat:send` middleware — score 0–10, configurable threshold via `.env`, logged to DB
- [ ] Guard Protocol — configurable threshold via admin panel (no restart)
- [ ] Guard Protocol — reliable URL blocking (regex + configurable whitelist)
- [ ] Plugin marketplace — stable API for third-party extensions
- [ ] Distributed data sharding for large files (inspired by IPFS/BitTorrent — voluntary nodes)

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

*Version 1.6 — March 2, 2026*
*"P2P is the soul. Rust is the body."*
