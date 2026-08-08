# Nodyx — Brand & Identity

> **Self-hosted community platform. Forum + Chat + Voice + P2P — on your server, under your control.**

---

## What is Nodyx?

**Nodyx** is a free, open-source, self-hosted community platform built for communities that refuse to depend on third-party platforms.

One command. One server. One community. Forever.

- No Discord lock-in. No Slack pricing. No Reddit moderation.
- Your data stays on your machine — always.
- Built with: **Fastify · SvelteKit · PostgreSQL · Redis · WebRTC · Rust**

---

## Why "Nodyx"?

Each community is a **node** in a decentralized network. Nodyx is the software that makes those nodes possible — independent, interconnected, and owned by their members.

```
Node  +  -yx  =  Nodyx
(network node)   (motion, extension)
```

---

## Official Domains

| Domain | Purpose |
|---|---|
| [nodyx.org](https://nodyx.org) | Production — official live instance |
| [nodyx.dev](https://nodyx.dev) | Development — staging & contributor testing |

---

## Core Values

| Value | What it means |
|---|---|
| **Self-hosted** | You own the server. You own the data. No exceptions. |
| **Decentralized** | One instance = one community. No mega-platform. |
| **Open source** | AGPL-3.0. Fork it, audit it, contribute to it. |
| **P2P first** | Voice, canvas, and relaying use WebRTC + Rust relay — no central broker. |
| **Zero analytics** | No tracking, no telemetry, no ads. Ever. |

---

## Feature Overview

### Forum
- Threaded discussions with WYSIWYG editor (TipTap)
- Categories + subcategories with slugs
- SEO-ready: canonical URLs, Open Graph, JSON-LD, sitemap

### Real-time Chat
- Channels with replies, pins, link unfurl
- Polls, mentions, reactions
- WebSocket via Socket.IO

### Voice & Video
- WebRTC peer-to-peer audio/video
- Screen sharing + clip recording
- Native STUN/TURN (Rust) — `nodyx-turn`

### P2P Features
- **Jukebox** — shared YouTube queue, votes
- **NodyxCanvas** — collaborative drawing (CRDT LWW)
- **P2P Relay** — Rust service for traversal (`nodyx-relay`)

### Extras
- Calendar & Events
- DMs 1:1
- Global discovery (`/discover`) — federated instance directory
- Nodyx Authenticator — PWA with ECDSA P-256 passkeys

---

## Tech Stack

```
Backend   │ Fastify v5 + TypeScript + PostgreSQL + Redis
Frontend  │ SvelteKit 5 + Tailwind v4
Real-time │ Socket.IO (chat) + WebRTC (voice/P2P)
Relay     │ Rust — TCP:7443 / HTTP:7001
TURN      │ Rust — UDP:3478
Auth      │ JWT + Redis sessions + optional ECDSA passkeys
Proxy     │ Caddy (auto HTTPS)
```

---

## Quick Install

```bash
# One-line VPS install
curl -fsSL https://nodyx.org/install.sh | bash

# Or clone and run manually
git clone https://github.com/Pokled/nodyx
cd nodyx && bash install.sh
```

---

## Search Keywords

> *Self-hosted Discord alternative · Open source community platform · Self-hosted forum software · Privacy-first chat · Federated community server · FOSS Discord · Self-hosted Slack · WebRTC voice server · Open source forum · Decentralized community platform*

---

## License

[AGPL-3.0](../LICENSE) — Free to use, modify, and distribute. Modifications must remain open source.

---

---

## Rebrand Migration Checklist — Nexus → Nodyx

> Internal reference. Track progress as the rename rolls out.

### 1. GitHub

- [x] Rename repo `Pokled/Nexus` → `Pokled/nodyx` *(Settings → General → Repository name)*
- [x] Update repo description & topics (add: `nodyx`, `self-hosted`, `community-platform`, `discord-alternative`, `open-source`)
- [x] Update local remote: `git remote set-url origin https://github.com/Pokled/nodyx.git`
- [x] Update GitHub About URL → `https://nodyx.org`

### 2. Cloudflare — nodyx.org

**DNS Records**
- [x] `A     nodyx.org`          → `203.0.113.10`  (Proxied)
- [x] `A     www.nodyx.org`      → `203.0.113.10`  (Proxied)
- [x] `A     relay.nodyx.org`    → `203.0.113.10`  (**DNS only** — TCP:7443 ne passe pas par le proxy CF)
- [x] `A     signet.nodyx.org`   → `203.0.113.10`  (Proxied) — Authenticator PWA
- [x] `A     code.nodyx.org`     → `203.0.113.10`  (Proxied) — VS Code server
- [x] `A     turn.nodyx.org`     → `203.0.113.10`  (**DNS only** — UDP:3478 ne passe pas par le proxy CF)
- [x] `A     *.nodyx.org`        → `203.0.113.10`  (Proxied) — wildcard pour toutes les instances relay

> Le wildcard `*.nodyx.org` remplace les records CF individuels par instance. Plus besoin de créer un record DNS par slug enregistré.

**SSL/TLS**
- [x] Mode : **Full (Strict)**
- [x] Générer un Origin Certificate pour `nodyx.org` + `*.nodyx.org`
- [x] Déposer les fichiers sur le VPS : `/etc/caddy/nodyx.pem` + `/etc/caddy/nodyx.key`
- [x] Mettre à jour la Caddyfile pour pointer sur ces nouveaux fichiers

**Redirect Rules (nexusnode.app → nodyx.org)**
- [x] Dans le dashboard nexusnode.app → Rules → Redirect Rules
- [x] Règle 1 : `Hostname equals nexusnode.app` → `https://nodyx.org${uri}` (301, Dynamic)
- [x] Règle 2 : `Hostname wildcard *.nexusnode.app` → `https://${1}.nodyx.org${uri}` (301, Dynamic) — préserve les slugs des instances existantes
- [x] Vérifier que `signet.nexusnode.app` redirige bien vers `signet.nodyx.org`
- [x] Vérifier que `french-godot.nexusnode.app` redirige bien vers `french-godot.nodyx.org`

**Nettoyage des records CF individuels (anciens slugs)**
- [ ] Les instances avaient un `cloudflare_record_id` dans la DB — ces records `slug.nexusnode.app` sont maintenant inutiles (couverts par le wildcard `*.nexusnode.app` existant + redirect rule)
- [ ] Optionnel : purger les records DNS individuels dans la zone nexusnode.app (ils ne servent plus une fois la redirect rule active)

**Autres réglages recommandés**
- [x] HSTS activé (dans SSL/TLS → Edge Certificates)
- [x] "Always Use HTTPS" activé
- [x] Minimum TLS version : 1.2

### 3. Cloudflare — nodyx.dev

**DNS Records**
- [x] `A     nodyx.dev`          → `203.0.113.10`  (Proxied)
- [x] `A     www.nodyx.dev`      → `203.0.113.10`  (Proxied)

**SSL/TLS**
- [x] Mode : **Full (Strict)**
- [x] Générer un Origin Certificate pour `nodyx.dev` + `*.nodyx.dev`
- [x] Déposer sur le VPS : `/etc/caddy/nodyx-dev.pem` + `/etc/caddy/nodyx-dev.key`

### 4. DNS & Infrastructure VPS

- [x] Vérifier propagation DNS (`dig nodyx.org`, `dig relay.nodyx.org`, `dig signet.nodyx.org`)
- [x] Redémarrer Caddy après mise à jour des certs : `systemctl reload caddy`

### 5. Base de données — Migration des instances existantes ✓

Les `cloudflare_record_id` obsolètes ont été nullifiés. Les `name` étaient déjà des noms d'affichage (pas des subdomains), aucune migration SQL nécessaire.

```sql
-- Vérifier les instances concernées avant de migrer
SELECT slug, name, cloudflare_record_id, status
FROM directory_instances
WHERE name LIKE '%.nexusnode.app';

-- Migrer les subdomains nexusnode.app → nodyx.org
UPDATE directory_instances
SET
  name = REPLACE(name, '.nexusnode.app', '.nodyx.org'),
  cloudflare_record_id = NULL   -- record CF nexusnode.app obsolète, wildcard *.nodyx.org prend le relais
WHERE name LIKE '%.nexusnode.app';

-- Vérifier le résultat
SELECT slug, name, cloudflare_record_id FROM directory_instances;
```

> Les instances reliées par relay continuent de fonctionner : le relay route par slug, pas par domaine complet.

### 6. Caddy (`/etc/caddy/Caddyfile`)

- [x] Remplacer `nexusnode.app` → `nodyx.org`
- [x] Ajouter bloc `nodyx.dev` pour staging
- [x] Mettre à jour `Caddyfile.example` à la racine du repo

### 7. Scripts d'installation

- [x] `install.sh` — ~15 occurrences : `nexusnode.app` → `nodyx.org`, repo clone URL, relay URL
- [x] `install_tunnel.sh` — mêmes remplacements
- [x] `uninstall.sh` — vérifier les références

### 8. Variables d'environnement

- [x] `nodyx-core/.env.example` — `FRONTEND_URL`, `DIRECTORY_API_URL`
- [x] `nodyx-frontend/.env.example` — `PUBLIC_API_URL`
- [x] `.env` de production sur le VPS (ne pas committer)

### 9. Code applicatif

- [x] `nodyx-core/src/index.ts` — CORS origins, références nexusnode.app
- [x] `nodyx-core/src/routes/directory.ts` — URL directory
- [x] `nodyx-core/src/routes/admin.ts` — références
- [x] `nodyx-core/src/scheduler.ts` — ping directory
- [x] `nodyx-core/src/migrations/037_network_index.sql` — seed data
- [x] `nodyx-core/src/migrations/021_directory_assets.sql` — seed data
- [x] `nodyx-core/src/scripts/seed_forum_nodyx.ts` — données de seed
- [x] `nodyx-frontend/src/routes/+layout.server.ts`
- [x] `nodyx-frontend/src/routes/+page.svelte`
- [x] `nodyx-frontend/src/routes/discover/+page.server.ts`
- [x] `nodyx-frontend/src/routes/communities/+page.svelte`
- [x] `nodyx-frontend/src/routes/settings/+page.svelte`
- [x] `nodyx-frontend/src/routes/auth/login/+page.svelte`
- [x] `nodyx-frontend/src/routes/admin/settings/+page.svelte`
- [x] `nodyx-frontend/src/hooks.server.ts`

### 10. Services Rust (nodyx-p2p)

- [x] `nodyx-p2p/crates/nodyx-relay/src/server/http_proxy.rs`
- [x] `nodyx-p2p/crates/nodyx-relay/src/client/mod.rs`
- [x] `nodyx-p2p/crates/nodyx-relay/src/main.rs`
- [x] `nodyx-p2p/crates/nodyx-turn/src/main.rs`

### 11. Documentation

- [x] `README.md` (racine) — lien démo, repo URL, badges
- [x] `docs/en/README.md` + `docs/fr/README.md`
- [x] `docs/en/INSTALL.md` + `docs/fr/INSTALL.md`
- [x] `docs/en/ROADMAP.md` + `docs/fr/ROADMAP.md`
- [x] `docs/en/RELAY.md` + `docs/fr/RELAY.md`
- [x] `docs/en/DOMAIN.md` + `docs/fr/DOMAIN.md`
- [x] `docs/ideas/NODYX-RADIO.md` + `docs/ideas/NODYX-ETHER-GUIDE.md`
- [x] `docs/ideas/NEXUS-ETHER.md` → `NODYX-ETHER.md` (fichier renommé)
- [x] `docs/ideas/NEXUS-ETHER-GUIDE.md` → `NODYX-ETHER-GUIDE.md` (fichier renommé)
- [x] `docs/ideas/NEXUS-RADIO.md` → `NODYX-RADIO.md` (fichier renommé)
- [x] `docs/en/specs/010-nexus-global-search/` → `010-nodyx-global-search/` (répertoire renommé)
- [x] `docs/en/specs/011-nexus-event-calendar/` → `011-nodyx-event-calendar/` (répertoire renommé)
- [x] `docs/en/specs/012-nexus-galaxy-bar/` → `012-nodyx-galaxy-bar/` (répertoire renommé)
- [x] `CHANGELOG.md`
- [x] `nodyx-frontend/README.md`, `nodyx-core/README.md`, `nodyx-authenticator/README.md`
- [x] `nodyx-authenticator/src/routes/setup/+page.svelte`
- [x] `plugins/README.md` + `plugins/table-templates/README.md`

### 12. GitHub Releases & Binaires

- [ ] Prochaine release publiée sous `Pokled/nodyx` (pas l'ancien repo)
- [ ] Mettre à jour les URLs de download dans `install.sh` (`/releases/download/...`)

### 13. Post-migration

- [x] Vérifier que la redirection `nexusnode.app` → `nodyx.org` fonctionne
- [x] Tester `curl https://nodyx.org/install.sh`
- [x] Mettre à jour le badge CI dans `README.md`
- [ ] Annoter la GitHub Release avec la note de rebrand

---

<div align="center">

**nodyx.org** · **nodyx.dev** · [GitHub](https://github.com/Pokled/nodyx)

*"The network is the people."*

</div>
