# nodyx-core

The Fastify v5 backend API for [Nodyx](../README.md) — the self-hosted community platform.

Handles all data persistence, authentication, real-time events (Socket.IO), WebRTC signaling, federation, and scheduled tasks.

---

## Stack

| | |
|---|---|
| Runtime | Node.js 20+ |
| Framework | Fastify v5 |
| Language | TypeScript |
| Database | PostgreSQL 16 (pg Pool) |
| Cache / Sessions | Redis 7 (ioredis) |
| Full-text search | PostgreSQL tsvector + GIN indexes |
| Real-time | Socket.IO 4 (attached after `server.listen()`) |
| Auth | JWT Bearer + Redis session (7-day TTL) |
| Migrations | Auto-applied at startup from `src/migrations/` |

---

## Architecture

```
src/
├── index.ts            ← Entry point — registers routes, attaches Socket.IO after listen()
├── config/
│   └── database.ts     ← exports db (pg Pool) + redis (ioredis)
├── middleware/
│   ├── auth.ts         ← requireAuth, optionalAuth, adminOnly
│   ├── permissions.ts  ← community permission checks
│   ├── rateLimit.ts    ← Redis-backed rate limiting
│   └── validate.ts     ← request body validation
├── models/             ← DB query functions per domain
├── routes/             ← One file per domain, all prefixed /api/v1/
│   ├── auth.ts         ← Register, login, reset password
│   ├── authenticator.ts← Nodyx Signet — devices, challenges, enrollment
│   ├── users.ts        ← Profiles, linked instances, presence
│   ├── forums.ts       ← Categories, threads, posts, reactions, thanks
│   ├── chat.ts         ← Channels, messages, pins, unfurl
│   ├── notifications.ts← Notification CRUD + purge
│   ├── dm.ts           ← Direct messages 1:1
│   ├── polls.ts        ← Polls (choice / schedule / ranking)
│   ├── events.ts       ← Event calendar, RSVP
│   ├── garden.ts       ← Community feature voting
│   ├── communities.ts  ← Instance config, members
│   ├── admin.ts        ← Admin panel, bans, grades
│   ├── search.ts       ← Local full-text search
│   ├── directory.ts    ← Federation — instance registry, global search
│   ├── assets.ts       ← Asset library (frames, banners, badges, sounds…)
│   ├── whispers.ts     ← Ephemeral 1h chat rooms
│   └── instance.ts     ← Instance metadata (public info)
├── socket/
│   ├── index.ts        ← Chat events (send, react, typing, DMs…)
│   ├── voice.ts        ← WebRTC signaling (offer/answer/ICE)
│   └── io.ts           ← Shared Socket.IO instance
├── scheduler.ts        ← Periodic tasks (ping directory, purge, index)
└── migrations/         ← 40+ numbered SQL files, auto-applied at boot
```

> **Important:** Socket.IO is attached **after** `server.listen()` — this is a Fastify v5 constraint. Do not move it before `listen()`.

---

## Routes prefix

All REST routes are under `/api/v1/` **except** authenticator routes which are under `/api/auth/` (no `v1`).

| Prefix | Routes |
|---|---|
| `/api/v1/` | All standard routes |
| `/api/auth/` | Nodyx Signet (devices, challenges, enrollment tokens) |

---

## Development

```bash
cd nodyx-core
npm install
npm run dev         # tsx src/index.ts, port 3000
npm run build       # tsc → dist/
npm run test        # vitest run (63 tests, 6 files)
npm run test:watch  # vitest interactive
npm run seed        # seed DB with test data
npm run seed:reset  # drop + reseed
```

---

## Production

```bash
npm run build
pm2 restart nodyx-core   # after build
```

---

## Environment variables

See [`.env.example`](./.env.example) for the full annotated list.

| Variable | Required | Description |
|---|---|---|
| `JWT_SECRET` | Yes | JWT secret — 32+ random chars in production |
| `DB_HOST/PORT/NAME/USER/PASSWORD` | Yes | PostgreSQL connection |
| `REDIS_HOST/PORT` | No | Redis (default: localhost:6379) |
| `FRONTEND_URL` | Yes | Frontend origin for CORS |
| `SIGNET_URL` | No | Nodyx Signet PWA origin for CORS (e.g. `https://signet.nodyx.org`) |
| `NODYX_COMMUNITY_NAME/SLUG/LANGUAGE` | Yes | Community identity |
| `NODYX_MAX_MEMBERS` | No | Member cap (excluded banned users) |
| `NODYX_GLOBAL_INDEXING` | No | `true` to opt into cross-instance search |
| `DIRECTORY_API_URL` | No | Federation directory URL |
| `STUN_FALLBACK_URLS` | No | Fallback STUN for relay-mode voice |
| `NODE_ENV` | No | `development` or `production` |

---

## Migrations

Migrations are numbered SQL files in `src/migrations/` and applied **automatically at startup**:

```
001_initial.sql          ← Core schema
002–010                  ← Forum, auth, SEO, chat, voice
011–020                  ← Notifications, assets, P2P, garden
021–030                  ← DMs, polls, ban system, profiles
031–043                  ← Slugs, calendar, global search, Signet
```

To add a new migration: create `044_description.sql` (increment the number).

---

## Auth model

- **JWT Bearer** token sent in `Authorization: Bearer <token>` header
- **Redis session** `session:<token>` with 7-day TTL
- **Online presence** tracked via `heartbeat:<userId>` (15-min TTL)
- **Nodyx Signet** (passwordless): ECDSA P-256 challenge/response, devices stored in `signet_devices`

---

## Demo accounts

After `npm run seed`:

| Email | Password | Role |
|---|---|---|
| `alice@nodyx.demo` | `demo1234` | owner |
| `bob@nodyx.demo` | `demo1234` | member |

---

## Tests

```bash
npm run test
```

63 tests, 6 files. Pattern notes:
- Use `vi.resetAllMocks()` (not `clearAllMocks`) in `beforeEach` when using `mockResolvedValueOnce`
- `rowCount` is `null` for SELECT queries in node-postgres — use `rows.length` instead

---

## Part of the Nodyx monorepo

```
Nodyx/
├── nodyx-core/           ← Fastify API (this folder)
├── nodyx-frontend/       ← SvelteKit community app
├── nodyx-authenticator/  ← Nodyx Signet PWA (passwordless login)
├── nodyx-relay/          ← Rust P2P TCP tunnel
├── nodyx-turn/           ← Rust STUN/TURN server
└── docs/
```

→ See the [main README](../README.md) for full architecture and setup.
