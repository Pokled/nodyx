# NODYX — Architecture
### Version 1.0 — Technical reference document

---

> This document is the technical law of Nodyx.
> No architectural decision may be changed without project lead validation.
> Read this document before any implementation.

---

## 1. OVERVIEW

```
CLIENT
SvelteKit PWA / Tauri / Capacitor
        |
        | HTTP / WebSocket
        |
NODYX CORE API
Fastify + TypeScript
/api/v1/...   +   Socket.io (real-time)
        |               |               |
   PostgreSQL        Redis         Meilisearch
   Persistent      Cache/PubSub    Search
   data                             SEO
```

---

## 2. API ROUTE STRUCTURE

All routes start with `/api/v1/`

```
/api/v1/
├── health                  GET  — Infrastructure status
├── auth/
│   ├── register            POST — Account creation
│   ├── login               POST — Login
│   └── logout              POST — Logout
├── communities/
│   ├── /                   GET  — List communities
│   ├── /                   POST — Create a community
│   ├── /:slug              GET  — One community
│   └── /:slug/members      GET  — Members
├── forums/
│   ├── /:community         GET  — Forum categories
│   ├── /categories         POST — Create a category
│   ├── /threads            GET  — Thread list
│   ├── /threads            POST — Create a thread
│   ├── /threads/:id        GET  — One thread + posts
│   └── /posts              POST — Create a post
├── users/
│   ├── /:id                GET  — Public profile
│   └── /me                 GET  — My profile
└── search/
    └── /                   GET  — Global search
```

---

## 3. POSTGRESQL DATA MODEL

### Why PostgreSQL 16 (and not 17 or 18)

Nodyx ships with **PostgreSQL 16**. This is a deliberate choice, not a lag.

**Why 16 is the right baseline for Nodyx today:**

- **It's what Ubuntu 24.04 LTS ships by default.** `apt install postgresql` on a fresh Ubuntu 24.04 server installs PG 16. Picking the distro default keeps `install.sh` short, predictable, and free of third-party PPAs that admins might not trust. Less moving parts at install time means fewer breakages on real-world VPSes.
- **Upstream support runs until November 2028.** PostgreSQL has a 5-year support window per major version. PG 16 is supported with security and bug fixes for 2+ more years. We are not on a deprecated version.
- **Nodyx uses zero features specific to PG 17 or 18.** Our migrations rely on standard SQL plus widely-available extras: `JSONB`, `UUID`, `tsvector` full-text search, `CREATE INDEX CONCURRENTLY`, partial indexes, `IF NOT EXISTS` everywhere. These have been stable since PG 12+. We would gain literally nothing functional by upgrading.
- **The performance and feature gains from 17/18 don't apply at our scale.** Improvements like streaming I/O, logical replication slot sync, or vectorized JSON path are aimed at multi-terabyte deployments or replication-heavy architectures. A Nodyx instance is "one community on one VPS" — these gains don't move the needle.

**When we will migrate:**

The plan is to skip PG 17 and move directly to **PG 18** once Ubuntu 26.04 LTS ships it as the default (expected mid-2026). At that point the installer will update transparently for new installs, and we will provide a documented `pg_upgradecluster` path for existing instances. Until then, **staying on PG 16 is the boring, reliable, recommended choice**.

If you need PG 18 today for a specific reason (e.g. you are integrating Nodyx with another stack that requires it), you can add the official PostgreSQL APT repository and migrate manually with `pg_upgradecluster`. Open a thread on the forum if you want a walkthrough.

### Main tables

```sql
-- Users
users (
  id          UUID PRIMARY KEY,
  username    VARCHAR(50) UNIQUE,
  email       VARCHAR(255) UNIQUE,
  password    VARCHAR(255),
  avatar      VARCHAR(500),
  bio         TEXT,
  points      INTEGER DEFAULT 0,
  created_at  TIMESTAMP,
  updated_at  TIMESTAMP
)

-- Communities
communities (
  id          UUID PRIMARY KEY,
  name        VARCHAR(100),
  slug        VARCHAR(100) UNIQUE,
  description TEXT,
  avatar      VARCHAR(500),
  owner_id    UUID references users(id),
  is_public   BOOLEAN DEFAULT true,
  created_at  TIMESTAMP,
  updated_at  TIMESTAMP
)

-- Forum categories
categories (
  id           UUID PRIMARY KEY,
  community_id UUID references communities(id),
  name         VARCHAR(100),
  description  TEXT,
  position     INTEGER,
  created_at   TIMESTAMP,
  updated_at   TIMESTAMP
)

-- Threads (topics)
threads (
  id           UUID PRIMARY KEY,
  category_id  UUID references categories(id),
  author_id    UUID references users(id),
  title        VARCHAR(300),
  is_pinned    BOOLEAN DEFAULT false,
  is_locked    BOOLEAN DEFAULT false,
  views        INTEGER DEFAULT 0,
  created_at   TIMESTAMP,
  updated_at   TIMESTAMP
)

-- Posts (replies)
posts (
  id          UUID PRIMARY KEY,
  thread_id   UUID references threads(id),
  author_id   UUID references users(id),
  content     TEXT,
  is_edited   BOOLEAN DEFAULT false,
  created_at  TIMESTAMP,
  updated_at  TIMESTAMP
)

-- Community members
community_members (
  community_id UUID references communities(id),
  user_id      UUID references users(id),
  role         VARCHAR(20),
  joined_at    TIMESTAMP
)
```

### Relationships
```
users ----------< community_members >---------- communities
communities ----< categories
categories -----< threads
threads --------< posts
users ----------< posts
users ----------< threads
```

---

## 4. REDIS — USAGE

```
User sessions           nodyx:session:{token}       TTL 7 days
Profile cache           nodyx:user:{id}              TTL 1 hour
Thread cache            nodyx:thread:{id}            TTL 5 minutes
Chat Pub/Sub            nodyx:chat:{community_id}    Real-time
Notification Pub/Sub    nodyx:notif:{user_id}        Real-time
Rate limiting           nodyx:rate:{ip}              TTL 1 minute
```

---

## 5. PLUGIN ARCHITECTURE

Plugins extend Nodyx without modifying the core.

```
nodyx-plugins/
└── my-plugin/
    ├── plugin.json      — Plugin manifest
    ├── index.ts         — Entry point
    ├── routes/          — Additional API routes
    ├── migrations/      — Additional PostgreSQL tables
    └── ui/              — Additional SvelteKit components
```

### plugin.json
```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "author": "Contributor",
  "nodyxVersion": ">=1.0.0",
  "hooks": ["onPostCreate", "onUserJoin"],
  "routes": "/api/v1/plugins/my-plugin"
}
```

### Available hooks
```
onUserRegister      — After account creation
onUserJoin          — After joining a community
onThreadCreate      — After thread creation
onPostCreate        — After post creation
onCommunityCreate   — After community creation
```

---

## 6. SECURITY

```
Authentication    Signed JWT + refresh token in Redis
Passwords         bcrypt (cost factor 12)
Rate limiting     Redis — 100 req/min per IP
Validation        Zod on all inputs
CORS              Configurable per instance
Headers           Helmet.js (XSS, CSP, HSTS)
```

---

## 7. SOURCE FILE STRUCTURE

```
nodyx-core/src/
├── index.ts                — Server entry point
├── fortunes.ts             — Random quotes
├── config/
│   └── database.ts         — PostgreSQL + Redis connections
├── routes/
│   ├── auth.ts             — Authentication
│   ├── communities.ts      — Communities
│   ├── forums.ts           — Forum + threads + posts
│   ├── users.ts            — Profiles
│   └── search.ts           — Search
├── models/
│   ├── user.ts             — User model
│   ├── community.ts        — Community model
│   ├── thread.ts           — Thread model
│   └── post.ts             — Post model
├── middleware/
│   ├── auth.ts             — JWT verification
│   ├── rateLimit.ts        — Redis rate limiting
│   └── validate.ts         — Zod validation
├── migrations/
│   └── 001_initial.sql     — Initial schema
└── plugins/
    └── loader.ts           — Plugin loader
```

---

## 8. RULES

1. Always create SQL migrations before TypeScript code
2. Always validate inputs with Zod
3. Always go through models, never direct SQL in routes
4. Always commit after each created file
5. Never put business logic in index.ts
6. One route file = one functional domain
7. All routes return JSON
8. Errors always follow the format: `{ error: string, code: string }`

---

*Version 1.0 — February 2026*
*"The network is the people."*
