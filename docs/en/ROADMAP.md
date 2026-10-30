# NODYX, Roadmap

> *"A project that tries to do everything at once does nothing well."*
> The Nodyx roadmap is built on one simple rule: each phase must work perfectly
> before moving to the next.

> This document gives the current state and direction. For the full, line-by-line
> detail of every shipped feature, the
> [CHANGELOG](https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md) is the source of
> truth, it's the only document updated on every release.

---

## CURRENT STATE, October 2026, v2.13.0 on the way

| Phase | Title | Status |
|---|---|---|
| **Phase 1** | Forum MVP + Admin | Complete |
| **Phase 2** | Real-time Chat + Directory + Network Identity | Complete |
| **Phase 2.5** | Community customization + Light federation | Complete |
| **Phase 3** | P2P Infrastructure + Rust Foundation | In progress (see 3.0-D) |
| **Phase 4** | Platform enrichment | Complete |
| **Phase 4.5 to 4.16** | Security hardening, stability, testing, OctoGuard | Complete |
| **Phase 4.17** | Streamer Hub, the full toolkit for streamers | Complete |
| **Phase 4.18** | Next-gen voice: the SFU (audio + video) | Complete |
| **Phase 4.19** | Nodyx speaks eight languages | Complete (translation is ongoing) |
| **Phase 4.20** | Advanced instance customization | Complete |
| **Phase 4.21** | Extension SDK + marketplace | Complete (v1) |
| **Phase 4.22** | Community activities in voice channels | Complete (v1) |
| **Phase 4.23** | Music showcase + public showcase hardening | Complete |
| **Phase 4.24** | Ambiances and the floating shell | Complete |
| **Phase 4.25** | Installer rebuilt, security audit | Complete |
| **Phase 4.26** | Stabilization: hunting bugs in real use | Complete (v2.13) |
| **Phase 4.27** | Light and dark everywhere, appearance settings that make sense | In progress |
| Phase 5 | Mobile + Nodes + Reputation | In progress |
| **Phase Horizon** | NODYX-ETHER, physical layer sovereignty | Vision |
| **Phase Radio** | NODYX-RADIO, internet radio tuner + cooperative ad network | Vision |

Each entry below gives the essentials. Full detail (migrations, files, benchmarks, PRs) lives
in the CHANGELOG at the version listed.

---

## PHASE 1, MVP Forum + Admin (complete)

A community can install, configure, and run on Nodyx in full autonomy.

- Full forum: recursive categories, threads, posts, reactions, tags, full-text search,
  notifications, admin panel
- Native SEO: SSR rendering, sitemap, RSS, JSON-LD, `llms.txt` for AI agents. SEO/GEO hardening
  pass in v2.8 (sitemap fix, unique og:image, install guides)
- Self-hosting in 15 minutes: `install.sh` (VPS), `install_tunnel.sh` (zero port, Raspberry Pi),
  Docker, a Windows script with no Docker required, visual health check after install

**Success criterion**: install, configure, create content, moderate, and get indexed by search
engines, without being a developer. Validated.

---

## PHASE 2, Real-time Chat + Directory + Network Identity (complete)

Members talk live, the directory is real, every instance gets its own URL.

- WebSocket chat (Socket.IO), configurable channels, persisted history
- `nodyx.org` Directory: automatic registration, ping every 5 minutes, a real `/communities` page
- Network identity `slug.nodyx.org`: wildcard DNS, Caddy, zero admin configuration
- Voice channels, network layer: coturn then `nexus-turn` (Rust), WebRTC signaling

---

## PHASE 2.5, Community Customization + Light Federation (complete)

Every instance becomes unique, and instances can share what they create.

- Asset library (frames, banners, badges), Garden (feature proposals + seed voting)
- Cross-instance asset federation, Whispers (ephemeral rooms), clickable URLs

---

## PHASE 3, P2P Infrastructure + Rust Foundation (in progress)

> *"P2P is the soul. Rust is the body."*
> Rust sits below, invisible to the user, handling low-level networking, encryption,
> WireGuard, the DHT. Talks to `nodyx-core` over a local Unix socket.

### 3.0-A, `nodyx-relay-client` (validated, March 2026)
Replaces `install_tunnel.sh` + Cloudflare Tunnel. Zero domain, zero open port, tested on a
Raspberry Pi. Static Rust binary, automatic reconnection, wired into `install.sh`.

### 3.0-B, Browser P2P Nodes (WebRTC DataChannels) (shipped, March 2026)
Browsers become active nodes: 1-N mesh, instant P2P typing indicators, optimistic reactions,
peer-to-peer asset transfer in chunks. Reuses the existing `voice.ts` signaling, zero new server
infrastructure.

### 3.0-C, `nodyx-turn` (replaces coturn) (validated, March 2026)
A 2.9 MB, zero-dependency Rust STUN/TURN server. TURN-over-TCP (RFC 6062), dynamic HMAC
credentials, rate limiting, allocation quotas. Core fix in v2.9: the relay port range now
belongs to the server itself instead of the kernel's ephemeral range (voice was intermittent
for a chunk of self-hosters before this).

### 3.0-D, `nodyx-p2p` core, long-term vision (started)
The distributed core: DHT, WireGuard mesh, gossip, CRDTs, replication, resilience without a
central server.
- [x] **`nodyx-gossip`** (v2.9): peer discovery via epidemic anti-entropy, standard library only,
  Ed25519-signed records (anti-spoofing, anti-replay)
- [ ] Kademlia DHT, encrypted WireGuard mesh, IPC API exposed to `nodyx-core`, 3x replication

### 3.1, Voice Channels, Interface & Advanced Modes
- [x] VoicePanel sidebar, member interaction panel (RTT/jitter/packet loss), self-monitoring
- [ ] Amphitheater mode (1→N broadcast), Nodes-as-a-Service

### v1.0, Collaborative Table (planned)
The voice channel becomes a living space: games, files, shared music, all in the same window.
P2P DataChannel foundation already shipped (v0.9). Still to build: SVG table, `table:*`
protocol, collaborative jukebox, games (dice, chess, poker), a `plugins/table-templates/`
plugin system.

### 3.2, Inter-instance Mesh Network
- [ ] WireGuard mesh, fallback DHT, light federation between communities

---

## PHASE 4, Platform Enrichment (complete)

Nodyx becomes the complete community platform: NodyxCanvas (P2P collaborative whiteboard),
profile themes, mobile-responsive UI, chat replies/quotes and pinned messages, end-to-end
encrypted DMs, polls, multi-layer bans, event calendar, Gossip Protocol for cross-instance
search and discovery, a richer admin dashboard, system announcements, a moderation audit log,
Kanban-style tasks.

Line-by-line detail in the CHANGELOG, versions 1.1 through 1.8.

---

## PHASE 4.5, Security Hardening (complete, March 2026)
SQL injection, JWT, SSRF/DNS rebinding, Socket.IO IDOR, CSS/XSS injection, auth rate limiting,
crypto input validation. The project's first full security audit, before opening up Phase 5.

## PHASE 4.6, Active Defense & Runtime Security (complete)
Honeypot (25+ trapped scanner paths, tarpit, fingerprinting, honeytokens), fail2ban (5 jails),
permanent blocklist, Argon2id, chat anti-spam, content filtering, optional NSFW scanning,
Olympus Hub (security command center).

## PHASE 4.7, Two-Factor Authentication (complete)
TOTP (RFC 6238) and Nodyx Signet as a second factor, priority Signet > TOTP > direct login.

## PHASE 4.8, Production Stability & Cross-Runtime Consistency (complete)
A surgical audit across Node.js/Rust/Caddy/PM2/systemd: unified Redis keyPrefix, bans and rate
limiting consistent across both runtimes, session invalidation on password change, automatic
Caddy failover if the Rust service goes down.

## PHASE 4.9, Process Isolation, Test Coverage & CI (complete)
Every process runs under the `nodyx` system user (nothing but systemd stays root), hardened
file permissions, first Rust tests, critical dependencies pinned, a two-job parallel CI
pipeline.

## PHASE 4.10 through 4.15 (complete)
Living Profile and forum redesign (v1.9.5), end-to-end encrypted DMs (v2.0), Homepage Builder
and Widget SDK v1 (v2.1), NodyxCanvas major upgrade (v2.2), universal media player and tunnel
hardening (v2.3), backup system and live maintenance mode (v2.4).

## PHASE 4.16, OctoGuard Phase 1, Native Auto-moderation (complete, v2.6)
> *"Admin freedom is not negotiable. OctoGuard ships disabled, every rule is opt-in."*

A fail-open auto-mod pipeline under 50ms, ReDoS protection (the `re2` engine), 6 actions
(delete/warn/mute/kick/ban/report_only), a welcome flow, custom commands, mutes, a report
queue, an audit log, an outbound HMAC webhook, a kill switch. 69 tests, p95 benchmarked at
0.2ms.

Phases 2 (XP/levels/leaderboard), 3 (forum moderation, local NSFW filtering) and 4 (external
Bot API, Python SDK) are tracked separately in `docs/specs/016-Octoguard/`.

---

## PHASE 4.17, Streamer Hub, the Full Toolkit for Streamers (complete, v2.5 → v2.8)

A complete two-way bridge between a Nodyx instance and Twitch, built so a streamer stops
juggling three separate SaaS tools.

- **Unified chat**: real-time Twitch ↔ Nodyx bridge (EventSub + Helix, zero IRC), native emotes
  and badges plus BTTV/FFZ/7TV, verified live (277 messages received in a test session)
- **Chat Bot**: recurring timers, six native commands (`!nodyx`, `!uptime`, `!so`...), custom
  commands with configurable cooldown
- **Nodyx Deck**: a mobile-first touch Stream Deck, multi-page, clip/VOD/chat/audio actions, a
  WYSIWYG editor with presets
- **Nodyx Soundboard**: an audio library with ID3 extraction, a dedicated OBS overlay, a public
  viewer queue with anti-spam, a `!nextsound` chat command with fuzzy matching
- **Playlists and OBS scenes**: named playlists controllable from the Deck, a visual OBS-style
  scene composer

Full spec and phase reports in `docs/specs/015-streamer-hub/`.

---

## PHASE 4.18, Next-gen Voice, the SFU (complete, v2.9 → v2.11)

The mesh's math problem (15 viewers at 3 Mbps each is impossible on a residential connection)
had an answer written into the CDC long before it shipped. It's live now.

- **`nodyx-sfu`** (Rust, zero `unsafe`): hexagonal architecture, `VoiceService` behind a
  swap-ready `MediaEngine` trait, proven with 25 tests against a null engine before any real one
- **Audio in production** (v2.10): a mediasoup adapter, the `nodyx-sfud` daemon with
  constant-time token auth, automatic mesh ↔ SFU hybrid switchover
- **Video and screen sharing** (v2.11): a single upstream published and server-side fanned out,
  The Stage (fullscreen with chat and thread in voice channels), a real per-person equalizer, a
  TCP fallback path for ICE
- **Ongoing exploration**: a spike of a fully-Rust media engine (`str0m`) to lift the SFU's last
  "zero open port" constraint. NAT traversal verdict still pending a real residential-box test.
  Detail in `SPECS/NODYX_MEDIA_ENGINE_RUST.md`

---

## PHASE 4.19, Nodyx Speaks Eight Languages (complete, translation is ongoing)

The "nothing left hardcoded" audit is done: the entire interface, public and admin, runs
through translation keys, guarded by five CI gates against regression (including one dedicated
to `.ts` files, a blind spot found along the way).

- Eight languages across the core interface, English at full parity (the execution fallback
  before French), Brazilian Portuguese the first community locale to reach 100% (4,567 keys)
- `nodyx.org/translate`: translation status computed straight from the locale files, a page
  that can't lie, crediting every contributor
- Merging a translation now deploys automatically (it used to sit invisible for days)

---

## PHASE 4.20, Advanced Instance Customization (complete, v2.12)

Born from a real-world test: a genuine multigaming community hit non-configurable elements on
its admin's very first instinct.

- Header widget (Homepage Builder): background and logo positioned and resized independently,
  every element optionally hidden, no misleading fallback values
- Background image for the members sidebar, per-role visibility, adjustable dimming and zoom-out
- Instance theme system (v2.9): the owner sets the base, each member can override it for
  themselves, roughly 800 hardcoded colors tokenized

---

## PHASE 4.21, Extension SDK + Marketplace (complete, v1)

Nodyx can now be extended by third parties without touching the core. Covers a good part of
Phase 5's "documented public API for third-party developers" goal.

- Security-first SDK: an isolated surface, a defined host bridge, per-extension sandboxed
  key/value storage, a projected identity (never real accounts), a network proxy with
  anti-SSRF address pinning, an admin permission screen
- `extensions.nodyx.org`: showcase, registry, index. A first real extension (`next-event`) as
  proof, backed by tests
- Extension surfaces integrated into the homepage and the Homepage Builder

Full CDC in `SPECS/NODYX_SDK_CDC.md`, `SPECS/NODYX_SDK_SECURITY.md`,
`SPECS/NODYX_SDK_REFERENCE.md`.

---

## PHASE 4.22, Community Activities in Voice Channels (complete, v1)

A voice channel can now host an activity, a multiplayer game played while talking, on the same
model as extensions: an app bundle shipped by the instance, a dedicated real-time relay,
Nodyx identity resolved host-side. A Play Store-style gallery, a fullscreen dock, application
storage for scores and match state.

Detail in `SPECS/NODYX_ACTIVITIES_CDC.md`.

---

## PHASE 4.23, Music Showcase + Public Showcase Hardening (complete)

**Music showcase**: a public `/musique` module managed from `/admin/music`, born to host an
in-house game soundtrack and grown generic (editable title, subtitle, banner). Reorderable
categories, one-step upload with anti-malware scanning, a per-category PDF license certificate
generated on the fly.

**Public showcase hardening**, following the September 1st, 2026 incident (a standard member
account pushed spam to the homepage and the federated directory, with no auth bypass at all):
role-restrictable categories, the showcase and directory now limited to threads an admin has
explicitly featured, an IP-ban response that tells the truth when no public address is known.
Full CDC in `SPECS/NODYX_DURCISSEMENT_VITRINE_CDC.md`.

Directly downstream of that incident, a systematic security audit of everything running in
production started mid-September, module by module: the Socket.IO real-time layer, completeness
of admin authorization checks, and an unauthenticated XSS hole found and fixed along the way in
forum thread titles. Still ongoing as this is written.

---

## PHASE 4.24, Ambiances and the Floating Shell (complete, v2.13)

The look of an instance, set in depth by its admin, without ever writing CSS.

- On large screens the content floats in glass panes over the instance's own wallpaper
- Fourteen ready-made ambiances (Matrix, Cyberpunk, Gazette, Ocean...) with real photos under a
  free license, or the admin's own accent, backgrounds, decor and intensity
- Contrast computed, never guessed (at least 4.5:1); a server-side draft nobody sees before
  "Publish", undo and redo, an ambiance code to share
- A pen right on the site to style each zone (background, blur, corners, image, font), with
  bounded settings revalidated by the core

---

## PHASE 4.25, Installer Rebuilt, Security Audit (complete, v2.13)

`install.sh` and `install_tunnel.sh` read line by line, then largely rebuilt, after a bug report
on a minimal Debian 13.

- Updates no longer take the site down: the new version builds alongside, the switch happens
  only if everything succeeded, the database is backed up and checked first
- The real visitor address reaches Nodyx on every kind of install (rate limiting and bans
  depended on it), the firewall can no longer lock the admin out
- Downloaded programs verified by SHA-256, no secret left in a command line or in clear on disk
- Unattended installs (`--yes`, `--network`, password and token files), `nodyx-update`,
  `nodyx-doctor`, `nodyx-recover`, a rewritten `uninstall.sh`
- Test benches for every installer path, run in CI

---

## PHASE 4.26, Stabilization: Hunting Bugs in Real Use (complete, v2.13)

Using Nodyx every day on nodyx.org, and taking the screenshots for this documentation, surfaced
bugs that no test had seen. Each fix ships with a test that fails on the old code, and is checked
live after deployment.

- Canvas: frames, advanced shapes and connectors were lost on reload since v2.2
- Voice: a closed tab left a ghost in the room; someone joining during a screen share never saw it
- A first visit loaded every page twice; forum and sidebar layouts crushed on desktop screens
- Next: making large voice rooms work from a home server too (the `str0m` engine, Phase 4.18),
  so that no Nodyx admin ever has to open a port

---

## PHASE 4.27, Light and Dark Everywhere, Appearance Settings That Make Sense (in progress)

If you pick the light theme, every page should honour it. And an admin should know where to change
what without having to guess.

- Chat, the feed, members, the forum, the wiki, the calendar and tasks already follow the
  instance's ambiance in both themes, and respect the sheet settings (transparency, image) (v2.13)
- Next up: profiles, direct messages, sign-in, the admin area
- A homepage in two versions: the admin designs the grid once, dark or light, and Nodyx works out
  the other one while keeping its colours
- Every appearance setting gathered into one clear path, from the big picture down to the details,
  with each colour telling you where it comes from

---

## PHASE 5, Mobile & Reputation (in progress)
### Nodyx in everyone's pocket

- [ ] iOS app via Capacitor
- [ ] Android app via Capacitor
- [ ] Desktop via Tauri (~10MB, self-contained .exe/.app/.sh)
- [ ] NodyxPoints, a cross-instance community reputation system
- [ ] Badges and levels
- [x] **Public API for third-party developers**: largely covered by the extension SDK, see
  Phase 4.21. Still open: a real third-party marketplace beyond the first proof extension
- [ ] **Nodes**, durable structured knowledge, validated through the Garden, see
  [SPEC 013](specs/013-node/SPEC.md)
- [ ] **Galaxy Bar**, multi-instance switcher, decentralized SSO, see
  [SPEC 012](specs/012-nodyx-galaxy-bar/SPEC.md)

---

## ROADMAP RULES

1. We don't start a phase until the previous one is stable and in use
2. We don't break what works, we offer alternatives (e.g. Relay vs CF Tunnel vs open ports)
3. Complexity is hidden: the user sees a button, the Rust layer handles the complexity
4. Every addition must stay coherent with being decentralized and sovereign
5. The core stays simple, complexity lives in plugins
6. The community can vote to reprioritize future phases

## WHAT NEVER MAKES THE ROADMAP

- Ads, selling data
- Any feature that requires a mandatory central server (`nodyx.org` is optional, without it an
  instance stays fully functional on its own domain)
- A backdoor of any kind
- A permanent dependency on a proprietary third-party service
- Replacing Node.js or SvelteKit with Rust (every tool has its place)

---

## PHASE HORIZON, NODYX-ETHER
### The physical layer. The last frontier.

> *"Radio waves don't need permission."*

Nodyx decentralizes the application layer. But we still depend on one thing: the physical
infrastructure of the internet, fiber cables and satellites controlled by third parties.
NODYX-ETHER decentralizes the physical layer itself, through the same CRDTs already in
production in NodyxCanvas: the mechanism that syncs a brush stroke can sync a forum post over a
250 bit/s LoRa link, even with a two-hour delay.

```
Layer 1, Local mesh        LoRa / Wi-Fi ad-hoc    0-50 km       no infrastructure
Layer 2, Regional radio    HF / NVIS              500-3000 km   ionospheric bounce
Layer 3, Ionosphere        HF shortwave           Global        no cable, no satellite
```

This isn't a feature for tomorrow, it's a call for contributors: ham radio operators, LoRa
makers, Meshtastic contributors, embedded Rust developers. The architecture is there, the CRDT
foundation has shipped, the radio layer is waiting for the right hands.

→ **[Full spec: docs/ideas/NODYX-ETHER.md](https://github.com/Pokled/nodyx/blob/main/docs/ideas/NODYX-ETHER.md)**

---

## PHASE RADIO, NODYX-RADIO
### The internet radio that finally has a reason to exist.

> *"50,000 internet radio operators broadcasting into the void. Nodyx is the answer."*

Fewer than 5% of the 100,000+ internet radio stations at their peak ever had more than 10
concurrent listeners, not because the programming was bad, but because there was no structure
to turn simultaneous listeners into a community. A Nodyx instance IS that community layer: an
indexed forum, live chat during the broadcast, voice channels as an open studio, the Garden to
vote on upcoming shows.

The cooperative ad network is the missing business model: 200 Nodyx-Radio stations with 80
listeners each add up to 16,000 local listeners, a scale a local business or a regional event
can actually pay for. Geographic targeting only, zero tracking, zero user profiles. The money
stays local, the infrastructure stays free.

→ **[Full vision: docs/ideas/NODYX-RADIO.md](https://github.com/Pokled/nodyx/blob/main/docs/ideas/NODYX-RADIO.md)**

---

*Version 2.12.0, September 17, 2026.*
*"P2P is the soul. Rust is the body. Radio is the resilience. Community is the reason."*
