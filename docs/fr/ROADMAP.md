# NODYX — Roadmap
### Version 1.9 — La plateforme souveraine

---

> *"Un projet qui veut tout faire en même temps ne fait rien bien."*
> La roadmap Nodyx est construite sur une règle simple :
> chaque phase doit fonctionner parfaitement avant de passer à la suivante.

---

## ÉTAT ACTUEL — Mars 2026

| Phase | Titre | État |
|---|---|---|
| **Phase 1** | Forum MVP + Admin | ✅ Complète |
| **Phase 2** | Chat temps réel + Annuaire + Identité réseau | ✅ Complète |
| **Phase 2.5** | Personnalisation communautaire + Fédération légère | ✅ Complète |
| **Phase 3** | Infrastructure P2P + Fondation Rust | ✅ Complète |
| **Phase 4** | Enrichissement de la plateforme (v1.4 → v1.8) | ✅ Complète |
| **Phase 4.5** | Durcissement sécurité (v1.8.2) | ✅ Complète |
| **Phase 4.6** | Défense active & sécurité runtime (v1.9.0) | ✅ Complète |
| **Phase 4.7** | Double authentification — TOTP + Nodyx Signet 2FA (v1.9.1) | ✅ Complète |
| **Phase 4.8** | Stabilité production & cohérence cross-runtime (v1.9.3) | ✅ Complète |
| **Phase 4.9** | Isolation processus, couverture de tests & CI (v1.9.4) | ✅ Complète |
| Phase 5 | Mobile + Nodes + Réputation | 🔨 En cours |
| **Phase Horizon** | NODYX-ETHER — Souveraineté de la couche physique | 🌌 Vision |
| **Phase Radio** | NODYX-RADIO — Tuner radio internet + régie publicitaire coopérative | 📻 Vision |

---

## PHASE 1 — MVP Forum + Admin ✅ COMPLÈTE
### Objectif : Une communauté peut s'installer, se configurer, et vivre sur Nodyx

### 1.1 Backend Forum
- [x] Migration SQL initiale (users, communities, categories, threads, posts)
- [x] Migration 002 — user_profiles (bio, avatar, tags, liens, champs sociaux)
- [x] Migration 003 — grades (grades, community_grades, community_members.grade_id)
- [x] Migration 004 — liens sociaux (github, youtube, twitter, instagram, website)
- [x] Migration 005 — categories.parent_id (catégories infinies, CTE récursive)
- [x] Migration 006 — threads.is_featured (articles mis en avant)
- [x] Migration 007 — post_reactions + post_thanks (réactions emoji + karma)
- [x] Migration 008 — tags + thread_tags (tags community-scoped)
- [x] Migration 009 — search_vector + triggers GIN (full-text français)
- [x] Migration 010 — notifications (thread_reply, post_thanks, mention)
- [x] Route POST /api/v1/auth/register
- [x] Route POST /api/v1/auth/login + logout
- [x] Route GET  /api/v1/communities + /communities/:slug
- [x] Route POST /api/v1/communities/:slug/members (join/leave)
- [x] Routes forum (catégories, threads, posts) — CRUD complet
- [x] Édition du titre de thread (auteur + mods)
- [x] Réactions emoji sur les posts (6 emojis, toggle)
- [x] Bouton Merci (+5 karma à l'auteur, 1 par user/post)
- [x] Tags sur les threads (admin crée, sélection à la création)
- [x] Recherche full-text PostgreSQL (ts_headline, filtre communauté)
- [x] Notifications (réponse, merci reçu, @mention)
- [x] Middleware authentification JWT
- [x] Middleware rate limiting Redis
- [x] Validation Zod sur toutes les routes
- [x] Tracking "online" — heartbeat Redis 900s TTL
- [x] Routes instance — /instance/info, /instance/categories, /instance/threads/recent
- [x] Routes admin — stats, membres, threads (pin/lock/delete), catégories, tags

### 1.2 SEO et indexation
- [x] Routes forum rendues en HTML statique (SvelteKit SSR)
- [x] Balises meta dynamiques (title, description, og:*)
- [x] Sitemap.xml automatique
- [x] Robots.txt configurable
- [x] RSS feed
- [x] JSON-LD Schema.org (Forum, DiscussionForumPosting)
- [x] llms.txt (pour les agents IA)

### 1.3 Frontend
- [x] SvelteKit initialisé + Tailwind v4
- [x] Homepage = communauté de l'instance (NODYX_COMMUNITY_NAME via .env)
- [x] Arbre de catégories récursif (CategoryTree.svelte)
- [x] Page liste catégories + threads (avec pills de tags)
- [x] Page thread + posts + formulaire réponse
- [x] Éditeur WYSIWYG (Tiptap — gras, code, tableaux, images, iframes)
- [x] Formulaire inscription / connexion
- [x] Profils utilisateurs complets (bio, tags, links, GitHub widget)
- [x] Système de grades (CRUD admin + badge coloré)
- [x] Annuaire des instances (/communities — alimenté par nodyx.org)
- [x] Panneau admin complet (/admin — 9 pages dont Tags)
- [x] Navbar adaptive (loupe recherche, cloche notifications, lien Admin)
- [x] Page /search — onglets Threads/Posts, extraits surlignés
- [x] Page /notifications — liste + marquer lu + polling 30s

### 1.4 Self-hosting
- [x] `install.sh` — installeur one-click VPS (ports 80/443, Let's Encrypt via Caddy, PM2, coturn, PostgreSQL, Redis)
- [x] `install_tunnel.sh` — installeur home server via Cloudflare Tunnel (aucun port à ouvrir, Raspberry Pi, box)
- [x] docker-compose.yml (Nodyx + PostgreSQL + Redis)
- [x] Dockerfile multi-stage
- [x] Script seed (données de démonstration)
- [x] Script PowerShell "Nodyx-Easy-Install" — automatise Node/PostgreSQL/Redis sur Windows Server sans Docker
- [x] Health check visuel post-installation (spinner braille, score PASS/WARN/FAIL)
- [x] Documentation installation en 15 minutes
- [x] Guide complet des noms de domaine (DOMAIN.md — types, compatibilité, FAQ)
- [x] .env.example documenté

### Critère de succès Phase 1 ✅
Une personne non-développeur peut :
1. Installer Nodyx sur son serveur en moins de 15 minutes ✅
2. Configurer son instance via l'installeur interactif ✅
3. Créer des catégories, des threads, des tags ✅
4. Administrer sa communauté via le panneau admin ✅
5. Être trouvé sur les moteurs de recherche (Google, Bing, Brave, Qwant...) ✅

---

## PHASE 2 — Chat temps réel + Annuaire + Identité réseau ✅ COMPLÈTE
### Objectif : Les membres communiquent en live, l'annuaire est réel, chaque instance a son URL

### 2.1 Chat temps réel ✅
- [x] WebSocket (Socket.io) intégré dans Fastify v5
- [x] Canaux textuels configurables par l'admin
- [x] Notifications temps réel (WebSocket — remplace le polling 30s)
- [x] Historique des messages persisté en PostgreSQL

### 2.2 nodyx.org — Directory ✅
- [x] Service d'annuaire global réel — API d'enregistrement des instances
- [x] Page /communities alimentée par l'annuaire réel (fin du mock)
- [x] Enregistrement automatique d'une instance au premier démarrage
- [x] Ping automatique toutes les 5 minutes (membres live, stats en ligne)

### 2.3 Identité réseau — `slug.nodyx.org` ✅
- [x] Chaque instance choisit un slug unique à l'installation
- [x] Le slug est réservé auprès du nodyx.org directory (API REST)
- [x] DNS wildcard `*.nodyx.org` géré par notre Cloudflare
- [x] Caddy route `slug.nodyx.org → IP du nœud` (Cloudflare Origin Certificate)
- [x] L'admin n'a aucun DNS à configurer — URL propre en 1 clic

### 2.4 Salons vocaux — Couche réseau ✅
- [x] Serveur coturn (STUN/TURN) configuré et démarré par `install.sh`
- [x] Signalisation WebRTC via Socket.io (`src/socket/voice.ts`)
- [x] VoicePanel.svelte — barre flottante + gestion micro/caméra/partage écran
- [x] VoiceSettings.svelte — chaîne AudioContext configurable
- [x] MediaCenter.svelte — partage d'écran + clips

---

## PHASE 2.5 — Personnalisation communautaire + Fédération légère ✅ COMPLÈTE
### Objectif : Chaque instance est unique, et les instances peuvent partager leurs créations

### v0.6 — Bibliothèque d'assets & Jardin ✅

- [x] Migration 017 — `community_assets` (cadres, bannières, badges, stickers, avatars, fonds)
- [x] Migration 018 — `user_equipped_assets` (slots de personnalisation sur le profil)
- [x] Migration 019 — `feature_seeds` (propositions de fonctionnalités)
- [x] Migration 020 — `user_seed_balance` (3 graines/semaine par utilisateur)
- [x] Route `POST /api/v1/assets` — upload multipart avec compression Sharp (WebP)
- [x] Routes CRUD + like + equip/unequip pour les assets communautaires
- [x] Service `assetService.ts` — thumbnails automatiques, resize, gestion des slots
- [x] Page `/library` — galerie d'assets avec filtres catégorie/tags/popularité
- [x] Page `/library/[id]` — détail d'un asset avec like, équipement, bouton Chuchoter
- [x] Routes `/api/v1/garden` — propositions + vote par graines + changement de statut (admin)
- [x] Page `/garden` — liste des propositions, vote visuel avec compteur de graines
- [x] Profil utilisateur — affichage des assets équipés (frame, banner, badge, wallpaper)
- [x] Page `/users/me/edit` — gestion des slots d'assets sur son propre profil

### v0.7 — Fédération assets + Chuchotements ✅

- [x] Migration 021 — `directory_assets` (snapshot fédéré des assets d'autres instances)
- [x] Migration 022 — `whisper_rooms` + `whisper_messages` (salons éphémères)
- [x] Route `POST /api/directory/assets` — push d'assets vers le répertoire (Bearer token)
- [x] Route `GET /api/directory/assets/search` — recherche publique multi-instances
- [x] Scheduler — push assets toutes les heures vers `nodyx.org`
- [x] Scheduler — nettoyage des whispers expirés toutes les 10 minutes
- [x] Onglet "🌐 Toutes les instances" dans `/library` — assets fédérés depuis le répertoire
- [x] Routes `/api/v1/whispers` — création, récupération, suppression de salons éphémères
- [x] Socket.IO — événements `whisper:*` (join, leave, message, typing, history, expired)
- [x] Page `/whisper/[id]` — salon de chuchotement temps réel (style iMessage, TTL affiché)
- [x] Bouton "🤫 Chuchoter" sur les pages asset — création contextuelle d'un salon
- [x] Bouton "🔗 Partager" — copie du lien avec feedback "✅ Copié!"
- [x] `linkify.ts` — URLs cliquables dans le chat et les whispers (sans XSS)
- [x] Clickable URLs in chat (`linkifyHtml`) and whispers (`linkifyText`)

---

## PHASE 3 — Infrastructure P2P + Fondation Rust
### Objectif : Se libérer des dépendances réseau tierces. Construire le cœur décentralisé.

> *"Le P2P est l'âme. Rust est le corps."*
>
> Nodyx ne remplacera pas Node.js ou SvelteKit — ils font leur travail parfaitement.
> Rust viendra **en dessous**, invisible pour l'utilisateur, pour gérer les parties
> que JavaScript ne peut pas bien faire : réseau bas niveau, chiffrement, WireGuard, DHT.
> La couche Rust communique avec nodyx-core via un socket Unix local — simple et découplé.

---

### 3.0 — `nodyx-p2p` : La fondation Rust 🔨 EN COURS

#### Pourquoi Rust ici ?

Aujourd'hui, un utilisateur sans domaine et sans ports ouverts doit :
1. Créer un compte Cloudflare
2. Ajouter son domaine à Cloudflare (nécessite d'en posséder un, ~1€/an)
3. Configurer `cloudflared` manuellement ou via `install_tunnel.sh`

C'est trop de friction. Et surtout : **c'est une dépendance à un service tiers**,
contraire à la philosophie Nodyx.

La couche Rust résout ça de façon radicale et progressive.

#### Architecture

```
nodyx-frontend (SvelteKit) ──────────────────────┐
nodyx-core    (Fastify/Node.js) ─────────────────┤
                                                  │ IPC (Unix socket)
                                                  ▼
                                    ┌─────────────────────┐
                                    │     nodyx-p2p       │
                                    │       (Rust)        │
                                    │                     │
                                    │  ┌───────────────┐  │
                                    │  │ Relay Client  │  │
                                    │  │ (QUIC/tokio)  │  │
                                    │  └───────────────┘  │
                                    │  ┌───────────────┐  │
                                    │  │ STUN/TURN     │  │
                                    │  │ (remplace     │  │
                                    │  │  coturn)      │  │
                                    │  └───────────────┘  │
                                    │  ┌───────────────┐  │
                                    │  │ DHT Kademlia  │  │
                                    │  │ + WireGuard   │  │
                                    │  │ (réseau maillé│  │
                                    │  │  inter-nodes) │  │
                                    │  └───────────────┘  │
                                    └─────────────────────┘
```

#### Phase 3.0-A — `nodyx-relay-client` ✅ VALIDÉE — 1er mars 2026

> Remplace `install_tunnel.sh` + Cloudflare Tunnel. Zéro domaine requis. Zéro port à ouvrir.
> **Testé en conditions réelles : Raspberry Pi 4, aucun port ouvert, aucun compte Cloudflare.**

- [x] Binaire Rust statique (9MB) — `tokio` + `hyper` + `tokio-postgres` + `clap` + `dashmap`
- [x] Connexion TCP sortante vers `relay.nodyx.org:7443` (notre infra)
- [x] Forward HTTP bidirectionnel (JSON framing 4-byte length prefix)
- [x] Enregistrement automatique `slug.nodyx.org` sans DNS ni CF account
- [x] Reconnexion automatique avec backoff exponentiel (1s → 2s → 4s → max 30s)
- [x] GitHub Release `v0.1.2-p2p` — binaires amd64 + arm64 (rate limiting auth + fix traitement concurrent)
- [x] Intégration dans `install.sh` : option 2 "Nodyx Relay (recommandé)"
- [x] Service systemd côté client (`nodyx-relay-client.service`)

**Résultat utilisateur :** `bash install.sh` → choisir "Relay" → obtenir `moncommunaute.nodyx.org` **sans aucune configuration réseau**.

#### Phase 3.0-B — Browser P2P Nodes (WebRTC DataChannels) ✅ POC VALIDÉ — 2 mars 2026

> Les navigateurs des utilisateurs deviennent des nœuds actifs.
> Communication directe entre pairs sans intermédiaire serveur.
> **Réutilise le signaling existant de `voice.ts`** — zéro nouvelle infrastructure serveur.

**Approche :** WebRTC DataChannels natifs + signaling Socket.IO existant (pattern voice.ts)
**Pas pour ce POC :** libp2p (surcharge), DHT (2027+)

**v0.8 — POC deux navigateurs ✅ :**
- [x] Ajouter events `p2p:offer`, `p2p:answer`, `p2p:ice` dans `voice.ts` (3 lignes — même pattern que `voice:offer/answer/ice`)
- [x] Créer `nodyx-frontend/src/lib/p2p.ts` — gestionnaire RTCPeerConnection + DataChannel
- [x] Découverte de pair via Socket.IO existant (handshake polite/impolite — un seul initiateur)
- [x] Utiliser le coturn de l'instance (déjà installé) — pas de STUN tiers
- [x] Handler `ondatachannel` côté répondeur (crucial — sinon le répondeur ne reçoit jamais le canal)
- [x] Indicateur UI "⚡ P2P · N" dans l'en-tête du canal texte (jaune si actif, gris pulsant si connexion en cours)
- [x] Test validé : deux navigateurs, DataChannel direct confirmé, messages hors serveur

**Résultat utilisateur :** rejoindre un canal texte → l'indicateur ⚡ P2P apparaît automatiquement quand un autre membre est présent. Zéro configuration.

**v0.9 — Mesh 1-N ✅ LIVRÉ — 2 mars 2026 :**
- [x] Gérer plusieurs connexions pair simultanées (Map de RTCPeerConnections — déjà dans p2p.ts)
- [x] Indicateurs de frappe P2P instantanés (~1–5ms, dots animés style Discord)
- [x] Réactions optimistes + pop animation spring physics (arrive avant le serveur)
- [x] Fallback gracieux si WebRTC échoue (ICE timeout 12s, toast discret, flags _hadAttempt/_hadSuccess)
- [x] Transfert d'assets entre pairs (chunks 32 Ko, protocole p2p:asset:*, store p2pAssetPeers, bouton ⚡ jaune)

#### Phase 3.0-C — `nodyx-turn` (remplace coturn) ✅ VALIDÉE — 4 mars 2026 / Mise à jour 8 mars 2026

> coturn est un projet C des années 2000. Complexe à configurer, surface d'attaque importante.
> **Remplacé par un binaire Rust de 2.9MB — zéro dépendance, credentials dynamiques.**

- [x] Serveur STUN/TURN en Rust — RFC 5389 (STUN) + RFC 5766 (TURN)
- [x] Credentials dynamiques HMAC-SHA1 (time-based, coturn `use-auth-secret` compatible)
- [x] MESSAGE-INTEGRITY sur toutes les réponses TURN (RFC 5389 §10.3) — obligatoire pour relay Firefox/Chrome
- [x] **TURN-over-TCP (RFC 6062)** — TCP:3478 en parallèle de UDP:3478, registry d'allocations partagé
- [x] Framing RFC 4571 (longueur 2 octets big-endian par message TCP)
- [x] Abstraction `ResponseSink` — tous les handlers TURN transport-agnostiques (UDP et TCP unifiés)
- [x] nodyx-core génère les creds par utilisateur → `voice:init` Socket.IO (pas d'IPC)
- [x] ChannelBind / ChannelData (optimisation relay, moins d'overhead header)
- [x] Rate limiter UDP par IP (30 pkt/sec) — protection flood non authentifié
- [x] Quotas d'allocations : 10/IP, 1000 total, MAX_LIFETIME=300s (prévient la saturation du quota)
- [x] 2.9MB statique, `install.sh` intégré, service systemd
- [x] **Voix — Relay failover** : bascule automatique vers `iceTransportPolicy: relay` après perte de paquets élevée (>25% × 3 mesures consécutives)
- [x] **Voix — Opus optimisé** : 32 kbps par défaut, DTX désactivé, mono, FEC actif — optimisé pour VPN/liens dégradés

#### Phase 3.0-D — `nodyx-p2p` core (vision long terme 2027-2028)

> Le cœur distribué. Quand un nœud veut contacter un autre nœud directement, sans passer par nous.
> Réseau immortel : chaque donnée répliquée sur 3+ nœuds, auto-guérison.

- [ ] DHT Kademlia (via `libp2p`) — découverte de pairs sans serveur central
- [ ] WireGuard (via `wireguard-rs`) — tunnel chiffré direct entre instances volontaires
- [ ] ICE/STUN natif — traversée NAT sans coturn pour les connexions P2P
- [ ] API IPC exposée à nodyx-core : `relay.register(slug)`, `peer.connect(slug)`, `network.peers()`
- [ ] Gossip protocol — propagation naturelle de l'état du réseau
- [ ] CRDTs — données sans conflit entre nœuds (compteurs de likes, présence distribuée)
- [ ] Réplication facteur 3 — auto-guérison si un nœud tombe
- [ ] Si `nodyx.org` est inaccessible, les nœuds se trouvent via DHT (résilience)

---

### 3.1 — Salons vocaux — Interface & Modes avancés
*(couche réseau déjà en place — Phase 2.4)*

- [x] VoicePanel sidebar — panneau gauche fixe avec liste des participants (Galaxy Bar layout)
- [x] Panneau d'interaction membre — cliquer sur un membre → stats réseau temps réel (RTT / jitter / perte de paquets) + curseur de volume
- [x] Panneau self-monitoring — cliquer sur soi → jauge audio live, badges muted / deafened / PTT
- [x] Popup VoiceSettings — modal large en position fixe (360px), échappe le débordement de la sidebar avec overlay backdrop
- [x] Boutons d'interaction par pair — lien Profil, Message Direct, Partage de fichier + Mini-jeu (à venir)
- [ ] Mode Amphithéâtre — diffusion 1→N (9 à 25+ personnes, vidéo sur "toile")
- [ ] Nodes-as-a-Service — un Raspberry Pi peut devenir relais de flux média pour soulager le serveur principal

#### v1.0 — Table Collaborative ⏳ PLANIFIÉE
*(fondation P2P DataChannels opérationnelle — v0.9)*

> *Le salon vocal devient un espace de vie : jouer, travailler, écouter de la musique, partager des fichiers — tout dans la même fenêtre. Premier open-source self-hosted à combiner ces 4 usages.*

**Fondation visuelle**
- [ ] Table SVG ovale — avatars positionnés sur ellipse (moi = toujours en bas, algo `getAvatarPositions`)
- [ ] Zone centrale dégagée (drag & drop, même plan SVG)
- [ ] Clic avatar → menu contextuel (chuchoter, profil, défier, sourdine)
- [ ] Protocole `table:*` dans les DataChannels (state, event, object:move/add/remove)
- [ ] Arbitre hôte — source de vérité unique, élection automatique au départ de l'hôte
- [ ] Persistance de l'état en DB (snapshot 30s) + restauration à la reconnexion
- [ ] Ondes audio sur les avatars (AnalyserNode + CSS custom property `--voice-intensity`)

**Fichiers & présence**
- [ ] Drag & drop fichier → partagé sur la table pour tous (temporaire)
- [ ] Épinglage 📎 — fichier reste visible même si l'owner est offline
- [ ] Drag fichier sur un avatar → ouvre un Whisper avec le fichier
- [ ] États de présence : 🎙️ vocal / 🪑 à table / 🎮 en jeu

**Widgets**
- [ ] Roue aléatoire "Qui commence ?" (CSS animation, résultat visible de tous)
- [ ] Timer partagé — Pomodoro / Blitz / Custom (AudioContext pour le son de fin)
- [ ] Tableau des scores persistant par session
- [ ] Mode scène — "Prendre la parole" (vote rapide, mic prioritaire, autres -20dB)
- [ ] Mode spectateur — membres du forum observent sans participer (Socket.IO room séparée)
- [ ] Historique exportable de session (texte ou PDF)

**Jukebox collaboratif**
- [ ] Lecteur Web Audio API (play/pause/next) — synchro P2P, qualité originale
- [ ] Volume individuel (GainNode + localStorage, jamais broadcasté)
- [ ] Cover art : tags ID3 → MusicBrainz → Apple iTunes → cache IndexedDB
- [ ] Playlists collaboratives sauvegardées en DB
- [ ] Votes 👍👎 + file d'attente prioritaire intelligente
- [ ] Crossfade entre morceaux (deux GainNode en overlap)
- [ ] Réactions timecode (style SoundCloud) — stockées en DB, réapparaissent à la réécoute
- [ ] Sleep timer avec fondu sortant progressif

**Templates & plugins**
- [ ] Sélecteur de template (hôte choisit, broadcaste `table:theme:set` à tous)
- [ ] 3 templates officiels : Brasserie de Nuit, Table de Feutre, Pierre & Braise
- [ ] Système de plugins `plugins/table-templates/` — premier exemple pour les devs communautaires

**Jeux (progression séquentielle)**
- [ ] Dés RPG (d4–d100) — animation CSS 3D + historique visible de tous
- [ ] Échecs — `chess.js` + plateau SVG + sync état FEN via DataChannel
- [ ] Poker — machine à états + chiffrement AES-GCM des mains par joueur
- [ ] RPG / Warhammer — carte hexagonale, tokens (assets de la Bibliothèque), brouillard de guerre *(long terme)*

### 3.2 — Réseau maillé inter-instances
*(dépend de Phase 3.0-C)*

- [ ] WireGuard mesh entre instances volontaires — tunnel chiffré bout en bout
- [ ] DHT pour découverte des pairs sans serveur central
- [ ] Gossip protocol — synchronisation légère de métadonnées entre nœuds
- [ ] Annuaire de secours distribué — si `nodyx.org` tombe, les nœuds maintiennent l'annuaire
- [ ] Transition automatique vers connexion P2P directe quand disponible
- [ ] Fédération légère — un membre de la communauté A peut interagir avec la communauté B

---

## PHASE 4 — Enrichissement de la plateforme
### Objectif : Nodyx devient la plateforme communautaire complète

**Livré en avance :**
- [x] **NodyxCanvas** (v0.9) — tableau blanc collaboratif P2P dans les salons vocaux (CRDT LWW, curseurs vocaux, export PNG)
- [x] **Système de thèmes de profil** (v1.0) — 6 presets (Défaut, Minuit, Forêt, Chaleur, Rose, Verre), moteur CSS variables (`--p-bg`, `--p-card-bg`, `--p-accent`…), éditeur live avec color pickers, propagation dans toute l'app (nav, sidebars, fond)
- [x] **UI responsive mobile** (v1.0) — drawer de canaux, barre de navigation basse, VoicePanel accessible sur mobile, forum + admin responsives
- [x] **Bibliothèque d'assets 12 Mo** (v1.0) — limite augmentée (était 5 Mo), conseils de design par type d'asset
- [x] **Chat — Réponses/citations** (v1.1) — reply_to_id, barre de prévisualisation dans l'input, citation inline dans le message
- [x] **Chat — Messages épinglés** (v1.1) — bannière sticky dans le header du canal, épinglage/désépinglage admin
- [x] **Chat — Aperçus de liens** (v1.1) — unfurl Open Graph côté serveur, cache Redis 1h, cartes sous les messages
- [x] **Chat — Badge de mention** (v1.1) — bulle rouge sur l'icône Chat, séparé de la cloche de notifications
- [x] **Présence — Statuts personnalisés** (v1.1) — emoji + texte, 8 presets, persisté Redis 24h, visible de tous dans la sidebar
- [x] **Présence — Membres hors ligne** (v1.1) — section collapsible dans la sidebar, avatars niveaux de gris
- [x] **Plugins** (v1.1) — fondation `plugins/` avec 3 table-templates officiels (Brasserie de Nuit, Table de Feutre, Pierre & Braise)
- [x] **Messages privés (DMs)** (v1.2) — conversations 1:1, `dm_conversations` + `dm_messages`, badge non-lu, Socket.IO `dm:send/typing/read`
- [x] **Sondages** (v1.2) — dans le chat (bouton 📊) et le forum (à la création + standalone), 3 types : choix / planning / classement, résultats temps réel Socket.IO
- [x] **Système de ban** (v1.2) — ban IP, ban email, enforcement multi-couches (inscription, connexion, middleware), interface admin
- [x] **nodyx-turn — TURN-over-TCP** (v1.3) — RFC 6062, TCP:3478, bypass VPN/firewall pour la voix
- [x] **nodyx-turn — Fix MESSAGE-INTEGRITY** (v1.3) — RFC 5389 §10.3, relay fonctionne désormais dans Firefox, Chrome, tous les clients WebRTC
- [x] **Voix — Relay failover** (v1.3) — redémarrage ICE automatique avec `iceTransportPolicy: relay` après 3 mesures de perte élevée consécutives
- [x] **Voix — Opus optimisé** (v1.3) — 32 kbps par défaut, DTX désactivé, mono, FEC actif
- [x] **Calendrier d'événements** (v1.6) — CRUD complet, RSVP, cover upload, pages `/calendar` + `/calendar/[id]` + edit, `can_manage` (auteur OU mod/admin), sanitize-html étendu — [SPEC 011](../en/specs/011-nodyx-event-calendar/SPEC.md)
- [x] **Gossip Protocol** (v1.6) — `announceEventsToDirectory()` toutes les 10 min, `/discover` multi-type (communautés + threads + événements)
- [x] **Global Search Gossip-based** (v1.5) — `network_index` FTS GIN PostgreSQL, `announceThreadsToDirectory()`, `/discover` avec barre de recherche et cards cross-instances, opt-in `NODYX_GLOBAL_INDEXING=true` — [SPEC 010](../en/specs/010-nodyx-global-search/SPEC.md)
- [x] **Admin — Dashboard enrichi** (v1.7) — stats v2 (événements/sondages/assets/chat/DMs), graphique activité duale 7j (posts + nouveaux membres), top 5 contributeurs, derniers inscrits
- [x] **Annonces système** (v1.7) — bannières colorées (6 variantes) admin-créées, dismissibles, expirables, prévisualisation live — `/admin/announcements`
- [x] **Journal de modération** (v1.7) — audit trail 11 types d'actions, filtres action/acteur, pagination — `/admin/audit-log`, migrations 045-046

**Connaissance & Découverte :**
- [ ] **Nodes** — connaissance structurée durable, Anchors, validée via le Jardin — [SPEC 013](../en/specs/013-node/SPEC.md)
- [ ] **Galaxy Bar** — switcher multi-instances, SSO décentralisé, notifications bio-luminescentes — [SPEC 012](../en/specs/012-nodyx-galaxy-bar/SPEC.md)

**Outils :**
- [ ] Partage de fichiers (hébergé sur le nœud, pas de CDN central)
- [x] **Système de tâches léger** (v1.8) — Kanban par communauté, colonnes configurables, cartes avec assignation/échéance/priorité, drag & drop natif, `/tasks`
- [ ] Ollama IA locale — assistant de savoir (indexe le forum local)
- [ ] **Nodyx Guard Protocol** — middleware scoring toxicité dans `chat:send`, seuil configurable, logs DB
- [ ] Marketplace plugins — API stable pour extensions tierces (fondations dans `plugins/`)

---

---

## PHASE 4.5 — Durcissement sécurité ✅ COMPLÈTE
### Objectif : rendre chaque surface imperméable avant que la Phase 5 n'ouvre la plateforme à un usage plus large

> *"Livré vite. Maintenant, blindons."*
> Audit sécurité complet conduit en mars 2026 — avant tout travail sur la Phase 5.

- [x] **Injection SQL** — requêtes paramétrées dans `gardenService` et les routes `notifications`
- [x] **JWT** — `algorithms: ['HS256']` explicite sur tous les appels `jwt.verify()`
- [x] **SSRF / DNS Rebinding** — blocklist plages IP privées (RFC 1918 + loopback + link-local) dans l'unfurl Open Graph
- [x] **IDOR Socket.IO** — vérification appartenance/ownership sur `chat:react`, `chat:delete`, `voice:stats`, événements `jukebox`
- [x] **Injection CSS / XSS** — valeurs de variables CSS sanitisées (pas de `url()` / `expression()` / `javascript:`) ; `font-family` restreint à une allowlist
- [x] **Auth** — rate limiting enrollment Nodyx Signet ; nettoyage JWT Redis au logout ; validation assigné tâche = membre communauté
- [x] **Crypto / Input** — validation magic bytes WebP (RIFF) ; stripping saut de ligne sur les headers email (SMTP header injection)

---

## PHASE 4.6 — Défense active & sécurité runtime ✅ COMPLÈTE
### Objectif : transformer la plateforme en défenseur actif — détecter, dissuader et alerter en temps réel

> *"Le meilleur pare-feu est celui qui pense."*
> La Phase 4.6 s'appuie sur le durcissement statique de la 4.5 pour construire des systèmes de sécurité dynamiques et runtime.

- [x] **Honeypot** — 25+ chemins scanner piégés (`.env`, `.git`, `wp-admin`, `phpmyadmin`, shells, backups…) ; tarpit 3–7s ; géolocalisation ; page scare terminal ; DB logging + fail2ban auto-ban
- [x] **fail2ban** — 5 jails : SSH, récidivistes SSH (permanent), brute force auth HTTP, honeypot (7 jours), liste noire permanente
- [x] **`nodyx-auth.log`** — la route auth alimente désormais le jail fail2ban à chaque tentative échouée
- [x] **Liste noire permanente** — jail `nodyx-permban` (`bantime = -1`) + DB `ip_bans` pour les acteurs connus malveillants
- [x] **Surveillance Discord** — embeds temps réel : hits honeypot, brute force, connexion admin, nouvelle IP, nouvelles inscriptions
- [x] **Argon2id** — standard de hachage OWASP 2026 ; migration bcrypt transparente à la prochaine connexion
- [x] **Anti-spam chat** — double fenêtre glissante (burst + soutenu) ; UI cooldown côté client
- [x] **Filtre contenu** — symboles nazis/haineux (6 codepoints Unicode), allowlist images (Tenor/Giphy uniquement), blocklist domaines configurable
- [x] **Scan NSFW optionnel** — `nsfwjs` + TensorFlow.js sur upload image (`NSFW_SCAN=true`)
- [x] **Rate limiting upload** — 10 uploads / 10 minutes / utilisateur
- [x] **Vérification e-mail** — obligatoire si SMTP configuré ; connexion bloquée pour les comptes non vérifiés
- [x] **Rotation des logs** — rotation quotidienne, rétention 90 jours, compression
- [x] **Pixel de tracking** (v1.9.2) — PNG 1×1 dans la scary page (`GET /_hp_px/:incidentId`) ; loggé dans `honeypot_pixel_hits` ; alerte Discord au retour de l'attaquant (>30s) ; corrélation IP pixel / IP originale
- [x] **Pièges de collecte credentials** (v1.9.2) — 12 chemins login déclenchent un faux formulaire WordPress convaincant ; credentials loggés dans `honeypot_credential_attempts` ; embed Discord "🔑 Credential Harvest" à la soumission
- [x] **Fichiers canari** (v1.9.2) — 11 patterns (`.env`, dumps SQL, `id_rsa`, `wp-config.php`…) servent de fausses credentials réalistes ; PRNG déterministe par IP — même attaquant = mêmes fausses données ; embed Discord "📄 Canary"
- [x] **Empreinte canvas** (v1.9.2) — JS dans la scary page POSTs le hash fingerprint vers `/_hp_fp` ; upsert dans `honeypot_fingerprints` ; Discord "🔍 Fingerprint Reconnu" si visits > 1 (même cross-IP)
- [x] **Honeytokens** (v1.9.2) — 3 liens invisibles + 1 quasi-invisible dans le HTML de la scary page ; clic → Discord "🎯 HONEYTOKEN CLICKED" ; signal haute confiance d'attaquant humain
- [x] **Slowloris inverse** (v1.9.2) — `reply.hijack()` stream la scary page octet par octet (96B/180ms navigateurs, 256B/80ms bots) ; bloque les threads attaquants 45–90s
- [x] **Olympus Hub** (v1.9.2) — centre de commandement sécurité : stats globales, timeline 48h, top IPs, "PIÈGES ACTIFS", table "CREDENTIAL HARVEST", "ATTAQUANTS RÉCURRENTS" (fingerprints), section pixel, blocklist distribuée fédérée

---

## PHASE 4.7 — Double authentification (2FA) ✅ COMPLÈTE
### Objectif : ajouter un second facteur fort sans sacrifier l'expérience utilisateur

- [x] **TOTP (RFC 6238)** — compatible avec toutes les apps d'authentification (Google Authenticator, Aegis, Bitwarden) ; setup QR code ; session pending Redis 5 min
- [x] **2FA via Nodyx Signet** — si l'utilisateur a un appareil Signet enregistré, Signet est utilisé comme second facteur (ECDSA P-256 > secret TOTP partagé) ; réutilisation complète de l'infrastructure challenge/approbation existante
- [x] **Chaîne de priorité** — Signet > TOTP > connexion directe ; le système sélectionne automatiquement le facteur le plus fort disponible
- [x] **Interface Settings** — activer/désactiver le 2FA avec affichage QR code et flux de confirmation
- [x] **Interface Login** — second step transparent : saisie code TOTP ou déclenchement automatique de l'écran d'attente Signet
- [x] **Rebuild PWA Nodyx Signet** — placeholders `nexusnode.app` remplacés par `nodyx.org`

---

## PHASE 4.8 — Stabilité production & cohérence cross-runtime ✅ COMPLÈTE
### Objectif : rendre Nodyx imperturbable — tout état partagé entre runtimes cohérent, chaque scénario de panne géré

> *"Un système est aussi stable que sa pire hypothèse silencieuse."*
> La Phase 4.8 est un audit chirurgical complet sur l'ensemble du stack — Node.js, Rust, Caddy, PM2, systemd —
> qui identifie et élimine les modes de défaillance silencieux qui paraissaient corrects en développement mais corrompaient l'état en production.

- [x] **Audit Redis keyPrefix — Node.js** — `ioredis keyPrefix: 'nodyx:'` est la seule source de vérité ; tous les préfixes `nodyx:` manuels supprimés dans auth.ts, adminOnly.ts, socket/index.ts, scheduler.ts, index.ts, routes/admin.ts et 6 fichiers de tests (les double-préfixes comme `nodyx:nodyx:heartbeat:` écrivaient silencieusement des clés mortes jamais relues)
- [x] **Audit Redis keyPrefix — Rust** — Rust n'a pas de keyPrefix ioredis ; les 11 clés partagées portent désormais `nodyx:` manuellement : `banned:`, `user_sessions:`, `login_rate:`, `register_rate:`, `reset_rate:`, `resend_verify:`, `resend_verify_ip:` (auth.rs) + `banned:` × 2, `user_sessions:`, scan `heartbeat:*` (admin.rs) + `rate:search:` (directory.rs)
- [x] **Cohérence des bans cross-runtime** — les bans posés par Node.js (panneau admin) ou Rust (cache ban login) sont maintenant visibles des deux côtés
- [x] **Rate limiting cross-runtime** — les limites login/register/reset/resend-verify sont partagées : un attaquant ne peut plus contourner le rate limiting Node.js en frappant l'endpoint Rust
- [x] **Compteur en ligne corrigé** — le dashboard admin affichait toujours 0 membre en ligne (Rust scannait `heartbeat:*` au lieu de `nodyx:heartbeat:*`)
- [x] **Invalidation de session au changement de mot de passe** — l'index `user_sessions:{id}` est maintenant cohérent entre les deux runtimes ; changer le mot de passe invalide les sessions Node.js ET Rust
- [x] **Timeouts fetch scheduler** — `AbortSignal.timeout()` ajouté aux 4 appels HTTP sortants non protégés (pingDirectory 8s, pushAssetsToDirectory 15s, announceThreadsToDirectory 10s, announceEventsToDirectory 10s)
- [x] **Caddy — failover Rust** — les 18 blocs `localhost:3100` passés en `lb_policy first` + `fail_duration 30s` ; si nodyx-server (Rust) est injoignable, Caddy bascule automatiquement sur nodyx-core (Node.js) — zéro downtime sur crash Rust
- [x] **install.sh — version centralisée** — variable `NODYX_VERSION` unique utilisée dans la génération `.env`, le payload d'enregistrement annuaire et le résumé post-installation
- [x] **install.sh — Caddyfile généré durci** — les deux modes (relay et normal) incluent désormais headers de sécurité, bloc honeypot et `header_up -X-Forwarded-For` sur toutes les routes API
- [x] **Garde-fous PM2** — `max_memory_restart` sur les 4 processus (512M core, 256M frontend, 256M hub, 128M docs)
- [x] **Log rotation** — `/etc/logrotate.d/nodyx-auth` — daily, 30 jours de rétention, compressé
- [x] **Rebrand systemd** — `nodyx-relay.service` description et `SyslogIdentifier` mis à jour

**Validation :** 63/63 tests Node.js verts · build Rust 0 erreur · caddy validate OK

---

## PHASE 4.9 — Isolation processus, couverture de tests & CI ✅ COMPLÈTE
### Objectif : Zéro processus root, couverture de tests complète sur les deux runtimes, pipeline CI reproductible

- [x] **Isolation processus — User=nodyx** — Tous les processus applicatifs tournent désormais sous l'utilisateur système `nodyx` ; seuls systemd et code-server restent root. Concerne : `nexus-turn.service` (était root), `pm2-nodyx.service` (remplace `pm2-root.service`). `/home/nodyx` créé avec PM2_HOME.
- [x] **Permissions fichiers durcies** — `nodyx-frontend/.env` et `nodyx-hub/.env` passés de 644 (lisibles par tous) à `root:nodyx 640` ; répertoire `uploads/` transféré à `nodyx:nodyx`
- [x] **Suite de tests Node.js — 181/181** — 6 nouveaux fichiers de tests couvrant modules, polls, search, notifications, wiki, middleware-extended. Causes racines corrigées : `vi.resetAllMocks()` détruisant les implémentations mock Redis, cache module-level `_communityId`, mock transactions `db.connect()`
- [x] **Suite de tests Rust — 18/18** — Premiers tests Rust pour `nodyx-server` : `error.rs` (11 tests — tous les status HTTP, format JSON, no-leak erreur interne, header `Retry-After`) + `extractors.rs` (7 tests — serde rename `Claims`, JWT decode, rejet mauvais secret, token expiré, token malformé)
- [x] **Épinglage dépendances critiques** — Paquets sensibles épinglés à la version exacte dans `nodyx-core/package.json` : `fastify`, `socket.io`, `jsonwebtoken`, `argon2`, `bcrypt`, `pg`, `ioredis`, `web-push`
- [x] **Pipeline CI durci** — GitHub Actions : deux jobs parallèles (`test-node`, `test-rust`), cache npm, gate `npx tsc --noEmit` avant vitest, build + tests Rust avec cache cargo
- [x] **Trou de migration comblé** — `052_placeholder.sql` ajouté pour fermer l'écart entre 051 et 053

**Validation :** 181/181 tests Node.js verts · 18/18 tests Rust verts · TypeScript 0 erreur · Tous les services actifs en utilisateur nodyx

---

## PHASE 5 — Mobile et réputation
### Objectif : Nodyx dans la poche de tout le monde

- [ ] App iOS via Capacitor
- [ ] App Android via Capacitor
- [ ] Desktop via Tauri (.exe/.app/.sh ~10MB, autonome)
- [ ] NodyxPoints — système de réputation communautaire inter-instances
- [ ] Badges et niveaux
- [ ] API publique documentée pour développeurs tiers

---

## RÈGLES DE LA ROADMAP

1. On ne commence pas une phase sans que la précédente soit stable et utilisée
2. On ne casse pas ce qui marche — on propose des alternatives (ex: Relay vs CF Tunnel vs ports ouverts)
3. La complexité est cachée : l'utilisateur voit un bouton, la couche Rust gère la complexité
4. Chaque ajout doit être cohérent avec l'aspect décentralisé et souverain
5. Le core reste simple. La complexité va dans les plugins.
6. La communauté peut voter pour reprioriser les phases futures

---

## CE QUI N'EST JAMAIS DANS LA ROADMAP

- Publicité
- Vente de données
- Fonctionnalité qui nécessite un serveur central **obligatoire** (`nodyx.org` est optionnel — sans lui, l'instance reste pleinement fonctionnelle sur son propre domaine)
- Backdoor de quelque nature que ce soit
- Dépendance permanente à un service propriétaire tiers
- Remplacement de Node.js ou SvelteKit par Rust (chaque outil à sa place)

---

---

## PHASE HORIZON — NODYX-ETHER
### La couche physique. La dernière frontière.

> *"Les ondes radio n'ont pas besoin de permission."*

Nodyx décentralise la couche applicative.
Mais nous dépendons encore d'une chose : l'infrastructure physique d'internet.
Des câbles en fibre contrôlés par des FAI. Des satellites contrôlés par des entreprises.

**NODYX-ETHER décentralise la couche physique elle-même.**

Le pont qui rend ça possible : **les CRDTs**.
Déjà dans Nodyx (NodyxCanvas). Déjà en production.
Le même CRDT qui synchronise un coup de pinceau peut synchroniser un post de forum
sur un lien LoRa à 250 bits/s — même avec 2 heures de délai.

```
Couche 1 — Mesh local       LoRa / Wi-Fi ad-hoc   0–50 km      sans infrastructure
Couche 2 — Radio régionale  HF / NVIS             500–3000 km   rebond ionosphérique
Couche 3 — Ionosphère       HF ondes courtes      Mondial       sans câble, sans satellite
```

```
nodyx-p2p/
└── nodyx-ether/          ← workspace futur
    ├── nodyx-modem/      ← modem logiciel (encodage HF / LoRa en Rust)
    ├── nodyx-mesh/       ← relais mesh LoRa / Wi-Fi ad-hoc
    └── nodyx-sync/       ← sérialisation des deltas CRDT (Cap'n Proto / FlatBuffers)
```

**nodyx-relay devient un orchestrateur multi-chemins :**
`ethernet → wifi-mesh → lora → hf-radio` — fallback automatique, les CRDTs gèrent la convergence.

**Ce que ça signifie concrètement :**
Une communauté dans une zone sinistrée. La fibre est coupée. La 4G est détruite.
Un Raspberry Pi sur batterie. Un module LoRa sur le toit. 55€ au total.
La communauté continue. Les annonces passent. Les gens savent qui est en vie.

**C'est ça, la souveraineté.**

Ce n'est pas une feature pour demain. C'est un **appel à contributeurs :**
→ Radioamateurs, makers LoRa, contributeurs Meshtastic, développeurs Rust embarqué.
→ L'architecture est là. La fondation CRDT est livrée.
→ La couche radio attend les bonnes mains.

→ **[Spec complète : docs/ideas/NODYX-ETHER.md](../ideas/NODYX-ETHER.md)**

---

## PHASE RADIO — NODYX-RADIO
### La radio internet qui a enfin une raison d'exister.

> *"50 000 opérateurs de radio internet qui émettent dans le vide. Nodyx est la réponse."*

Le problème que personne n'a résolu : 100 000+ stations radio internet à leur apogée.
Moins de 5% avaient plus de 10 auditeurs simultanés.
Pas parce que les programmes étaient mauvais. Parce qu'il n'existait aucune structure
pour transformer des auditeurs simultanés en communauté.

**Les stations qui ont survécu** avaient une couche communautaire structurellement attachée.
**Les stations qui sont mortes** avaient des auditeurs, mais pas de communauté.

L'inversion que Nodyx rend possible :
```
Stations mortes    :  broadcast → espoir de communauté
Stations vivantes  :  communauté → broadcast comme expression
```

**Une instance Nodyx EST la couche communautaire.** Une station qui tourne Nodyx obtient :
- Forum (archives, discussions, notes d'émission — indexées par tous les moteurs de recherche)
- Chat en direct (les auditeurs réagissent en temps réel pendant les émissions)
- Salons vocaux (studio ouvert, coulisses, questions/réponses en direct)
- Garden (la communauté vote les prochains programmes)

**La régie coopérative — le modèle économique manquant :**

Une petite station avec 80 auditeurs ne peut pas négocier avec des annonceurs seule.
Mais 200 stations Nodyx-Radio avec 80 auditeurs chacune = **16 000 auditeurs locaux**.
Un artisan, un boulanger, un événement régional paie pour cette portée.

```
nodyx.org/radio
  → régie publicitaire coopérative
  → annonceurs locaux/régionaux déposent leurs spots audio
  → spots distribués aux stations de la région ciblée
  → revenus partagés : 80% station / 20% infrastructure nodyx.org
```

Pas de tracking. Pas de profils utilisateurs. Ciblage géographique uniquement.
Le boulanger du village finance la radio du village qui tourne sur un Pi dans le village.
**L'argent reste local. L'infrastructure reste libre.**

De nouvelles stations vont voir le jour parce qu'elles ont enfin une communauté.
Et parce qu'elles peuvent enfin se financer.

→ **[Vision complète : docs/ideas/NODYX-RADIO.md](../ideas/NODYX-RADIO.md)**

---

*Version 2.1 — 8 mars 2026*
*"Le P2P est l'âme. Rust est le corps. La radio est la résilience. La communauté est la raison."*
