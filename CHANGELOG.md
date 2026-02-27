# Changelog

All notable changes to Nexus are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [0.3.1] — 2026-02-27

### Fixed
- **Screen sharing in voice channels** — the feature existed but did nothing (video was only shown locally, never sent to peers)
  - `voice.ts`: `startScreenShare()` now adds the video track to all active `RTCPeerConnection`s and triggers renegotiation (`createOffer` → `voice:offer`) for each peer
  - `voice.ts`: `stopScreenShare()` removes video senders and renegotiates to signal end of share
  - `voice.ts`: `ontrack` handler now splits audio/video — video tracks go to `remoteScreenStore`
  - `MediaCenter.svelte`: rewritten to use `startScreenShare`/`stopScreenShare` from `voice.ts`
  - Remote screens visible inside MediaCenter panel (with username + live badge)
  - Clip recording (rolling 60s) now connected to the actual shared stream

---

## [0.3.0] — 2026-02-27

### Added
- **`docker-compose.yml`** — full stack in one command: PostgreSQL 16 + Redis 7 + API + Frontend
  - PostgreSQL healthcheck ensures API waits for DB before starting
  - Volumes for persistent data (`postgres_data`, `redis_data`) and uploads bind-mount
- **`.env.example`** (root) — `DB_PASSWORD` for docker-compose
- **`nexus-core/src/scripts/migrate.ts`** — idempotent SQL migration runner
  - Creates `schema_migrations` tracking table on first run
  - Skips already-applied migrations — safe to call on every boot
- **`nexus-frontend/Dockerfile`** — multi-stage Node.js build (builder → runner, PORT=3001)

### Changed
- **`nexus-core/src/index.ts`** — `runMigrations()` called before `server.listen()`
- **`nexus-core/Dockerfile`** — `src/migrations/` copied into runner image; `uploads/` subdirs created

---

## [0.2.0] — 2026-02-27

### Added
- **Test suite** (nexus-core): 34 Vitest tests covering auth routes, middleware, and forum routes
  - `auth.test.ts` — 13 tests: register/login/logout with mocked DB + Redis
  - `middleware.test.ts` — 10 tests: `requireAuth`, `optionalAuth`, `rateLimit`
  - `forums.test.ts` — 11 tests: GET /threads, POST /threads, POST /posts
- **GitHub Actions CI** — automated test run on every push/PR to `main`
- **Docs restructuring** — all `.MD` files reorganized into `docs/{en,fr,es,it,de}/`
- **Multilingual documentation stubs** — `docs/es/`, `docs/it/`, `docs/de/` ready for future translations
- **Technical specs** moved to `docs/specs/` (8 specs: profiles, grades, social widgets, audio, search, calendar, galaxy bar, node)
- **Root `README.md`** in English with stack table, project status, and multilingual links
- **`Caddyfile.example`** — generic Caddy reverse proxy config
- **`ecosystem.config.example.js`** — PM2 config with relative paths
- **`turn-server/.env.example`** — template env vars for TURN server

### Security
- Removed sensitive files from git tracking: hardcoded IP addresses, absolute paths, user upload assets
- Sanitized `turn-server/server.js`: replaced hardcoded IP (`87.88.104.61`) and domain with env vars (`TURN_EXTERNAL_IP`, `TURN_REALM`)
- Updated `.gitignore` to exclude `uploads/avatars/*`, `uploads/banners/*`, `uploads/logos/*`, `.claude/`, `.nexus-context/`
- Added `.gitkeep` files to preserve `uploads/` directory structure

### Removed
- Dead files: `VoicePanel_old.svelte`, `svelte.config_old.js`, boilerplate SvelteKit README
- Redundant docs scattered across `nexus-core/` root (moved to `docs/`)

---

## [0.1.0] — 2026-02-20

### Added
- **Forum** — categories, threads, posts, reactions, thanks, tags, pin/lock/feature
- **Real-time chat** — channels, WebSocket (send/edit/delete/react/typing), @mentions, notifications
- **Voice channels** — WebRTC P2P mesh, TURN fallback, VAD, network stats (RTT/jitter/loss)
- **Screen sharing + clip recording** — `MediaCenter.svelte` (60s clips, snapshots)
- **User profiles** — avatar/banner upload, GitHub widget, bio, points
- **Communities + roles + permissions** — granular permission system with grades
- **Admin panel** — stats, moderation, branding (logo/banner), category/channel management
- **PostgreSQL full-text search** — instant search across threads and posts
- **Notifications** — reply, mention, thanks events
- **JWT auth** — sessions stored in Redis, 7-day TTL, logout blacklisting
- **Rate limiting** — sliding window via Redis, per-IP with `X-RateLimit-*` headers
- **AI assistant** — local Ollama integration (no cloud dependency)
- **13 SQL migrations** — complete schema from users to voice channels

[Unreleased]: https://github.com/Pokled/Nexus/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Pokled/Nexus/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pokled/Nexus/releases/tag/v0.1.0
