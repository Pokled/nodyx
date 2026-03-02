# NEXUS — Roadmap
### Version 1.4 — Le chemin réaliste

---

> *"Un projet qui veut tout faire en même temps ne fait rien bien."*
> La roadmap Nexus est construite sur une règle simple :
> chaque phase doit fonctionner parfaitement avant de passer à la suivante.

---

## ÉTAT ACTUEL — Mars 2026

| Phase | Titre | État |
|---|---|---|
| **Phase 1** | Forum MVP + Admin | ✅ Complète |
| **Phase 2** | Chat temps réel + Annuaire + Identité réseau | ✅ Complète |
| **Phase 2.5** | Personnalisation communautaire + Fédération légère | ✅ Complète |
| **Phase 3** | Infrastructure P2P + Fondation Rust | 🔨 En cours |
| Phase 4 | Enrichissement de la plateforme | ⏳ Planifiée |
| Phase 5 | Mobile et réputation | ⏳ Planifiée |

---

## PHASE 1 — MVP Forum + Admin ✅ COMPLÈTE
### Objectif : Une communauté peut s'installer, se configurer, et vivre sur Nexus

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
- [x] Homepage = communauté de l'instance (NEXUS_COMMUNITY_NAME via .env)
- [x] Arbre de catégories récursif (CategoryTree.svelte)
- [x] Page liste catégories + threads (avec pills de tags)
- [x] Page thread + posts + formulaire réponse
- [x] Éditeur WYSIWYG (Tiptap — gras, code, tableaux, images, iframes)
- [x] Formulaire inscription / connexion
- [x] Profils utilisateurs complets (bio, tags, links, GitHub widget)
- [x] Système de grades (CRUD admin + badge coloré)
- [x] Annuaire des instances (/communities — alimenté par nexusnode.app)
- [x] Panneau admin complet (/admin — 9 pages dont Tags)
- [x] Navbar adaptive (loupe recherche, cloche notifications, lien Admin)
- [x] Page /search — onglets Threads/Posts, extraits surlignés
- [x] Page /notifications — liste + marquer lu + polling 30s

### 1.4 Self-hosting
- [x] `install.sh` — installeur one-click VPS (ports 80/443, Let's Encrypt via Caddy, PM2, coturn, PostgreSQL, Redis)
- [x] `install_tunnel.sh` — installeur home server via Cloudflare Tunnel (aucun port à ouvrir, Raspberry Pi, box)
- [x] docker-compose.yml (Nexus + PostgreSQL + Redis)
- [x] Dockerfile multi-stage
- [x] Script seed (données de démonstration)
- [x] Script PowerShell "Nexus-Easy-Install" — automatise Node/PostgreSQL/Redis sur Windows Server sans Docker
- [x] Health check visuel post-installation (spinner braille, score PASS/WARN/FAIL)
- [x] Documentation installation en 15 minutes
- [x] Guide complet des noms de domaine (DOMAIN.md — types, compatibilité, FAQ)
- [x] .env.example documenté

### Critère de succès Phase 1 ✅
Une personne non-développeur peut :
1. Installer Nexus sur son serveur en moins de 15 minutes ✅
2. Configurer son instance via l'installeur interactif ✅
3. Créer des catégories, des threads, des tags ✅
4. Administrer sa communauté via le panneau admin ✅
5. Être trouvé sur Google ✅

---

## PHASE 2 — Chat temps réel + Annuaire + Identité réseau ✅ COMPLÈTE
### Objectif : Les membres communiquent en live, l'annuaire est réel, chaque instance a son URL

### 2.1 Chat temps réel ✅
- [x] WebSocket (Socket.io) intégré dans Fastify v5
- [x] Canaux textuels configurables par l'admin
- [x] Notifications temps réel (WebSocket — remplace le polling 30s)
- [x] Historique des messages persisté en PostgreSQL

### 2.2 nexusnode.app — Directory ✅
- [x] Service d'annuaire global réel — API d'enregistrement des instances
- [x] Page /communities alimentée par l'annuaire réel (fin du mock)
- [x] Enregistrement automatique d'une instance au premier démarrage
- [x] Ping automatique toutes les 5 minutes (membres live, stats en ligne)

### 2.3 Identité réseau — `slug.nexusnode.app` ✅
- [x] Chaque instance choisit un slug unique à l'installation
- [x] Le slug est réservé auprès du nexusnode.app directory (API REST)
- [x] DNS wildcard `*.nexusnode.app` géré par notre Cloudflare
- [x] Caddy route `slug.nexusnode.app → IP du nœud` (Cloudflare Origin Certificate)
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
- [x] Scheduler — push assets toutes les heures vers `nexusnode.app`
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
> Nexus ne remplacera pas Node.js ou SvelteKit — ils font leur travail parfaitement.
> Rust viendra **en dessous**, invisible pour l'utilisateur, pour gérer les parties
> que JavaScript ne peut pas bien faire : réseau bas niveau, chiffrement, WireGuard, DHT.
> La couche Rust communique avec nexus-core via un socket Unix local — simple et découplé.

---

### 3.0 — `nexus-p2p` : La fondation Rust 🔨 EN COURS

#### Pourquoi Rust ici ?

Aujourd'hui, un utilisateur sans domaine et sans ports ouverts doit :
1. Créer un compte Cloudflare
2. Ajouter son domaine à Cloudflare (nécessite d'en posséder un, ~1€/an)
3. Configurer `cloudflared` manuellement ou via `install_tunnel.sh`

C'est trop de friction. Et surtout : **c'est une dépendance à un service tiers**,
contraire à la philosophie Nexus.

La couche Rust résout ça de façon radicale et progressive.

#### Architecture

```
nexus-frontend (SvelteKit) ──────────────────────┐
nexus-core    (Fastify/Node.js) ─────────────────┤
                                                  │ IPC (Unix socket)
                                                  ▼
                                    ┌─────────────────────┐
                                    │     nexus-p2p       │
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

#### Phase 3.0-A — `nexus-relay-client` ✅ VALIDÉE — 1er mars 2026

> Remplace `install_tunnel.sh` + Cloudflare Tunnel. Zéro domaine requis. Zéro port à ouvrir.
> **Testé en conditions réelles : Raspberry Pi 4, aucun port ouvert, aucun compte Cloudflare.**

- [x] Binaire Rust statique (9MB) — `tokio` + `hyper` + `tokio-postgres` + `clap` + `dashmap`
- [x] Connexion TCP sortante vers `relay.nexusnode.app:7443` (notre infra)
- [x] Forward HTTP bidirectionnel (JSON framing 4-byte length prefix)
- [x] Enregistrement automatique `slug.nexusnode.app` sans DNS ni CF account
- [x] Reconnexion automatique avec backoff exponentiel (1s → 2s → 4s → max 30s)
- [x] GitHub Release `v0.1.1-relay` — binaires amd64 + arm64 (fix traitement concurrent)
- [x] Intégration dans `install.sh` : option 2 "Nexus Relay (recommandé)"
- [x] Service systemd côté client (`nexus-relay-client.service`)

**Résultat utilisateur :** `bash install.sh` → choisir "Relay" → obtenir `moncommunaute.nexusnode.app` **sans aucune configuration réseau**.

#### Phase 3.0-B — Browser P2P Nodes (WebRTC DataChannels) 🔨 PROCHAINE ÉTAPE

> Les navigateurs des utilisateurs deviennent des nœuds actifs.
> Communication directe entre pairs sans intermédiaire serveur.
> **Réutilise le signaling existant de `voice.ts`** — zéro nouvelle infrastructure serveur.

**Approche :** WebRTC DataChannels natifs + signaling Socket.IO existant (pattern voice.ts)
**Pas pour ce POC :** libp2p (surcharge), DHT (2027+)

**v0.8 — POC deux navigateurs :**
- [ ] Ajouter events `p2p:offer`, `p2p:answer`, `p2p:ice` dans `voice.ts` (3 lignes — même pattern que `voice:offer/answer/ice`)
- [ ] Créer `nexus-frontend/src/lib/p2p.ts` — gestionnaire RTCPeerConnection + DataChannel
- [ ] Découverte de pair via Socket.IO existant (handshake polite/impolite — un seul initiateur)
- [ ] Utiliser le coturn de l'instance (déjà installé) — pas de STUN tiers
- [ ] Handler `ondatachannel` côté répondeur (crucial — sinon le répondeur ne reçoit jamais le canal)
- [ ] Indicateur UI "⚡ P2P direct" / "☁️ Serveur" dans l'interface chat
- [ ] Test validé : deux navigateurs, DataChannel direct confirmé, messages hors serveur

**v0.9 — Mesh 1-N :**
- [ ] Gérer plusieurs connexions pair simultanées (Map de RTCPeerConnections)
- [ ] Broadcast découverte : qui d'autre est connecté ?
- [ ] Fallback gracieux si WebRTC échoue (NAT strict, firewall)
- [ ] Transfert d'assets entre pairs (téléchargement depuis le pair le plus proche)

#### Phase 3.0-C — `nexus-turn` (remplace coturn)

> coturn est un projet C des années 2000. Complexe à configurer, surface d'attaque importante.

- [ ] Serveur STUN/TURN en Rust — RFC 5766 + RFC 8656
- [ ] Credentials dynamiques fournis par nexus-core via IPC (pas de config statique)
- [ ] Logs structurés (JSON), métriques Prometheus
- [ ] ~5MB statique, configuration zéro à l'installation

#### Phase 3.0-D — `nexus-p2p` core (vision long terme 2027-2028)

> Le cœur distribué. Quand un nœud veut contacter un autre nœud directement, sans passer par nous.
> Réseau immortel : chaque donnée répliquée sur 3+ nœuds, auto-guérison.

- [ ] DHT Kademlia (via `libp2p`) — découverte de pairs sans serveur central
- [ ] WireGuard (via `wireguard-rs`) — tunnel chiffré direct entre instances volontaires
- [ ] ICE/STUN natif — traversée NAT sans coturn pour les connexions P2P
- [ ] API IPC exposée à nexus-core : `relay.register(slug)`, `peer.connect(slug)`, `network.peers()`
- [ ] Gossip protocol — propagation naturelle de l'état du réseau
- [ ] CRDTs — données sans conflit entre nœuds (compteurs de likes, présence distribuée)
- [ ] Réplication facteur 3 — auto-guérison si un nœud tombe
- [ ] Si `nexusnode.app` est inaccessible, les nœuds se trouvent via DHT (résilience)

---

### 3.1 — Salons vocaux — Interface & Modes avancés
*(couche réseau déjà en place — Phase 2.4)*

- [x] VoicePanel sidebar — panneau gauche fixe avec liste des participants (Galaxy Bar layout)
- [x] Panneau d'interaction membre — cliquer sur un membre → stats réseau temps réel (RTT / jitter / perte de paquets) + curseur de volume
- [x] Panneau self-monitoring — cliquer sur soi → jauge audio live, badges muted / deafened / PTT
- [x] Popup VoiceSettings — modal large en position fixe (360px), échappe le débordement de la sidebar avec overlay backdrop
- [x] Boutons d'interaction par pair — lien Profil, Message Direct, Partage de fichier + Mini-jeu (à venir)
- [ ] Mode Table Ronde — WebRTC P2P direct (2 à 8 personnes, faible latence)
- [ ] Mode Amphithéâtre — diffusion 1→N (9 à 25+ personnes, vidéo sur "toile")
- [ ] Mini-jeux entre membres — petits jeux en duo dans le salon vocal (premier jeu : TBD)
- [ ] Partage de fichiers entre membres vocaux — transfert P2P direct dans le salon
- [ ] Nodes-as-a-Service — un Raspberry Pi peut devenir relais de flux média pour soulager le serveur principal

### 3.2 — Réseau maillé inter-instances
*(dépend de Phase 3.0-C)*

- [ ] WireGuard mesh entre instances volontaires — tunnel chiffré bout en bout
- [ ] DHT pour découverte des pairs sans serveur central
- [ ] Gossip protocol — synchronisation légère de métadonnées entre nœuds
- [ ] Annuaire de secours distribué — si `nexusnode.app` tombe, les nœuds maintiennent l'annuaire
- [ ] Transition automatique vers connexion P2P directe quand disponible
- [ ] Fédération légère — un membre de la communauté A peut interagir avec la communauté B

---

## PHASE 4 — Enrichissement de la plateforme
### Objectif : Nexus devient la plateforme communautaire complète

- [ ] Partage de fichiers (hébergé sur le nœud, pas de CDN central)
- [ ] Whiteboard collaboratif (temps réel via WebSocket)
- [ ] Système de tâches léger (Trello-like, par communauté)
- [ ] Ollama IA locale — assistant de savoir (indexe le forum local)
- [ ] **Nexus Guard Protocol — intégration TypeScript** : migrer le moteur de scoring toxicité dans `nexus-core/src/socket/index.ts` comme middleware `chat:send` — score 0–10, seuil configurable via `.env`, logs en DB
- [ ] Guard Protocol — seuil configurable via panneau admin (sans redémarrage)
- [ ] Guard Protocol — blocage URL fiable (regex + whitelist configurable)
- [ ] Marketplace plugins — API stable pour extensions tierces
- [ ] Data Sharding distribué pour les fichiers lourds (inspiration IPFS/BitTorrent — nœuds volontaires)

---

## PHASE 5 — Mobile et réputation
### Objectif : Nexus dans la poche de tout le monde

- [ ] App iOS via Capacitor
- [ ] App Android via Capacitor
- [ ] Desktop via Tauri (.exe/.app/.sh ~10MB, autonome)
- [ ] NexusPoints — système de réputation communautaire inter-instances
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
- Fonctionnalité qui nécessite un serveur central **obligatoire** (`nexusnode.app` est optionnel — sans lui, l'instance reste pleinement fonctionnelle sur son propre domaine)
- Backdoor de quelque nature que ce soit
- Dépendance permanente à un service propriétaire tiers
- Remplacement de Node.js ou SvelteKit par Rust (chaque outil à sa place)

---

*Version 1.6 — 2 mars 2026*
*"Le P2P est l'âme. Rust est le corps."*
