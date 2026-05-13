# Nodyx Streamer Hub

**Statut** : v2.3 — Phase 0 ✅ + Phase 1 ✅ livrée, Phase 2 prête à démarrer
**Numéro de spec** : 015
**Version** : 2.3 (2026-05-08)
**Auteur** : Pokled + Claude
**Phase cible** : v2.5 (Phase 1) → v2.7 (Phase 5 complète)

---

## 1. Vision & principes

Un streamer aujourd'hui paye, jongle ou subit une dizaine d'outils :

| Besoin | Service classique |
|---|---|
| Alertes en stream | Streamlabs / StreamElements |
| Stream Deck | Elgato (matériel, ~150€) ou Touch Portal (logiciel) |
| Statistiques | StreamElements / TwitchTracker |
| Chat unifié | Streamer.bot / Botisimo |
| Communauté hors stream | Discord (gratuit mais GAFAM, modération limitée) |
| Polls / sondages animés | StreamElements / Beeyou |
| Top clips à l'écran | Streamer.bot scripts maison |
| Extension Twitch perso | Codée à la main (3-4 jours pour un dev) |

Aucun de ces outils n'est pensé comme un environnement complet. Ils s'empilent, leurs intégrations cassent à chaque update Twitch, et le streamer paye plusieurs abonnements pour avoir un service correct.

**Nodyx Streamer Hub** est un module qui transforme une instance Nodyx en environnement complet pour un streamer : alertes live, chat unifié Twitch ↔ Nodyx, Stream Deck web, statistiques natives, gestion de polls, top clips à l'écran, et un générateur d'extension Twitch qui pointe vers l'instance. Le tout libre, auto-hébergé, et intégré au reste de Nodyx (forum, vocal, canvas) qui devient l'espace de communauté du streamer.

### Principes

- **Souveraineté du streamer sur son audience.** Les viewers vivent chez le streamer, pas dans un silo tiers. Le streamer peut quitter Twitch un jour, sa communauté reste avec lui sur son instance.
- **Pas anti-Twitch, pas anti-GAFAM dogmatique.** Twitch concentre l'audience, on s'y interface. Mais l'architecture est en *providers* : Twitch est le premier, Owncast / PeerTube / YouTube Live / Kick peuvent être ajoutés sans réécrire le moteur. Une instance Nodyx n'est jamais piégée dans un seul écosystème de stream.
- **Réutilisation maximale de l'existant.** Le chat est le chat Nodyx existant. Les threads sont les threads Nodyx existants. Les polls sont les polls Nodyx existants. Le Streamer Hub orchestre, il ne réinvente pas.
- **Une instance = un streamer principal.** Cohérent avec "une instance = une communauté". Les mods peuvent voir/configurer, mais il y a un seul streamer "owner" du hub.
- **Pas de SaaS cloud.** Chaque instance est autonome. Aucun "Streamer Hub Pro" hosté par nodyx.org. Le streamer paye son VPS, point.
- **Tokens chiffrés au repos.** AES-256-GCM avec clé par instance (`STREAMER_OAUTH_KEY` env var). Si la DB fuite, les tokens ne sont pas exploitables sans accès au filesystem.

### Tradeoff principal accepté

Twitch peut deprecate des endpoints / events sans grand préavis. On accepte une dette de maintenance liée à l'API Twitch (versionnée, on suit l'évolution). C'est la rançon d'avoir une vraie intégration plutôt qu'un scraping fragile.

### Non-vision (ce que le module ne fait PAS)

- **Pas de bot Discord.** Le streamer migre sa communauté **vers** Nodyx, pas l'inverse.
- **Pas de relai vers un service hébergé par nodyx.org.** Tout tourne sur l'instance du streamer.
- **Pas un fork de Streamlabs.** Le code est natif Nodyx, pas une couche compat.
- **Pas de plateforme de streaming.** Nodyx ne stream pas, il s'interface.

---

## 2. Architecture & composants

### 2.1 Module Nodyx activable

Le Streamer Hub s'inscrit dans le système de modules de Nodyx (cf [`docs/specs/MODULE_SYSTEM`](../MODULE_SYSTEM.md) / `.claude/ideas/MODULE_SYSTEM.md`). L'admin de l'instance l'active depuis `/admin/modules`. Une fois actif :
- L'onglet **Streamer Hub** apparaît dans la sidebar admin
- Le menu utilisateur expose une option "Connecter mon compte Twitch" (pour les viewers)
- L'extension Twitch peut être générée depuis `/admin/streamer-hub/extension`

### 2.2 Couche Provider

```
┌─────────────────────────────────────────────────────────┐
│                  Streamer Hub (core)                    │
│  Routes admin, persistence, UI, command dispatcher      │
└─────────────────────────┬───────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │   Provider interface  │
              └───────────┬───────────┘
                          │
        ┌─────────────────┼─────────────────┐
        ▼                 ▼                 ▼
   ┌──────────┐     ┌──────────┐     ┌──────────┐
   │  Twitch  │     │  Owncast │     │ PeerTube │
   │ Phase 1  │     │  futur   │     │  futur   │
   └──────────┘     └──────────┘     └──────────┘
```

L'interface `StreamerProvider` expose :

```typescript
interface StreamerProvider {
  id:    'twitch' | 'owncast' | 'peertube' | 'youtube' | 'kick'
  label: string

  // OAuth flow (streamer)
  getAuthUrl(redirectUri: string, state: string): string
  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>
  refreshTokens(refreshToken: string): Promise<OAuthTokens>

  // EventSub / webhooks / polling
  subscribeEvents(token: string, callbackUrl: string): Promise<void>
  unsubscribeEvents(token: string): Promise<void>
  verifyWebhookSignature(req: IncomingRequest): boolean
  parseWebhookEvent(req: IncomingRequest): StreamerEvent | null

  // Chat bridge
  connectChat(token: string, channel: string, onMessage: ChatHandler): ChatConnection
  sendChatMessage(connection: ChatConnection, text: string): Promise<void>

  // Stream metadata
  getStreamInfo(token: string, channel: string): Promise<StreamInfo | null>
  getTopClips(channel: string, count: number): Promise<Clip[]>
}
```

Phase 1 implémente uniquement `TwitchProvider`. Les phases ultérieures peuvent ajouter Owncast / PeerTube / YouTube Live / Kick sans toucher au reste.

### 2.3 Composants concrets (Phase 1)

**Backend (`nodyx-core`)**

- `src/services/streamer/streamerHubService.ts` : orchestration, persistence, dispatch
- `src/services/streamer/providers/twitchProvider.ts` : provider Twitch
- `src/services/streamer/providers/_types.ts` : interface commune
- `src/routes/streamer.ts` : endpoints admin + viewer + webhook EventSub
- `src/services/streamer/chatBridge.ts` : bridge Twitch IRC ↔ Nodyx chat
- `src/services/streamer/obsClient.ts` : connexion OBS WebSocket v5

**Frontend (`nodyx-frontend`)**

- `src/routes/admin/streamer-hub/+page.svelte` : tableau de bord
- `src/routes/admin/streamer-hub/connect/+page.svelte` : flow OAuth Twitch
- `src/routes/admin/streamer-hub/obs/+page.svelte` : Stream Deck web
- `src/routes/admin/streamer-hub/stats/+page.svelte` : stats live + recap
- `src/routes/admin/streamer-hub/extension/+page.svelte` : générateur d'extension
- `src/routes/auth/connect-twitch/+page.svelte` : flow OAuth viewer
- `src/lib/streamer/twitchAlert.ts` : gestion des alertes côté UI

---

## 3. Database schema (migration 078)

```sql
-- ─── Tokens OAuth chiffrés (provider × streamer) ─────────────────────────
-- Chiffrement : AES-256-GCM avec clé dérivée HKDF(master_key_v{key_version}, enc_salt).
-- Voir §12.1. Une fuite de la DB sans la master key ne suffit pas.
CREATE TABLE streamer_oauth_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          TEXT NOT NULL CHECK (provider IN ('twitch', 'owncast', 'peertube', 'youtube', 'kick')),
  user_id           UUID REFERENCES users(id) ON DELETE CASCADE,
  external_id       TEXT NOT NULL,                          -- Twitch user_id, etc.
  external_login    TEXT NOT NULL,                          -- Twitch login, etc.
  access_token_enc  BYTEA NOT NULL,                         -- AES-256-GCM ciphertext
  refresh_token_enc BYTEA NOT NULL,
  enc_salt          BYTEA NOT NULL,                         -- 16 octets, sel HKDF par row
  enc_iv            BYTEA NOT NULL,                         -- 12 octets, IV unique par chiffrement
  enc_tag           BYTEA NOT NULL,                         -- 16 octets, tag GCM
  key_version       INTEGER NOT NULL DEFAULT 1,             -- version master_key utilisée (rotation mensuelle)
  scopes            TEXT[] NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  is_streamer       BOOLEAN NOT NULL DEFAULT FALSE,         -- TRUE pour le streamer principal, FALSE pour les viewers
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rotated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),     -- dernière rotation forcée du token Twitch (§12.3)
  UNIQUE (provider, external_id)
);

CREATE INDEX idx_streamer_oauth_user     ON streamer_oauth_tokens(user_id);
CREATE INDEX idx_streamer_oauth_streamer ON streamer_oauth_tokens(provider, is_streamer) WHERE is_streamer = TRUE;

-- ─── Events temps-réel (follow, sub, raid, bits, etc) ────────────────────
CREATE TABLE streamer_events (
  id           BIGSERIAL PRIMARY KEY,
  provider     TEXT NOT NULL,
  event_type   TEXT NOT NULL,                              -- 'follow', 'subscribe', 'subscription.gift', 'cheer', 'raid', 'poll.begin', 'poll.end', 'stream.online', 'stream.offline'
  external_id  TEXT,                                       -- ID Twitch / Owncast / etc.
  payload      JSONB NOT NULL,                             -- payload complet du provider
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL, -- viewer Nodyx si lié
  occurred_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ                                 -- NULL si pas encore dispatch
);

CREATE INDEX idx_streamer_events_occurred ON streamer_events(occurred_at DESC);
CREATE INDEX idx_streamer_events_type     ON streamer_events(event_type, occurred_at DESC);

-- ─── Lien viewer Twitch ↔ user Nodyx ────────────────────────────────────
-- (utilisateur déjà inscrit qui lie son compte Twitch en plus)
ALTER TABLE users ADD COLUMN twitch_id    TEXT UNIQUE;
ALTER TABLE users ADD COLUMN twitch_login TEXT;

CREATE INDEX idx_users_twitch ON users(twitch_id) WHERE twitch_id IS NOT NULL;

-- ─── Streams (un par session de stream) ──────────────────────────────────
CREATE TABLE streamer_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider      TEXT NOT NULL,
  external_id   TEXT NOT NULL,                             -- Twitch stream_id
  thread_id     UUID REFERENCES threads(id) ON DELETE SET NULL,  -- thread auto pour le récap
  started_at    TIMESTAMPTZ NOT NULL,
  ended_at      TIMESTAMPTZ,
  peak_viewers  INTEGER DEFAULT 0,
  total_followers_gained INTEGER DEFAULT 0,
  total_subs_gained      INTEGER DEFAULT 0,
  total_bits             INTEGER DEFAULT 0,
  total_raids_in         INTEGER DEFAULT 0,
  category      TEXT,
  title         TEXT
);

CREATE INDEX idx_streamer_sessions_started ON streamer_sessions(started_at DESC);

-- ─── OBS WebSocket configuration (un par instance) ───────────────────────
CREATE TABLE streamer_obs_config (
  id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),  -- singleton
  enabled         BOOLEAN NOT NULL DEFAULT FALSE,
  ws_url          TEXT,                                          -- ex: ws://localhost:4455
  password_enc    BYTEA,                                         -- AES-256-GCM (mêmes colonnes salt/iv/tag/version qu'au-dessus)
  password_salt   BYTEA,
  password_iv     BYTEA,
  password_tag    BYTEA,
  password_kver   INTEGER DEFAULT 1,
  scenes_layout   JSONB NOT NULL DEFAULT '[]',                   -- layout du Stream Deck web
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO streamer_obs_config (id) VALUES (1) ON CONFLICT DO NOTHING;

-- ─── Souscriptions EventSub (1 par streamer × event_type) ────────────────
-- Stocke le secret HMAC partagé avec Twitch + le nonce d'URL (§12.2).
CREATE TABLE streamer_eventsub_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        TEXT NOT NULL,
  external_sub_id TEXT NOT NULL,                              -- ID de la souscription côté Twitch
  event_type      TEXT NOT NULL,                              -- 'channel.follow', 'stream.online', etc.
  callback_nonce  TEXT NOT NULL,                              -- 32 octets aléatoires, base64url, dans l'URL callback
  hmac_secret_enc BYTEA NOT NULL,                             -- secret HMAC partagé, AES-256-GCM
  hmac_salt       BYTEA NOT NULL,
  hmac_iv         BYTEA NOT NULL,
  hmac_tag        BYTEA NOT NULL,
  hmac_kver       INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'enabled',            -- 'enabled', 'revoked', 'failed'
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, callback_nonce),
  UNIQUE (provider, event_type)
);

CREATE INDEX idx_streamer_eventsub_nonce ON streamer_eventsub_subscriptions(callback_nonce);

-- ─── Audit log (étend le pattern de backup_audit_log) ────────────────────
CREATE TABLE streamer_audit_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  action       TEXT NOT NULL,                              -- 'connect_twitch', 'disconnect', 'config_obs', 'generate_extension'
  ip_address   INET,
  metadata     JSONB,
  status       TEXT NOT NULL CHECK (status IN ('success', 'failed')),
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_streamer_audit_created ON streamer_audit_log(created_at DESC);
```

---

## 4. OAuth Twitch — flow streamer

### 4.1 Scopes minimaux requis

Liste mise à jour après le spike Phase 0 (cf [PHASE_0_REPORT.md](PHASE_0_REPORT.md)).

| Scope | Pourquoi | Phase |
|---|---|---|
| `user:read:email` | Identifier le streamer | 1 |
| `user:read:chat` | EventSub Chat (lire le chat) | 2 |
| `user:write:chat` | Helix Send Chat Message (écrire dans le chat) | 2 |
| `channel:read:subscriptions` | Détecter les subs | 1 |
| `bits:read` | Détecter les bits | 1 |
| `moderator:read:followers` | Détecter les follows (préfixe `moderator` côté EventSub) | 1 |
| `channel:read:polls` | Recap polls | 4 |
| `channel:manage:polls` | Optionnel : créer un poll Twitch depuis Nodyx | 4 |
| `clips:edit` | Création de clips depuis Nodyx (`!clip`, auto-clip) | 5 |

Notes spike :
- **Scope `clips:read` retiré** : il **n'existe pas** côté Twitch (`invalid scope requested`). Pour *lire* les top clips (Helix `GET /clips`), un App Access Token suffit, aucun scope user requis. `clips:edit` ne sert que pour *créer* un clip et arrive en Phase 5.
- **`chat:read` / `chat:edit` retirés** : ce sont les anciens scopes IRC. La spec utilise EventSub Chat (`user:read:chat` / `user:write:chat`), aligné §6.1.

### 4.2 Flow

1. Admin clique **Connecter Twitch** sur `/admin/streamer-hub`
2. Frontend → `GET /api/v1/streamer/twitch/auth` → renvoie l'URL Twitch OAuth
3. Redirect vers `https://id.twitch.tv/oauth2/authorize?...`
4. Twitch redirige vers `https://nodyx.org/api/v1/streamer/twitch/callback?code=...&state=...`
5. Backend valide `state` (CSRF), échange `code` contre `access_token` + `refresh_token`
6. Tokens chiffrés AES-256-GCM avec `STREAMER_OAUTH_KEY` (env), insérés en DB
7. EventSub : abonnement aux events listés section 5
8. Redirect vers `/admin/streamer-hub` avec un toast "Connecté en tant que [login]"

### 4.3 Refresh automatique

Le refresh token Twitch est valide indéfiniment (jusqu'à révocation explicite). Avant chaque appel API, le service vérifie `expires_at` et refresh si nécessaire (avec une marge de 5 min).

---

## 5. EventSub — webhooks Twitch temps-réel

### 5.1 Endpoint

`POST /api/v1/integrations/twitch/eventsub/{nonce}` (public, signature HMAC obligatoire)

Le `{nonce}` est un blob 32 octets aléatoires (base64url) généré au moment de la souscription EventSub et stocké dans `streamer_eventsub_subscriptions.callback_nonce`. C'est l'URL que Nodyx fournit à Twitch dans `subscribeEvents`. Permet de retrouver le secret HMAC à utiliser pour vérifier la signature sans exposer un endpoint global devinable. Voir §12.2.

Vérification :
- Lookup `callback_nonce` en DB → récupère le secret HMAC chiffré et le déchiffre. Si le nonce n'existe pas : 404 immédiat, pas de log verbeux pour ne rien révéler.
- Header `Twitch-Eventsub-Message-Signature` : HMAC-SHA256 du body, signé avec le secret partagé. Si invalide : 403 silencieux + audit log `hmac_invalid`.
- Header `Twitch-Eventsub-Message-Type` : `webhook_callback_verification` / `notification` / `revocation`
- Header `Twitch-Eventsub-Message-Id` : déduplication (cache Redis 24 h)

### 5.2 Events souscrits

| Event Twitch | Action Nodyx |
|---|---|
| `channel.follow` (v2) | INSERT `streamer_events`, post dans le chat Nodyx, lien viewer si possible |
| `channel.subscribe` | idem + thread dédié si gros sub |
| `channel.subscription.gift` | idem + accumulation pour anniversaire mensuel |
| `channel.cheer` | idem + leaderboard bits |
| `channel.raid` (incoming) | trigger raider preview (top clips) |
| `channel.raid` (outgoing) | post dans le chat Nodyx |
| `channel.poll.begin` | mirror en poll Nodyx avec `external_id` |
| `channel.poll.end` | met à jour le poll Nodyx |
| `stream.online` | crée un `streamer_sessions` + thread auto-récap |
| `stream.offline` | clôture le `streamer_sessions`, génère le récap |

### 5.3 Flux

```
Twitch                 nodyx.org                Nodyx instance
  │                        │                          │
  │────HMAC POST──────────>│                          │
  │   (event)              │                          │
  │                        │ verify HMAC              │
  │                        │ dedupe                   │
  │                        │ INSERT streamer_events   │
  │                        │ dispatch via Socket.IO   │
  │                        │──────────────────────────>│
  │                        │                          │ post in chat
  │                        │                          │ update store
  │                        │                          │ trigger overlay
```

---

## 6. Chat bridge Twitch ↔ Nodyx

### 6.1 Architecture (EventSub Chat, pas IRC)

Twitch a poussé en GA fin 2024 deux APIs qui rendent IRC obsolète pour notre cas d'usage :
- **EventSub Chat** (`channel.chat.message`) : webhook qui pousse chaque message du chat vers nous, dans le même pipeline que les autres events (subs, follows, etc.)
- **Helix Send Chat Message** (`POST /chat/messages`) : envoie un message dans le chat depuis le compte streamer

Donc **zéro connexion IRC** à maintenir. Le bridge devient un simple flux de webhooks et de POST HTTP, dans la même couche que tout le reste.

```
Inbound  : Twitch chat → EventSub channel.chat.message webhook → Nodyx chat #twitch-chat
Outbound : Message Nodyx dans #twitch-chat → POST /chat/messages Helix → Twitch chat
```

Les messages reçus arrivent dans `streamer_events` avec `event_type = 'chat.message'` et un `payload` contenant `{ broadcaster_user_id, chatter_user_id, message, badges, fragments... }`.

### 6.2 Channel Nodyx dédié

Un channel `#twitch-chat` est auto-créé à la première connexion Twitch. Il est read-write par défaut pour tous les membres de l'instance. Toute écriture dans ce channel est relayée vers le chat Twitch.

Mode "lecture seule pour les non-streamers" optionnel via la config admin.

### 6.3 Préservation des badges et emotes

EventSub Chat fournit déjà les `badges` et `fragments` (avec emote IDs) dans le payload. On enrichit côté Nodyx avec :

- **Badges Twitch** (sub, mod, vip, premium) : sprite officiel via Helix `/chat/badges/global` + `/chat/badges/channel`, cachés en Redis 24h
- **Emotes natives Twitch** : URL CDN `https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/2.0`
- **BTTV** : `https://api.betterttv.net/3/cached/users/twitch/{user_id}` + `https://cdn.betterttv.net/emote/{id}/2x.webp`
- **FFZ** : `https://api.frankerfacez.com/v1/room/id/{room_id}` + cache 24h
- **7TV** : `https://7tv.io/v3/users/twitch/{user_id}` + cache 24h

Tous les caches stockés en Redis (`emotes:bttv:channel:{user_id}`, etc., TTL 24h).

### 6.4 Garde-fou : check stream live avant send

Avant chaque `POST /chat/messages` outbound, on vérifie que `streamer_sessions` a une session ouverte pour ce streamer (`ended_at IS NULL`). Sinon, on n'envoie pas (un message dans le chat d'un stream offline est inutile et perçu comme spam par les viewers qui se connectent à la prochaine session).

Mode **"test"** : un toggle admin bypasse ce check pour permettre au streamer de tester l'envoi à froid.

### 6.5 Limites techniques

- **Helix Send Chat Message** : limite de 100 req/min pour un compte régulier, 1500 req/min pour un compte affilié/partenaire. Largement suffisant.
- **EventSub Chat** : pas de limite côté reception, c'est Twitch qui pousse.
- Si rate-limit hit côté send : queue Redis `streamer:chat:send_queue` avec backoff exponentiel + alerte admin si la queue dépasse 50 messages en attente.

### 6.6 Pourquoi pas IRC

IRC reste fonctionnel à la date de cette spec, mais Twitch a clairement signalé sa volonté de pousser EventSub Chat comme remplacement. Choisir IRC dès Phase 2 = se créer une dette technique pour un refactor inévitable. Choisir EventSub Chat = aligné avec la direction Twitch, code plus simple, pipeline unifié avec le reste des events.

---

## 7. Mapping viewer Twitch ↔ user Nodyx

### 7.1 Trois flows possibles

**Flow A — Viewer existant déjà sur Nodyx, lie son compte Twitch**

1. Sur son profil → "Connecter mon compte Twitch"
2. OAuth Twitch (scope minimal `user:read:email`)
3. Backend récupère `twitch_id` + `twitch_login`, met à jour la row `users`
4. Désormais, ses events Twitch (follow, sub, etc) sont liés à son compte Nodyx → notifs perso, badges affichés

**Flow B — Viewer arrive depuis Twitch, pas encore inscrit sur Nodyx**

1. Sur la page Twitch du streamer, clique le panel d'extension "Rejoindre la communauté de [streamer]"
2. Atterrit sur l'instance Nodyx, écran "Login with Twitch"
3. OAuth Twitch
4. Backend crée un user avec `twitch_id` + `twitch_login` + email Twitch
5. Le viewer est connecté

**Flow C — Viewer existant sur Nodyx (autre login), arrive depuis Twitch**

1. Click panel Twitch → arrive sur Nodyx
2. Login with Twitch → match `twitch_id` existant en DB
3. Login automatique sur le compte Nodyx déjà existant

### 7.2 Sécurité

- Email Twitch comme fallback de matching, mais `twitch_id` est la clé primaire (un user peut changer d'email Twitch sans se faire ré-attribuer un autre compte Nodyx)
- Si un user Nodyx existe avec le même email mais sans `twitch_id`, on propose une fusion avec confirmation explicite
- Audit log de chaque liaison

---

## 8. OBS Stream Deck web

### 8.1 Topologies supportées

Trois cas réels chez les streamers :

| Topologie | Cas d'usage | Configuration Nodyx |
|---|---|---|
| **A. PC unique** | Streamer débutant, configurateur OBS sur la même machine que le navigateur | `ws://localhost:4455` |
| **B. Multi-PC LAN** | Streamer sérieux : PC gaming + PC streaming + Pi pour OBS, tous sur le même réseau | `ws://192.168.X.Y:4455` (IP locale du PC OBS) |
| **C. Distant via tunnel** | Stream à distance, PC OBS chez soi, navigateur en déplacement | Tunnel utilisateur (Tailscale, Cloudflare Tunnel, headscale, …) qui expose le PC OBS sur l'internet, puis `wss://obs.tunnel.example:4455` |

**Phase 3 (initiale)** couvre A et B en mode **navigateur-direct** : le frontend Nodyx ouvre une connexion WebSocket directe vers OBS. Avantages :
- Latence minimale (pas de hop serveur)
- Aucun credential OBS sur le serveur Nodyx
- Marche en LAN sans aucune config réseau supplémentaire

**Phase 6+ (futur)** ajoute un mode **proxy serveur** pour le cas C sans tunnel utilisateur :
- Credentials OBS chiffrés côté serveur Nodyx
- Le serveur Nodyx maintient la connexion OBS
- Le navigateur parle au serveur Nodyx via Socket.IO
- Latence +30-80ms acceptable, fonctionne depuis n'importe où

### 8.2 Configuration

Le streamer :
1. Installe OBS ≥ 28 (WebSocket server v5 built-in)
2. Active "WebSocket Server" dans OBS Settings → Tools → WebSocket Server Settings
3. Note le port (4455 par défaut) et le mot de passe généré
4. Configure dans Nodyx `/admin/streamer-hub/obs` :
   - **URL** : `ws://localhost:4455` (cas A) ou `ws://<IP-LAN>:4455` (cas B). En cas C, l'URL du tunnel
   - **Password** : copié depuis OBS

Le frontend teste la connexion immédiatement après save (handshake WebSocket v5 + auth challenge). Feedback clair : ✓ "Connecté à OBS [version]" ou ✗ avec le message d'erreur exact (timeout, mauvais password, port fermé).

### 8.3 Doc tunnel pour le cas C

`docs/admin/streamer-hub-obs-tunnel.md` (FR + EN) liste 3 setups éprouvés :
- **Tailscale** (le plus simple, gratuit jusqu'à 100 devices) : configuration en 5 commandes
- **Cloudflare Tunnel** (gratuit, requiert un domaine sur CF) : `cloudflared tunnel`
- **headscale** (auto-hébergé Tailscale) : pour les puristes self-hosted

### 8.4 Actions exposées

Phase 1 minimal :
- Switch scene
- Toggle source visibility (mic, cam, capture)
- Start/stop streaming
- Start/stop recording
- Save replay buffer
- Custom hotkeys mappés

Phase 5 polish :
- Filter toggle (chroma key, color correction, etc.)
- Audio mixer (volume sliders par source)
- Profile / scene collection switch

### 8.5 UI Stream Deck

Grille 5 × 3 (15 boutons) configurable, drag-and-drop. Chaque bouton :
- Label personnalisé
- Icône (emoji, SVG, image upload)
- Action : choix dans un menu déroulant des actions OBS dispo
- Couleur de fond

Layout sauvegardé en `streamer_obs_config.scenes_layout` (JSONB).

---

## 9. Stats live & récap polls

### 9.1 Modèle "1 thread par mois, 1 post par stream"

Plutôt que créer un thread par stream (catastrophe de pollution pour un streamer quotidien : 30 threads/mois, recherche cassée, pagination ingérable), on consolide :

- **1 thread mensuel** auto-créé au premier stream du mois, dans la catégorie "Streams" (auto-créée la 1ère fois)
- **Titre** : `[Streams] Mai 2026`
- **Chaque stream du mois** = un post dans ce thread, formaté en récap consolidé
- **Stream en cours** = le post du jour en mode "live" qui se met à jour en temps réel
- **Stream terminé** = le post passe en version finale (totaux figés)

Bénéfices :
- Lisibilité : on voit l'historique d'un mois en un coup d'œil
- Recherche : `Mai 2026` retourne 1 thread, pas 30
- Archive automatique : les threads des mois passés s'accumulent proprement, sans intervention manuelle
- Engagement : les viewers peuvent commenter chaque stream dans son post, sans noyer le thread

### 9.2 Stats live (stream en cours)

À l'événement `stream.online` :
- Si pas de thread `[Streams] [Mois Année]` pour le mois en cours → création
- Création d'un nouveau post dans ce thread, marqué `live = true`
- Le post contient un embed temps réel mis à jour toutes les 60s :
  - Titre Twitch + catégorie
  - Nombre de viewers actuels
  - Followers / subs / raids gagnés depuis le début de la session
  - Top 5 chatters (messages envoyés)
  - Top 5 emotes utilisées
  - Lien vers le replay (rempli à `stream.offline`)

À l'événement `stream.offline` :
- Le post passe en version finale (totaux figés, plus de mise à jour)
- Post de récap consolidé :

```
🎬 Stream du 7 mai 2026 — 4h 23min
🎮 Catégorie : Just Chatting
👥 Peak : 234 viewers (moy. 187)
🆕 +12 followers, +3 subs, +1 raid (Streamer X arrive avec 89 viewers)
💬 1 247 messages, 47 chatters uniques
🎉 Top emote : KEKW (203 occurrences)
🔗 [Replay sur Twitch](...)
```

### 9.3 Récap mensuel

Le 1er de chaque mois à 00:00 UTC, un dernier post est ajouté au thread du mois précédent : récap mensuel agrégé (total heures streamées, croissance followers, top events, etc.). Puis le thread est verrouillé (lectures OK, plus d'écriture).

### 9.4 Récap polls

Quand un poll Twitch est créé :
- Mirror automatique en poll Nodyx avec `external_id` partagé
- Les votes Nodyx sont fusionnés avec les votes Twitch dans l'affichage
- À la fin du poll : post de récap avec graphique de la répartition

---

## 10. Top clips & raider preview

### 10.1 Commande chat `!topclips`

Quand un message Twitch ou Nodyx contient `!topclips` (et que l'auteur a le droit `moderator+` ou que le streamer l'a activé pour tous) :
- Backend appelle Helix `/clips?broadcaster_id=...&first=5`
- Récupère les 5 top clips de la semaine
- Post un message dans le chat Nodyx avec previews
- Si OBS est connecté : option pour afficher en overlay pendant 30s

### 10.2 Rate-limit anti-flood

Toutes les commandes chat (`!topclips`, `!followage`, `!uptime`, …) sont **rate-limitées par utilisateur** via Redis :
- Cooldown global par commande : 30 s
- Cooldown spécifique par couple (utilisateur, commande) : 60 s
- Si flood détecté (5 hits du cooldown en 1 min) : timeout 5 min de l'utilisateur sur les commandes (le chat normal reste ouvert)
- Bypass : le streamer + ses mods n'ont aucun cooldown

Implémentation : clé Redis `streamer:cmd:{cmd}:{user_id}` avec TTL = cooldown. Présence de la clé = on ignore la commande silencieusement (pas de toast, pas de spam de "tu dois attendre").

### 10.3 Liste des commandes chat (Phase 5)

| Commande | Action | Cooldown |
|---|---|---|
| `!topclips` | Top 5 clips de la semaine | 30 s |
| `!uptime` | Durée du stream en cours | 10 s |
| `!followage [@user]` | Depuis quand `user` follow | 30 s |
| `!so @user` | Shoutout (post un récap du dernier stream de `user`, mods only) | 30 s |
| `!discord` ou `!nodyx` | Lien vers l'instance Nodyx | 60 s |
| `!commands` | Liste les commandes dispo | 30 s |

### 10.4 Raider preview

Sur `channel.raid` (incoming) :
- Backend détecte le `from_broadcaster_user_id`
- Fetch les top 3 clips de ce raider
- Pop-up dans `/admin/streamer-hub` ou notif live : "🎉 [Raider] arrive avec X viewers ! Afficher leurs top clips ?"
- Si OK : envoi à OBS pour afficher en overlay 30s, en hommage au raider

---

## 11. Twitch Extension generator

### 11.1 Flow

1. Streamer clique **Générer mon extension Twitch** sur `/admin/streamer-hub/extension`
2. Nodyx fournit un template `.zip` avec :
   - `manifest.json` (configuré pour pointer vers l'instance)
   - `panel.html` + `panel.js` : panneau "Rejoindre la communauté de [streamer]"
   - `component.html` + `component.js` : overlay live qui affiche les events temps-réel
   - `config.html` + `config.js` : page de config admin (pas grand chose vu que tout vient de l'instance)
3. Le streamer télécharge le `.zip` et l'upload sur dev.twitch.tv en suivant le tuto fourni
4. Soumission Twitch (peut prendre des semaines pour approval)
5. Une fois approuvée : l'extension est dispo sur sa page Twitch

### 11.2 Pubsub

L'extension utilise **Twitch PubSub** pour recevoir les events de l'instance Nodyx :
- L'instance Nodyx publie un message PubSub via Helix avec un JWT signé
- L'extension côté viewer écoute le pubsub channel
- L'overlay s'anime en temps réel (alerte de follow, sub, raid, etc.)

JWT signé par l'instance avec son secret d'extension (généré au moment de la génération de l'extension).

### 11.3 Marketing intégré

Le panel par défaut affiche :
- Nom de la communauté + avatar
- Lien direct vers l'instance Nodyx
- Footer : "Powered by Nodyx — outils libres pour streamers"

Effet viral : chaque streamer Nodyx qui installe l'extension promeut Nodyx auprès de ses viewers Twitch.

---

## 12. Sécurité

Approche **defense-in-depth** : aucune mesure n'est suffisante seule, l'empilement rend l'exploitation coûteuse même si une couche tombe.

### 12.1 Tokens & chiffrement au repos

- **Double chiffrement (master + sel par row)**. La `STREAMER_OAUTH_KEY` (env, 32 octets) est la *master key*. Pour chaque row, on dérive une clé spécifique via HKDF-SHA256(master_key, salt) où `salt` est un blob 16 octets stocké dans la row à côté du ciphertext. Conséquence : une fuite de la DB seule ne donne RIEN (les sels ne servent que dérivés avec la master). Une fuite de la master sans la DB ne donne rien non plus. Il faut les deux pour exploiter.
- **AES-256-GCM** avec IV unique par chiffrement (12 octets aléatoires). Le tag GCM garantit l'authenticité.
- **Rotation mensuelle de la master key**. Cron mensuel : génère `master_key_v(N+1)`, ré-encrypt tous les tokens en background, garde `master_key_vN` valide pendant 7 j (fenêtre de chevauchement pour les sessions actives), puis purge. Limite la fenêtre d'exposition d'une clé volée à ~30 j max. Pattern colonnes : `key_version INTEGER NOT NULL DEFAULT 1`.
- **Tests automatisés de non-déchiffrement** (tests négatifs) : la suite vérifie qu'un payload chiffré ne se déchiffre PAS si on change la master key, le sel, l'IV ou le tag GCM. Garantit qu'on ne dégrade jamais le chiffrement par mégarde lors d'un refactor.

### 12.2 EventSub webhooks

- **HMAC SHA-256** : sécurité primaire. Twitch signe avec un secret partagé fourni à `subscribeEvents`. Nodyx vérifie avant tout traitement, y compris parsing JSON. Signature invalide = 403 silencieux + log.
- **Nonce dans l'URL** : `POST /api/v1/integrations/twitch/eventsub/{nonce}` où `{nonce}` est un blob 32 octets aléatoire généré à la souscription EventSub et stocké en DB (un nonce par streamer). Empêche les appels malveillants directs sur l'endpoint sans connaître l'URL exacte. La HMAC reste la sécurité primaire ; le nonce est une couche supplémentaire qui élimine 99% du bruit.
- **Déduplication** : `Twitch-Eventsub-Message-Id` cachée en Redis 24 h pour absorber les retries Twitch sans double-traitement.
- **Rate limit** middleware `rateLimit` existant sur l'endpoint EventSub (10 req/s par défaut, généreux).
- **CORS** : aucune origine browser n'est autorisée sur cet endpoint (Twitch ne vient pas du navigateur). Toute requête CORS est rejetée d'office.

### 12.3 Cycle de vie des tokens Twitch

- **Rotation forcée tous les 30 j** : un cron déclenche un refresh proactif de l'access_token + refresh_token Twitch (Twitch retourne un nouveau refresh à chaque refresh). Si un token a été exfiltré il y a > 30 j, il est mort, même si l'attaquant ne l'a pas encore utilisé.
- **Révocation immédiate** sur disconnect : appel à `POST /oauth2/revoke` Twitch + DELETE row.
- **Audit log** de chaque liaison, refresh, révocation, échec de refresh.

### 12.4 Isolation système & containment

- **Compte système dédié `nodyx-streamer`** (séparé du user `nodyx` qui fait tourner nodyx-core). Le service Streamer Hub tourne sous ce user, avec lecture/écriture limitée à ses tables et son répertoire d'uploads. Conséquence d'une RCE dans le module Streamer : pas d'accès aux backups, pas d'accès au JWT_SECRET principal, pas d'accès aux DMs E2E, pas d'écriture sur les autres tables. Pattern identique au Sprint 4 audit (User=nodyx systemd étendu en User=nodyx-streamer pour ce module).
- **OBS WebSocket password** : chiffré au repos comme tous les autres secrets, déchiffré uniquement en mémoire dans la session admin du navigateur du streamer. Jamais en clair sur disque côté serveur.
- **Twitch Extension JWT secret** : généré à la première génération, stocké chiffré, jamais exposé via API.

### 12.5 Surveillance & alerting

- **Audit log** sur les actions sensibles (`connect_twitch`, `disconnect`, `config_obs`, `generate_extension`, `token_refresh`, `token_decrypt_failed`). Pattern identique à `backup_audit_log`.
- **Alertes temps réel sur anomalies** :
  - ≥ 5 échecs de déchiffrement de tokens en 1 min → alerte critique (signale tentative d'exploitation après fuite DB sans master key)
  - ≥ 10 webhooks EventSub avec HMAC invalide en 1 min → alerte (tentative d'injection ou fuite du secret HMAC)
  - Refresh token sollicité > 5 fois en 1 h → alerte (course de sessions ou clock drift)
  - Outbound chat actif alors que `streamer_sessions.ended_at IS NOT NULL` → alerte (bug ou compromission)
  - 0 event reçu en 1 h alors que `stream.online` actif → alerte (EventSub down ou révoqué)

### 12.6 Priorisation par phase

Tout n'est pas implémenté en Phase 1. Découpage proposé :

| Mesure | Phase | Coût supplémentaire |
|---|---|---|
| HMAC SHA-256 EventSub | Phase 0 / 1 | inclus |
| AES-256-GCM master + sel HKDF | Phase 1 | +1 j |
| Audit log de base | Phase 1 | gratuit (réutilise `backup_audit_log`) |
| Nonce dans URL EventSub | Phase 1 | +0.5 j |
| Tests non-déchiffrement | Phase 1 | +0.5 j |
| Compte système dédié `nodyx-streamer` | Phase 1 (install.sh) | +0.5 j |
| Rotation master key mensuelle | Phase 5 | +1 j |
| Rotation forcée tokens 30 j | Phase 5 | +0.5 j |
| Alertes temps réel anomalies | Phase 5 | +1-2 j |

Rationale : les fondations (chiffrement double, isolation système, nonce URL, audit) sont en place **dès la Phase 1** parce que ce sont des choix structurels difficiles à introduire après coup. Les couches actives (rotation, alertes) arrivent en Phase 5 quand on a assez de signal pour calibrer les seuils sans noyer l'admin de faux positifs.

---

## 13. Phases d'implémentation

| Phase | Livrable | Effort | Valeur |
|---|---|---|---|
| **0 — Spike technique** | OAuth Twitch streamer + 1 webhook EventSub qui logge l'event dans la console + refresh token. Aucune UI, aucune persistence, aucun chat. **Lever les doutes du flow OAuth/HMAC/refresh avant tout engagement de Phase 1.** | 1-2 j | Validation de faisabilité |
| **1 — Foundations Twitch** | OAuth Twitch streamer (+ stockage chiffré), EventSub complet (follow / sub / raid / bits / poll / stream), feed activité dans le chat Nodyx, `users.twitch_id`, OAuth viewer **Flow A** (lier son Twitch perso à un compte Nodyx existant). Flow B/C reportés en Phase 5. | 2-3 j | 🔥 Déjà utilisable comme alerte streamer |
| **2 — Chat unifié Twitch ↔ Nodyx** | Bridge **EventSub Chat (in) + Helix Send Chat Message (out)**, badges Twitch + BTTV/FFZ/7TV emotes, channel `#twitch-chat` auto, check stream live avant send, queue Redis recovery sur 429 | 3-4 j | 🔥 Remplace Streamer.bot pour 90% des cas |
| **3 — OBS Stream Deck web** | Connexion OBS WebSocket v5 depuis le navigateur (LAN + tunnel), grille drag-and-drop, actions essentielles, doc tunnel pour multi-PC | 4-5 j | 🔥 Remplace Stream Deck Elgato (~150€) |
| **4 — Stats live + récap polls** | Thread mensuel + post-par-stream auto-update, récap auto en fin de stream + récap mensuel le 1er de chaque mois, mirror polls Twitch | 3-4 j | 🔥 Remplace une partie de StreamElements |
| **5 — Top clips, raider preview, commandes chat, Twitch Extension** | Commandes `!topclips` `!uptime` `!followage` `!so` `!commands` (avec rate-limit), raider preview overlay, générateur d'extension Twitch, **Flow B/C viewer** (signup auto / login auto depuis le panel Twitch) | 1-2 sem | 🔥 Effet viral |

**Phase 0 (Spike)** est OBLIGATOIRE avant Phase 1. C'est un proof-of-concept jeté qui valide que le flow OAuth Twitch + signature HMAC EventSub + refresh tokens fonctionne bout en bout dans notre environnement Caddy + nodyx-core. Si la Phase 0 révèle un blocage technique majeur (cas tordu CORS, problème de redirect URI multi-instance, etc.), on l'apprend en 1 jour, pas en plein milieu de la Phase 1. Le code de Phase 0 est jeté ou intégré, peu importe — l'objectif est l'apprentissage.

**Phase 1 seule** (après spike validé) rend déjà Nodyx utilisable comme remplaçant de Streamlabs/StreamElements pour les alertes basiques. Chaque phase ajoutée empile de la valeur sans casser ce qui précède.

---

## 14. Fichiers à créer / modifier

**Backend** :
- `nodyx-core/src/migrations/078_streamer_hub.sql` (nouveau)
- `nodyx-core/src/services/streamer/streamerHubService.ts` (nouveau)
- `nodyx-core/src/services/streamer/providers/twitchProvider.ts` (nouveau)
- `nodyx-core/src/services/streamer/providers/_types.ts` (nouveau)
- `nodyx-core/src/services/streamer/chatBridge.ts` (Phase 2)
- `nodyx-core/src/services/streamer/obsClient.ts` (Phase 3)
- `nodyx-core/src/routes/streamer.ts` (nouveau)
- `nodyx-core/src/index.ts` (register routes)

**Frontend** :
- `nodyx-frontend/src/routes/admin/streamer-hub/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/connect/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/obs/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/stats/+page.svelte`
- `nodyx-frontend/src/routes/admin/streamer-hub/extension/+page.svelte`
- `nodyx-frontend/src/routes/auth/connect-twitch/+page.svelte`
- `nodyx-frontend/src/lib/streamer/twitchAlert.ts`

**Docs** :
- `docs/admin/streamer-hub.md` (FR + EN)

**Infra** :
- `install.sh` : générer `STREAMER_OAUTH_KEY` au setup
- `nodyx-core/.env.example` : ajouter les vars

---

## 15. Risques & questions ouvertes

1. **Twitch peut deprecate des events sans préavis.** Mitigation : versionnage de la couche provider, fallback sur polling Helix si EventSub down. Monitoring : alertes admin si pas d'event reçu pendant 1h alors que `stream.online`.

2. **Twitch IRC peut devenir read-only un jour** (rumeurs). Mitigation : migration prévue vers EventSub Chat (en preview chez Twitch). Refactor estimé à 1-2 jours.

3. **OBS WebSocket v5 nécessite OBS ≥ 28.** Mitigation : message clair dans la doc, version check à la connexion.

4. **Twitch Extension submission peut être refusée** ou prendre des semaines. Mitigation : la spec ne dépend pas de l'extension pour fonctionner. C'est un bonus marketing, pas un bloquant.

5. **Multi-streamer ?** Décidé : NON. Une instance = un streamer principal + ses mods (en lecture). Si plusieurs streamers veulent collaborer, ils ouvrent chacun leur instance Nodyx et utilisent `nodyx-relay` pour se fédérer.

6. **Modération automatique côté Twitch chat (bannir, timeout, etc) depuis Nodyx ?** Hors scope Phase 1-5. Phase 6 potentielle, scope à définir.

7. **Intégration des autres providers (Owncast, PeerTube, YouTube Live, Kick) ?** Architecture prête (interface `StreamerProvider`), implémentations à faire après Phase 5 selon demande communauté. Owncast probablement en premier (libre, self-hosted, philosophie alignée).

8. **OBS via cloud (depuis un autre PC, pas localhost) ?** Hors scope Phase 1-5. La complexité explose (NAT traversal, proxy, etc). Phase 6+ si demandé.

### 15.bis — Points à valider explicitement en Phase 0

Ces 5 hypothèses de la spec n'étaient **pas confirmées** par la doc Twitch publique, ou présentaient un risque de mauvaise surprise. Le spike Phase 0 (cf [PHASE_0_REPORT.md](PHASE_0_REPORT.md)) a produit un GO / NO-GO sur chacun.

1. ✅ **EventSub Chat ne nécessite pas de validation "Chat Bot"** — Validé empiriquement le 2026-05-08. La consent screen Twitch a accepté `user:read:chat` sur une app fraîchement créée (< 24 h), sans review demandée. Pipeline EventSub Chat dispo sans frottement administratif.

2. ✅ **`clips:read` n'existe pas** — Twitch rejette ce scope avec `invalid scope requested`. Pour *lire* les top clips, un App Access Token suffit (Helix `GET /clips` est public côté lecture). `clips:edit` reste pour Phase 5 (création de clips depuis Nodyx). §4.1 mis à jour.

3. ⏸ **Scopes pour `!so @user` (shoutout)** — Différé. Hors scope spike (canary minimal). Hypothèse maintenue : Helix `GET /channels?broadcaster_id=...` accessible avec App Access Token. À valider en Phase 5. Pas bloquant pour Phase 1-4.

4. ⏸ **Twitch Extension Developer Rig & hosting** — Différé. Validation manuelle au moment de la submission Phase 5. Mitigation prévue si Twitch refuse self-hosted : héberger les assets sur CDN externe, ne servir que les *données* depuis l'instance.

5. ⏸ **Queue chat outbound : timeout + purge** — Différé. Hors scope spike (la queue n'existe que côté Phase 2). Pattern à implémenter en Phase 2 selon §6.5 : chaque entrée queue = `{ msg, expires_at }`, le worker drop les entrées expirées sans tentative d'envoi, alerte admin si taux de drop > 10%.

**Bonus validé au-delà des 5 critères initiaux** : le canary `stream.online` a été reçu live (POST → log `🎬 EventSub notification reçue` en 2 ms), validant le path `notification` en plus du path `verification`. Voir PHASE_0_REPORT.md pour le détail.

---

## 16. V2 — Évolutions futures (hors scope V1)

À mentionner pour ne pas se peindre dans un coin :

- **Owncast / PeerTube / YouTube Live / Kick providers** : architecture prête, implémentation à la demande
- **TipeeeStream / Twitch Bits payouts** : agrégation des revenus en un seul tableau de bord
- **Chat moderation tools** : bannir, timeout, supprimer un message Twitch depuis Nodyx
- **Bot commandes custom** : `!discord`, `!followage`, `!uptime`, etc, configurables depuis Nodyx
- **Soundboard** : déclencher des sons OBS depuis le chat (commandes ou clic)
- **Donor wall** : panneau auto-update des derniers dons / subs / bits
- **Loyalty points (Streamlabs Points clone)** : système de fidélité Nodyx-natif
- **Extension hub Nodyx** : marketplace d'overlays / panels prêts à l'emploi
- **Auto-clip** : enregistre un clip à chaque event majeur (sub, raid, gros bits)
- **Webhook outgoing** : envoyer les events vers Zapier / IFTTT / autres
- **Multi-language streamer team** : un streamer + un co-host dans une autre langue, chats séparés affichés côte à côte

---

## 17. Décision finale & ordre d'attaque

Spec **v2.4** validée Pokled (2026-05-10). Phase 0 ✅ + Phase 1 ✅ + Phase 2 ✅ livrées en prod (`nodyx.org`). Phase 3 prête à démarrer.

État actuel :

1. ✅ **Phase 0 — Spike technique** (`feat/streamer-hub-spike`, archive). OAuth + EventSub bout-en-bout validés en 3h, canary `stream.online` reçu live en 2 ms. Branche conservée comme archive.

2. ✅ **Phase 1 — Foundations Twitch** (`feat/streamer-hub-phase-1`, mergée dans `main`). Livré 2026-05-08 :
   - OAuth Twitch streamer + tokens chiffrés AES-256-GCM avec HKDF master + sel par row (§12.1)
   - EventSub 9 events souscrits (`channel.follow` v2, `subscribe`, `subscription.gift`, `cheer`, `raid`, `poll.begin/end`, `stream.online/offline`)
   - Webhook `/api/v1/integrations/twitch/eventsub/{nonce}` avec HMAC SHA-256 + dedup Redis 24h + persist DB
   - Page admin `/admin/streamer-hub` (statut connection, liste subscriptions, feed events, actions refresh/disconnect)
   - Module `streamer-hub` enregistré dans le system de modules (`/admin/modules`)
   - Channel auto `#streamer-events` (`is_system_managed=TRUE`, lecture seule sauf mods)
   - User système Nodyx auto-créé (avatar logo, name_color #7c3aed, glow Twitch purple, bio)
   - Push automatique des events au chat avec 9 templates formatés
   - OAuth viewer **Flow A** : `/settings` > "Comptes liés" pour lier son Twitch perso à son profil Nodyx (Flow B/C reportés en Phase 5)
   - Callback OAuth idempotent (gère les requests dupliqués Twitch sans page d'erreur)
   - 204/204 tests verts, build TS clean

3. ✅ **Phase 2 — Chat unifié Twitch ↔ Nodyx** (`feat/streamer-hub-phase-2`, mergée dans `main` via `v2.5.0`). Livré 2026-05-10. Voir [PHASE_2_REPORT.md](PHASE_2_REPORT.md) pour le détail complet. Résumé :
   - EventSub Chat `channel.chat.message` (subscription créée, dedup vs Twitch)
   - Channel `#twitch-chat` auto, read-write par défaut (relai outbound depuis tout membre)
   - Outbound via Helix `POST /chat/messages` avec garde-fou `streamer_sessions` (live only)
   - Lifecycle de sessions : INSERT à `stream.online`, UPDATE `ended_at` à `stream.offline`
   - Emotes natives Twitch (fragments + CDN) + BTTV / FFZ / 7TV (fetch parallèle, cache Redis 24h)
   - Badges Twitch globaux + channel via Helix (App Access Token cache 50j, global 7j, channel 24h)
   - Queue Redis `streamer:chat:send_queue` (sorted set) + backoff exponentiel + alerte audit > 50
   - 65 nouveaux tests (5 fichiers), 269/269 verts

4. ➡️ **Phase 3 — OBS Stream Deck web** (à démarrer depuis `main`). WebSocket v5 navigateur-direct (topologies A + B), grille drag-and-drop, doc tunnel pour le cas C. Estimé 4-5 j.

### Changelog de la spec

**v2.4 — 2026-05-10** (post-livraison Phase 2)
- §13 : Phase 1 rectifiée (Flow A only, Flow B/C reportés en Phase 5).
- §13 : Phase 2 enrichie (mention de la queue Redis recovery sur 429, livrée).
- §13 : Phase 5 enrichie (Flow B/C viewer ajoutés).
- §17 : Phase 2 marquée livrée + PHASE_2_REPORT.md référencé. Phase 3 ordonnée.

**v2.3 — 2026-05-08** (post-livraison Phase 1)
- §17 : Phase 1 marquée livrée, recap de ce qui est en prod, Phase 2 ordonnée
- Pas de modif de spec technique : tout ce qui était spec'é a été livré tel quel.

**v2.2 — 2026-05-08** (post-spike Phase 0)
- §4.1 Scopes : retrait `clips:read` (n'existe pas chez Twitch) + retrait `chat:read`/`chat:edit` (anciens scopes IRC, remplacés par `user:read:chat`/`user:write:chat`). Phase explicite par scope (1 / 2 / 4 / 5).
- §15.bis : statuts GO/NO-GO mis à jour (#1 ✓, #2 ✓, #3 ⏸, #4 ⏸, #5 ⏸). Bonus canary `stream.online` reçu live ajouté.
- §17 : mise à jour de la décision finale (Phase 0 close, Phase 1 prête à démarrer).
- Nouveau fichier [PHASE_0_REPORT.md](PHASE_0_REPORT.md) : rapport définitif du spike.

**v2.1 — 2026-05-07** (post-relecture Pokled)
- §3 schéma DB : ajout colonnes `enc_salt`, `enc_iv`, `enc_tag`, `key_version`, `rotated_at` sur `streamer_oauth_tokens` ; nouvelle table `streamer_eventsub_subscriptions` (nonce URL + secret HMAC chiffré)
- §5.1 : endpoint EventSub passe de `/eventsub` à `/eventsub/{nonce}` (32 octets aléatoires par souscription)
- §8 / §9 / §10 : renumérotation des sous-sections (8.4, 8.5, 9.4, 10.4) — les duplicates 8.2, 9.2, 10.2 sont corrigés
- §12 Sécurité : restructurée en 6 sous-sections, intégration des 7 mesures de durcissement (double chiffrement master + sel HKDF, rotation master key, rotation forcée tokens 30 j, nonce URL EventSub, compte système dédié, alertes temps réel anomalies, tests négatifs non-déchiffrement)
- §15.bis : 5 points de vérification explicites du spike Phase 0 (EventSub Chat sans review, `clips:read` vs `clips:edit`, scopes `!so`, hosting Extension HTTPS, TTL queue chat outbound)

**v2 — 2026-05-07** (1ère relecture Pokled)
- §6 : abandon IRC → EventSub Chat + Helix Send Chat Message
- §8 : ajout topologies multi-PC (LAN + tunnel) + plan Phase 6+ proxy serveur
- §9 : threads consolidés (1 par mois, 1 post par stream)
- §10 : rate-limit anti-flood + liste commandes Phase 5
- §13 : ajout Phase 0 (Spike) obligatoire avant Phase 1
- §6.4 : check stream live avant chaque send chat outbound

**v1 — 2026-05-07** : draft initial.