<div align="center">
  <img src="../img/nodyx-logo.png" alt="Nodyx" width="220"/>

  <h3><em>"Le réseau, ce sont les gens."</em></h3>

  <p><strong>La plateforme communautaire que personne ne peut te prendre.<br/>Forum + Chat + Voix + Canvas P2P — sur ton serveur, sous ton contrôle, pour toujours.</strong></p>

  [![Version](https://img.shields.io/badge/version-v1.8.2-7c3aed)](../../CHANGELOG.md)
  [![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
  [![CI](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml/badge.svg)](https://github.com/Pokled/Nodyx/actions/workflows/ci.yml)
  [![Stack](https://img.shields.io/badge/stack-Fastify%20%2B%20SvelteKit%20%2B%20PostgreSQL%20%2B%20Rust-green)](ARCHITECTURE.md)

  <sub>⭐ Si Nodyx te parle, une étoile aide d'autres personnes à le trouver — et nous permet de continuer.</sub>
</div>

---

<div align="center">

<a href="../../README.md"><img src="https://flagcdn.com/16x12/gb.png" alt="EN"> English</a> · <a href="README.md"><img src="https://flagcdn.com/16x12/fr.png" alt="FR"> Français</a>

</div>

---

<div align="center">
  <img src="../img/hero.png" alt="Nodyx — accueil communauté" width="860"/>
</div>

---

> **[→ Instance live : nodyx.org](https://nodyx.org)** — instance officielle, VPS de production

---

## Pourquoi Nodyx

- **Discord** enferme les communautés dans une plateforme privée — tes 10 ans d'historique disparaissent s'ils ferment ou te bannissent
- **Les forums** sont lents et fragmentés — pas de voix, pas de temps réel, invisibles dans le quotidien de tes membres
- **Les outils auto-hébergés** combinent rarement chat + voix + base de connaissances en une seule installation

Nodyx les réunit. Une commande. Ton serveur. Pour toujours.

---

## Internet a cassé quelque chose.

Discord, Facebook, Slack — ils n'ont pas construit des communautés. Ils les ont capturées.

Dix ans de discussions. De tutoriels. De savoir collectif. De souvenirs.
Enfermés dans des silos. Invisibles pour les moteurs de recherche. Disparus quand la plateforme décide.

**Tu n'en as jamais été propriétaire.**

---

## Nodyx te le rend.

Une commande. Ton serveur. Tes règles. Ta communauté — définitivement.

```bash
git clone https://github.com/Pokled/Nodyx.git && cd Nodyx && sudo bash install.sh
```

Fonctionne sur un Raspberry Pi derrière une box FAI. Sans domaine. Sans ouvrir un port. Sans compte cloud.

---

## Ce qui rend Nodyx différent

### La seule plateforme avec tout ça en une seule installation

| | **Nodyx** | Discord | Matrix | Discourse | Lemmy |
|---|:---:|:---:|:---:|:---:|:---:|
| Auto-hébergé | ✅ | ❌ | ✅ | ✅ | ✅ |
| Forum indexé par Google | ✅ | ❌ | ❌ | ✅ | ✅ |
| Chat temps réel | ✅ | ✅ | ✅ | ⚠️ | ❌ |
| Salons vocaux | ✅ | ✅ | ✅ | ❌ | ❌ |
| Partage d'écran | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Voix P2P — zéro relais Big Tech** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Tableau blanc collaboratif P2P** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **DataChannels P2P (frappe, réactions instant)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Serveur maison (sans ouvrir un port)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Annuaire fédéré de communautés** | ✅ | ❌ | ⚠️ | ❌ | ✅ |
| **Bibliothèque d'assets (cadres, badges, bannières)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Salles whisper éphémères** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Connexion sans mot de passe (ECDSA P-256 PWA)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Jukebox P2P collaboratif (file YouTube)** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Calendrier d'événements (OSM, RSVP, SEO)** | ✅ | ❌ | ❌ | ⚠️ | ❌ |
| **Recherche globale cross-instance** | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Thèmes de profil personnalisés (app globale)** | ✅ | ❌ | ❌ | ❌ | ❌ |

| Open source | ✅ AGPL | ❌ | ✅ | ✅ | ✅ |

> Nodyx est la seule plateforme auto-hébergée combinant un **forum indexé**, **chat temps réel**, **voix P2P**, **canvas collaboratif** et un **annuaire fédéré** en une seule installation.

---

## La stack P2P — 100% Rust écrit à la main

C'est là que Nodyx va plus loin que n'importe qui d'autre.

### nodyx-turn — Serveur STUN/TURN en Rust *(remplace coturn)*

coturn est le standard industriel — un serveur C mature utilisé par Signal, Jitsi, Matrix.
On l'a remplacé par un **binaire Rust de 2,9 Mo** qui fait exactement ce dont Nodyx a besoin. Rien de plus.

```
RFC 5389 (STUN) + RFC 5766 (TURN) + RFC 6062 (TURN-over-TCP)
Credentials HMAC-SHA1 time-based (username={expires}:{userId})
MESSAGE-INTEGRITY sur toutes les réponses (RFC 5389 §10.3) — Firefox/Chrome conforme
Rate limiting + quotas d'allocation (MAX_LIFETIME=300s) + ban map
tokio async runtime — UDP:3478 + TCP:3478 (bypass VPN/firewall)
Zéro dépendance coturn en production
```

### nodyx-relay — Tunnel TCP P2P en Rust *(sans domaine, sans port ouvert)*

Un Raspberry Pi sous ton bureau. Sans domaine. Sans redirection de port sur le routeur. Sans compte Cloudflare.
Lance Nodyx quand même.

```
nodyx-relay server  →  écoute TCP:7443 + HTTP:7001
nodyx-relay client  →  tunnel TCP persistant → expose le port 80 local
```

- Reconnexion automatique avec backoff exponentiel (1s → 30s max)
- Authentification JWT par instance
- Routing par slug : `tonclub.nodyx.org` → proxifié vers le Pi derrière ta box
- Validé sur un vrai Raspberry Pi 4 sans aucun port ouvert ✅

### WebRTC DataChannels — P2P sans serveur

Messages entre pairs qui ne touchent jamais le serveur.

- **Indicateurs de frappe instantanés** — < 5ms de latence locale (vs 80-200ms via serveur)
- **Réactions emoji optimistes** — apparaissent immédiatement, serveur confirme en arrière-plan
- **Transfert de fichiers P2P** — assets partagés directement entre pairs
- **Fallback gracieux** — si DataChannel indisponible (NAT strict), Socket.IO prend le relais transparentement

### NodyxCanvas — Tableau blanc collaboratif P2P

Dessinez ensemble en temps réel. Synchronisé via les DataChannels existants.
Aucun serveur ne touche les données. Session éphémère par défaut.

```
CRDT Last-Write-Wins par élément (UUID + timestamp)
canvas:op / canvas:clear / canvas:cursor  →  DataChannels P2P
Curseurs conscients de la voix : le curseur d'un pair pulse quand il parle
Export PNG natif + récap textuel posté dans le salon chat
```

---

## Captures d'écran

<table>
  <tr>
    <td align="center"><b>Accueil communauté</b></td>
    <td align="center"><b>Forum</b></td>
  </tr>
  <tr>
    <td><img src="../img/Index_Api-Nodyx.png" alt="Page d'accueil communauté" width="460"/></td>
    <td><img src="../img/Forum_Api-Nodyx.png" alt="Catégorie forum" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Chat temps réel</b></td>
    <td align="center"><b>Salons vocaux — WebRTC P2P</b></td>
  </tr>
  <tr>
    <td><img src="../img/Chat-Texte_Api-Nodyx.png" alt="Chat texte" width="460"/></td>
    <td><img src="../img/Salon-vocal_Api-Nodyx.png" alt="Salon vocal avec visualisation mesh P2P" width="460"/></td>
  </tr>
  <tr>
    <td align="center"><b>Panneau admin</b></td>
    <td align="center"><b>Annuaire des instances</b></td>
  </tr>
  <tr>
    <td><img src="../img/AdminPanel_Instance_Api-Nodyx.png" alt="Tableau de bord admin" width="460"/></td>
    <td><img src="../img/Annuaire_instances_Api-Nodyx.png" alt="Annuaire des instances" width="460"/></td>
  </tr>
</table>

---

## Installation rapide

### Prérequis

Le script installe tout automatiquement, mais ton système doit avoir au minimum **`curl`** ou **`wget`** pour le télécharger et le lancer, et **`git`** si tu clones le dépôt manuellement.

Sur un **serveur Ubuntu / Debian fraîchement installé**, ces outils sont souvent absents :

```bash
# Ubuntu / Debian
apt-get install -y git curl
```

> `git` et `curl` sont les **deux seules choses** à installer manuellement.
> Tout le reste (Node.js, PostgreSQL, Redis, Caddy, PM2…) est installé par le script.

### Installation en une commande (recommandée)

**Option A — cloner d'abord, puis lancer :**
```bash
git clone https://github.com/Pokled/Nodyx.git
cd Nodyx
sudo bash install.sh
```

**Option B — commande unique avec `curl` (pas besoin de `git`) :**
```bash
curl -fsSL https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh | sudo bash
```

**Option C — commande unique avec `wget` (si `curl` n'est pas installé) :**
```bash
wget -qO- https://raw.githubusercontent.com/Pokled/Nodyx/main/install.sh | sudo bash
```

Le script propose **trois modes réseau** :

| Mode | Prérequis | Résultat |
|---|---|---|
| **Ports ouverts** | Ports 80 + 443, domaine ou IP | HTTPS Let's Encrypt, contrôle total |
| **Nodyx Relay** ⭐ | Rien — TCP sortant seulement | `tonclub.nodyx.org` en quelques minutes |
| **Cloudflare Tunnel** | Compte CF + domaine personnel | Ton domaine, sans ouvrir un port |

> **Nodyx Relay** est le mode par défaut recommandé — fonctionne sur un Raspberry Pi derrière une box FAI.
> Sans domaine. Sans redirection de port. Sans compte cloud. Lance juste le script.

Installe automatiquement : Node.js, PostgreSQL, Redis, nodyx-turn (STUN/TURN Rust), Caddy (HTTPS), PM2.
Génère les secrets, initialise la base de données, crée ton compte admin.
**Aucune configuration manuelle.**

> Systèmes supportés : Ubuntu 22.04 / 24.04, Debian 11 / 12 / 13. Windows → [Guide WSL](INSTALL.md#windows)

→ **[Guide d'installation complet (FR)](INSTALL.md)**
→ **[Complete installation guide (EN)](../en/INSTALL.md)**

### Docker

```bash
git clone https://github.com/Pokled/Nodyx.git
cd Nodyx
cp nodyx-core/.env.example nodyx-core/.env
docker-compose up -d
```

### Mettre à jour une instance existante

Une seule commande à lancer depuis le dossier Nodyx sur ton serveur :

```bash
# Si installé dans ~/nodyx
cd ~/nodyx && git pull && \
  cd nodyx-core && npm run build && sudo pm2 restart nodyx-core && \
  cd ../nodyx-frontend && npm run build && sudo pm2 restart nodyx-frontend
```

```bash
# Si installé dans /opt/nodyx
cd /opt/nodyx && git pull && \
  cd nodyx-core && npm run build && sudo pm2 restart nodyx-core && \
  cd ../nodyx-frontend && npm run build && sudo pm2 restart nodyx-frontend
```

Les migrations de base de données sont appliquées automatiquement au démarrage — pas de SQL manuel.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                       Ton navigateur                        │
└──────────────┬──────────────────────────────┬───────────────┘
               │ HTTP / WebSocket             │ WebRTC P2P
               ▼                             ▼
┌──────────────────────────┐    ┌────────────────────────────┐
│   nodyx-core (Fastify)   │    │  Connexion directe pair     │
│   nodyx-frontend (Svelte)│    │  DataChannels + Canvas      │
│   PostgreSQL + Redis      │    │  Voix + Partage d'écran    │
└──────────────────────────┘    └────────────────────────────┘
               │                             │
        ┌──────┴──────┐               ┌──────┴──────┐
        │ nodyx-relay │               │ nodyx-turn  │
        │ (Rust TCP)  │               │ (Rust TURN) │
        │ serveur maison│             │ traversée NAT│
        └─────────────┘               └─────────────┘
```

| Couche | Technologie |
|---|---|
| API | TypeScript + Fastify v5 |
| Base de données | PostgreSQL 16 |
| Cache / Sessions | Redis 7 |
| Recherche full-text | PostgreSQL FTS (tsvector + GIN) |
| Frontend | SvelteKit 5 + Tailwind v4 |
| Éditeur | TipTap (WYSIWYG) |
| Temps réel | Socket.IO |
| Voix | WebRTC P2P mesh |
| Relais TURN | **nodyx-turn** — Rust, auto-hébergé, durci |
| Relais P2P | **nodyx-relay** — Rust, tokio + hyper |
| Canvas collaboratif | **NodyxCanvas** — CRDT LWW, DataChannels P2P |

---

## Ce qui est livré. Ce qui arrive.

### Livré

| Fonctionnalité | Version |
|---|---|
| Forum (catégories, threads, posts, réactions, tags) | v0.1 |
| Recherche full-text (PostgreSQL FTS) | v0.1 |
| Chat temps réel (Socket.IO) | v0.1 |
| Salons vocaux (WebRTC P2P) | v0.1 |
| Partage d'écran + enregistrement de clips | v0.2 |
| Panneau admin | v0.2 |
| SEO (sitemap, RSS, JSON-LD) | v0.3 |
| Installateur en une commande | v0.4 |
| Annuaire des instances + DNS auto | v0.5 |
| nodyx-relay — Tunnel TCP P2P Rust | v0.5 |
| Bibliothèque d'assets communautaire (cadres, bannières, badges) | v0.6 |
| Jardin des features — vote communautaire avec stades de croissance organiques | v0.6 |
| Annuaire d'assets fédéré (partage cross-instance) | v0.7 |
| Whispers — salles de chat éphémères chiffrées (TTL 1h) | v0.7 |
| DataChannels P2P — frappe instantanée, réactions optimistes | v0.8 |
| nodyx-turn — STUN/TURN Rust remplaçant coturn | v0.9 |
| **NodyxCanvas — tableau blanc collaboratif P2P dans les salons vocaux** | **v0.9** |
| **Système de thèmes de profil** — 6 presets, moteur CSS par utilisateur, éditeur live | **v1.0** |
| **UI responsive mobile** — drawer de chat, nav bas, voix accessible sur mobile | **v1.0** |
| **Bibliothèque d'assets 12 Mo** + conseils de design par type d'asset | **v1.0** |
| **Chat — Réponses/citations, messages épinglés, aperçus de liens, badge @mention** | **v1.1** |
| **Présence — Statut personnalisé** (emoji + texte, 8 presets) **+ liste des membres hors ligne** | **v1.1** |
| **Messages privés (DMs)** — conversations 1:1 avec badge non-lu | **v1.2** |
| **Sondages** — dans le chat et le forum, 3 types (choix/planning/classement), résultats temps réel | **v1.2** |
| **Système de ban** — ban IP, ban email, enforcement multi-couches | **v1.2** |
| **nodyx-turn — TURN-over-TCP** (RFC 6062) — voix fonctionnelle via VPN et firewall stricts | **v1.3** |
| **nodyx-turn — MESSAGE-INTEGRITY** — candidats relay acceptés par tous les navigateurs | **v1.3** |
| **Voix — Relay failover** — bascule automatique vers TURN relay sur perte de paquets élevée | **v1.3** |
| **Voix — Opus optimisé** — 32 kbps par défaut, DTX désactivé, mono pour liens dégradés | **v1.3** |

### v1.4 → v1.7

| Fonctionnalité | Version |
|---|---|
| **URLs de threads en slug + SEO complet** (canonical, OG, JSON-LD, sitemap) | v1.4 |
| **Slugs de catégories** + affichage des sous-catégories sur la page parente | v1.5 |
| **Recherche globale** — index FTS cross-instance, UI `/discover` | v1.5 |
| **Calendrier d'événements** — CRUD, RSVP, cartes OSM, image de couverture, rich snippets | v1.6 |
| **Protocole Gossip** — fédération des événements entre instances | v1.6 |
| **Nodyx Signet** — auth sans mot de passe ECDSA P-256 PWA sur `signet.nodyx.org` | v1.7 |
| **Enrollment QR** — scanner depuis les paramètres pour éviter la saisie manuelle du token | v1.7 |
| **UI optimiste** — toutes les mutations mettent à jour l'état local instantanément (sans re-fetch) | v1.7 |
| **Centre de notifications** — purge automatique 30j + bouton effacer les lues | v1.7 |

### v1.8

| Fonctionnalité | Version |
|---|---|
| **Tâches / Kanban** — tableaux par communauté, drag & drop, assignés, priorités, échéances | v1.8 |
| **Alerte de mise à jour** — bannière admin quand une nouvelle release GitHub est disponible (cache Redis 6h) | v1.8 |
| **Affichage de la version** — "Nodyx v1.8.x" affiché sur la page d'accueil via la variable `NODYX_VERSION` | v1.8 |
| **Audit de sécurité** — correctif permissions PATCH /cards, health 503, binding HOST, enrollment adminOnly, rate limit sur /announcement, modérateurs peuvent gérer les tags | v1.8.1 |
| **Audit de sécurité complet** — 38 vulnérabilités corrigées (SQLi, XSS, JWT, SSRF, IDOR, CSS injection, Socket.IO) | v1.8.2 |

### À venir

| Fonctionnalité | Notes |
|---|---|
| **Nodes** — connaissance structurée durable, validée via le Jardin | [SPEC 013](../en/specs/013-node/SPEC.md) |
| Mobile (Capacitor) / Desktop (Tauri) | — |

---

## La Vision

Nodyx n'est pas une alternative à Discord.

C'est une réponse différente à une question différente.

Discord a demandé : *"Comment croître vite et capturer des communautés ?"*
Nodyx demande : *"Comment donner aux communautés la souveraineté sur leur propre existence ?"*

Chaque instance Nodyx est un nœud souverain. Elle tourne là où tu la fais tourner — un VPS, un Pi, un vieux laptop. Elle stocke ce que tu choisis de stocker. Elle partage ce que tu choisis de partager. Elle s'arrête quand tu décides — pas quand une entreprise pivote.

Internet était décentralisé par conception. SMTP, IRC, NNTP — n'importe qui pouvait faire tourner un serveur et parler au serveur de quelqu'un d'autre. C'était la promesse. Les Big Tech l'ont centralisée en silos sur deux décennies.

**Nodyx, c'est la promesse tenue.**

Et elle se propage de la même façon. Chaque instance qui se lance expose d'autres à l'idée. Chaque événement public indexé par les moteurs de recherche attire quelqu'un de nouveau. Chaque communauté qui choisit la souveraineté en inspire une autre. Le R0 est dans l'architecture.

Nous ne construisons pas un produit. Nous reconstruisons une infrastructure pour les communautés humaines.

> *"Fork us if we betray you."* — AGPL-3.0

---

## Documentation

| Langue | Docs |
|---|---|
| <img src="https://flagcdn.com/16x12/fr.png" alt="FR"> Français | [docs/fr/](.) |
| <img src="https://flagcdn.com/16x12/gb.png" alt="EN"> English | [docs/en/](../en/) |
| <img src="https://flagcdn.com/16x12/es.png" alt="ES"> Español | *à venir* |
| <img src="https://flagcdn.com/16x12/it.png" alt="IT"> Italiano | *à venir* |
| <img src="https://flagcdn.com/16x12/de.png" alt="DE"> Deutsch | *à venir* |

- [Manifeste](MANIFESTO.md) — Pourquoi Nodyx existe
- [Architecture](ARCHITECTURE.md) — Comment c'est construit
- [Roadmap](ROADMAP.md) — Où on va
- [Moteur audio](AUDIO.md) — EQ broadcast, RNNoise, chaîne audio complète
- [Moteur neural](NEURAL-ENGINE.md) — IA locale avec Ollama
- [Spécifications](../en/specs/) — Toutes les specs fonctionnelles
- [Idées](../../docs/ideas/) — Réflexions de design en cours
- [**NODYX-ETHER**](../../docs/ideas/NODYX-ETHER.md) — La vision couche physique (LoRa / radio HF / ionosphère)
- [**NODYX-ETHER Guide**](../../docs/ideas/NODYX-ETHER-GUIDE.md) — Comment participer : CB, radioamateurs, LoRa, renaissance des radios régionales
- [**NODYX-RADIO**](../../docs/ideas/NODYX-RADIO.md) — Nodyx comme tuner radio : de nouvelles stations vont naître parce qu'elles ont enfin une communauté

---

## Contribuer

Nodyx appartient à sa communauté.

1. Parcours les [Issues ouvertes](https://github.com/Pokled/Nodyx/issues) ou ouvre une [Discussion](https://github.com/Pokled/Nodyx/discussions)
2. Lis [CONTRIBUTING.md](CONTRIBUTING.md) avant d'ouvrir une PR
3. Les commits suivent [Conventional Commits](https://www.conventionalcommits.org/), écrits en anglais

Contribue librement — aucune validation préalable requise :

```
docs/        →  améliore ou traduis la documentation
docs/ideas/  →  réflexions de design, propositions UX, nouvelles idées
```

Le cœur (`nodyx-core/src/`) nécessite une discussion au préalable — ouvre une Issue.

---

## Licence

**AGPL-3.0** — La licence open source la plus forte pour les logiciels en réseau.

Si tu utilises Nodyx, même via un réseau, tes modifications doivent être open source.
Si Nodyx trahit ses principes un jour, cette licence permet à n'importe qui de forker le projet et de continuer dans l'esprit du [Manifeste](MANIFESTO.md).

---

<div align="center">
  <p><em>Né le 18 février 2026.</em></p>
  <p><strong>"Fork us if we betray you."</strong></p>
</div>
