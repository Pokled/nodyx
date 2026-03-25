# NODYX — Roadmap
### Version 1.8 — The sovereign stack

---

> *"A project that tries to do everything at once does nothing well."*
> The Nodyx roadmap is built on one simple rule:
> each phase must work perfectly before moving to the next.

---

## CURRENT STATE — March 2026

| Phase | Title | Status |
|---|---|---|
| **Phase 1** | Forum MVP + Admin | ✅ Complete |
| **Phase 2** | Real-time Chat + Directory + Network Identity | ✅ Complete |
| **Phase 2.5** | Community customization + Light federation | ✅ Complete |
| **Phase 3** | P2P Infrastructure + Rust Foundation | ✅ Complete |
| **Phase 4** | Platform enrichment (v1.4 → v1.8) | ✅ Complete |
| **Phase 4.5** | Security hardening (v1.8.2) | ✅ Complete |
| **Phase 4.6** | Active defense & runtime security (v1.9.0) | ✅ Complete |
| **Phase 4.7** | 2FA — TOTP + Nodyx Signet as 2nd factor (v1.9.1) | ✅ Complete |
| **Phase 4.8** | Production stability & cross-runtime hardening (v1.9.3) | ✅ Complete |
| Phase 5 | Mobile + Nodes + Reputation | 🔨 In Progress |
| **Phase Horizon** | NODYX-ETHER — Physical layer sovereignty | 🌌 Vision |
| **Phase Radio** | NODYX-RADIO — Internet radio + cooperative ad network | 📻 Vision |

---

## PHASE 1 — Forum MVP + Admin ✅ COMPLETE
### Goal: A community can install, configure, and live on Nodyx

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
- [x] Homepage = instance community (NODYX_COMMUNITY_NAME via .env)
- [x] Recursive category tree (CategoryTree.svelte)
- [x] Category + thread list page (with tag pills)
- [x] Thread + posts page + reply form
- [x] WYSIWYG editor (Tiptap — bold, code, tables, images, iframes)
- [x] Registration / login form
- [x] Complete user profiles (bio, tags, links, GitHub widget)
- [x] Grade system (admin CRUD + colored badge)
- [x] Instance directory (/communities — powered by nodyx.org)
- [x] Full admin panel (/admin — 9 pages including Tags)
- [x] Adaptive navbar (search, notifications bell, Admin link)
- [x] /search page — Threads/Posts tabs, highlighted excerpts
- [x] /notifications page — list + mark read + 30s polling

### 1.4 Self-hosting
- [x] `install.sh` — one-click VPS installer (ports 80/443, Let's Encrypt via Caddy, PM2, coturn, PostgreSQL, Redis)
- [x] `install_tunnel.sh` — home server installer via Cloudflare Tunnel (no open ports, Raspberry Pi, home box)
- [x] docker-compose.yml (Nodyx + PostgreSQL + Redis)
- [x] Multi-stage Dockerfile
- [x] Seed script (demo data)
- [x] PowerShell "Nodyx-Easy-Install" script — automates Node/PostgreSQL/Redis on Windows Server without Docker
- [x] Visual post-installation health check (braille spinner, PASS/WARN/FAIL score)
- [x] 15-minute installation documentation
- [x] Complete domain name guide (DOMAIN.md — types, compatibility, FAQ)
- [x] Documented .env.example

### Phase 1 success criteria ✅
A non-developer can:
1. Install Nodyx on their server in under 15 minutes ✅
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

### 2.2 nodyx.org — Directory ✅
- [x] Real global directory service — instance registration API
- [x] /communities page fed by the real directory (end of mock)
- [x] Automatic instance registration on first startup
- [x] Automatic ping every 5 minutes (live member count, online stats)

### 2.3 Network identity — `slug.nodyx.org` ✅
- [x] Each instance chooses a unique slug at installation
- [x] The slug is reserved with the nodyx.org directory (REST API)
- [x] Wildcard DNS `*.nodyx.org` managed by our Cloudflare
- [x] Caddy routes `slug.nodyx.org → node IP` (Cloudflare Origin Certificate)
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
- [x] Scheduler — push assets to `nodyx.org` every hour
- [x] Scheduler — clean up expired whisper rooms every 10 minutes
- [x] "🌐 All instances" tab in `/library` — federated assets from the directory
- [x] `/api/v1/whispers` routes — create, retrieve, delete ephemeral rooms
- [x] Socket.IO — `whisper:*` events (join, leave, message, typing, history, expired)
- [x] `/whisper/[id]` page — real-time whisper room (iMessage-style, TTL displayed)
- [x] "🤫 Whisper" button on asset pages — contextual room creation
- [x] "🔗 Share" button — copies link with "✅ Copied!" feedback
- [x] `linkify.ts` — clickable URLs in chat (`linkifyHtml`) and whispers (`linkifyText`)

---

## PHASE 3 — P2P Infrastructure + Rust Foundation ✅ COMPLETE
### Goal: Break free from third-party network dependencies. Build the decentralized core.

> *"P2P is the soul. Rust is the body."*
>
> Nodyx will not replace Node.js or SvelteKit — they do their job perfectly.
> Rust will come **underneath**, invisible to the user, to handle the parts
> that JavaScript can't do well: low-level networking, encryption, WireGuard, DHT.
> The Rust layer communicates with nodyx-core via a local Unix socket — simple and decoupled.

---

### 3.0 — `nodyx-p2p`: The Rust Foundation ✅ COMPLETE

#### Why Rust here?

Today, a user without a domain and without open ports must:
1. Create a Cloudflare account
2. Add their domain to Cloudflare (requires owning one, ~$1/year)
3. Configure `cloudflared` manually or via `install_tunnel.sh`

That's too much friction. And more importantly: **it's a dependency on a third-party service**,
contrary to Nodyx's philosophy.

The Rust layer solves this radically and progressively.

#### Architecture

```
nodyx-frontend (SvelteKit) ──────────────────────┐
nodyx-core    (Fastify/Node.js) ─────────────────┤
                                                  │ IPC (Unix socket)
                                                  ▼
                                    ┌─────────────────────┐
                                    │     nodyx-p2p       │
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

#### Phase 3.0-A — `nodyx-relay-client` ✅ VALIDATED — March 1, 2026

> Replaces `install_tunnel.sh` + Cloudflare Tunnel. Zero domain required. Zero open ports.
> **Tested in real conditions: Raspberry Pi 4, no open ports, no Cloudflare account.**

- [x] Static Rust binary (9MB) — `tokio` + `hyper` + `tokio-postgres` + `clap` + `dashmap`
- [x] Outbound TCP connection to `relay.nodyx.org:7443` (our infrastructure)
- [x] Bidirectional HTTP forwarding (JSON framing, 4-byte length prefix)
- [x] Automatic `slug.nodyx.org` registration without DNS or CF account
- [x] Automatic reconnection with exponential backoff (1s → 2s → 4s → max 30s)
- [x] GitHub Release `v0.1.1-relay` — amd64 + arm64 binaries (fix: concurrent request handling)
- [x] Integration in `install.sh`: option 2 "Nodyx Relay (recommended)"
- [x] Client-side systemd service (`nodyx-relay-client.service`)

**User result:** `bash install.sh` → choose "Relay" → get `mycommunity.nodyx.org` **with zero network configuration**.

#### Phase 3.0-B — Browser P2P Nodes (WebRTC DataChannels) ✅ POC VALIDATED — March 2, 2026

> Users' browsers become active relay nodes.
> Direct peer-to-peer communication without server intermediary.
> **Reuses the existing `voice.ts` signaling** — zero new server infrastructure needed.

**Approach:** Native WebRTC DataChannels + existing Socket.IO signaling (voice.ts pattern)
**Not in this POC:** libp2p (overkill), DHT (2027+)

**v0.8 — Two-browser POC ✅:**
- [x] Add `p2p:offer`, `p2p:answer`, `p2p:ice` events to `voice.ts` (3 lines — same pattern as `voice:offer/answer/ice`)
- [x] Create `nodyx-frontend/src/lib/p2p.ts` — RTCPeerConnection + DataChannel manager
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

#### Phase 3.0-C — `nodyx-turn` (replaces coturn) ✅ VALIDATED — March 4, 2026 / Updated March 8, 2026

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

#### Phase 3.0-D — `nodyx-p2p` core (long-term vision 2027-2028)

> The distributed core. When a node wants to contact another node directly, without going through us.
> Immortal network: every piece of data replicated on 3+ nodes, auto-healing.

- [ ] Kademlia DHT (via `libp2p`) — peer discovery without central server
- [ ] WireGuard (via `wireguard-rs`) — encrypted direct tunnel between voluntary instances
- [ ] Native ICE/STUN — NAT traversal without coturn for P2P connections
- [ ] IPC API exposed to nodyx-core: `relay.register(slug)`, `peer.connect(slug)`, `network.peers()`
- [ ] Gossip protocol — natural state propagation across the network
- [ ] CRDTs — conflict-free distributed data (like counters, presence)
- [ ] Replication factor 3 — auto-healing if a node goes down
- [ ] If `nodyx.org` is unreachable, nodes find each other via DHT (resilience)

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
- [ ] Distributed backup directory — if `nodyx.org` goes down, nodes maintain the directory
- [ ] Automatic transition to direct P2P connection when available
- [ ] Lightweight federation — a member of community A can interact with community B

---

## PHASE 4 — Platform enrichment (v1.4 → v1.8) ✅ COMPLETE
### Goal: Nodyx becomes the complete community platform

**Delivered:**
- [x] **NodyxCanvas** (v0.9) — P2P collaborative whiteboard in voice channels (CRDT LWW, voice-aware cursors, PNG export)
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
- [x] **nodyx-turn — TURN-over-TCP** (v1.3) — RFC 6062, TCP:3478, VPN/firewall bypass for voice
- [x] **nodyx-turn — MESSAGE-INTEGRITY fix** (v1.3) — RFC 5389 §10.3, relay now works in Firefox, Chrome, all WebRTC clients
- [x] **Voice — Relay failover** (v1.3) — auto-restart ICE with `iceTransportPolicy: relay` after 3 consecutive high-loss polls
- [x] **Voice — Opus optimized** (v1.3) — 32 kbps default, DTX off, mono, FEC on
- [x] **Event Calendar** (v1.6) — full CRUD, RSVP, cover upload, `/calendar` + `/calendar/[id]` + edit pages, `can_manage` (author OR mod/admin), extended sanitize-html — [SPEC 011](../en/specs/011-nodyx-event-calendar/SPEC.md)
- [x] **Gossip Protocol** (v1.6) — `announceEventsToDirectory()` every 10 min, `/discover` multi-type (communities + threads + events)
- [x] **Global Search Gossip-based** (v1.5) — `network_index` FTS GIN PostgreSQL, `announceThreadsToDirectory()`, `/discover` with search bar and cross-instance cards, opt-in `NODYX_GLOBAL_INDEXING=true` — [SPEC 010](../en/specs/010-nodyx-global-search/SPEC.md)
- [x] **Admin — Enriched Dashboard** (v1.7) — extended stats (events/polls/assets/chat/DMs), dual 7-day activity chart (posts + new members), top 5 contributors, recent registrations
- [x] **System Announcements** (v1.7) — color-coded banners (6 variants) admin-created, user-dismissible, optional expiry, live preview — `/admin/announcements`
- [x] **Moderation Log** (v1.7) — audit trail for 11 admin action types, action/actor filters, pagination — `/admin/audit-log`, migrations 045-046
- [x] **Lightweight task system** (v1.8) — community Kanban boards, configurable columns, cards with assignee/due date/priority, native HTML5 drag & drop, `/tasks`

---

## PHASE 4.5 — Security Hardening ✅ COMPLETE
### Goal: Harden every surface area before Phase 5 opens the platform to broader use

> *"Shipped fast. Now make it bulletproof."*
> Full security audit conducted March 2026 — before any Phase 5 work begins.

### Audit scope and results

- **38 vulnerabilities** identified and fixed across the entire codebase
- Zero TypeScript compilation errors after all fixes
- All fixes deployed to production without downtime

### Vulnerability categories fixed

**SQL Injection**
- [x] `gardenService` — parameterized queries replacing raw string interpolation
- [x] `notifications` routes — all dynamic filters hardened

**JWT**
- [x] Algorithm confusion attack — explicit `algorithms: ['HS256']` enforced on all `jwt.verify()` calls

**SSRF / DNS Rebinding**
- [x] Open Graph unfurl (`chat:unfurl`) — private IP range blocklist (RFC 1918 + loopback + link-local), hostname resolution check before fetch

**Socket.IO IDOR**
- [x] `chat:react` — ownership/membership check before applying reaction
- [x] `chat:delete` — author or admin validation, no cross-channel deletion
- [x] `voice:stats` — channel membership verified before exposing peer stats
- [x] `jukebox` events — room membership enforced on all queue mutations

**CSS / XSS Injection**
- [x] Profile themes — CSS variable values sanitized, no `url()` / `expression()` / `javascript:` allowed
- [x] Font CSS injection — `font-family` values restricted to allowlist
- [x] GIF URLs — scheme validation + domain allowlist before rendering

**Authentication**
- [x] Enrollment rate limiting — Nodyx Signet registration endpoint protected
- [x] Logout session cleanup — JWT invalidated in Redis on explicit logout
- [x] Assignee validation — task assignee must be a community member

**Cryptography / Input**
- [x] WebP RIFF validation — asset uploads verify magic bytes before Sharp processing
- [x] SMTP header injection — newline stripping on all user-supplied email headers

---

## PHASE 4.6 — Active Defense & Runtime Security ✅ COMPLETE
### Goal: Turn the platform into an active defender — detect, deter, and alert in real time

> *"The best firewall is one that thinks."*
> Phase 4.6 builds on the static hardening of 4.5 with dynamic, runtime security systems.

- [x] **Honeypot** — 25+ scanner paths trapped (`.env`, `.git`, `wp-admin`, `phpmyadmin`, shells, backups…); tarpit 3–7s; geolocation; terminal scare page; DB logging + fail2ban auto-ban
- [x] **fail2ban** — 5 jails: SSH, SSH repeat offenders (permanent), HTTP auth brute force, honeypot (7 days), permanent blacklist
- [x] **`nodyx-auth.log`** — auth route now feeds the fail2ban jail on every failed login (was previously inert)
- [x] **Permanent IP blacklist** — `nodyx-permban` jail (`bantime = -1`) + DB `ip_bans` for known bad actors
- [x] **Discord security monitoring** — real-time embeds for honeypot hits, brute force, admin login, new IP detection, new registrations
- [x] **Argon2id** — new password hashing standard (OWASP 2026); bcrypt hashes transparently migrated on next login
- [x] **Chat anti-spam** — dual sliding window rate limiter (burst + sustained); client-side cooldown UI
- [x] **Content filter** — Nazi/hate symbols (6 Unicode codepoints), image allowlist (Tenor/Giphy only), configurable domain blocklist
- [x] **Optional NSFW scan** — `nsfwjs` + TensorFlow.js on image upload (`NSFW_SCAN=true`)
- [x] **Upload rate limiting** — 10 uploads / 10 minutes / user
- [x] **Email verification** — mandatory when SMTP configured; login blocked for unverified accounts
- [x] **Log rotation** — daily rotation, 90-day retention, compressed
- [x] **Tracking pixel** (v1.9.2) — 1×1 transparent PNG embedded in scare page (`GET /_hp_px/:incidentId`); logged to `honeypot_pixel_hits`; Discord alert on revisits (>30s threshold); cross-correlates pixel IP with original attacker IP
- [x] **Credential harvesting traps** (v1.9.2) — 12 login paths trigger a convincing fake WordPress login form; credentials logged to `honeypot_credential_attempts`; Discord "🔑 Credential Harvest" embed on submission
- [x] **Canary files** (v1.9.2) — 11 file patterns (`.env`, SQL dumps, `id_rsa`, `wp-config.php`…) serve realistic fake credentials; deterministic PRNG seeded by IP — same attacker always sees the same fake data; Discord "📄 Canary" embed
- [x] **Canvas fingerprint** (v1.9.2) — browser JS in scare page POSTs fingerprint hash to `/_hp_fp`; upserted in `honeypot_fingerprints`; Discord "🔍 Fingerprint Reconnu" if visits > 1 (across different IPs)
- [x] **Honeytokens** (v1.9.2) — 3 invisible + 1 quasi-invisible link embedded in scare page HTML; click → Discord "🎯 HONEYTOKEN CLICKED"; high-confidence human attacker signal
- [x] **Slowloris inverse** (v1.9.2) — `reply.hijack()` streams scare page byte-by-byte (96B/180ms browsers, 256B/80ms bots); ties up attacker threads for 45–90s; `raw.destroyed` guard prevents crashes
- [x] **Olympus Hub** (v1.9.2) — security command center: global stats, 48h timeline, top IPs, "PIÈGES ACTIFS" trap aggregation, "CREDENTIAL HARVEST" masked table, "ATTAQUANTS RÉCURRENTS" fingerprint list, tracking pixel section, federated distributed blocklist

---

## PHASE 4.7 — Two-Factor Authentication ✅ COMPLETE
### Goal: Add a strong second factor without sacrificing UX

> *"Something you know + something you have."*
> Phase 4.7 layers cryptographic 2FA on top of the existing auth stack, with Nodyx Signet as the premium path.

- [x] **TOTP (RFC 6238)** — compatible with any authenticator app (Google Authenticator, Aegis, Bitwarden); QR code setup; 6-digit confirmation; Redis-backed 5-min pending session
- [x] **2FA via Nodyx Signet** — if user has a registered Signet device, Signet is used as 2nd factor (ECDSA P-256 > shared TOTP secret); full reuse of existing challenge/approval infrastructure
- [x] **Priority chain** — Signet > TOTP > direct login; system selects the strongest available factor automatically
- [x] **Settings UI** — enable/disable 2FA with QR code display and confirmation code flow
- [x] **Login UI** — seamless second-step: TOTP code input or Signet auto-triggered waiting screen
- [x] **Nodyx Signet PWA rebuild** — stale `nexusnode.app` placeholders replaced with `nodyx.org`

---

## PHASE 4.8 — Production stability & cross-runtime hardening ✅ COMPLETE
### Goal: Make Nodyx imperturbable — every shared state between runtimes consistent, every failure scenario handled

> *"A system is only as stable as its weakest assumption."*
> Phase 4.8 is a full surgical audit across the entire stack — Node.js, Rust, Caddy, PM2, systemd —
> identifying and eliminating silent failure modes that looked fine in development but would corrupt state in production.

- [x] **Redis keyPrefix audit — Node.js** — `ioredis keyPrefix: 'nodyx:'` is the single source of truth; all manual `nodyx:` prefixes removed from auth.ts, adminOnly.ts, socket/index.ts, scheduler.ts, index.ts, routes/admin.ts and 6 test files (double-prefix like `nodyx:nodyx:heartbeat:` was silently writing dead keys)
- [x] **Redis keyPrefix audit — Rust** — Rust has no ioredis keyPrefix; all 11 shared keys now carry `nodyx:` prefix manually: `banned:`, `user_sessions:`, `login_rate:`, `register_rate:`, `reset_rate:`, `resend_verify:`, `resend_verify_ip:` (auth.rs), `banned:` × 2 + `user_sessions:` + `heartbeat:*` scan (admin.rs), `rate:search:` (directory.rs)
- [x] **Cross-runtime ban coherence** — bans set by Node.js (admin panel) or Rust (login ban-cache) are now visible to both runtimes
- [x] **Cross-runtime rate limiting** — login/register/reset/resend-verify rate limits are now shared: an attacker can no longer bypass Node.js rate limiting by hitting the Rust endpoint
- [x] **Online count fixed** — admin dashboard online member count was always 0 (Rust was scanning `heartbeat:*` instead of `nodyx:heartbeat:*`)
- [x] **Session invalidation on password change** — `user_sessions:{id}` index now consistent between both runtimes; changing password invalidates sessions from both Node.js and Rust logins
- [x] **Scheduler fetch timeouts** — `AbortSignal.timeout()` added to all 4 previously unguarded outbound HTTP calls (pingDirectory 8s, pushAssetsToDirectory 15s, announceThreadsToDirectory 10s, announceEventsToDirectory 10s)
- [x] **Caddy — Rust failover** — all 18 `localhost:3100` blocks switched to `lb_policy first` + `fail_duration 30s`; if nodyx-server (Rust) is unreachable, Caddy automatically falls back to nodyx-core (Node.js) — zero downtime on Rust crash
- [x] **install.sh — version centralized** — single `NODYX_VERSION` variable used consistently across `.env` generation, directory registration payload, and post-install summary
- [x] **install.sh — generated Caddyfile hardened** — both relay and normal mode now include security headers, honeypot block, and `header_up -X-Forwarded-For` on all API routes
- [x] **PM2 memory guards** — `max_memory_restart` added to all 4 processes (512M core, 256M frontend, 256M hub, 128M docs)
- [x] **Log rotation** — `/etc/logrotate.d/nodyx-auth` — daily, 30-day retention, compressed
- [x] **systemd rebrand** — `nodyx-relay.service` description and `SyslogIdentifier` updated to `nodyx-relay`

**Validation:** 63/63 Node.js tests green · Rust build 0 errors · Caddy validate OK

---

## PHASE 5 — Mobile + Nodes + Reputation
### Goal: Nodyx in everyone's pocket, with structured knowledge and end-to-end privacy

- [ ] **Nodes** (SPEC 013) — durable structured knowledge, Anchors, community-validated via Garden — [SPEC 013](../en/specs/013-node/SPEC.md)
- [ ] **DMs end-to-end encrypted** — ECDH key exchange + AES-256-GCM per-message encryption, keys never leave the client
- [ ] **Plugin system** — stable external contributor API, plugin marketplace foundations (`plugins/` directory already in place)
- [ ] **Mobile — iOS** via Capacitor
- [ ] **Mobile — Android** via Capacitor
- [ ] **Desktop** via Tauri (.exe/.app/.sh ~10MB, standalone)
- [ ] **Rust migration** — `nodyx-server` Axum crate replacing nodyx-core progressively (directory → auth → search → users → forums → Socket.IO)
- [ ] **NodyxPoints** — inter-instance community reputation system
- [ ] **Badges and levels**
- [ ] **Galaxy Bar** — multi-instance switcher, decentralized SSO, bio-luminescent notifications — [SPEC 012](../en/specs/012-nodyx-galaxy-bar/SPEC.md)
- [ ] **Documented public API** for third-party developers

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
- Features that require a **mandatory** central server (`nodyx.org` is optional — without it, the instance remains fully functional on its own domain)
- Backdoors of any kind
- Permanent dependency on a proprietary third-party service
- Replacing Node.js or SvelteKit with Rust (every tool in its place)

---

---

## PHASE HORIZON — NODYX-ETHER
### The physical layer. The last frontier.

> *"Radio waves don't need permission."*

Nodyx decentralizes the application layer.
But we still depend on one thing: the physical internet infrastructure.
Fiber cables controlled by ISPs. Satellites controlled by corporations.

**NODYX-ETHER decentralizes the physical layer itself.**

The bridge that makes it possible: **CRDTs**.
Already in Nodyx (NodyxCanvas). Already in production.
The same CRDT that synchronizes a whiteboard stroke can synchronize a forum post
over a LoRa link at 250 bps — even with a 2-hour delay.

```
Layer 1 — Local mesh     LoRa / Wi-Fi ad-hoc   0–50 km     no infrastructure
Layer 2 — Regional radio HF / NVIS             500–3000 km  ionospheric bounce
Layer 3 — Ionosphere     HF shortwave          Global       no cables, no satellites
```

```
nodyx-p2p/
└── nodyx-ether/          ← future workspace
    ├── nodyx-modem/      ← software modem (HF / LoRa encoding in Rust)
    ├── nodyx-mesh/       ← LoRa / Wi-Fi ad-hoc mesh relay
    └── nodyx-sync/       ← CRDT delta serialization (Cap'n Proto / FlatBuffers)
```

**nodyx-relay becomes a multi-path orchestrator:**
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

→ **[Full spec: docs/ideas/NODYX-ETHER.md](../ideas/NODYX-ETHER.md)**

---

## PHASE RADIO — NODYX-RADIO
### Internet radio that finally has a reason to exist.

> *"50,000 internet radio operators broadcasting into the void. Nodyx is the signal back."*

The problem no one solved: 100,000+ internet radio stations existed at their peak.
Less than 5% had more than 10 simultaneous listeners.
Not because the programs were bad. Because there was no structure to turn simultaneous listeners into a community.

**Stations that survived** had a community layer structurally attached.
**Stations that died** had audiences but not communities.

The inversion Nodyx makes possible:
```
Dead stations   :  broadcast → hope for community
Living stations :  community → broadcast as expression
```

**A Nodyx instance IS the community layer.** A radio station that runs Nodyx gets:
- Forum (archives, discussions, show notes — indexed by all search engines)
- Live chat (listeners react in real-time during broadcasts)
- Voice channels (open studio, backstage, listener Q&A)
- Garden (community votes on upcoming programs)

**The cooperative ad network — the missing economic model:**

A small station with 80 listeners can't negotiate with advertisers alone.
But 200 Nodyx-Radio stations with 80 listeners each = **16,000 local listeners**.
A local baker, artisan, or event can pay for that reach.

```
nodyx.org/radio
  → cooperative advertising network
  → local/regional advertisers deposit audio spots
  → spots distributed to stations in the targeted region
  → revenue split: 80% station / 20% nodyx.org infrastructure
```

No tracking. No user profiling. Geographic targeting only.
The baker from the village funds the village radio that runs on a Raspberry Pi in the village.
**The money stays local. The infrastructure stays free.**

New stations will emerge because they finally have a community.
And because they can finally sustain themselves.

→ **[Full vision: docs/ideas/NODYX-RADIO.md](../ideas/NODYX-RADIO.md)**

---

*Version 2.2 — March 2026*
*"P2P is the soul. Rust is the body. Radio is the resilience. Community is the reason."*
