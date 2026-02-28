# Nexus

> *"The network is the people."*

**Nexus** is a self-hosted, open-source, decentralized community platform.
Forum + real-time chat + voice channels — on your own server, under your own control.

[![Version](https://img.shields.io/badge/version-v0.3.2-7c3aed)](CHANGELOG.md)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/Pokled/Nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nexus/actions/workflows/ci.yml)
[![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20SvelteKit%20%2B%20PostgreSQL-green)](docs/en/ARCHITECTURE.md)

---

> **[→ Live demo: pokled.ddns.net](https://pokled.ddns.net)** *(self-hosted instance — may occasionally be offline)*

---

## Why Nexus?

Discord, Facebook and Slack locked millions of communities into private silos.
Discussions, tutorials, collective knowledge — invisible to Google, inaccessible without an account, doomed to disappear when the platform closes.

**Nexus fixes that.**

- **Self-hosted** — runs on a Raspberry Pi, a €3 VPS, or your own server
- **One instance = one community** — no multi-tenant platform, no data sharing
- **P2P by design** — no central point of failure
- **Forum indexed by Google** — your knowledge belongs to the internet
- **Real-time chat + voice** — WebRTC P2P mesh, self-hosted TURN relay
- **Open source** — AGPL-3.0, forever

---

## Screenshots

<table>
  <tr>
    <td align="center"><b>Community Home</b></td>
    <td align="center"><b>Forum</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Index_Api-Nexus.png" alt="Community home page" width="460"/></td>
    <td><img src="docs/img/Forum_Api-Nexus.png" alt="Forum category" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Real-time Chat</b></td>
    <td align="center"><b>Voice Channels — WebRTC P2P</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Chat-Texte_Api-Nexus.png" alt="Text chat" width="460"/></td>
    <td><img src="docs/img/Salon-vocal_Api-Nexus.png" alt="Voice channel with P2P mesh visualization" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Admin Panel</b></td>
    <td align="center"><b>Instance Directory</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/AdminPanel_Instance_Api-Nexus.png" alt="Admin dashboard" width="460"/></td>
    <td><img src="docs/img/Annuaire_instances_Api-Nexus.png" alt="Instance directory" width="460"/></td>
  </tr>
</table>

---

## Stack

| Layer | Technology |
|---|---|
| API | TypeScript + Fastify v5 |
| Database | PostgreSQL 16 |
| Cache / Sessions | Redis 7 |
| Full-text search | PostgreSQL FTS (tsvector + GIN) |
| Frontend | SvelteKit 5 + Tailwind v4 |
| Editor | TipTap (WYSIWYG) |
| Real-time | Socket.IO |
| Voice | WebRTC P2P mesh |
| TURN relay | node-turn (self-hosted) |

---

## Quick Start

### Docker (recommended)

```bash
git clone https://github.com/Pokled/Nexus.git
cd Nexus/nexus-core
cp .env.example .env
# Edit .env with your community settings
docker-compose up -d
```

### Manual install

See [docs/fr/README.md](docs/fr/README.md) for the full installation guide (French).
English guide coming soon — contributions welcome.

---

## Project Status

| Feature | Status |
|---|---|
| Forum (categories, threads, posts, reactions, tags) | ✅ Done |
| Full-text search (PostgreSQL FTS) | ✅ Done |
| Real-time chat (Socket.IO) | ✅ Done |
| Voice channels (WebRTC P2P) | ✅ Done |
| Screen sharing | ✅ Done |
| Admin panel | ✅ Done |
| SEO (sitemap, RSS, JSON-LD) | ✅ Done |
| Self-hosted TURN server | ✅ Done |
| Meilisearch | ⏳ Phase 2 |
| Instance directory | ⏳ Phase 2 |
| WireGuard P2P mesh | ⏳ Phase 3 |
| Mobile (Capacitor) / Desktop (Tauri) | ⏳ Phase 5 |

---

## Documentation

| Language | Docs |
|---|---|
| 🇫🇷 Français | [docs/fr/](docs/fr/) |
| 🇬🇧 English | [docs/en/](docs/en/) |
| 🇪🇸 Español | *coming soon* |
| 🇮🇹 Italiano | *coming soon* |
| 🇩🇪 Deutsch | *coming soon* |

- [Manifesto](docs/en/MANIFESTO.md) — Why Nexus exists
- [Architecture](docs/fr/ARCHITECTURE.md) — How it's built
- [Roadmap](docs/fr/ROADMAP.md) — Where we're going
- [Contributing](docs/en/CONTRIBUTING.md) — How to contribute
- [Specs](docs/specs/) — Functional specifications

---

## Contributing

Nexus belongs to its community. All contributions are welcome.

Read [CONTRIBUTING.md](docs/en/CONTRIBUTING.md) before you start.
Commits must follow [Conventional Commits](https://www.conventionalcommits.org/) and be written in **English**.

```
nexus-plugins/    →  Build plugins
nexus-themes/     →  Build themes
docs/             →  Improve documentation
```

---

## License

**AGPL-3.0** — If Nexus ever betrays its principles, this license explicitly allows
anyone to fork the project and continue it in the spirit of the [Manifesto](docs/en/MANIFESTO.md).

---

*Born February 18, 2026. "Fork us if we betray you."*
