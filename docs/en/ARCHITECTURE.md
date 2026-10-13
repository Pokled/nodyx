# Architecture

How a Nodyx instance is put together, what runs where, and why. This page describes the code as it is today; when the code changes, this page changes with it.

## The founding rule

**One instance = one community.** A Nodyx server hosts a single community: its forum, its chat, its voice rooms, its members. There is no multi-tenant mode and no central server. Instances find each other through an opt-in directory, and an instance keeps working if nodyx.org disappears.

## The big picture

```
                 Browser (SvelteKit app, installable as a PWA)
                          |  HTTPS + WebSocket
                          v
                      Caddy (reverse proxy, TLS)
             /api/* and /socket.io/*          everything else
                    |                               |
                    v                               v
          nodyx-core (port 3000)          nodyx-frontend (port 5173)
          Fastify v5 + TypeScript         SvelteKit 5, server-side rendering
          REST API + Socket.IO
              |            |
              v            v
         PostgreSQL      Redis
         all data        sessions, presence, rate limits, queues
```

Voice and video do not travel through this path: they go browser to browser over WebRTC, with Rust helpers for the cases where a direct link is impossible (see [Voice and video](#voice-and-video)).

## The two main applications

### nodyx-core: the API

- **Fastify v5 + TypeScript**, compiled to `dist/` and run by PM2.
- **REST API under `/api/v1/`**, one file per domain in `src/routes/` (about 35 files: auth, forums, chat, dm, users, polls, events, wiki, tasks, canvas, music, extensions, admin, and more).
- **Socket.IO** for everything real time: chat, presence, typing, voice signaling, the collaborative canvas, whisper rooms. It is attached **after** `server.listen()`, a constraint of Fastify v5.
- **Middleware** in `src/middleware/`: `requireAuth`, `optionalAuth`, `adminOnly`, permissions, rate limiting, validation (zod).
- **Migrations** in `src/migrations/`, plain numbered SQL files applied automatically at startup. A database change is always a new file, never an edit of an old one.

### nodyx-frontend: the interface

- **SvelteKit 5 + Tailwind v4**, served by the Node adapter with server-side rendering.
- Pages render on the server first, so a visitor sees content before JavaScript loads, and search engines index the forum.
- During server-side rendering, the frontend calls the core directly on the local network instead of going back out through the internet.
- **Translations** live in `src/lib/locales/*.json`. French is the source language. CI gates refuse hardcoded strings, missing keys and broken placeholders.

## Data

| Store | What it holds |
|---|---|
| **PostgreSQL** | Everything durable: members, forum, chat history, events, polls, wiki, settings, audit logs. |
| **Redis** | Short-lived state: login sessions, online presence, rate-limit counters, job queues. All keys share the `nodyx:` prefix. |
| **Local disk** | Uploaded files (avatars, images, audio), served by the instance itself. |

Search uses PostgreSQL full-text indexes. There is no separate search engine to run.

## Accounts and security

- **Sign-in**: a JWT bearer token, backed by a Redis session (7 days). Logging out or resetting a password revokes the session server side.
- **Two-factor authentication**: TOTP codes (RFC 6238), computed offline in any authenticator app.
- **Nodyx Signet**: passwordless sign-in from a phone, with an ECDSA P-256 key that never leaves the device.
- **Private messages are end-to-end encrypted** in the browser (ECDH P-256 key agreement, AES-GCM). The server stores only ciphertext. An optional backup, locked by a recovery phrase on the device, lets a member read their history on another device.
- **Public data is whitelisted**: user records go through dedicated serializers, so a new database column never leaks by accident.

## Voice and video

```
   small room:  browser <-------- WebRTC (direct, P2P) --------> browser
                       \                                      /
                        `---- nexus-turn (relay if blocked) --'

   large room:  browser ----> nodyx-sfud (SFU) ----> every other browser
```

- **By default, rooms are peer to peer (mesh)**: audio and screen sharing go directly between participants. The core only relays the signaling.
- **nexus-turn** (Rust, replaces coturn) relays the stream when two participants cannot reach each other directly.
- **nodyx-sfud** is an optional SFU daemon (mediasoup today, behind an engine interface built to switch to a pure Rust engine). When it is enabled, a room switches from mesh to SFU once it reaches a participant threshold, and stays there until it empties. The switch is seamless: the mesh stays up until every participant is ready on the SFU.
- The audio chain (noise suppression, noise gate, broadcast EQ) runs in the browser, before anything is sent.

## Running without opening a port

A community should not need a public IP address or an open router port. **nexus-relay** (Rust) provides a tunnel: the instance dials out to a relay, and the relay brings visitors back in through a subdomain such as `your-community.nodyx.org`. The tunnel works over a dedicated port or over plain HTTPS (WebSocket on 443), so it also works from networks that only allow web traffic.

## The network

Instances stay independent and choose what they share:

- **Directory** (nodyx-hub): an instance can register so others can find it.
- **Global discovery**: with `NODYX_GLOBAL_INDEXING=true`, an instance shares public threads and events with the network search on `/discover`.
- **Gossip** (nodyx-gossip, Rust): peer discovery without a central server. In development.

## Extending an instance

- **Widgets**: blocks for the homepage builder, installed from a zip package.
- **Extensions**: run in a sandboxed iframe and receive only the permissions the administrator grants at install time.
- **Extension store**: [extensions.nodyx.org](https://extensions.nodyx.org) lists published packages.

## The repository

| Folder | Role |
|---|---|
| `nodyx-core/` | The API (TypeScript). |
| `nodyx-frontend/` | The interface (SvelteKit). |
| `nodyx-p2p/` | The Rust workspace: `nexus-relay` (tunnel), `nexus-turn` (TURN), `nodyx-sfu` (SFU), `nodyx-gossip` (discovery), `nodyx-server` (an Axum port of the API, in progress, not yet serving traffic). |
| `nodyx-authenticator/` | Nodyx Signet, the phone app for passwordless sign-in. |
| `nodyx-hub/` | The instance directory. |
| `nodyx-store/` | The extension store. |
| `nodyx-docs/` | This documentation site, [nodyx.dev](https://nodyx.dev). |
| `nodyx-landing/` | The presentation site, [start.nodyx.org](https://start.nodyx.org). |
| `docs/` | The documentation pages, in several languages. |
| `scripts/` | Install, update and operations scripts, with their tests. |

## Running it yourself

`install.sh` (classic server) and `install_tunnel.sh` (no open port, through the relay) set up PostgreSQL, Redis, Caddy, PM2 and the Rust services, then build the applications. Updates go through the same scripts: the new version is built next to the running one, and the switch only happens once everything has succeeded. See the [installation guide](./INSTALL.md).
