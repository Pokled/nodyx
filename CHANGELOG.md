# Changelog

All notable changes to Nodyx are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [1.8.2] — 2026-03-20

### Security — Full Paranoid Audit (38 vulnerabilities fixed)

**Critical — SQL Injection**
- **`gardenService.ts`** — `requesterId` interpolated directly into SQL template literal → full parameterized query with `$N` placeholder
- **`models/notification.ts`** — `daysOld` interpolated into `INTERVAL '${daysOld} days'` → parameterized via `$1 * INTERVAL '1 day'`

**Critical — JWT Algorithm Confusion**
- **`middleware/auth.ts`**, **`middleware/adminOnly.ts`**, **`socket/index.ts`** — `jwt.verify()` without explicit algorithm → added `{ algorithms: ['HS256'] }` on all verify calls
- **`routes/auth.ts`**, **`routes/authenticator.ts`** — `jwt.sign()` without explicit algorithm → added `{ algorithm: 'HS256' }` on all sign calls

**High — SSRF / DNS Rebinding**
- **`routes/chat.ts` — `/unfurl`** — two-step DNS resolution (validate then fetch) vulnerable to DNS rebinding: attacker resolves to safe IP, then re-resolves to `127.0.0.1` during fetch → replaced `fetch()` with a custom `https.request()`/`http.request()` that connects directly to the pre-resolved IP (single DNS lookup, anti-rebinding)
- **`routes/chat.ts` — `isPrivateIp()`** — missing IPv6 documentation prefix `2001:db8::/32` (RFC 3849) → added

**High — Socket.IO IDOR & Missing Guards**
- **`socket/index.ts` — `chat:typing`** — no room membership check → user could broadcast typing to any channel UUID → added `socket.rooms.has()` guard
- **`socket/index.ts` — `chat:react`** — no channel membership check → user could toggle reactions on messages of channels they're not in → added `findMessageById()` + `socket.rooms.has()` pre-check
- **`socket/index.ts` — `chat:delete`** — admin check used `community_members WHERE user_id = $1` (any community) → admin of community A could delete messages of community B → scoped to `JOIN channels ON community_id` of the specific message
- **`socket/voice.ts` — `voice:stats`** — no room check, no rate limit → any authenticated user could broadcast to any voice room → added room check + rate limit (10/s)
- **`socket/voice.ts` — `voice:ping`** — no rate limit → spam triggered expensive `fetchSockets()` on every call → added rate limit (3/s)
- **`socket/voice.ts` — `jukebox:request_sync`** — no rate limit, no room check, no UUID validation → full DoS vector → added all three guards
- **`socket/index.ts` — `dm:typing`** — no participant check → any user could spoof typing to any conversation ID → added `EXISTS (SELECT 1 FROM dm_participants WHERE user_id = $2)` subquery

**High — XSS / CSS Injection**
- **`routes/users.ts` — `website_url`** — `z.string().url()` accepts `javascript:` protocol → added `.refine(v => /^https?:\/\//i.test(v))`
- **`routes/users.ts` — `name_font_family`** — free string, injected in `font-family: '...'` CSS → added regex `^[a-zA-Z0-9 _\-]+$`
- **`routes/users.ts` — `localFontUrl`** — `/uploads/` path without quote restriction, injected in `@font-face { src: url('...') }` → added `!/['"\\]/.test(v)` guard
- **`routes/users.ts` — `metadata.theme.bgImage`** — unvalidated, injected in `background: url("...")` → added strict Zod schema (HTTPS only)
- **`lib/nameEffects.ts`** (frontend) — `fontUrl` and `fontFamily` not escaped in CSS string context → added backslash + single-quote escaping before injection
- **`lib/profileThemes.ts`** (frontend) — `bgImage` from JSONB injected without validation → added `https://` guard (defense in depth)
- **`routes/chat/+page.svelte`** (frontend) — GIF URL injected unescaped in `<img src="...">` template → added `https://` validation + `"` / `'` encoding

**Medium — Crypto / File Validation**
- **`services/fileScanner.ts` — WebP**  — RIFF magic bytes shared with AVI/WAV; `offset 8` ("WEBP") not checked → added dedicated step-2 check after EXPECTED_MAGIC validation
- **`services/emailService.ts`** — `username` and `communityName` embedded in email templates without sanitization → added `sanitizeHeader()` stripping `\r\n` (SMTP header injection)
- **`routes/users.ts` — font upload`** — extension derived from `data.filename` (client-controlled), not MIME type → switched to `mimeToExt` lookup table

**Medium — Auth & Access Control**
- **`routes/authenticator.ts` — `POST /devices/register`** — no rate limit on enrollment token endpoint → added `enrollRateLimit` (3 req/5min/IP)
- **`routes/tasks.ts` — `PATCH /cards/:id` assignee**  — `assignee_id` accepted without membership check → added `community_members` validation before update
- **`routes/polls.ts` — `POST /:id/vote`** — no ban check → banned users could still vote → added `community_bans` lookup
- **`routes/auth.ts` — logout`** — `redis.del(session:token)` without cleaning `user_sessions:userId` index → added `redis.srem()`
- **`routes/directory.ts` — gossip receive`** — UUID not validated before PostgreSQL `::uuid` cast (throws unhandled error on malformed input) → added `UUID_RE.test()` skip

**Low / Infrastructure**
- **`config/database.ts`** — PostgreSQL SSL not configurable → added `DB_SSL=true` opt-in with `rejectUnauthorized: true`
- **`index.ts` — Socket.IO`** — transports not explicitly set (relay strips Upgrade header) → added `transports: ['polling', 'websocket']`, `pingInterval: 8000`, `pingTimeout: 4000`
- **`socket/rateLimiter.ts`** — added rules for `voice:stats` (10/s), `voice:ping` (3/s), `jukebox:request_sync` (3/s)
- **`socket/voice.ts` — `voice:stats`** — `rtt` accepted `NaN` / `Infinity` → added `isFinite()` check
- **`socket/index.ts`** — `JSON.parse` on Redis status data without try-catch → wrapped in try/catch

---

## [1.8.1] — 2026-03-15

### Security
- **`PATCH /cards/:id` — permission check ajouté** — n'importe quel membre authentifié pouvait modifier n'importe quelle carte (titre, description, assigné, priorité, déplacement de colonne). Le handler vérifie désormais que l'utilisateur est créateur de la carte, créateur du tableau, ou admin/mod (même logique que le DELETE).
- **`POST /api/auth/enrollment-tokens` — restreint aux admins** — la route d'émission de tokens Signet n'était protégée que par `requireAuth`. Ajout de `adminOnly` en preHandler.
- **`ecosystem.config.js` — HOST: 127.0.0.1** — le frontend SvelteKit SSR écoutait sur `0.0.0.0:5173` en production. Ajout de `HOST: '127.0.0.1'` pour lier sur localhost uniquement derrière Caddy.
- **`/api/v1/health` — HTTP 503 si DB down** — le catch renvoyait `{ status: 'error' }` avec HTTP 200 → tout monitoring considérait l'instance saine même si la DB était déconnectée. Fix : `reply.code(503).send(...)`.

### Fixed
- **`tasks.ts` — cache `getCommunityId()`** — la fonction refaisait une requête DB à chaque appel. Ajout d'un cache module-level `_communityId` (même pattern que `admin.ts`).
- **`tasks.ts` — try/catch sur toutes les routes** — les 9 handlers propagaient les erreurs DB en 500 non maîtrisé. Chaque handler est maintenant enveloppé dans un try/catch avec `reply.code(500).send({ error: 'Internal server error' })`.
- **`/api/v1/instance/announcement` — rateLimit ajouté** — route appelée à chaque chargement de page (layout.server.ts), exposée au flood sans protection.
- **`instance.ts POST /tags` — modérateurs autorisés** — les modérateurs étaient bloqués à tort pour créer/supprimer des tags (incohérent avec les autres routes où mods = admins).
- **Version corrigée** — `nodyx-core/package.json` et `nodyx-frontend/package.json` passés de `1.0.0` à `1.8.0` ; `GET /` retournait `version: '0.1.0'` → lit désormais `process.env.NODYX_VERSION ?? '1.8.0'`.
- **`install.sh` — bannière et version** — bannière affichait `v1.0`, enregistrement directory hardcodait `"1.0.0"` → corrigés en `v1.8` et `${NODYX_VERSION:-1.8.0}`.
- **`admin/ai` — Neural Engine** — `selectModel()` appelait `POST /api/v1/admin/neural/set-model` (route inexistante) avec token depuis `localStorage` (violation de la convention HttpOnly cookie). Remplacé par un no-op avec bannière "En développement".
- **`.env.example` — variables manquantes documentées** — `nodyx-core/.env.example` : ajout de `GOSSIP_PEERS`, `STUN_FALLBACK_URLS`, `SIGNET_URL`, `VPS_IP`, `CF_TOKEN`, `CF_ZONE_ID` ; `nodyx-frontend/.env.example` : `PUBLIC_API_URL` corrigé (était `/api/v1` → maintenant la racine du domaine), ajout de `PRIVATE_API_SSR_URL` et `PUBLIC_DIRECTORY_URL`.

### Added
- **Previews SVG pour les table-templates** — `brasserie-de-nuit`, `pierre-et-braise`, `table-de-feutre` : fichier `preview.svg` (280×160px) créé pour chaque template officiel, requis par la future UI de sélection.

---

## [1.8.0] — 2026-03-14

### Added
- **Système de tâches léger** — Kanban par communauté, accessible sur `/tasks`
  - Tableaux avec 3 colonnes par défaut (À faire / En cours / Terminé)
  - Colonnes configurables : nom, couleur (9 variantes), ajout/suppression
  - Cartes : titre, description, assignation, échéance, priorité (basse/normale/haute/urgente)
  - Drag & drop natif HTML5 entre colonnes (zéro dépendance)
  - Modal d'édition complète avec sélecteur de membre pour l'assignation
  - Permissions : tout membre peut créer tableaux et cartes ; gestion colonnes réservée au créateur + admin/mod
  - Migration 047 (`task_boards`, `task_columns`, `task_cards`)
- **Alerte de mise à jour dans le panel admin** — bannière indigo affichée dès qu'une nouvelle version est disponible sur GitHub, avec lien vers les notes de version ; vérification via l'API GitHub Releases, résultat mis en cache Redis 6h
- **Numéro de version** affiché sur la page d'accueil dans la section "Cette instance" (ex: `Nodyx v1.8.0`) — lu depuis la variable d'environnement `NODYX_VERSION`
- **Directory réseau — instances hors ligne masquées** — `GET /directory` filtre désormais les instances dont `last_seen > 30 minutes` ; seules les instances actives apparaissent dans la Galaxy Bar et sur `/admin/status`

### Fixed
- **Raspberry Pi ARM64 (Pi 4/5)** — `install.sh` : installation forcée de `@rollup/rollup-linux-arm64-gnu` si absent après `npm install` (évite l'erreur `traceVariable / tick from svelte` due au fallback JS de Rollup 4 sans binaire natif)
- **ARM32 bloqué** (`armv7l`/`armv6l`) — message d'erreur explicite avec instruction pour passer en OS 64-bit
- **Build ARM** — `NODE_OPTIONS=--max-old-space-size=1024` ajouté sur le build frontend

---

## [1.7.0] — 2026-03-10

### Added
- **Landing page refonte** — hero dynamique avec stats live (membres/canaux/threads), feature highlights illustrés, footer institutionnel avec lien GitHub/AGPL
- **Admin — Dashboard enrichi** — statistiques étendues (événements, sondages, assets, messages chat, DMs), graphique d'activité duale (posts + nouveaux membres sur 7 jours), top 5 contributeurs du mois, derniers inscrits
- **Annonces système** — bannières colorées (6 variantes : indigo/amber/green/red/sky/rose) créées par les admins, dismissibles par l'utilisateur, expiration optionnelle par date/heure, prévisualisation live dans le panneau admin (`/admin/announcements`)
- **Journal de modération** — audit trail complet des actions admin (`/admin/audit-log`), 11 types d'actions (ban/unban/kick/rôle/pin/unpin/lock/unlock/supprimer fil/créer annonce/supprimer annonce), filtres par action et par admin, pagination 50 entrées, helper `logAction()` fire-and-forget
  - Migrations 045 (`system_announcements`) + 046 (`admin_audit_log`)

### Fixed
- **Stabilité admin** — pool PG `max` 10 → 20 pour absorber les requêtes SSR parallèles lors des rechargements de pages admin ; `connectionTimeoutMillis: 5000` ; `.catch()` ajouté sur toutes les queries stats vulnérables (`activityRes`, `membersActivityRes`, `topContribRes`, `recentMembersRes`) — corrige les déconnexions socket intermittentes lors des actions admin (changement de rôle, ban, etc.)
- **Directory** — `online_count` dédupliqué via `io.in('presence').fetchSockets()`, fenêtre `isOnline` élargie à 20 minutes
- **Tests** — `admin.test.ts` : mock fallback `mockResolvedValue` pour les queries supplémentaires du dashboard enrichi ; pattern SQL `community_members` mis à jour pour matcher le JOIN users

---

## [1.6.0] — 2026-03-08

### Added
- **Calendrier d'événements** (SPEC 011) — CRUD complet, RSVP (going/maybe/not_going), cover upload (`asset_type: banner`), sanitize-html étendu (img/iframe/table/div/span)
  - Pages `/calendar`, `/calendar/new`, `/calendar/[id]`, `/calendar/[id]/edit`
  - `can_manage` retourné par `GET /events/:id` (auteur OU mod/admin de la communauté)
  - `canManageEvent()` helper dans `events.ts`
- **Gossip Protocol** — synchronisation légère des événements cross-instances
  - Scheduler `announceEventsToDirectory()` — pousse les événements à venir toutes les 10 min
  - `/discover` multi-type : cards communautés + threads + événements avec types dédiés

---

## [1.5.0] — 2026-03-08

### Added
- **Slug URLs pour les catégories** — URLs lisibles pour toutes les catégories et sous-catégories
  - Format : `/forum/nouvelles-fonctionnalites` (NFD + strip emojis + tirets)
  - Redirect 301 automatique UUID → slug sur les pages catégorie et thread
  - `generateCategorySlug()` dans `community.ts` (même algo que threads)
  - Régénération automatique du slug quand un admin renomme une catégorie
  - `scripts/regen-category-slugs.ts` — script one-shot pour les instances existantes
  - Migrations 039 (`categories.slug`) + 040 (`network_index.category_slug`)
- **Sous-catégories visibles** — les catégories parentes (ex: Développement) affichent maintenant leurs sous-catégories en grille avant la liste de threads
- **Global Search cross-instances** (`/discover`) — SPEC 010
  - Table `network_index` avec indexation FTS PostgreSQL (GIN)
  - Scheduler `announceThreadsToDirectory()` : pousse les threads publics toutes les 10 min
  - Directory : `POST /announce` + `GET /search` avec `ts_rank` et fallback `updated_at`
  - Page `/discover` avec barre de recherche, cards instances, tags, pagination
  - Opt-in via `NODYX_GLOBAL_INDEXING=true` dans `.env`
  - Lien « Découvrir » dans la navigation principale
- **URLs cross-instances correctes** — les liens depuis `/discover` pointent vers `/forum/{category_slug}/{thread_slug}` de l'instance distante

### Fixed
- Redirect post-création de thread vers l'URL canonique (slug catégorie + slug thread)
- `category_slug` retourné par `ThreadModel.create` via sous-requête inline
- Tous les liens forum utilisent `category.slug ?? category.id` (home, search, notifications, admin, sitemap, RSS)

---

## [1.4.0] — 2026-03-08

### Added
- **Slug URLs** — threads accessibles via URLs lisibles et indexables par les moteurs de recherche
  - Format : `/forum/[category]/mon-titre-de-thread-XXXXXXXX` (NFD accent-stripping + suffixe UUID)
  - Redirect 301 automatique des anciens UUID vers le slug canonique
  - `scripts/regen-slugs.ts` — script de régénération pour les instances existantes
- **SEO complet** — chaque page forum correctement balisée
  - `<link rel="canonical">` sur toutes les pages thread et catégorie
  - OpenGraph complet : `og:url`, `og:image` (banner communautaire), `og:site_name`, `og:type`
  - JSON-LD `DiscussionForumPosting` avec `url`, `dateModified`, `isPartOf`, `interactionStatistic`
  - `og:site_name` + `theme-color` injectés globalement via le layout
- **`/sitemap.xml` dynamique** — toutes les catégories et threads publics avec `lastmod` et priorité
  - Fetch en parallèle par catégorie, cache 1h, regeneration automatique
  - `robots.txt` déjà référencé (était présent, maintenant actif)
- **Migration 036** — colonnes `slug`, `is_indexed`, `last_indexed_at` sur `threads`
  - Infrastructure prête pour le Global Search (SPEC 010)

### Fixed
- `forums.ts GET /threads/:id` — toutes les queries suivantes (posts, tags, views) utilisent `thread.id` (UUID résolu) et non le slug brut
- `forums.ts POST /posts` — `thread_id` résolu en UUID avant insert FK et vérification de ban
- `forums.ts PATCH /threads/:id` — `isMod`, `update`, `remove`, `setThreadTags` utilisent `thread.id`
- `CreatePostBody` Zod — `thread_id` accepte string (UUID ou slug), résolution côté serveur
- `+page.server.ts` — requête polls utilise `thread.id` et non `params.thread` (slug)
- Suppression de `pokled.ddns.net` hardcodé dans `og:image` (vestige d'une instance de dev)

---

## [1.3.0] — 2026-03-08

### Added
- **Système de ban complet** — protection multi-couches contre les abus
  - IP ban + email ban : les comptes recréés depuis la même IP ou avec le même email sont bloqués dès l'inscription
  - Déconnexion socket immédiate au moment du ban (le modérateur n'a pas à attendre)
  - Enforcement à toutes les couches : login, socket.io, API, `instance/members`, `communities/join`
  - Page `/banned` dédiée, redirection automatique dès l'événement `banned` Socket.IO
  - Panel admin : formulaire de ban avec motif, durée optionnelle, confirmation modale
  - Migration 030 : `community_bans` (userId, reason, bannedBy, expiresAt, ipBan, emailBan)
- **nodyx-turn — TURN over TCP (RFC 6062)** — les utilisateurs derrière VPN ou firewall strict peuvent désormais utiliser les salons vocaux
  - Écoute simultanée UDP:3478 + TCP:3478 — même binaire, même configuration
  - Framing RFC 4571 : préfixe 2 octets big-endian par message
  - Registry partagée UDP/TCP — une seule allocation par client quel que soit le transport
  - ICE server URL ajouté automatiquement : `turn:IP:3478?transport=tcp`
- **nodyx-turn — MESSAGE-INTEGRITY sur les réponses** (RFC 5389 §10.3)
  - Les réponses TURN (Allocate, Refresh, CreatePermission, ChannelBind) incluent désormais le champ MESSAGE-INTEGRITY obligatoire
  - Fixe le problème fondamental : Firefox et Chrome rejetaient silencieusement les réponses sans MI → aucun relay candidate généré → TURN inutilisable en relay

### Fixed
- **Voice — Relay failover automatique** — détection de qualité dégradée et bascule relay
  - Si la perte de paquets dépasse 25% pendant 3 polls consécutifs (~6s), la connexion bascule en relay-only via `pc.setConfiguration({ iceTransportPolicy: 'relay' })` + ICE restart
  - Bascule silencieuse (sans coupure audio) — spécialement conçu pour les utilisateurs VPN
- **Voice — Opus optimisé pour les liens à forte perte**
  - Bitrate par défaut : 64 kbps → **32 kbps** (paquets plus petits, meilleure résistance à la perte)
  - DTX (Discontinuous Transmission) désactivé : les silences généraient des bursts au retour de la parole
  - Mono forcé (`stereo=0`) : la voix ne nécessite pas la stéréo, réduit encore la bande passante
  - FEC (in-band Forward Error Correction) maintenu : `useinbandfec=1`
- **Voice — Calcul packet loss** — `Math.max(0, dLost)` protège contre les deltas négatifs lors d'un ICE restart
- **nodyx-turn — Quota allocation** — `MAX_LIFETIME` plafonné à 300s (Firefox demandait 3600s → quota saturé en ~25 reconnexions → vocal bloqué 1h)
- **Socket.IO — Transport polling-first** — `transports: ['polling', 'websocket']` — nodyx-relay strip le header `Upgrade`, le WebSocket seul en premier tentait indéfiniment → `online_count = 0` sur toutes les instances relay
- **Salons vocaux — Capacité portée à 25** — limite relevée + enforcement côté serveur + notification `voice:full` côté client

---

## [1.2.0] — 2026-03-07

### Added
- **Sondages (Polls)** — système complet dans le chat ET le forum
  - 3 types : choix unique, planning (schedule), classement (ranking)
  - Résultats en temps réel via Socket.IO, clôture par l'auteur ou un admin
  - Bouton 📊 dans l'input du chat, intégration à la création de sujet forum
  - Composants `PollCard.svelte` (affichage + vote) et `PollCreator.svelte`
  - Migrations 028 (tables polls/options/votes + `channel_messages.poll_id`) et 029 (`polls.thread_id`)
- **Messages Privés (DM)** — messagerie 1-to-1 temps réel
  - Route dédiée `/dm/:username`, inbox triée par dernier message
  - Socket.IO room `dm:<userId>` — livraison instantanée, badge de non-lus
- **Galaxy Bar — instances liées** — affichage des instances Nodyx fédérées dans la barre latérale gauche
  - Liste dynamique depuis le directory, indicateur d'état (en ligne / hors ligne)
  - Navigation rapide entre communautés
- **Forum — sélecteur catégorie/sous-catégorie** — formulaire de nouveau sujet avec dropdown hiérarchique, navigation URL persistée
- **uninstall.sh** — script de désinstallation complète interactif
  - Double confirmation avant toute suppression
  - Suppression sélective : PM2, Caddy, Redis, PostgreSQL, nodyx-turn, nodyx-relay, UFW
- **nodyx-update** — script `/usr/local/bin/nodyx-update` généré à l'install pour mettre à jour Nodyx en une commande

### Fixed
- **Installer — Redis sur Debian Trixie / Raspberry Pi** — service marqué "static" → `systemctl unmask` ajouté ; répertoires `/var/lib/redis` et `/var/log/redis` créés avant le démarrage (cause de crash "No such file or directory")
- **Installer — Spinners animés** — progression visible pendant `npm install` et `npm run build` (surtout utile sur ARM lent)
- **Installer — Détection crash PM2** — vérification `online` 5s après `pm2 start`, dump des logs si crash
- **Installer — Attente backend** — timeout porté à 180s avec spinner animé (était 60s silencieux)
- **Installer — Enregistrement admin** — 3 tentatives avec délai 8s, gestion des codes 409 (réinstall)
- **Installer — README** — `cd Nodyx` manquant dans la commande one-liner
- **SSR — URL API** — configurable via `PRIVATE_API_SSR_URL` pour les environnements non-standard
- **Polls — persistance** — `getMessages` n'incluait pas `poll_id` dans le SELECT → sondages perdus au refresh
- **Polls — messages vides** — contrainte `content NOT NULL` → insérer `''` pour les messages de type poll
- **Forum — bouton Annuler** — couleur et navigation corrigées (URL absolue avec paramètres de catégorie)
- **online_count** — comptait les heartbeats Redis (TTL 15min) au lieu de `io.fetchSockets()` → comptage exact

---

## [1.1.0] — 2026-03-06

### Added
- **Chat — Système de réponses/citations** — `reply_to_id` sur les messages, barre de prévisualisation dans l'input, citation inline avec bordure colorée dans le message
- **Chat — Messages épinglés** — un admin peut épingler un message par canal, bannière sticky dans le header du canal, masquable, désépinglage admin
- **Chat — Aperçus de liens (Open Graph)** — unfurl côté serveur avec cache Redis 1h, cartes de prévisualisation (titre, description, image, site_name) sous les messages
- **Chat — Badge de mention** — bulle rouge sur l'icône Chat dans la navigation quand un utilisateur est @mentionné (séparé de la cloche de notifications générale)
- **Chat — Barre d'actions messages** — réponse (↩️), édition (propres messages), épinglage (admin), suppression, copie
- **Présence — Statuts personnalisés** — emoji + texte libre, 8 presets (En réunion, Distrait, BRB…), persisté dans Redis 24h, visible dans la sidebar pour tous les membres
- **Présence — Statut dans le panel de profil** — bouton de statut rapide au-dessus des liens du dropdown, ouvre la modale de statut
- **Présence — Liste des membres hors ligne** — section collapsible "Hors ligne — N" en bas de la sidebar, avatars en niveaux de gris, opacité 50%
- **Auth — Mot de passe oublié** — flow complet (token email, TTL 1h, migration 025, emailService.ts)
- **Migration 025** — table `password_reset_tokens` (userId, token hash, expiration)
- **Migration 026** — `reply_to_id` sur `channel_messages` + `pinned_message_id` sur `channels`
- **Plugins** — dossier `plugins/` (retiré du .gitignore) avec README et 3 table-templates officiels (Brasserie de Nuit, Table de Feutre, Pierre & Braise)
- **Nouveaux composants** — `ChannelSidebar.svelte`, `EmojiPicker.svelte`, `VoiceRoom.svelte`
- **GET /api/v1/instance/members** — liste complète des membres pour la sidebar hors-ligne

### Fixed
- **Voice en mode Relay** — `TURN_PUBLIC_IP` vide = zéro ICE server → voix impossible en NAT strict. `voice.ts` lit désormais `STUN_FALLBACK_URLS` et `install.sh` injecte deux STUN Google publics en mode Relay
- **install.sh — Version** — enregistrement auprès du directory avec `"0.4.1"` → corrigé en `"1.0.0"`
- **install.sh — Description communauté** — jamais renseignée (créée vide en SQL), `NODYX_COMMUNITY_DESCRIPTION` absent du `.env` → prompt ajouté, variable injectée
- **install.sh — Pays** — `NODYX_COMMUNITY_COUNTRY` toujours vide → prompt ajouté

---

## [1.0.0] — 2026-03-05

### Added
- **Profile theme system** — complete per-user personalization engine
  - 6 built-in presets: Défaut 🌑, Minuit 🌌, Forêt 🌲, Chaleur 🔥, Rose 🌸, Verre 💎
  - CSS variable architecture: `--p-bg`, `--p-card-bg`, `--p-card-border`, `--p-accent`, `--p-text`, `--p-text-muted`
  - Live preview editor in `/users/me/edit` — preset grid + 5 individual hex color pickers
  - Migration 024 — `metadata JSONB DEFAULT '{}'` on `user_profiles`
  - Theme stored as `metadata.theme` via PostgreSQL JSONB merge operator (`||`)
- **App-wide theming** — user's profile theme propagates to the entire interface: top nav, Galaxy Bar sidebar, members sidebar, bottom nav, page background — every logged-in user skins the app with their own preset
- **Mobile-responsive UI overhaul** — full mobile-first layout
  - Chat page: sliding channel drawer (hamburger button), VoicePanel always accessible on mobile
  - Forum pages: responsive category icon, title, and dropdown sizing
  - Admin settings: responsive two-column form layout
  - Bottom navigation bar (`lg:hidden`) with `--bottom-nav-h` CSS variable for safe content padding
- **Community favicon** — dynamic `<link rel="icon">` injected from the community logo in `<svelte:head>`
- **Asset library — 12 MB upload limit** (up from 5 MB)
  - `@fastify/multipart` limit updated to 12 MB
  - Migration 023 — DB constraint updated (`CHECK (file_size <= 12582912)`)
  - Per-type upload tooltips with design guidelines, recommended dimensions, format advice
- **Profile badges** — displayed at 56 × 56 px (doubled from 28 × 28 px)

### Fixed
- Profile `metadata` column was missing from `SELECT` in `GET /users/:username/profile` — theme was saved to DB but never returned to frontend
- Chat page channel sidebar visual gap on desktop — `fixed top-14` base class leaked through `lg:relative` override; restructured using `max-lg:` Tailwind prefix for mobile-only fixed positioning
- `@fastify/multipart` file size limit (5 MB) was independent of the DB constraint — both now consistently at 12 MB

---

## [0.9.0] — 2026-03-04

### Added
- **NodyxCanvas** — tableau blanc collaboratif P2P dans les salons vocaux
  - CRDT LWW (Last-Write-Wins) par élément — convergence garantie sans conflit
  - Curseurs distants en temps réel (throttle 50ms, fade 4s, halo vocal si `speaking: true`)
  - Outils : stylo, post-it, rect, cercle, effaceur, colorpicker, undo local, clear all
  - Grille de fond CSS `radial-gradient` dark (dots)
  - Export PNG + envoi du récap dans le canal texte au choix
  - Protocole `canvas:op` via DataChannels P2P
- **Jukebox collaboratif** — lecteur audio synchronisé dans les salons vocaux
  - Web Audio API — play/pause/next en sync P2P
  - Queue collaborative, historique de session
  - Volume individuel (GainNode + localStorage, jamais broadcasté)
  - Autoplay unblock automatique (gestion politique navigateur)
  - VoiceToolbar : boutons Jukebox / Canvas / Screenshare + controls row compact
- **nodyx-turn** — STUN/TURN Rust natif remplace coturn (Phase 3.0-C ✅)
  - Binaire 2.9MB statique (tokio + RFC 5389/5766)
  - Credentials dynamiques HMAC-SHA1 time-based (coturn `use-auth-secret` compatible)
  - MESSAGE-INTEGRITY vérification, ChannelBind / ChannelData
  - Rate limiter UDP par IP (30 pkt/sec) + quotas allocations (10/IP, 1000 total)
  - Migration : nodyx-core génère les creds par utilisateur → `voice:init` Socket.IO
  - `install.sh` intégré, service systemd, GitHub Release `v0.1.2-p2p` (amd64 + arm64)
- **P2P asset transfer** — transfert de fichiers entre pairs via DataChannels
  - Protocole `p2p:asset:*` (chunks 32 Ko, indicateur de progression)
  - Store `p2pAssetPeers`, bouton ⚡ jaune dans la sidebar
- **Partage d'écran** — améliorations
  - Bouton screen share restauré dans la barre de controls + sidebar
  - Flux vidéo distants affichés dans le salon vocal

### Fixed
- P2P DataChannel restait actif à la navigation (déconnexion propre ajoutée)
- Admin branding file upload — mauvaise URL + token null
- Seed forum : ordre des posts + images de badges externes remplacées
- Homepage : vraies images d'avatars sur les articles + derniers posts

---

## [0.8.0] — 2026-03-02

### Added
- **Phase 3.0-B — Browser P2P DataChannels** ✅ POC validé
  - `nodyx-frontend/src/lib/p2p.ts` — gestionnaire RTCPeerConnection + DataChannel
  - Signaling via Socket.IO existant (events `p2p:offer`, `p2p:answer`, `p2p:ice`)
  - Handshake polite/impolite — un seul initiateur, pas de collision
  - Indicateur UI `⚡ P2P · N` dans l'en-tête du canal texte (jaune si actif, gris pulsant si en cours)
  - Fallback gracieux WebRTC (timeout ICE 12s, toast discret)
- **Indicateurs de frappe P2P instantanés** — ~1–5ms via DataChannel (dots animés style Discord)
- **Réactions optimistes** — animation spring physics, arrive avant confirmation serveur
- **Transfert d'assets P2P** — premier prototype (chunks 32 Ko)

### Fixed
- Fallback ICE : flag `_hadAttempt`/`_hadSuccess` pour éviter double toast
- Plusieurs connexions pairs simultanées (Map de RTCPeerConnections)

---

## [0.7.0] — 2026-03-01

### Added
- **Bibliothèque d'assets communautaire**
  - Upload multipart avec compression Sharp → WebP + thumbnail auto
  - Catégories : cadres, bannières, badges, stickers, avatars, fonds
  - Recherche full-text FR, filtres, tri popularité
  - Limite 5 MB (augmentée à 12 MB en v1.0.0)
  - Routes `POST/GET/DELETE /api/v1/assets` + `/api/v1/assets/user/:id`
  - Page `/library` — galerie avec filtres + upload
  - Page `/library/[id]` — détail, like, équipement, bouton Chuchoter
  - Profil utilisateur — affichage des assets équipés (frame, banner, badge, wallpaper)
  - Page `/users/me/edit` — gestion des slots d'assets
  - Admin — pages gestion assets + jardin
- **Jardin de fonctionnalités** (Garden)
  - `feature_seeds` — propositions de fonctionnalités votables
  - `seed_waters` — vote unique par utilisateur (409 si double vote)
  - Page `/garden` — propositions, barre de progression, arrosage one-shot, toast "déjà voté"
  - Routes `POST/GET /api/v1/garden/seeds` + `POST /api/v1/garden/seeds/:id/water`
- **Fédération d'assets** — snapshot des assets vers le directory nexusnode.app
  - Migration 021 — `directory_assets`
  - Route `POST /api/directory/assets` + `GET /api/directory/assets/search`
  - Onglet "🌐 Toutes les instances" dans `/library`
  - Scheduler : push assets toutes les heures
- **Chuchotements (Whispers)** — salons de chat éphémères
  - Migration 022 — `whisper_rooms` + `whisper_messages`
  - Socket.IO events `whisper:*` (join, leave, message, typing, history, expired)
  - Page `/whisper/[id]` — salon temps réel style iMessage, TTL affiché
  - Bouton "🤫 Chuchoter" sur les pages asset
  - Scheduler : nettoyage des whispers expirés toutes les 10 minutes
- **`linkify.ts`** — URLs cliquables dans le chat et les whispers (sans XSS)
- **Migrations 017–022** (name_color, community_assets, feature_seeds, profile_assets, directory_assets, whisper_rooms)
- **Slug `fix`** — `GIF` préservés sans conversion WebP (animation conservée)

### Fixed
- `@fastify/multipart` : fichier doit être en dernier dans FormData (champs collectés avant le fichier)

---

## [0.5.0] — 2026-03-01

### Added
- **nodyx-relay** — Rust P2P relay infrastructure (Phase 3.0-A ✅)
  - `nodyx-relay server` — deployed on VPS: TCP:7443 (relay clients) + HTTP:7001 (Caddy proxy), tokio async, DashMap in-memory registry
  - `nodyx-relay client` — 9MB static binary, outbound TCP connection only — **zero open ports, zero domain required**
  - Automatic `slug.nexusnode.app` provisioning — slug reserved in DB at registration, DNS wildcard served by relay proxy
  - Exponential backoff reconnection (1s → 2s → 4s → max 30s)
  - `install.sh` — option 2 "Nodyx Relay (recommended)" → auto-downloads binary, generates systemd service, full URL without touching a router
  - `nodyx-relay-client.service` — systemd unit, auto-restart, enabled on boot
  - GitHub Releases `v0.1.0-relay` + `v0.1.1-relay` — amd64 + arm64 static binaries
  - **Validated:** Raspberry Pi 4, zero open ports, zero Cloudflare account → `https://test.nexusnode.app` live ✅
- **Voice channel member interaction panel**
  - Click any member in the voice channel sidebar → opens their real-time stats in VoicePanel (RTT, jitter, packet loss, volume slider)
  - Click yourself ("vous") → green self-monitoring panel: live audio level meter, muted / deafened / PTT status badges
  - Interaction buttons per peer: Profile link, Direct Message (functional), File sharing + Mini-game (coming soon)
  - `voicePanel.ts` — shared Svelte writable store for cross-component panel targeting (discriminated union: `{ type: 'peer', socketId } | { type: 'self', username, avatar } | null`)
- **VoicePanel sidebar** — redesigned as a fixed-position left sidebar (Galaxy Bar layout)
  - Participant list with clickable member rows, animated connection indicator, member count badge
  - VoiceSettings popup — fixed-position (`bottom-24 left-1/2`), 360px wide, escapes sidebar overflow with backdrop blur overlay

### Fixed
- **nodyx-relay concurrent requests** — relay client was processing requests sequentially. With Socket.IO long-polling (pingInterval 8s), one user's blocking GET delayed all others → relay server 10s timeout → 504 Gateway Timeout → Socket.IO disconnect → presence sidebar empty. Fixed by spawning a tokio task per request; writes are serialized via `mpsc`. Timeout ladder: `pingInterval(8s) < reqwest(12s) < relay-server(15s)`
- **online_count off-by-default** — `/info` and `/admin/stats` counted `redis.keys('nodyx:heartbeat:*')` (set on API calls, 15 min TTL). Active Socket.IO session ≠ recent API call → count dropped to 0 after 15 min of browse-only activity. Fixed: `io.in('presence').fetchSockets()` — Socket.IO presence room as the source of truth, deduplicated by `userId`

### Infrastructure
- `relay.nexusnode.app` — DNS A record (grey cloud, no Cloudflare proxy) for direct TCP:7443 relay client connections
- UFW: port 7443/tcp opened on the VPS for relay client inbound connections
- `nodyx-relay.service` — systemd unit active on VPS, ~1.3MB RAM, Restart=on-failure
- Caddy: `*.nexusnode.app` now routes to `localhost:7001` (nodyx-relay HTTP proxy) instead of `localhost:3000` — relay handles routing (tunnel → active relay, 302 → DB URL, 404 → unknown)

---

## [0.4.0] — 2026-02-28

### Added
- **Production deployment** — full stack live on [nexusnode.app](https://nexusnode.app) (Hetzner CPX42, Ubuntu 24.04, PM2, Caddy, Cloudflare)
- **Directory API** — instance registry with automatic Cloudflare DNS subdomain provisioning
  - `GET /api/directory` — list active instances
  - `POST /api/directory/register` — register an instance, triggers URL check + DNS creation
  - `POST /api/directory/ping` — heartbeat to update member/online counts and `last_seen`
  - `DELETE /api/directory/:slug` — unregister and remove DNS record
- **Migration 014** — `directory_instances` table (slug, token, subdomain, cloudflare_record_id, last_seen…)
- **Scheduler** (`scheduler.ts`) — auto-pings the directory every 5 minutes with live member/online counts from DB + Socket.IO
- **Communities page** — replaced mock data with live `/api/directory` API data

### Infrastructure
- Caddy reverse proxy with Cloudflare Origin Certificate (Full Strict SSL)
- `*.nexusnode.app` wildcard block — all registered subdomains routed to the same stack
- `code.nexusnode.app` — code-server (VS Code in browser) for remote development
- Claude Code CLI installed on VPS for remote AI-assisted development

### Fixed
- Directory DNS creation: replaced `dnsLookup` (returned Cloudflare proxy IP) with `VPS_IP` env var

---


## [0.4.1] — 2026-03-01

### Added
- **`install.sh`** — one-click node installer for Ubuntu 22.04/24.04 and Debian 11/12
  - Detects the server's public IP automatically (used for TURN relay config)
  - Installs and configures: Node.js 20, PostgreSQL, Redis, coturn, Caddy, PM2
  - Grants PostgreSQL 15+ `CREATE ON SCHEMA public` (migration fix for fresh installs)
  - Configures UFW firewall (SSH, HTTP, HTTPS, TURN ports, WebRTC relay range)
  - Generates secure random secrets (DB password, JWT secret, TURN credential)
  - Bootstraps the instance community and creates the admin account automatically
  - Saves all credentials to `/root/nodyx-credentials.txt` (chmod 600)
  - TURN URL uses server IP directly — bypasses Cloudflare proxy automatically
- **`docs/en/INSTALL.md`** — comprehensive English installation guide
  - Hardware requirements, OS compatibility table
  - VPS recommendations (Hetzner, DigitalOcean, Vultr, OVH)
  - Windows WSL2 step-by-step guide
  - Home server / NAT / CGNAT section with port forwarding table
  - VPN and WireGuard considerations (Phase 3 preview)
  - Common errors & fixes (port conflicts, DNS, TURN, SSL, uploads)
  - Post-install guide and admin tips
- **`docs/fr/INSTALL.md`** — guide d'installation complet en français (même contenu)
- **`nodyx-core/src/migrations/015_admin_role.sql`** — fixes `community_members_role` constraint to include `'admin'` role (was missing from migration 001, causing DB errors when promoting users to admin)
- **GitHub CLI (`gh`)** — installed on the VPS for release management

### Fixed
- **DB constraint `community_members_role`** — migration 001 only allowed `('owner', 'moderator', 'member')`; the admin middleware and routes already referenced `'admin'`, causing a silent mismatch. Migration 015 aligns the constraint with the codebase.

### Changed
- **TURN relay** — removed hardcoded home server (`pokled.ddns.net`). TURN is now configured entirely via `.env` variables (`PUBLIC_TURN_URL`, `PUBLIC_TURN_USERNAME`, `PUBLIC_TURN_CREDENTIAL`), set automatically by `install.sh` using the detected public IP.
- **File uploads** — Caddy now routes `/uploads/*` to port 3000 (was missing, causing 404 on uploaded avatars/banners)
- **Instance directory** — backend scheduler pings directory every 5 minutes with live member/online stats

---

## [0.3.3] — 2026-02-28

### Fixed
- **Forum:** erreur 500 sur toutes les pages catégories — la requête SQL `GET /forums/threads` référençait `c.slug` (colonne inexistante sur la table `categories`)
- **TipTap:** warning "Duplicate extension names: link, underline" — StarterKit v3 inclut désormais ces extensions par défaut ; désactivées dans StarterKit, conservées avec leur config personnalisée

### Build
- `tsconfig.json` : exclut `src/tests/` du build de production — `npm run build` propre sans erreurs de test
- `tsconfig.test.json` : nouveau fichier dédié à vitest (`noEmit: true`, inclut les tests)

### Docs
- Documentation EN/FR complète — README, ARCHITECTURE, ROADMAP, MANIFESTO, CONTRIBUTING traduits intégralement
- `docs/en/specs/` : 8 specs traduites (002 à 013)
- `docs/fr/` : AUDIO et NEURAL-ENGINE ajoutés
- Tous les liens internes `docs/` corrigés
- README racine : diagramme réseau P2P, notice alpha, badge version mis à jour

---

## [0.3.2] — 2026-02-28

### Fixed
- **WebRTC TURN relay fully operational** — relay candidates now correctly advertise the public IP
  - `turn-server/server.js`: `externalIp` → `externalIps` (node-turn reads the plural form — one character, weeks of debugging)
  - `turn-server/server.js`: `relayIps: ['0.0.0.0']` → `['192.168.1.100']` — relay socket now binds to the actual LAN interface instead of wildcard (was causing `xor-relayed-address: 0.0.0.0` in ALLOCATE responses)
  - `turn-server/server.js`: added `credentials` config so node-turn can validate `MESSAGE-INTEGRITY` from browsers
  - PM2 process now started with explicit `--cwd` — `dotenv` was silently failing to find `.env` causing 40+ crash-restart cycles
  - Bbox port forwarding rule fixed: relay port range `49152–55440` was mapped to internal port `48000` instead of `49152`

- **WebRTC ICE reconnection loop** — `_scheduleRejoin` was destroying all peer connections when a single peer failed
  - Added `_dropPeer()`, `_hasOtherConnectedPeer()`, `_handlePeerFailure()` — only triggers full rejoin if no other connected peer exists
  - Per-peer ICE restart (2 attempts before escalating to rejoin)

- **Double-peer appearance on reconnect** — race condition where `voice:peer_joined` arrived before `voice:peer_left` for the same `userId`
  - `onPeerJoined` now detects stale peers by `userId` and calls `_dropPeer` before adding the new socket

### Changed
- **ICE config cleanup** — removed broken TCP/TLS TURN URL variants (`?transport=tcp`, port 443, `turns:`) injected via `configureICE` — these were timing out and delaying ICE gathering
- `iceCandidatePoolSize: 2` added to pre-gather relay candidates before ICE checking starts
- Added `[ICE gather]` + `[ICE config]` console debug logging for future diagnostics

### Security
- Removed two user logo uploads (`uploads/logos/`) that were accidentally tracked in git

---

## [0.3.1] — 2026-02-27

### Fixed
- **Screen sharing in voice channels** — the feature existed but did nothing (video was only shown locally, never sent to peers)
  - `voice.ts`: `startScreenShare()` now adds the video track to all active `RTCPeerConnection`s and triggers renegotiation (`createOffer` → `voice:offer`) for each peer
  - `voice.ts`: `stopScreenShare()` removes video senders and renegotiates to signal end of share
  - `voice.ts`: `ontrack` handler now splits audio/video — video tracks go to `remoteScreenStore`
  - `MediaCenter.svelte`: rewritten to use `startScreenShare`/`stopScreenShare` from `voice.ts`
  - Remote screens visible inside MediaCenter panel (with username + live badge)
  - Clip recording (rolling 60s) now connected to the actual shared stream

---

## [0.3.0] — 2026-02-27

### Added
- **`docker-compose.yml`** — full stack in one command: PostgreSQL 16 + Redis 7 + API + Frontend
  - PostgreSQL healthcheck ensures API waits for DB before starting
  - Volumes for persistent data (`postgres_data`, `redis_data`) and uploads bind-mount
- **`.env.example`** (root) — `DB_PASSWORD` for docker-compose
- **`nodyx-core/src/scripts/migrate.ts`** — idempotent SQL migration runner
  - Creates `schema_migrations` tracking table on first run
  - Skips already-applied migrations — safe to call on every boot
- **`nodyx-frontend/Dockerfile`** — multi-stage Node.js build (builder → runner, PORT=3001)

### Changed
- **`nodyx-core/src/index.ts`** — `runMigrations()` called before `server.listen()`
- **`nodyx-core/Dockerfile`** — `src/migrations/` copied into runner image; `uploads/` subdirs created

---

## [0.2.0] — 2026-02-27

### Added
- **Test suite** (nodyx-core): 34 Vitest tests covering auth routes, middleware, and forum routes
  - `auth.test.ts` — 13 tests: register/login/logout with mocked DB + Redis
  - `middleware.test.ts` — 10 tests: `requireAuth`, `optionalAuth`, `rateLimit`
  - `forums.test.ts` — 11 tests: GET /threads, POST /threads, POST /posts
- **GitHub Actions CI** — automated test run on every push/PR to `main`
- **Docs restructuring** — all `.MD` files reorganized into `docs/{en,fr,es,it,de}/`
- **Multilingual documentation stubs** — `docs/es/`, `docs/it/`, `docs/de/` ready for future translations
- **Technical specs** moved to `docs/specs/` (8 specs: profiles, grades, social widgets, audio, search, calendar, galaxy bar, node)
- **Root `README.md`** in English with stack table, project status, and multilingual links
- **`Caddyfile.example`** — generic Caddy reverse proxy config
- **`ecosystem.config.example.js`** — PM2 config with relative paths
- **`turn-server/.env.example`** — template env vars for TURN server

### Security
- Removed sensitive files from git tracking: hardcoded IP addresses, absolute paths, user upload assets
- Sanitized `turn-server/server.js`: replaced hardcoded IP (`87.88.104.61`) and domain with env vars (`TURN_EXTERNAL_IP`, `TURN_REALM`)
- Updated `.gitignore` to exclude `uploads/avatars/*`, `uploads/banners/*`, `uploads/logos/*`, `.claude/`, `.nodyx-context/`
- Added `.gitkeep` files to preserve `uploads/` directory structure

### Removed
- Dead files: `VoicePanel_old.svelte`, `svelte.config_old.js`, boilerplate SvelteKit README
- Redundant docs scattered across `nodyx-core/` root (moved to `docs/`)

---

## [0.1.0] — 2026-02-20

### Added
- **Forum** — categories, threads, posts, reactions, thanks, tags, pin/lock/feature
- **Real-time chat** — channels, WebSocket (send/edit/delete/react/typing), @mentions, notifications
- **Voice channels** — WebRTC P2P mesh, TURN fallback, VAD, network stats (RTT/jitter/loss)
- **Screen sharing + clip recording** — `MediaCenter.svelte` (60s clips, snapshots)
- **User profiles** — avatar/banner upload, GitHub widget, bio, points
- **Communities + roles + permissions** — granular permission system with grades
- **Admin panel** — stats, moderation, branding (logo/banner), category/channel management
- **PostgreSQL full-text search** — instant search across threads and posts
- **Notifications** — reply, mention, thanks events
- **JWT auth** — sessions stored in Redis, 7-day TTL, logout blacklisting
- **Rate limiting** — sliding window via Redis, per-IP with `X-RateLimit-*` headers
- **AI assistant** — local Ollama integration (no cloud dependency)
- **13 SQL migrations** — complete schema from users to voice channels

[Unreleased]: https://github.com/Pokled/Nodyx/compare/v1.8.1...HEAD
[1.8.1]: https://github.com/Pokled/Nodyx/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/Pokled/Nodyx/compare/v1.7.0...v1.8.0
[1.7.0]: https://github.com/Pokled/Nodyx/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/Pokled/Nodyx/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/Pokled/Nodyx/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/Pokled/Nodyx/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/Pokled/Nodyx/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/Pokled/Nodyx/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/Pokled/Nodyx/compare/v1.0.0...v1.1.0
[0.9.0]: https://github.com/Pokled/Nodyx/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/Pokled/Nodyx/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/Pokled/Nodyx/compare/v0.5.0...v0.7.0
[0.5.0]: https://github.com/Pokled/Nodyx/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/Pokled/Nodyx/compare/v0.3.3...v0.4.1
[0.3.3]: https://github.com/Pokled/Nodyx/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/Pokled/Nodyx/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/Pokled/Nodyx/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/Pokled/Nodyx/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/Pokled/Nodyx/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/Pokled/Nodyx/releases/tag/v0.1.0
