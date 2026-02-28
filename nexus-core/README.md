# NEXUS

> *"Le réseau, ce sont les gens."*

**Nexus** est une plateforme de communication communautaire, décentralisée, open source et libre.

C'est l'internet des années 2000 reconstruit avec les outils de 2026.

---

## Pourquoi Nexus existe

Discord, Facebook et les GAFA ont enfermé des millions de communautés dans des silos privés.
Des discussions, des tutoriels, du savoir collectif — invisibles pour Google, inaccessibles sans compte, condamnés à disparaître le jour où la plateforme ferme.

**Nexus répare ça.**

- Forums publics **indexables par Google**
- Réactions, merci, tags, recherche full-text
- **Chat temps réel** communautaire (Socket.IO)
- **Voix P2P + partage d'écran** (WebRTC mesh)
- **Self-hostable** sur n'importe quel serveur
- **Réseau P2P** — les utilisateurs sont le réseau
- **Open source** — AGPL-3.0

---

## Une instance = une communauté

Nexus ne se déploie pas comme une plateforme multi-communautés.
**Chaque installation Nexus est une communauté souveraine**, configurée via `.env` :

```env
NEXUS_COMMUNITY_NAME=Linux & Open Source
NEXUS_COMMUNITY_DESCRIPTION=La communauté francophone du logiciel libre.
NEXUS_COMMUNITY_LANGUAGE=fr
NEXUS_COMMUNITY_COUNTRY=FR
NEXUS_COMMUNITY_SLUG=linux
```

Les instances se découvrent via le **nexus-directory** — l'annuaire global *(Phase 2)*.

---

## État du projet

**v0.3.2 — État actuel**

```
Infrastructure              ✓  Fastify + PostgreSQL + Redis
Forum backend               ✓  25+ routes (auth, forum, grades, admin)
Instance = Communauté       ✓  NEXUS_COMMUNITY_NAME via .env
Catégories infinies         ✓  parent_id récursif + CTE PostgreSQL
Éditeur WYSIWYG             ✓  Tiptap (gras, code, tableaux, images, iframes)
Réactions & Merci           ✓  6 emojis + bouton Merci (+5 karma)
Tags sur les threads        ✓  prédéfinis par l'admin, pills colorées
Recherche full-text         ✓  PostgreSQL tsvector/GIN, extraits surlignés
Notifications               ✓  réponse, merci reçu, @mention + cloche
Panneau admin               ✓  Dashboard, membres, grades, modération, tags
SEO                         ✓  Sitemap, RSS, robots.txt, JSON-LD, llms.txt
Frontend SvelteKit          ✓  SSR + SEO, 20+ pages
Docker self-hosting         ✓  docker-compose.yml
Chat temps réel             ✓  Socket.IO — WebSocket + REST
Salons vocaux               ✓  WebRTC P2P mesh + TURN relay self-hosted
Partage d'écran             ✓  WebRTC screen sharing
Réseau P2P WireGuard        ○  Phase 3
```

---

## Installation

### Option A — Docker (recommandé)

La méthode la plus simple. Nécessite Docker Desktop ou Docker Engine.

```bash
git clone https://github.com/Pokled/Nexus.git
cd nexus-core
cp .env.example .env
# Éditez .env avec les informations de votre communauté
docker-compose up -d
```

L'API démarre sur `http://localhost:3000`

---

### Option B — Windows Server sans Docker (PowerShell Easy-Install)

Un script PowerShell automatise l'installation complète en moins de 15 minutes :
Node.js, PostgreSQL, Redis, configuration de la base, migrations, et enregistrement comme service Windows.

```powershell
# Exécutez PowerShell en tant qu'Administrateur, puis :
.\scripts\Install-Nexus.ps1

# Ou avec un chemin d'installation personnalisé :
.\scripts\Install-Nexus.ps1 -NexusPath "D:\Apps\Nexus"
```

Le script installe et configure automatiquement :
- **Chocolatey** (gestionnaire de paquets Windows)
- **Node.js LTS** + **PostgreSQL 16** + **Redis**
- **NSSM** pour enregistrer Nexus comme service Windows (démarrage automatique)
- Règle de pare-feu pour le port de l'API

---

### Option C — Installation manuelle (Linux/Mac/Windows)

**Prérequis :** Node.js 20+, PostgreSQL 16+, Redis 7+

```bash
git clone https://github.com/Pokled/Nexus.git
cd nexus-core
npm install
cp .env.example .env
```

Éditez `.env` avec vos valeurs, puis créez la base de données :

```sql
-- En tant que superuser PostgreSQL
CREATE ROLE nexus_user LOGIN PASSWORD 'votre_mot_de_passe';
CREATE DATABASE nexus OWNER nexus_user;
GRANT ALL PRIVILEGES ON DATABASE nexus TO nexus_user;
```

Appliquez les migrations :

```bash
# Linux/Mac (peer auth ou mot de passe)
PGPASSWORD=votre_mdp psql -U nexus_user -d nexus -f src/migrations/001_initial.sql
# ... répétez pour 002 à 010

# Windows
$env:PGPASSWORD="votre_mdp"
& "C:\Program Files\PostgreSQL\16\bin\psql.exe" -U nexus_user -d nexus -f src\migrations\001_initial.sql
# ... répétez pour 002 à 010
```

Démarrez :

```bash
npm run dev       # développement (ts-node, port 3000)
npm run build     # compilation TypeScript
npm start         # production (node dist/)
```

---

## Reverse proxy HTTPS — Caddy (recommandé)

[Caddy](https://caddyserver.com) est un reverse proxy qui gère automatiquement les certificats SSL via Let's Encrypt. Aucune configuration SSL manuelle.

```bash
# Installer Caddy
choco install caddy       # Windows
apt install caddy         # Debian/Ubuntu
brew install caddy        # macOS

# Lancer avec la configuration d'exemple
caddy run --config scripts/Caddyfile.example
```

Un exemple commenté est disponible dans [`scripts/Caddyfile.example`](./scripts/Caddyfile.example).

---

## Variables d'environnement

Voir [`.env.example`](./.env.example) pour la liste complète commentée.

| Variable | Obligatoire | Description |
|---|---|---|
| `NEXUS_COMMUNITY_NAME` | Oui | Nom affiché de la communauté |
| `NEXUS_COMMUNITY_SLUG` | Oui | Slug URL (lettres minuscules, tirets) |
| `NEXUS_COMMUNITY_LANGUAGE` | Non | Langue (défaut : `fr`) |
| `JWT_SECRET` | Oui | Secret JWT — **32+ caractères aléatoires en production** |
| `DB_HOST` / `DB_PORT` / `DB_NAME` | Oui | Connexion PostgreSQL |
| `DB_USER` / `DB_PASSWORD` | Oui | Identifiants PostgreSQL |
| `REDIS_HOST` / `REDIS_PORT` | Non | Redis (défaut : `localhost:6379`) |
| `PORT` | Non | Port API (défaut : `3000`) |
| `NODE_ENV` | Non | `development` ou `production` |

---

## Stack technique

| Couche | Technologie |
|---|---|
| API | TypeScript + Fastify |
| Base de données | PostgreSQL 16 |
| Cache / Rate limiting | Redis 7 |
| Recherche full-text | PostgreSQL tsvector + GIN |
| Frontend | SvelteKit + Tailwind v4 |
| Éditeur | Tiptap (WYSIWYG) |
| Desktop | Tauri *(Phase 5)* |
| Mobile | Capacitor *(Phase 5)* |
| Réseau P2P | WireGuard + DHT *(Phase 3)* |
| IA locale | Ollama *(Phase 4)* |

---

## Comptes de démonstration

Après `npm run seed` :

| Email | Mot de passe | Rôle |
|---|---|---|
| `alice@nexus.demo` | `demo1234` | owner (linux) |
| `bob@nexus.demo` | `demo1234` | membre |
| `charlie@nexus.demo` | `demo1234` | owner (gaming) |

---

## Documentation

- [ROADMAP.MD](./ROADMAP.MD) — Le chemin vers la vision complète
- [ARCHITECTURE.MD](./ARCHITECTURE.MD) — Comment Nexus est construit
- [CONTRIBUTING.MD](./CONTRIBUTING.MD) — Comment contribuer
- [NEXUS_CONTEXT.md](./NEXUS_CONTEXT.md) — Vision complète et décisions techniques

---

## Contribuer

Nexus appartient à sa communauté. Toutes les contributions sont les bienvenues.

Lis [CONTRIBUTING.MD](./CONTRIBUTING.MD) avant de commencer.

```
nexus-plugins/    →  Crée des plugins
nexus-themes/     →  Crée des thèmes
i18n/             →  Traduis dans ta langue
nexus-docs/       →  Améliore la documentation
```

---

## Licence

AGPL-3.0 — Le code appartient à sa communauté.

Si Nexus trahit ses principes, le Manifeste autorise explicitement
n'importe qui à forker le projet et continuer.

---

## Superviseure officielle

**Iris** — Approuve chaque commit depuis le 18 février 2026. 🐱

---

*Né le 18 février 2026 à 23h37.*
*"Fork us if we betray you."*
