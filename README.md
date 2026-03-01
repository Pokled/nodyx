<div align="center">
  <img src="docs/img/nexus-logo.png" alt="Nexus" width="220"/>

  <p><em>"The network is the people."</em></p>

  <p><strong>Self-hosted, open-source, decentralized community platform.<br/>Forum + real-time chat + voice channels — on your own server, under your own control.</strong></p>

  [![Version](https://img.shields.io/badge/version-v0.5.0-7c3aed)](CHANGELOG.md)
  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
  [![CI](https://github.com/Pokled/Nexus/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nexus/actions/workflows/ci.yml)
  [![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20SvelteKit%20%2B%20PostgreSQL-green)](docs/en/ARCHITECTURE.md)
</div>

---

> **[→ Live: nexusnode.app](https://nexusnode.app)** — official instance, production VPS

> ⚠️ **Alpha stage** — Forum, real-time chat, and voice channels are functional. P2P federation, global directory, and mobile apps are still in development. Not yet recommended for large-scale production use.

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

<div align="center">
  <img src="docs/img/Nexus-reseau.png" alt="Nexus network architecture — self-hosted, P2P, federated" width="700"/>
  <p><em>Your instance. Your users. Your data. No central server.</em></p>
</div>

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

## How Nexus compares

|  | **Nexus** | Discord | Matrix | Discourse | Lemmy | NodeBB |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Self-hosted | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ |
| Forum indexed by Google | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| Real-time chat | ✅ | ✅ | ✅ | ⚠️ | ❌ | ❌ |
| Voice channels | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Screen sharing | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| P2P voice (no Big Tech relay) | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| No account required to read | ✅ | ❌ | ❌ | ✅ | ✅ | ✅ |
| **Community directory** | ✅ | ❌ | ⚠️ | ❌ | ✅ | ❌ |
| Open source | ✅ AGPL | ❌ | ✅ Apache | ✅ GPL | ✅ AGPL | ✅ GPL |
| Forum + Chat + Voice in one | ✅ | ⚠️ | ❌ | ❌ | ❌ | ❌ |

> Nexus is the only self-hosted platform combining an **indexed forum**, **real-time chat**, **P2P voice**, and a **federated community directory** in a single install.
> Matrix has chat+voice but no indexed forum. Discourse has forum+chat but no voice. Lemmy has a directory but no voice or real-time chat.

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
| TURN relay | coturn (self-hosted) |
| **P2P relay** | **Rust — tokio + hyper (nexus-relay)** |

---

## Quick Start

### ⚡ One-click install (recommended)

One command. A few questions. Everything configured automatically.

```bash
git clone https://github.com/Pokled/Nexus.git
cd Nexus
sudo bash install.sh
```

The installer offers **three network modes**:

| Mode | Requirements | Result |
|---|---|---|
| **Open ports** | Ports 80 + 443 open, domain or IP | Let's Encrypt HTTPS, full control |
| **Nexus Relay** ⭐ | Nothing — outbound TCP only | `yourcommunity.nexusnode.app` in minutes |
| **Cloudflare Tunnel** | CF account + own domain | Your custom domain, no open ports |

> **Nexus Relay** is the recommended default — works on a Raspberry Pi behind a home router, no domain, no port forwarding, no Cloudflare account.

The script installs and configures Node.js, PostgreSQL, Redis, coturn (TURN relay), Caddy (HTTPS), and PM2. It detects your public IP, generates secure secrets, bootstraps the community, and creates your admin account. **No manual configuration needed.**

> Supported: Ubuntu 22.04/24.04, Debian 11/12. Windows users → [WSL guide](docs/en/INSTALL.md#-windows-users--wsl-guide).

→ **[Complete installation guide (EN)](docs/en/INSTALL.md)** — VPS, WSL, home server, NAT, common errors, tips
→ **[Guide d'installation complet (FR)](docs/fr/INSTALL.md)** — VPS, WSL, serveur maison, NAT, erreurs, astuces

### Docker

```bash
git clone https://github.com/Pokled/Nexus.git
cd Nexus
cp nexus-core/.env.example nexus-core/.env
# Edit nexus-core/.env with your community settings
docker-compose up -d
```

---

## Project Status

| Feature | Status |
|---|---|
| Forum (categories, threads, posts, reactions, tags) | ✅ Done |
| Full-text search (PostgreSQL FTS) | ✅ Done |
| Real-time chat (Socket.IO) | ✅ Done |
| Voice channels (WebRTC P2P) | ✅ Done |
| Screen sharing + clip recording | ✅ Done |
| Admin panel | ✅ Done |
| SEO (sitemap, RSS, JSON-LD) | ✅ Done |
| Self-hosted TURN server (coturn) | ✅ Done |
| One-click installer (`install.sh`) | ✅ Done |
| Instance directory + auto DNS | ✅ Done |
| **nexus-relay — P2P relay (no domain, no open ports)** | ✅ **Done** — Phase 3.0-A |
| **Voice member stats & interaction panel** | ✅ **Done** |
| Rust STUN/TURN server (`nexus-turn`) | ⏳ Phase 3.0-B |
| WireGuard P2P mesh (inter-instance) | ⏳ Phase 3.0-C |
| File sharing + collaborative whiteboard | ⏳ Phase 4 |
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
- [Architecture](docs/en/ARCHITECTURE.md) — How it's built
- [Roadmap](docs/en/ROADMAP.md) — Where we're going
- [Contributing](docs/en/CONTRIBUTING.md) — How to contribute
- [Audio Engine](docs/en/AUDIO.md) — Broadcast EQ, RNNoise, audio chain explained
- [Neural Engine](docs/en/NEURAL-ENGINE.md) — Local AI with Ollama
- [Specs](docs/specs/) — Functional specifications (FR) / [EN](docs/en/specs/)

---

## Contributing

Nexus belongs to its community. All contributions are welcome.

1. Browse [open Issues](https://github.com/Pokled/Nexus/issues) or start a [Discussion](https://github.com/Pokled/Nexus/discussions)
2. Read [CONTRIBUTING.md](docs/en/CONTRIBUTING.md) before opening a PR
3. Commits follow [Conventional Commits](https://www.conventionalcommits.org/), written in **English**

Where to contribute freely — no validation required:

```
nexus-plugins/    →  Build plugins
nexus-themes/     →  Build themes
docs/             →  Improve or translate documentation
i18n/             →  Translate into your language
```

The **core** (`nexus-core/src/`) requires discussion first — open an Issue.

---

## License

**AGPL-3.0** — If Nexus ever betrays its principles, this license explicitly allows
anyone to fork the project and continue it in the spirit of the [Manifesto](docs/en/MANIFESTO.md).

---

*Born February 18, 2026. "Fork us if we betray you."*
