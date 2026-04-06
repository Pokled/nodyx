# NODYX

> *"The network is the people."*

**Nodyx** is a decentralized, open source, free community communication platform.

It is the internet of the 2000s rebuilt with the tools of 2026.

---

## Why Nodyx exists

Discord, Facebook, and Big Tech have locked millions of communities inside private silos.
Discussions, tutorials, collective knowledge — invisible to Google, inaccessible without an account, condemned to disappear the day the platform shuts down.

**Nodyx fixes that.**

- Public forums **indexed by all search engines** (Google, Bing, Brave, Qwant...)
- Reactions, thanks, tags, full-text search
- Real-time community **chat** (Socket.IO)
- **Voice** + screen sharing (WebRTC P2P)
- **Self-hostable** on any server
- **P2P network** — users are the network
- **Open source** — AGPL-3.0

---

## One instance = one community

Nodyx is not deployed as a multi-community platform.
**Each Nodyx installation is a sovereign community**, configured via `.env`:

```env
NODYX_COMMUNITY_NAME=Linux & Open Source
NODYX_COMMUNITY_DESCRIPTION=The English-speaking free software community.
NODYX_COMMUNITY_LANGUAGE=en
NODYX_COMMUNITY_COUNTRY=US
NODYX_COMMUNITY_SLUG=linux
```

Instances discover each other through the **nodyx-directory** — the global registry *(Phase 2)*.

---

## Project status

**v2.0.0 — Private & Sovereign Communications**

```
Forum                       ✓  Categories, threads, posts, reactions, thanks, tags, slugs
Full-text search            ✓  PostgreSQL tsvector/GIN, highlighted excerpts
Admin panel                 ✓  Dashboard, members, grades, bans, moderation
SEO                         ✓  Sitemap, RSS, robots.txt, JSON-LD, canonical URLs
Real-time chat              ✓  Socket.IO — channels, replies, pins, link previews, @mentions
Voice channels              ✓  WebRTC P2P mesh — mute, deafen, PTT, noise filter
Screen sharing              ✓  WebRTC screen share + clip recording
P2P DataChannels            ✓  Instant typing, optimistic reactions, file transfer
NodyxCanvas                 ✓  Collaborative P2P whiteboard in voice channels
Notifications               ✓  reply, thanks, @mention — badge, center, auto-purge 30d
Direct messages             ✓  1:1 DMs — E2E encrypted (ECDH P-256 + AES-256-GCM + ESY layer)
  ↳ E2E shield              ✓  Live indicator (green/orange), ESY fingerprint tooltip
  ↳ Barbarize animation     ✓  Encryption visualized — glyphs scramble then reveal in real-time
  ↳ Edit & delete           ✓  Inline edit with re-encryption, real-time delete for all participants
Polls                       ✓  Choice / schedule / ranking — in chat and forum
Ban system                  ✓  User ban, IP ban, email ban
Asset library               ✓  Frames, banners, badges, stickers, sounds, themes, fonts
Profile themes              ✓  6 presets, per-user app-wide CSS, live editor
Mobile UI                   ✓  Bottom nav, chat drawer, voice on mobile
Calendar / Events           ✓  CRUD, RSVP, OSM maps, cover image, rich snippets
Global Search               ✓  Cross-instance FTS index, /discover UI
Federation                  ✓  Instance directory, Galaxy Bar (multi-instance switcher)
Gossip Protocol             ✓  Cross-instance event/thread indexing
Nodyx Signet                ✓  Passwordless ECDSA P-256 auth PWA
2FA (TOTP + Signet)         ✓  RFC 6238 TOTP + Signet as 2nd factor, priority chain
nodyx-relay                 ✓  Rust TCP tunnel — home server, no open ports
nodyx-turn                  ✓  Rust STUN/TURN — replaces coturn, voice through VPNs
Honeypot suite              ✓  Tarpit, canary files, fake logins, pixel, fingerprint, honeytokens, slowloris
Olympus Hub                 ✓  Security command center — live dashboard, credential harvest, distributed blocklist
```

---

## Installation

### Option A — Docker (recommended)

The simplest method. Requires Docker Desktop or Docker Engine.

```bash
git clone https://github.com/Pokled/Nodyx
cd Nodyx/nodyx-core
cp .env.example .env
# Edit .env with your community information
docker-compose up -d
```

The API starts on `http://localhost:3000`

---

### Option B — Windows Server without Docker (PowerShell Easy-Install)

A PowerShell script automates the full installation in under 15 minutes:
Node.js, PostgreSQL, Redis, database configuration, migrations, and registration as a Windows service.

```powershell
# Run PowerShell as Administrator, then:
.\scripts\Install-Nodyx.ps1

# Or with a custom installation path:
.\scripts\Install-Nodyx.ps1 -NodyxPath "D:\Apps\Nodyx"
```

The script automatically installs and configures:
- **Chocolatey** (Windows package manager)
- **Node.js LTS** + **PostgreSQL 16** + **Redis**
- **NSSM** to register Nodyx as a Windows service (auto-start)
- Firewall rule for the API port

---

### Option C — Manual installation (Linux/Mac/Windows)

**Prerequisites:** Node.js 20+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/Pokled/Nodyx
cd Nodyx/nodyx-core
npm install
cp .env.example .env
```

Edit `.env` with your values, then create the database:

```sql
-- As a PostgreSQL superuser
CREATE ROLE nodyx_user LOGIN PASSWORD 'your_password';
CREATE DATABASE nodyx OWNER nodyx_user;
GRANT ALL PRIVILEGES ON DATABASE nodyx TO nodyx_user;
```

Apply migrations:

```bash
# Linux/Mac (peer auth or password)
PGPASSWORD=your_password psql -U nodyx_user -d nodyx -f src/migrations/001_initial.sql
# Migrations are applied automatically at startup — no manual SQL needed

# Windows
$env:PGPASSWORD="your_password"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U nodyx_user -d nodyx -f src\migrations\001_initial.sql
# Migrations are applied automatically at startup — no manual SQL needed
```

Start:

```bash
npm run dev       # development (ts-node, port 3000)
npm run build     # TypeScript compilation
npm start         # production (node dist/)
```

---

## HTTPS reverse proxy — Caddy (recommended)

[Caddy](https://caddyserver.com) is a reverse proxy that automatically manages SSL certificates via Let's Encrypt. No manual SSL configuration.

```bash
# Install Caddy
choco install caddy       # Windows
apt install caddy         # Debian/Ubuntu
brew install caddy        # macOS

# Run with the example configuration (from repo root)
caddy run --config nodyx-core/scripts/Caddyfile.example
```

An annotated example is available in [`nodyx-core/scripts/Caddyfile.example`](../../nodyx-core/scripts/Caddyfile.example).

---

## Environment variables

See [`nodyx-core/.env.example`](../../nodyx-core/.env.example) for the full annotated list.

| Variable | Required | Description |
|---|---|---|
| `NODYX_COMMUNITY_NAME` | Yes | Community display name |
| `NODYX_COMMUNITY_SLUG` | Yes | URL slug (lowercase letters, hyphens) |
| `NODYX_COMMUNITY_LANGUAGE` | No | Language (default: `en`) |
| `JWT_SECRET` | Yes | JWT secret — **32+ random characters in production** |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | Yes | PostgreSQL connection |
| `DB_USER` / `DB_PASSWORD` | Yes | PostgreSQL credentials |
| `REDIS_HOST` / `REDIS_PORT` | No | Redis (default: `localhost:6379`) |
| `PORT` | No | API port (default: `3000`) |
| `NODE_ENV` | No | `development` or `production` |

---

## Tech stack

| Layer | Technology |
|---|---|
| API | TypeScript + Fastify |
| Database | PostgreSQL 16 |
| Cache / Rate limiting | Redis 7 |
| Full-text search | PostgreSQL tsvector + GIN |
| Frontend | SvelteKit + Tailwind v4 |
| Editor | Tiptap (WYSIWYG) |


| P2P | WebRTC DataChannels + nodyx-relay (Rust) |


---

## Demo accounts

After `npm run seed`:

| Email | Password | Role |
|---|---|---|
| `bob@nodyx.demo` | `demo1234` | member |
| `charlie@nodyx.demo` | `demo1234` | owner (gaming) |

---

## Documentation

- [ROADMAP.md](./ROADMAP.md) — The path to the complete vision
- [ARCHITECTURE.md](./ARCHITECTURE.md) — How Nodyx is built
- [CONTRIBUTING.md](./CONTRIBUTING.md) — How to contribute
- [MANIFESTO.md](./MANIFESTO.md) — The founding principles

---

## Contributing

Nodyx belongs to its community. All contributions are welcome.

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before you start.

```
nodyx-plugins/    →  Create plugins
nodyx-themes/     →  Create themes
i18n/             →  Translate into your language
nodyx-docs/       →  Improve documentation
```

---

## License

AGPL-3.0 — The code belongs to its community.

If Nodyx betrays its principles, the Manifesto explicitly authorizes
anyone to fork the project and continue.

---

## Official supervisor

**Iris** — Approves every commit since February 18, 2026. 🐱

---

*Born February 18, 2026 at 11:37 PM.*
*"Fork us if we betray you."*
