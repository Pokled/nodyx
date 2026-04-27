<div align="center">

<img src="docs/img/nodyx-icon.svg" alt="Nodyx" width="80"/>

# Nodyx

### *"Le réseau, c'est les gens."*

**La plateforme communautaire auto-hébergée qui vous appartient vraiment.**  
Forum + Chat + Voix + P2P + Canvas + Constructeur de page d'accueil + SDK Widget — un seul serveur, une communauté, pour toujours.

[![Version](https://img.shields.io/badge/version-v2.2.0-7c3aed)](CHANGELOG.md)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml)
[![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20SvelteKit%20%2B%20PostgreSQL%20%2B%20Rust-green)](docs/en/ARCHITECTURE.md)
[![Ko-fi](https://img.shields.io/badge/Soutenir-Ko--fi-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/Pokled)

<sub>⭐ Si Nodyx vous parle, une étoile aide les autres à le trouver — et nous garde en vie.</sub>

</div>

---

<div align="center">

**[📖 Documentation → nodyx.dev](https://nodyx.dev)** &nbsp;·&nbsp;
**[🚀 Démo en direct → nodyx.org](https://nodyx.org)** &nbsp;·&nbsp;
<a href="README.md"><img src="https://flagcdn.com/16x12/gb.png" alt="EN"> English</a> · <a href="docs/fr/README.md"><img src="https://flagcdn.com/16x12/fr.png" alt="FR"> Français</a>

</div>

---

<div align="center">
  <img src="docs/img/nodyx_home_page.png" alt="Nodyx — Constructeur de page d'accueil" width="860"/>
</div>

---

## Pourquoi Nodyx

- **Discord** enferme les communautés dans une plateforme privée — vos 10 ans d'historique disparaissent si elle ferme ou vous bannit
- **Les forums** sont lents et fragmentés — pas de voix, pas de temps réel, invisibles dans le quotidien de vos membres
- **Les outils auto-hébergés** combinent rarement chat + voix + base de connaissances consultable en une seule installation — et aucun ne vous laisse construire votre propre page d'accueil

Nodyx les réunit tous. Une commande. Votre serveur. Pour toujours.

### Construit sur

| Couche | Technologie |
|---|---|
| API Backend | **TypeScript** + **Fastify v5** + Socket.IO — `nodyx-core/` |
| Frontend | **SvelteKit 5** + Tailwind v4 + éditeur TipTap — `nodyx-frontend/` |
| Base de données | **PostgreSQL 16** (FTS, migrations) + **Redis 7** (sessions, présence) |
| Relais voix | **nodyx-turn** — STUN/TURN en Rust (remplace coturn, binaire de 2,9 Mo) |
| Tunnel P2P | **nodyx-relay** — tunnel TCP Rust (serveur domestique, sans ports ouverts) |
| Temps réel | Maillage P2P WebRTC + fallback Socket.IO |
| Auth (optionnel) | **Nodyx Signet** — PWA sans mot de passe ECDSA P-256 — `nodyx-authenticator/` |
| Gestionnaire de processus | **PM2** sous un utilisateur système dédié `nodyx` |
| Proxy inverse | **Caddy** — TLS Let's Encrypt automatique |

> **Docker non requis.** L'installateur déploie Node.js + PostgreSQL + Redis + Caddy + PM2 nativement. `docker-compose.yml` est fourni uniquement pour le développement local.

---

## Internet a cassé quelque chose.

Discord, Facebook, Slack — ils n'ont pas construit des communautés. Ils les ont capturées.

Dix ans de discussions. Tutoriels. Savoir collectif. Souvenirs.
Enfermés dans des silos. Invisibles aux moteurs de recherche. Disparus quand la plateforme le décide.

**Vous n'en avez jamais été propriétaire.**

---

## Nodyx vous le rend.

Une commande. Votre serveur. Vos règles. Votre communauté — définitivement.

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Fonctionne sur un Raspberry Pi derrière un routeur domestique. Sans domaine. Sans ports ouverts. Sans compte cloud.

---

## Ce qui distingue Nodyx

### La seule plateforme avec tout ça en une seule installation

| | **Nodyx** | Discord | Matrix | Discourse | Lemmy |
|---|:---:|:---:|:---:|:---:|:---:|
| Auto-hébergé | ✅ | ❌ | ✅ | ✅ | ✅ |
| Open source | ✅ AGPL | ❌ | ✅ | ✅ | ✅ |
| Forum indexé par Google | ✅ | ❌ | ❌ | ✅ | ✅ |
| Chat en temps réel | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Salons vocaux | ✅ | ✅ | ✅ | ❌ | ❌ |
| Partage d'écran | ✅ | ✅ | ✅ | ❌ | ❌ |
| Voix P2P — zéro relais Big Tech | ✅ | ❌ | ❌ | ❌ | ❌ |
| Canvas P2P collaboratif | ✅ | ❌ | ❌ | ❌ | ❌ |
| DataChannels P2P (frappe instantanée, réactions) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Serveur domestique (sans redirection de ports) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Annuaire fédéré de communautés | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| Bibliothèque d'assets (cadres, badges, bannières) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Salles chuchotées éphémères | ✅ | ❌ | ❌ | ❌ | ❌ |
| Connexion sans mot de passe (ECDSA P-256 PWA) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Jukebox P2P collaboratif (file YouTube) | ✅ | ❌ | ❌ | ❌ | ❌ |
| Calendrier d'événements (cartes OSM, RSVP, SEO) | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| Recherche globale inter-instances | ✅ | ❌ | ❌ | ❌ | ✅ |
| Thèmes de profil par utilisateur (à l'échelle de l'app) | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Constructeur de page d'accueil — 11 zones, drag & drop** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Boutique de widgets — installer des widgets externes via .zip** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **SDK Widget — créez vos propres widgets, sans framework** | ✅ | ❌ | ❌ | ❌ | ❌ |

> Nodyx est la seule plateforme auto-hébergée combinant un **forum indexé**, un **chat en temps réel**, une **voix P2P**, un **canvas collaboratif**, un **annuaire fédéré** et une **page d'accueil entièrement extensible** en une seule installation.

---

## Constructeur de page d'accueil + SDK Widget

Nodyx est livré avec un **Constructeur de page d'accueil drag-and-drop** et un **SDK Widget** complet — deux fonctionnalités qu'aucune autre plateforme communautaire auto-hébergée ne propose.

### 11 zones de mise en page

Placez des widgets n'importe où sur votre page d'accueil. Les positions disponibles sont :

```
banner          → bandeau d'annonce pleine largeur en haut
hero            → section héro principale
stats-bar       → compteurs communautaires (membres, en ligne, posts)
main            → au-dessus du contenu principal
sidebar         → colonne de droite (carte d'adhésion, etc.)
half-1 / half-2 → grille 2 colonnes
trio-1/2/3      → grille 3 colonnes
footer-1/2/3    → colonnes de pied de page
footer-bar      → bande de pied de page pleine largeur
```

### 4 widgets natifs (Phase 1)

| Widget | Description |
|---|---|
| **Bannière Héro** | Héro animé avec variantes live/événement/nuit résolues côté serveur |
| **Barre de stats** | Compteurs animés de membres, d'utilisateurs en ligne et de fils de discussion |
| **Carte d'adhésion** | CTA pour les visiteurs, masquée pour les membres connectés |
| **Bannière d'annonce** | Bandeau info/avertissement/erreur avec icône, refermable |

### Boutique de widgets — installation en un clic

N'importe quel développeur peut packager un widget en `.zip` et l'installer sur n'importe quelle instance Nodyx :

```
my-widget-1.0.0.zip
├── manifest.json     ← id, label, version, schéma (champs de config)
└── widget.iife.js    ← Web Component — isolé en Shadow DOM
```

Le panneau d'administration gère l'upload, la validation, l'extraction et l'activation. Pas de recompilation, pas de déploiement.

### SDK Widget — créez le vôtre, zéro outil de build

Les widgets sont des **Custom Elements** standard (Web Components). JavaScript pur, pas de React, pas de Vue, pas de npm.

```javascript
class MyWidget extends HTMLElement {
  connectedCallback() { this._render() }

  _render() {
    var cfg = JSON.parse(this.dataset.config || '{}')
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' })
    this.shadowRoot.innerHTML = `<div>Bonjour ${cfg.title}</div>`
  }
}
customElements.define('nodyx-widget-my-widget', MyWidget)
```

→ **[Guide complet pas à pas pour non-développeurs → nodyx.dev/create-widget](https://nodyx.dev/create-widget)**

---

## La Stack P2P — 100% Rust écrit à la main

C'est là que Nodyx va plus loin que quiconque.

### nodyx-turn — serveur STUN/TURN en Rust *(remplace coturn)*

coturn est le standard de l'industrie — un serveur C mature utilisé par Signal, Jitsi, Matrix.
Nous l'avons remplacé par un **binaire Rust de 2,9 Mo** qui fait exactement ce dont Nodyx a besoin. Rien de plus.

```
RFC 5389 (STUN) + RFC 5766 (TURN) + RFC 6062 (TURN-over-TCP)
Identifiants basés sur le temps HMAC-SHA1 (username={expires}:{userId})
MESSAGE-INTEGRITY sur toutes les réponses (RFC 5389 §10.3) — compatible Firefox/Chrome
Limitation de débit + quotas d'allocation (MAX_LIFETIME=300s) + carte de bannissement
Runtime async tokio — UDP:3478 + TCP:3478 (contournement VPN/pare-feu)
Zéro dépendance coturn en production
```

### nodyx-relay — tunnel TCP P2P en Rust *(sans domaine, sans ports ouverts)*

Un Raspberry Pi sous votre bureau. Sans domaine. Sans redirection de ports sur le routeur. Sans compte Cloudflare.
Faites tourner Nodyx quand même.

```
nodyx-relay server  →  écoute TCP:7443 + HTTP:7001
nodyx-relay client  →  tunnel TCP persistant → expose le port local 80
```

- Reconnexion automatique avec backoff exponentiel (1s → 30s max)
- Authentification JWT par instance
- Routage par slug : `votreclub.nodyx.org` → proxifié vers le Pi derrière votre routeur
- Validé sur un vrai Raspberry Pi 4 sans aucun port ouvert ✅

### DataChannels WebRTC — P2P sans le serveur

Messages entre pairs qui ne passent jamais par le serveur.

- **Indicateurs de frappe instantanés** — < 5ms de latence locale (vs 80–200ms via serveur)
- **Réactions emoji optimistes** — apparaissent instantanément, le serveur confirme en arrière-plan
- **Transfert de fichiers P2P** — assets partagés directement entre pairs
- **Fallback élégant** — si le DataChannel est indisponible (NAT strict), Socket.IO prend le relais en transparence

### NodyxCanvas — Tableau blanc collaboratif (v2.2)

<div align="center">
  <img src="docs/img/Nodyx_canvas_alternative_Mural.png" alt="NodyxCanvas — tableau blanc collaboratif" width="860"/>
</div>

Dessinez, annotez et construisez ensemble en temps réel — directement dans les salons vocaux.
Synchronisé via CRDT Socket.IO. Chaque opération est persistante (snapshot PostgreSQL JSONB).

```
CRDT Last-Write-Wins par élément (UUID + timestamp)
canvas:op / canvas:clear / canvas:cursor / canvas:chat  →  Socket.IO
Curseurs conscients de la voix : le curseur d'un pair pulse quand il parle
Panneau de participants en temps réel avec outil actif + avatar
Chat propre au tableau (indépendant du chat du salon vocal)
```

**Outils (v2.2) :**

| Outil | Touche | Description |
|---|---|---|
| Sélection | V | Déplacer + redimensionner avec 8 poignées (coins + points médians) |
| Stylo | P | Dessin à main levée — couleur, largeur, opacité |
| Texte | T | Texte inline riche — gras/italique/souligné/barré, alignement, police, taille |
| Post-it | N | Note autocollante — 8 couleurs, multiligne |
| Rect / Cercle | R / C | Remplissage + contour avec couleurs et largeur indépendants |
| Forme | S | Formes avancées — triangle, losange, étoile, hexagone, nuage |
| Flèche | A | Flèches stylisées — pleine/tiretée/pointillée, 3 types de pointe |
| Connecteur | X | Connecteurs intelligents — droit/bézier/coudé, pointes début+fin indépendantes |
| Image | I | Glisser-déposer ou sélecteur de fichier → uploadé dans `/assets`, rendu sur le canvas |
| Cadre | F | Section nommée — étiquette + bordure tiretée, regroupe les éléments visuellement |
| Gomme | E | Gomme ponctuelle |

**Fonctionnalités du canvas :**
- Annuler / Rétablir — pile de 50 opérations par session, Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z
- Aimantation à la grille — grille monde de 28px, activable (G)
- Zoom — Ctrl+Molette, pincement, ou boutons de la barre d'outils (5% → 1000%)
- Panoramique — Espace+glisser ou glisser avec le bouton central
- Barre de bas de page — % de zoom, bascule grille, bascule aimantation
- Exporter PNG — télécharge le canvas complet, publie un récapitulatif dans le salon de chat

---

## Captures d'écran

<div align="center"><sub>Communauté · Constructeur · Admin · Fonctionnalités — tout tourne sur une seule installation</sub></div>

<br/>

<div align="center"><b>— Expérience communautaire —</b></div>

<table>
  <tr>
    <td align="center"><b>Page d'accueil — Constructeur de grille</b></td>
    <td align="center"><b>Forum</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/nodyx_home_page.png" alt="Page d'accueil avec widgets du Constructeur de grille" width="460"/></td>
    <td><img src="docs/img/Nodyx_Forum.png" alt="Forum — catégories, fils, éditeur riche" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Chat en temps réel</b></td>
    <td align="center"><b>Salons vocaux — WebRTC P2P</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Nodyx_chat.png" alt="Chat texte en temps réel" width="460"/></td>
    <td><img src="docs/img/Vocal_Nodyx_salon.png" alt="Salon vocal avec maillage P2P" width="460"/></td>
  </tr>
</table>

<br/>

<div align="center">

<b>— Constructeur de page d'accueil —</b>

<img src="docs/img/Nodyx_grid_builder_home_page_website.png" alt="Constructeur de page d'accueil — drag & drop, 11 zones, aperçu en direct" width="940"/>

<sub>Éditeur de grille drag-and-drop — 11 zones de mise en page, aperçu en direct, règles d'audience par widget et planification</sub>

</div>

<br/>

<table>
  <tr>
    <td align="center"><b>Boutique de widgets — installation via .zip</b></td>
    <td align="center"><b>Gestion des modules</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/widget_store_nodyx.png" alt="Boutique de widgets — installation .zip en un clic" width="460"/></td>
    <td><img src="docs/img/Nodyx_gestion_des_modules.png" alt="Gestion des modules — 26 modules activables" width="460"/></td>
  </tr>
</table>

<br/>

<div align="center"><b>— Fonctionnalités —</b></div>

<table>
  <tr>
    <td align="center"><b>Recherche inter-instances</b></td>
    <td align="center"><b>Sondages — Forum & Chat</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Nodyx_Moteur_de_recherche_inter_reseau.png" alt="Moteur de recherche fédéré inter-instances" width="460"/></td>
    <td><img src="docs/img/Nodyx_sondage.png" alt="Sondages avec résultats en temps réel" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Wiki</b></td>
    <td align="center"><b>Bibliothèque d'assets</b></td>
  </tr>
  <tr>
    <td><img src="docs/img/Nodyx_wiki.png" alt="Wiki communautaire" width="460"/></td>
    <td><img src="docs/img/Asset_nodyx.png" alt="Bibliothèque d'assets — cadres, badges, bannières" width="460"/></td>
  </tr>
</table>

---

## Démarrage rapide

### Prérequis

L'installateur gère tout automatiquement. Votre système n'a besoin que de **`curl`** et **`git`** pour démarrer.

```bash
# Ubuntu / Debian
apt-get install -y git curl
```

**Les limites mémoire PM2 sont automatiquement ajustées à votre machine :**

| RAM totale | nodyx-core | nodyx-frontend | Swap auto | Fonctionne sur |
|---|---|---|---|---|
| < 1,5 Go | 256 Mo | 192 Mo | 2 Go créés | Raspberry Pi 1 Go |
| 1,5 – 3 Go | 384 Mo | 256 Mo | 1 Go si besoin | RPi 4 / petit VPS |
| ≥ 3 Go | 512 Mo | 512 Mo | 1 Go si besoin | VPS standard ⭐ |

> Raspberry Pi : utilisez un **OS 64 bits** (Raspberry Pi OS 64-bit ou Ubuntu ARM64). Le 32 bits n'est pas pris en charge.

### Installation en un clic

```bash
curl -fsSL https://nodyx.org/install.sh | bash
```

Ou clonez d'abord :

```bash
git clone https://github.com/Pokled/Nodyx.git && cd Nodyx && sudo bash install.sh
```

L'installateur propose **trois modes réseau** :

| Mode | Prérequis | Résultat |
|---|---|---|
| **Nodyx Relay** ⭐ | Rien — TCP sortant uniquement | `votreclub.nodyx.org` en quelques minutes |
| **Ports ouverts** | Ports 80 + 443, domaine ou IP | HTTPS Let's Encrypt, contrôle total |
| **Cloudflare Tunnel** | Compte CF + domaine perso | Votre domaine personnalisé, sans ports ouverts |

> **Nodyx Relay** est la valeur par défaut recommandée — fonctionne sur un Raspberry Pi derrière un routeur domestique.
> Sans domaine. Sans redirection de ports. Sans compte cloud. Lancez simplement le script.

Installe automatiquement : **Node.js 20, PostgreSQL 16, Redis 7, Caddy (HTTPS), PM2, nodyx-turn** (Rust STUN/TURN).  
Génère les secrets, exécute toutes les migrations de la base de données, crée votre compte administrateur. **Sans Docker. Sans configuration manuelle.**

> Pris en charge : Ubuntu 22.04 / 24.04, Debian 11 / 12 / 13.

→ **[Guide d'installation complet (EN)](docs/en/INSTALL.md)**  
→ **[Guide d'installation complet (FR)](docs/fr/INSTALL.md)**

### Mise à jour d'une instance existante

```bash
cd /var/www/nexus && git pull && \
  cd nodyx-core && npm run build && sudo -u nodyx pm2 restart nodyx-core && \
  cd ../nodyx-frontend && npm run build && sudo -u nodyx pm2 restart nodyx-frontend
```

Les migrations de base de données sont appliquées automatiquement au démarrage — pas de SQL manuel.

---

## Architecture

### Structure du dépôt

```
nodyx/
├── nodyx-core/          → API REST Fastify v5 + TypeScript, Socket.IO, migrations DB
├── nodyx-frontend/      → SPA SvelteKit 5 + Tailwind v4 (SSR + hydratation client)
├── nodyx-p2p/           → Workspace Rust : nodyx-relay (tunnel TCP) + nexus-turn (STUN/TURN)
├── nodyx-authenticator/ → Nodyx Signet — PWA auth sans mot de passe ECDSA P-256 (SvelteKit 5)
├── nodyx-hub/           → Olympus Hub — tableau de bord admin interne (SvelteKit 5)
├── nodyx-docs/          → Site de documentation nodyx.dev (SvelteKit 5)
├── docs/                → Docs Markdown (EN + FR) — servies par nodyx-docs
├── install.sh           → Installateur en un clic (Node + PG + Redis + Caddy + PM2, sans Docker)
├── ecosystem.config.js  → Config des processus PM2 (production)
└── docker-compose.yml   → Développement local uniquement — non utilisé en production
```

### Fédération — comment ça fonctionne

Chaque instance Nodyx fait tourner un scheduler **Protocole Gossip** qui pinge périodiquement l'annuaire central (`nodyx.org/api/directory`). Les instances partagent leurs métadonnées publiques (nom, slug, URL, nombre de membres) et sont découvrables via la page `/discover` sur n'importe quelle instance. Les événements (calendrier) se fédèrent entre instances via le même mécanisme gossip. Il n'y a aucune dépendance à ActivityPub — le protocole est intentionnellement minimal et autonome.

### Diagramme d'exécution

```
┌─────────────────────────────────────────────────────────────┐
│                      Votre Navigateur                        │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP / WebSocket             │ WebRTC P2P
               ▼                             ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│   nodyx-core (Fastify)   │    │  Connexion directe entre   │
│   nodyx-frontend (Svelte)│    │  pairs — DataChannels +    │
│   PostgreSQL + Redis     │    │  Canvas + Voix + Partage   │
└──────────────────────────┘    └────────────────────────────┘
               │                             │
        ┌──────┴──────┐               ┌──────┴──────┐
        │ nodyx-relay │               │ nodyx-turn  │
        │ (Rust TCP)  │               │ (Rust TURN) │
        │ serveur dom.│               │ bypass NAT  │
        └─────────────┘               └─────────────┘
```

| Couche | Technologie |
|---|---|
| API | TypeScript + Fastify v5 — `nodyx-core/` |
| Base de données | PostgreSQL 16 · 53 migrations — automatiques au démarrage |
| Cache / Sessions | Redis 7 — sessions JWT, présence, limitation de débit |
| Recherche plein texte | PostgreSQL FTS (tsvector + GIN) — inter-instances via Gossip |
| Frontend | SvelteKit 5 + Tailwind v4 — `nodyx-frontend/` |
| Éditeur | TipTap (WYSIWYG) |
| Temps réel | Socket.IO (polling en premier, upgrade WebSocket) |
| Voix | Maillage P2P WebRTC — sans relais audio central |
| Relais TURN | **nodyx-turn** — Rust 2,9 Mo, remplace coturn |
| Relais P2P | **nodyx-relay** — tunnel TCP Rust, fonctionne sur serveurs domestiques |
| Canvas collaboratif | **NodyxCanvas** — CRDT LWW, sync Socket.IO, 11 outils, poignées de redimensionnement, annuler/rétablir |
| Page d'accueil | **Constructeur de page d'accueil** — 11 zones, drag & drop, règles de visibilité |
| Widgets | **Boutique de widgets** — installation .zip + **SDK Widget** (Web Components) |
| Auth sans mot de passe | **Nodyx Signet** — ECDSA P-256 PWA — `nodyx-authenticator/` |

---

## Ce qui est fait. Ce qui arrive.

<details>
<summary><b>v0.1 → v1.3 — Fondations</b></summary>

| Fonctionnalité | Version |
|---|---|
| Forum (catégories, fils, posts, réactions, tags) | v0.1 |
| Recherche plein texte (PostgreSQL FTS) | v0.1 |
| Chat en temps réel (Socket.IO) | v0.1 |
| Salons vocaux (WebRTC P2P) | v0.1 |
| Partage d'écran + enregistrement de clip | v0.2 |
| Panneau d'administration | v0.2 |
| SEO (sitemap, RSS, JSON-LD) | v0.3 |
| Installateur en un clic | v0.4 |
| Annuaire d'instances + DNS automatique | v0.5 |
| nodyx-relay — tunnel TCP P2P en Rust | v0.5 |
| Bibliothèque d'assets communautaires (cadres, bannières, badges) | v0.6 |
| Feature Garden — vote communautaire | v0.6 |
| Annuaire d'assets fédéré (partage inter-instances) | v0.7 |
| Chuchotements — salles de chat chiffrées éphémères (TTL 1h) | v0.7 |
| DataChannels P2P — frappe instantanée, réactions optimistes | v0.8 |
| nodyx-turn — Rust STUN/TURN remplaçant coturn | v0.9 |
| NodyxCanvas — tableau blanc P2P collaboratif | v0.9 |
| Système de thèmes de profil — 6 préréglages, moteur CSS par utilisateur à l'échelle de l'app | v1.0 |
| Interface responsive mobile | v1.0 |
| Chat — Répondre/citer, messages épinglés, aperçus de liens, badge @mention | v1.1 |
| Présence — Statut personnalisé + liste des membres hors ligne | v1.1 |
| Messages directs (DM) — conversations privées 1:1 | v1.2 |
| Sondages — dans le chat et le forum, 3 types, résultats en temps réel | v1.2 |
| Système de bannissement — IP ban, email ban, application multicouche | v1.2 |
| nodyx-turn — TURN-over-TCP (RFC 6062) | v1.3 |
| Voix — Basculement vers le relais + ajustement Opus | v1.3 |

</details>

<details>
<summary><b>v1.4 → v1.9 — Sécurité & Finitions</b></summary>

| Fonctionnalité | Version |
|---|---|
| URLs de fils par slug + SEO complet (canonical, OG, JSON-LD, sitemap) | v1.4 |
| Slugs de catégories + sous-catégories | v1.5 |
| Recherche globale — index FTS inter-instances, UI /discover | v1.5 |
| Calendrier d'événements — CRUD, RSVP, cartes OSM, image de couverture, rich snippets | v1.6 |
| Protocole Gossip — fédération d'événements entre instances | v1.6 |
| Nodyx Signet — PWA d'authentification sans mot de passe ECDSA P-256 | v1.7 |
| Inscription QR + UI Optimiste + Centre de notifications | v1.7 |
| Tâches / Kanban — tableaux par communauté, drag & drop, échéances | v1.8 |
| Alerte de mise à jour + affichage de la version de l'instance | v1.8 |
| Audit de sécurité paranoïaque complet — 38 vulnérabilités corrigées | v1.8.2 |
| Honeypot — 25+ chemins de scanner piégés ; tarpit ; géolocalisation ; journalisation DB | v1.9.0 |
| fail2ban — 5 jails : SSH, force brute, honeypot (7j), liste noire permanente | v1.9.0 |
| Argon2id — hashage de mots de passe OWASP 2026 | v1.9.0 |
| 2FA TOTP (RFC 6238) + 2FA via Nodyx Signet | v1.9.1 |
| Pièges de collecte de credentials + fichiers Canary + empreinte Canvas | v1.9.2 |
| Slowloris inverse — streaming octet par octet brûle les threads de l'attaquant 45–90s | v1.9.2 |
| Tableau de bord de sécurité Olympus Hub | v1.9.2 |
| Isolation des processus — tous les processus sous l'utilisateur système `nodyx` | v1.9.4 |
| 181 tests Node.js + 18 tests unitaires Rust + pipeline CI | v1.9.4 |
| Profil Vivant — Bannière générative (Lissajous/FNV-1a), Anneaux de réputation (SVG animé), Carte d'activité | v1.9.5 |
| Héro parallaxe, arcs d'avatar rotatifs, Chronologie, `/reputation` formules transparentes | v1.9.5 |
| Refonte du forum — design plat, zéro radius, contenu pleine largeur | v1.9.5 |

</details>

<details>
<summary><b>v2.0 — Communications Privées & Souveraines 🔒</b></summary>

| Fonctionnalité | Version |
|---|---|
| **Chiffrement E2E des DM** — ECDH P-256 + AES-256-GCM, clé privée ne quittant jamais le navigateur (IndexedDB non extractible) | v2.0 |
| **Couche ESY Barbare** — obfuscation par permutation d'octets par instance au-dessus d'AES-GCM, le serveur ne voit qu'un chiffré opaque | v2.0 |
| **Bouclier E2E** — indicateur en direct dans l'en-tête DM (pulse vert = actif, orange = partiel), info-bulle empreinte ESY | v2.0 |
| **Animation Barbarize** — l'expéditeur voit le texte obfusqué pendant le chiffrement, le destinataire le voit se déchiffrer en temps réel | v2.0 |
| **Édition de messages DM** — édition inline avec rechiffrement pour les messages E2E, propagation temps réel via socket | v2.0 |
| **Suppression de messages DM** — soft-delete temps réel propagé à tous les participants instantanément | v2.0 |
| **Refonte pleine largeur des DM** — layout splitté, sidebar glassmorphisme, bulles style iMessage, messages groupés | v2.0 |
| **AudioContext partagé** — contexte unique pour tous les VAD pairs (correction limite 6 contextes Chrome) | v2.0 |

</details>

<details open>
<summary><b>v2.2 — Mise à jour majeure NodyxCanvas 🎨</b></summary>

| Fonctionnalité | Version |
|---|---|
| **Refonte UI Canvas** — 4 composants dédiés : CanvasLeftToolbar, CanvasTopBar (contextuel par outil), CanvasBottomBar, CanvasRightPanel | v2.2 |
| **Annuler / Rétablir** — pile de 50 opérations, Ctrl+Z/Y/Shift+Z, boutons avec état actif/désactivé. Timestamp CRDT LWW corrigé pour que l'annulation s'applique toujours | v2.2 |
| **Aimantation à la grille** — grille monde de 28px, bascule (touche G), superposition visuelle de la grille | v2.2 |
| **Texte riche** — gras, italique, souligné, barré, alignement (gauche/centre/droite), 3 familles de polices (sans/serif/mono), 12 tailles de police | v2.2 |
| **Formes avancées** — triangle, losange, étoile, hexagone, nuage — rendus via Path2D, remplissage + contour + étiquette | v2.2 |
| **Connecteurs** — lignes droites / bézier / coudées, pointes début & fin indépendantes (flèche/point/aucune), style plein/tiret/pointillé, création en 2 clics | v2.2 |
| **Cadres / Sections** — régions rectangulaires nommées avec bordure tiretée, étiquette rendue au-dessus, saisie du nom inline à la création | v2.2 |
| **Insertion d'images** — glisser-déposer depuis le bureau ou sélecteur de fichier, uploadé dans `/api/v1/assets`, mis en cache et rendu sur le canvas, dimensionnement proportionnel | v2.2 |
| **Poignées de redimensionnement** — 8 poignées (coins + points médians) sur les éléments rect/cercle/forme/cadre/image/post-it sélectionnés, aperçu en direct, respecte l'aimantation | v2.2 |
| **Vrais avatars utilisateurs** — le panneau de participants affiche les vrais avatars (avec initiales en fallback) et leur outil actif | v2.2 |
| **Chat du tableau** — chat temps réel limité au tableau canvas, indépendant du chat du salon vocal | v2.2 |
| **Raccourcis clavier complets** — V P T N R C S A X I F E (outils) + G (grille) + Ctrl+Z/Y/Shift+Z (annuler/rétablir) + Suppr + Échap | v2.2 |
| **Rendu Portal** — canvas monté sur `document.body` via action portal, contourne les ancêtres CSS `transform` qui cassent `position:fixed` | v2.2 |

</details>

<details>
<summary><b>v2.1 — Constructeur de page d'accueil + SDK Widget 🧩</b></summary>

| Fonctionnalité | Version |
|---|---|
| **Constructeur de page d'accueil** — admin drag-and-drop, 11 zones de mise en page (banner, hero, stats-bar, main, sidebar, half ×2, trio ×3, footer ×4) | v2.1 |
| **Registre de plugins** — chaque widget natif est un fichier autonome, zéro changement core pour en ajouter de nouveaux | v2.1 |
| **4 widgets natifs Phase 1** — Bannière Héro (variantes live/événement/nuit), Barre de stats (compteurs animés), Carte d'adhésion, Bannière d'annonce | v2.1 |
| **Règles de visibilité** — audience par widget (tous / visiteurs / membres) + dates de début/fin planifiées | v2.1 |
| **Boutique de widgets** — installation de widgets externes via upload `.zip` (barre de progression XHR, validation en 4 étapes, liste blanche d'extraction) | v2.1 |
| **Chargeur de widgets dynamique** — Web Components chargés à l'exécution, sans recompilation, sans déploiement | v2.1 |
| **SDK Widget** — Custom Elements JS pur (Shadow DOM), schéma `manifest.json` → champs de config auto-générés dans le constructeur | v2.1 |
| **Widget démo : Lecteur Vidéo** — YouTube / Vimeo / MP4 avec aperçu en direct, visualiseur de source, installation en un clic | v2.1 |
| **nodyx.dev/create-widget** — guide pas à pas pour non-développeurs (7 étapes, EN) | v2.1 |

</details>

### À venir

| Fonctionnalité | Notes |
|---|---|
| **Canvas — Synchronisation Brainwave** — l'hôte diffuse le pan+zoom à tous les participants en temps réel, les abonnés restent synchronisés | Sprint C |
| **Canvas — Mode Fantôme** — brainstorming anonyme : les contributions apparaissent sous des pseudonymes aléatoires, l'auteur révélé à la fin | Sprint C |
| **Canvas — Minimap** — vignette 160×120 en bas à droite, cliquer pour naviguer | Sprint C |
| **Canvas — Sélection multiple** — Shift+clic ou lasso pour sélectionner + déplacer + supprimer plusieurs éléments | Sprint C |
| **Canvas — Post-its audio** — note vocale enregistrée directement sur le canvas, forme d'onde rendue en post-it | Sprint D |
| **Canvas — Chat contextuel** — discussion en fil ancrée à une zone du canvas, indexée spatialement | Sprint D |
| **Plus de widgets natifs** — Compte à rebours, Classement, Derniers fils, Événements mis en avant, Lecteur Jukebox | Phase 2 |
| **Marketplace de widgets** — widgets publiés par la communauté, notes, installation en un clic depuis l'annuaire | — |
| **Nœuds** — connaissance structurée durable, validée par la communauté via Garden | [SPEC 013](docs/en/specs/013-node/SPEC.md) |
| **Système de modules** — 26 modules activables depuis le panneau admin (CMS style Joomla) | [Spec](.claude/ideas/MODULE_SYSTEM.md) |
| **Réactions DM** — réactions emoji sur les messages privés | — |
| **Import Discord** — import en masse de canaux, fils, réactions, avatars | — |
| Mobile (Capacitor) / Bureau (Tauri) | — |
| Migration Rust — nodyx-server (Axum) remplaçant nodyx-core progressivement | — |

---

## La Vision

Nodyx n'est pas une alternative à Discord.

C'est une réponse différente à une question différente.

Discord s'est demandé : *"Comment grandir vite et capturer des communautés ?"*  
Nodyx se demande : *"Comment donner aux communautés la souveraineté sur leur propre existence ?"*

Chaque instance Nodyx est un nœud souverain. Elle tourne là où vous la faites tourner — un VPS, un Pi, un vieux laptop. Elle stocke ce que vous choisissez de stocker. Elle partage ce que vous choisissez de partager. Elle s'arrête quand vous le décidez — pas quand une entreprise pivote.

Internet était décentralisé par conception. SMTP, IRC, NNTP — n'importe qui pouvait faire tourner un serveur et parler à celui de n'importe qui d'autre. C'était la promesse. Les Big Tech l'ont centralisée en silos sur deux décennies.

**Nodyx, c'est la promesse tenue.**

Et elle se propage de la même façon. Chaque instance qui se lance expose d'autres personnes à l'idée. Chaque événement public indexé par Google attire quelqu'un de nouveau. Chaque communauté qui choisit la souveraineté en inspire une autre.

> *"Forkez-nous si nous vous trahissons."* — AGPL-3.0

---

## Documentation

| Langue | Docs |
|---|---|
| <img src="https://flagcdn.com/16x12/gb.png" alt="EN"> English | [nodyx.dev](https://nodyx.dev) · [docs/en/](docs/en/) |
| <img src="https://flagcdn.com/16x12/fr.png" alt="FR"> Français | [docs/fr/](docs/fr/) |
| <img src="https://flagcdn.com/16x12/es.png" alt="ES"> Español | *bientôt disponible* |
| <img src="https://flagcdn.com/16x12/de.png" alt="DE"> Deutsch | *bientôt disponible* |

- [**nodyx.dev**](https://nodyx.dev) — Wiki de documentation complet
- [**Créer un Widget**](https://nodyx.dev/create-widget) — Guide SDK Widget pas à pas
- [Manifeste](docs/en/MANIFESTO.md) — Pourquoi Nodyx existe
- [Architecture](docs/en/ARCHITECTURE.md) — Comment c'est construit
- [Roadmap](docs/en/ROADMAP.md) — Où on va
- [Moteur Audio](docs/en/AUDIO.md) — EQ broadcast, RNNoise, chaîne audio complète
- [Moteur Neural](docs/en/NEURAL-ENGINE.md) — IA locale avec Ollama
- [**NODYX-ETHER**](docs/ideas/NODYX-ETHER.md) — La vision de la couche physique (LoRa / radio HF / ionosphère)

---

## Contribuer

Nodyx appartient à sa communauté.

1. Parcourez les [Issues ouvertes](https://github.com/Pokled/Nodyx/issues) ou ouvrez une [Discussion](https://github.com/Pokled/Nodyx/discussions)
2. Lisez [CONTRIBUTING.md](docs/en/CONTRIBUTING.md) avant d'ouvrir une PR
3. Les commits suivent les [Conventional Commits](https://www.conventionalcommits.org/), rédigés en anglais

Contribuez librement — sans validation préalable requise :

```
docs/        →  améliorer ou traduire la documentation
docs/ideas/  →  design thinking, propositions UX, nouvelles idées
```

Le core (`nodyx-core/src/`) nécessite une discussion préalable — ouvrez une Issue.

---

## 🌟 Étoiles Nodyx — Contributeurs

Toute contribution externe vaut une étoile. Chaque Étoile figure sur [notre Hall of Fame](CONTRIBUTORS.md) — avec avatar, lien de profil et rang.

**La reconnaissance n'est pas optionnelle ici.** L'open source sans reconnaissance, c'est du travail gratuit, et ce n'est pas notre façon de faire.

### 🏆 Premier contributeur externe

<a href="https://github.com/Pranto2003"><img src="https://github.com/Pranto2003.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="Pranto"/></a>

**[Pranto Goswamee](https://github.com/Pranto2003)** : 🌟 × 1, a ajouté la duplication canvas `Ctrl/Cmd + D` ([PR #11](https://github.com/Pokled/nodyx/pull/11)).

*Première contribution externe à Nodyx. Merci 🙏*

<br/>

### 🎯 Premier Régulier

<a href="https://github.com/waazaa-fr"><img src="https://github.com/waazaa-fr.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="waazaa-fr"/></a>

**[waazaa-fr](https://github.com/waazaa-fr)** : 🌟 × 2, a trouvé et signalé deux bugs d'installation à la suite ([#14](https://github.com/Pokled/nodyx/issues/14), [#15](https://github.com/Pokled/nodyx/issues/15)), tous deux corrigés en quelques heures.

*Les chasseurs de bugs fiables gardent l'installateur honnête. Merci waazaa 🙏*

<br/>

### 🇪🇸 Hablas español ? Nodyx aussi maintenant

<a href="https://github.com/naranco66"><img src="https://github.com/naranco66.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="naranco66"/></a>

**[naranco66](https://github.com/naranco66)** : 🌟 × 3, a apporté l'espagnol (es-ES) à Nodyx via [PR #16](https://github.com/Pokled/nodyx/pull/16) (719 chaînes, parité complète clé + placeholder), est revenu avec [PR #19](https://github.com/Pokled/nodyx/pull/19) pour une révision native des chaînes community pulse, puis a sauté de l'i18n à l'ops avec [PR #22](https://github.com/Pokled/nodyx/pull/22) : corrigé des références `nexus-*` orphelines dans `docker-compose.yml` et une incompatibilité de chemin de police Alpine qui cassait le build Docker frontend.

*Troisième locale, troisième pont vers le monde, et une config Docker qui fonctionne vraiment dès le départ. Gracias naranco 🙏*

<br/>

### 🇩🇪 Sprichst du Deutsch ? Nodyx aussi maintenant

<a href="https://github.com/forke24x7"><img src="https://github.com/forke24x7.png?size=80" width="60" height="60" align="left" style="border-radius:50%; margin-right:12px;" alt="forke24x7"/></a>

**[forke24x7](https://github.com/forke24x7)** : 🌟 × 3, a apporté l'allemand (de) à Nodyx en joignant un `de.json` relu nativement (741 chaînes) sur [l'issue #5](https://github.com/Pokled/nodyx/issues/5), a déclenché le travail de support Pangolin / tunnel alternatif via [l'issue #18](https://github.com/Pokled/nodyx/issues/18), et a détecté une régression du build frontend dans `install_tunnel.sh` le jour même du test Pangolin ([#21](https://github.com/Pokled/nodyx/issues/21)).

*Quatrième locale, une demande de fonctionnalité qui a amélioré l'installateur pour toute la communauté auto-hébergement, et une chasse à la régression le jour même. Danke forke 🙏*

<br/>

👉 **[Voir tous les contributeurs →](CONTRIBUTORS.md)**

---

## Soutenir Nodyx

Nodyx est construit par un seul développeur, sans argent de VC et sans conditions. Si le projet vous est utile, pensez à le soutenir :

<a href="https://ko-fi.com/Pokled"><img src="https://ko-fi.com/img/githubbutton_sm.svg" alt="Soutenir sur Ko-fi"/></a>

Votre soutien aide à couvrir les coûts serveur et maintient Nodyx 100% gratuit et open-source.

---

## Licence

**AGPL-3.0** — La licence open source la plus forte pour les logiciels en réseau.

Si vous utilisez Nodyx, même via un réseau, vos modifications doivent être open source.
Si Nodyx trahit un jour ses principes, cette licence permet à n'importe qui de le forker et de continuer dans l'esprit du [Manifeste](docs/en/MANIFESTO.md).

---

<div align="center">
  <p><em>Né le 18 février 2026.</em></p>
  <p><strong>"Forkez-nous si nous vous trahissons."</strong></p>
</div>
