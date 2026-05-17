# OctoGuard, modérateur automatique pour Nodyx

**Version** : 2.1 (admin-freedom, architecture éthique à 2 niveaux)
**Statut** : Spécification technique
**Mascotte** : pieuvre Nodyx + bouclier
**Objectif** : système natif de modération automatique, bienvenue, commandes personnalisées, mute temporaire et signalement, **construit en surcouche de l'infra modération existante de Nodyx**. Aucun doublon. **Aucune politique de contenu imposée à l'admin.**
**Cible de livraison** : ≤ 2 semaines.

---

## Principe fondamental : admin-freedom

Cette spec repose sur le principe d'architecture éthique à deux niveaux de Nodyx :

- **Niveau 1, l'instance** : liberté totale de l'admin. Tout est désactivable, tout est configurable. Aucune politique de contenu n'est imposée par le code. L'admin assume la responsabilité légale de son instance (en France, hébergeur = responsable du contenu hébergé).
- **Niveau 2, l'annuaire cross-instance** : la modération éthique du réseau se fait au niveau du directory, pas du code obligatoire. C'est lui qui refuse de référencer les instances qui hébergent ce qui n'est pas humain. Spec dédiée à venir (018-directory-moderation).

OctoGuard est donc un **outil que l'admin choisit d'activer**, pas une politique. Par défaut, **désactivé**. Aucune règle préchargée. L'admin construit son cadre depuis zéro.

---

## Avant-propos : pourquoi v2.1

La v1.1 créait plusieurs tables et systèmes qui dupliquaient l'existant Nodyx. Cette v2.0 part d'un **audit complet** (cf. discussion #25, fil OctoGuard) et redéfinit OctoGuard comme **une couche au-dessus** de ce qui marche déjà, pas un système parallèle. Bénéfices :

- Un seul endroit pour les logs admin (la table `admin_audit_log` existante).
- Un seul système de ban (la table `community_bans` existante).
- Un seul rate-limit Socket.IO de burst (le `rateLimiter.ts` existant).
- Un seul filtre de contenu, mais évolué : on **étend** `contentFilter.ts` (env var → DB + UI admin).

---

## Inventaire de l'existant Nodyx (à respecter)

| Ce qui existe | Où | OctoGuard en fait quoi |
|---|---|---|
| Filtre haineux hard-codé (swastika, runes SS) | `services/contentFilter.ts` | **Activé par défaut, désactivable** via env `NODYX_HATE_FILTER_ENABLED=false` ou setting DB. Désactivation derrière une modale d'avertissement explicite (friction informée, pas blocage). L'admin assume sa responsabilité légale. |
| Patterns regex via env var `BLOCKED_CONTENT_PATTERNS` | idem | **Étendu** : règles structurées en DB, modifiables à chaud depuis l'UI admin. Compatibilité env var conservée 2 versions. |
| `community_bans` (ban permanent) | migration 034, `admin.ts:394-510` | **Réutilisé**. Migration 088 ajoute `expires_at` pour ban_temp. |
| `ip_bans` / `email_bans` (+ protection mainstream domains) | migration 035, `admin.ts:515-637` | **Réutilisés** si l'admin choisit "auto-ban IP/email" comme action escalade. |
| `admin_audit_log` + helper `logAction()` | migration 046, `admin.ts:78-95` | **Source unique des logs OctoGuard**. Actions automatiques loggées avec `actor_username='octoguard:auto'`. Pas de table `octoguard_logs`. |
| Anti-bot signup 3 couches (honeypot, timing, pattern) + `bot_signup_attempts` | migration 084, `auth.ts:114-234` | **Intact**. Pas de Module à dupliquer. |
| `reported_ips` (blocklist distribuée honeypot inter-instance) | migration 058 | **Intact**. Distinct du Module 7 (reports user-facing). |
| Rate limit API global (100/60s) + login (5/15min) + register (5/h) | `middleware/rateLimit.ts`, `auth.ts:49-89` | **Intacts**. OctoGuard n'y touche pas. |
| Rate limit Socket.IO burst chat (5/3s + 15/15s) | `socket/rateLimiter.ts:23-43` | **Intact**. OctoGuard ajoute une couche **contenu** par-dessus, pas une couche burst. |
| `kick` user (retire de `community_members`) | `admin.ts:368-391` | **Réutilisé** comme action OctoGuard. |
| Page admin members + audit-log | frontend `admin/members`, `admin/audit-log` | **Intactes**. OctoGuard ajoute sa page séparée `/admin/octoguard`. |

---

## Contexte & contraintes Nodyx

- **Mono-tenant strict** : "une instance = une communauté". Aucun `guildId` dans la spec.
- **Identifiants UUID** partout.
- **Système de rôles** : `users.role` enum (`owner`/`admin`/`moderator`/`member`) + table `grades` custom. Gérés tous les deux dans les listes d'immunisation.
- **Voice WebRTC P2P** : pas de bot vocal Phase 1. Voice metadata sans audio en Phase 3 (cf. feedback yudin-s).
- **DM E2E** : exception encadrée pour le welcome DM (flag `is_system: true`, badge `[Système]` côté UI).
- **Pas de `kick` Discord-style** : le `kick` Nodyx existant retire de `community_members`. Le ban_temp utilise `community_bans` + `expires_at`.
- **Pas d'embed riche** : markdown brut.
- **XP / niveaux / leaderboard** : reportés Phase 2.
- **Scope Phase 1 = chat uniquement**. Forums (catégories/threads) Phase 3.

---

## Principes généraux

- **Pipeline message** : tout event Socket.IO `chat:send` passe par OctoGuard **après** le rate-limit burst existant (`checkRateLimit(userId, 'chat:send')`) et **avant** `addMessage` + broadcast.
- **Performance cible** : p95 < 5ms ajoutés par message.
- **Timeout de sécurité** : 50ms. Si dépassé, bypass + warning. Jamais bloquer le chat.
- **Cache RAM** des règles compilées, invalidé via Redis pub/sub à chaque CRUD admin.
- **Logs** : **dans `admin_audit_log` existant**. Pas de table dédiée. Helper `logAction()` étendu avec un actor virtuel `octoguard:auto`.
- **`event_id` dès le jour 1** (proposition yudin-s) : chaque action OctoGuard et chaque event Socket.IO modération porte un UUID unique pour permettre l'idempotence (Phase 4 Bot API en hérite directement).
- **Mode dry-run** : action `report_only` ou flag `dry_run: true` qui log sans agir.
- **Undo** : chaque ligne `admin_audit_log` d'OctoGuard porte un `metadata.undoable: true` + opération inverse encodée. UI admin `/admin/octoguard/logs` propose le bouton.
- **Réutilisation** : `community_bans`, `ip_bans`, `email_bans`, `kick` existants sont appelés en interne. Aucune duplication.
- **Kill switch** : env `OCTOGUARD_ENABLED` par défaut **`false`**. OctoGuard est inactif au premier boot, l'admin l'active s'il le veut. `OCTOGUARD_ENABLED=false` court-circuite tout le pipeline (latence ajoutée = 0).
- **État initial** : aucune règle préchargée. La table `octoguard_automod_rules` part vide. L'admin construit son cadre depuis zéro, pas de "politique par défaut".
- **Durées libres** : aucun enum strict sur les durées de sanctions. Format `{ value: number, unit: 'm'|'h'|'d'|'w'|'M' }` accepté côté API. L'admin choisit ses propres seuils.
- **Redis keyPrefix** : client a déjà `keyPrefix: 'nodyx:'`. Clés OctoGuard sans préfixe dans le code (ex: `octoguard:rules`).

---

## Module 1 : Auto-modération

### Types de règles

| Type | Paramètres | Actions possibles |
|---|---|---|
| `regex` | `pattern`, `flags` | delete, warn, mute, ban_temp |
| `caps` | `min_length`, `threshold_percent` | delete, warn |
| `link_domain` | `mode: whitelist\|blacklist`, `domains[]` | delete, warn, mute |
| `mention_spam` | `max_mentions` | delete, mute |
| `link_spam` | `max_links` | delete, warn |

**Note importante** : on **ne crée pas** de type `flood`. Le `socket/rateLimiter.ts` existant fait déjà l'anti-flood en burst (5 msgs/3s + 15 msgs/15s). Reproduire ça serait du doublon. Si on veut un anti-flood paramétrable plus tard, on **étend `rateLimiter.ts`** (config en DB plutôt que hard-codée), pas dans OctoGuard.

### Actions

- **`delete`** : supprime le message et émet `chat:blocked` privé à l'auteur avec `i18n_key`. Réutilise le pattern existant `socket.emit('chat:blocked', { reason })`.
- **`warn`** : enregistre un avertissement dans `octoguard_warns` (nouvelle table dédiée). À N warns sur fenêtre glissante, escalade configurable.
- **`mute`** : INSERT dans **`chat_mutes`** (nouvelle table, cf. Module 6). Durée libre (`{ value, unit }`) ou `perm`.
- **`ban_temp`** : INSERT dans **`community_bans`** existante avec `expires_at`. Durée libre ou `perm`.
- **`notify_only`** : aucune action sur l'utilisateur. Le match est seulement loggé dans `admin_audit_log` et envoyé au webhook si configuré. Permet à un admin d'observer une règle sans agir, ou de configurer une modération 100% manuelle assistée.
- **`report_only`** : alias de `notify_only` orienté test (dry-run d'une règle pendant son réglage).

### Format JSON d'une règle (colonne `params` JSONB)

```json
{
  "name": "Anti gros mots",
  "type": "regex",
  "params": { "pattern": "\\b(merde|connard)\\b", "flags": "i" },
  "action": "delete",
  "action_duration": null,
  "escalation": {
    "warns_threshold": 3,
    "window_days": 7,
    "action": "mute",
    "duration": "1h"
  },
  "immunized_role_types": ["owner", "admin", "moderator"],
  "immunized_grade_ids": ["uuid-grade-vip"],
  "enabled": true,
  "dry_run": false
}
```

### Compatibilité `BLOCKED_CONTENT_PATTERNS`

À chaque boot, OctoGuard lit `process.env.BLOCKED_CONTENT_PATTERNS`. Si présent et non vide :
1. **Si la table `octoguard_automod_rules` est vide** : import automatique des patterns env vers la DB (one-shot). Log un message `[octoguard] migration env → DB de N patterns`.
2. **Si la table contient déjà des règles** : l'env est ignoré (DB fait foi).

Documentation pousse à supprimer l'env var une fois la migration faite. Compatibilité conservée 2 versions, deprecated en v2.1, retiré en v2.3.

---

## Module 2 : Welcome

Inchangé par rapport à v1.1.

- Message public dans un channel chat configuré.
- DM système optionnel (`is_system: true`, badge `[Système]`).
- Auto-grade à l'inscription.
- Variables : `{user}`, `{userMention}`, `{communityName}`, `{rulesUrl}`.

**Table** : `octoguard_welcome` singleton (`id = 1 CHECK`).

---

## Module 3 : Commandes custom

Inchangé. `!commande` dans le chat → réponse markdown. Cooldown Redis `octoguard:cooldown:{cmdId}:{userId}` avec TTL.

**Table** : `octoguard_commands`.

---

## Module 4 : Logs & Undo (RÉUTILISE l'existant)

**Pas de table `octoguard_logs`**. Toutes les actions OctoGuard écrivent dans `admin_audit_log` :

```ts
await logAction(
  null,                            // actor_id NULL = action automatique
  'octoguard.delete_message',      // action préfixée octoguard.*
  'message',                       // target_type
  messageId,                       // target_id
  excerpt,                         // target_label (extrait du message)
  {
    rule_id: rule.id,
    rule_name: rule.name,
    actor: 'octoguard:auto',
    event_id: 'uuid-v4',
    undoable: true,
    undo_op: { type: 'restore_message', message_id: messageId },
  }
)
```

Le helper `logAction()` existant est étendu pour accepter `actor_id = null` (cas action auto, l'`actor_username` devient `octoguard:auto`).

**UI admin** : page `/admin/octoguard/logs` qui filtre `admin_audit_log WHERE action LIKE 'octoguard.%'`. Bouton Undo pour les actions où `metadata.undoable = true`.

**Actions enregistrées** :
- `octoguard.delete_message`
- `octoguard.warn_user`
- `octoguard.mute_user`
- `octoguard.unmute_user`
- `octoguard.ban_temp_user`
- `octoguard.welcome_sent`
- `octoguard.command_invoked`
- `octoguard.report_filed` (Module 7)
- `octoguard.report_actioned`

---

## Module 5 (optionnel) : Webhook sortant

Inchangé. POST signé HMAC-SHA256 vers URL admin. Singleton `octoguard_webhook`.

---

## Module 6 (NOUVEAU) : Mute / Timeout chat

**Manquant identifié dans l'audit**. Aucun système actuel n'empêche un user de poster (à part le ban global ou la déconnexion socket).

### Table `chat_mutes`

```sql
CREATE TABLE chat_mutes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id    UUID REFERENCES channels(id) ON DELETE CASCADE,  -- NULL = mute global communauté
  reason        TEXT,
  applied_by    UUID REFERENCES users(id) ON DELETE SET NULL,    -- NULL si action OctoGuard auto
  applied_at    TIMESTAMPTZ DEFAULT NOW(),
  expires_at    TIMESTAMPTZ                                       -- NULL = perm
);
CREATE INDEX idx_chat_mutes_user_active
  ON chat_mutes(user_id) WHERE expires_at IS NULL OR expires_at > NOW();
CREATE INDEX idx_chat_mutes_channel ON chat_mutes(channel_id);
```

### Application

- **Pipeline `chat:send`** : avant de processer le message, check rapide en cache RAM (LRU par userId) : "ce user est-il muted dans ce channel ou globalement ?". Si oui, emit `chat:blocked` avec reason `muted_until: ISO`.
- **Cache RAM** : `Map<userId, MuteEntry[]>` avec TTL 60s, rechargé à la volée. Invalidation pub/sub sur INSERT/DELETE.
- **Auto-cleanup** : worker `setInterval(60_000, purgeExpiredMutes)` qui DELETE les mutes expirés et publie l'invalidation.

### Actions admin

| Méthode | Route | Description |
|---|---|---|
| POST | `/admin/octoguard/mutes` | Mute un user (params: user_id, channel_id?, duration, reason) |
| DELETE | `/admin/octoguard/mutes/:id` | Unmute |
| GET | `/admin/octoguard/mutes?active=true` | Liste mutes actifs |

---

## Module 7 (NOUVEAU) : Reports utilisateur

**Manquant identifié dans l'audit**. Aucun système permettant à un user de signaler un message ou un autre user.

### Table `reports`

```sql
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  target_type   VARCHAR(32) NOT NULL
    CHECK (target_type IN ('message', 'user', 'thread', 'post', 'dm_message')),
  target_id     UUID NOT NULL,
  reason        TEXT NOT NULL,
  category      VARCHAR(32),                                     -- spam, harassment, hate, illegal, other
  status        VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  resolution    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_reports_status_created ON reports(status, created_at DESC);
CREATE INDEX idx_reports_target         ON reports(target_type, target_id);
```

### UX

- Sur un message chat, menu contextuel "Signaler ce message". Formulaire bref : catégorie + raison.
- Sur un profil utilisateur, "Signaler ce membre".
- Côté admin : page `/admin/octoguard/reports` avec inbox triée par date, actions inline (Marquer résolu / Banner / Mute / Supprimer le contenu / Rejeter).

### Anti-abuse (paramétrable par l'admin)

Stocké dans une config singleton `reports_settings` :
- `rate_limit_per_hour` (défaut 5, modifiable)
- `cooldown_per_target_hours` (défaut 24, modifiable)
- `enabled` (défaut true)

L'admin peut totalement assouplir ou désactiver ces protections depuis l'UI. Valeurs par défaut raisonnables, pas imposées.

---

## Routes API

Préfixe : `/api/v1/admin/octoguard`, middleware `adminOnly`.

| Méthode | Route | Description |
|---|---|---|
| GET | `/rules` | Liste règles auto-mod |
| POST | `/rules` | Créer règle |
| PUT | `/rules/:id` | Modifier règle |
| DELETE | `/rules/:id` | Supprimer règle |
| GET | `/welcome` | Lire config welcome |
| PUT | `/welcome` | Modifier config welcome |
| GET | `/commands` | Liste commandes |
| POST | `/commands` | Créer commande |
| PUT | `/commands/:id` | Modifier commande |
| DELETE | `/commands/:id` | Supprimer commande |
| GET | `/mutes?active=true&user_id=` | Liste mutes |
| POST | `/mutes` | Mute user |
| DELETE | `/mutes/:id` | Unmute |
| GET | `/logs?action=&user_id=&from=&to=&page=` | Logs OctoGuard (filtre `admin_audit_log WHERE action LIKE 'octoguard.%'`) |
| POST | `/logs/:id/undo` | Annuler une action |
| GET | `/webhook` | Lire config webhook |
| PUT | `/webhook` | Modifier webhook |
| POST | `/bench` | Bench perf interne |

### Reports (REST public + admin)

| Méthode | Route | Description |
|---|---|---|
| POST | `/api/v1/reports` | Soumettre un report (requireAuth) |
| GET | `/api/v1/admin/octoguard/reports?status=open` | Inbox admin |
| PATCH | `/api/v1/admin/octoguard/reports/:id` | Marquer résolu / actioned / dismissed |

---

## Pipeline d'exécution

Hook dans `nodyx-core/src/socket/index.ts` sur l'event `chat:send`, après le rate-limit burst existant ligne 398 et avant le `addMessage` ligne ~450.

```typescript
socket.on('chat:send', async (data) => {
  // 1. Rate limit burst EXISTANT (intact)
  const rateLimitMs = checkRateLimit(userId, 'chat:send')
  if (rateLimitMs > 0) { socket.emit('chat:rate_limited', { retryAfter: rateLimitMs }); return }

  // 2. Filtre haineux hard-codé EXISTANT (intact)
  const sanitized = sanitizeHtml(data.content)
  const hate = checkHtmlContent(sanitized)
  if (!hate.ok) { socket.emit('chat:blocked', { reason: hate.reason }); return }

  // 3. NOUVEAU : check mute (Module 6)
  if (isUserMuted(userId, channelId)) {
    socket.emit('chat:blocked', { reason: 'muted_until_iso' })
    return
  }

  // 4. NOUVEAU : pipeline OctoGuard (Modules 1, 3)
  const og = await octoguardPipeline({ message: sanitized, userId, channelId })
  if (og.blocked) { socket.emit('chat:blocked', { reason: og.reason, event_id: og.event_id }); return }
  if (og.command_response) { /* envoyer la réponse de commande custom */ return }

  // 5. Suite normale (intact)
  const message = await ChannelModel.addMessage({ ... })
  io.to(`channel:${channelId}`).emit('chat:message', message)
})
```

**Pipeline OctoGuard** wrappé dans `Promise.race([pipeline(), timeout(50)])`. Si timeout : bypass + warning + telemetry `octoguard.pipeline.timeout`.

---

## Migrations SQL

### Migration 088 : `expires_at` sur `community_bans`

Légère, **utile pour TOUT le projet** (pas que OctoGuard).

```sql
BEGIN;

ALTER TABLE community_bans
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_community_bans_expires
  ON community_bans(expires_at) WHERE expires_at IS NOT NULL;

-- Worker purge des bans expirés ailleurs (cf. scheduler.ts)

COMMIT;
```

### Migration 089 : tables OctoGuard

```sql
BEGIN;

-- Règles auto-mod
CREATE TABLE octoguard_automod_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(100) NOT NULL,
  type                  VARCHAR(32) NOT NULL
    CHECK (type IN ('regex','caps','link_domain','mention_spam','link_spam')),
  params                JSONB NOT NULL DEFAULT '{}'::jsonb,
  action                VARCHAR(32) NOT NULL
    CHECK (action IN ('delete','warn','mute','ban_temp','notify_only','report_only')),
  action_duration       VARCHAR(16),
  escalation            JSONB,
  immunized_role_types  TEXT[] DEFAULT ARRAY['owner','admin','moderator'],
  immunized_grade_ids   UUID[] DEFAULT '{}',
  dry_run               BOOLEAN DEFAULT false,
  enabled               BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Welcome (singleton)
CREATE TABLE octoguard_welcome (
  id              INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  channel_id      UUID,
  public_message  TEXT,
  dm_message      TEXT,
  dm_enabled      BOOLEAN DEFAULT false,
  auto_grade_id   UUID REFERENCES grades(id) ON DELETE SET NULL,
  enabled         BOOLEAN DEFAULT false,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Commandes custom
CREATE TABLE octoguard_commands (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  command          VARCHAR(64) NOT NULL UNIQUE,
  response         TEXT NOT NULL,
  cooldown_seconds INT DEFAULT 5 CHECK (cooldown_seconds >= 0),
  allowed_channels UUID[],
  allowed_roles    TEXT[],
  enabled          BOOLEAN DEFAULT true,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Warns (avec escalation)
CREATE TABLE octoguard_warns (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id    UUID REFERENCES octoguard_automod_rules(id) ON DELETE SET NULL,
  reason     TEXT,
  cleared_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mutes (Module 6)
CREATE TABLE chat_mutes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  reason     TEXT,
  applied_by UUID REFERENCES users(id) ON DELETE SET NULL,
  applied_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);
CREATE INDEX idx_chat_mutes_user_active
  ON chat_mutes(user_id) WHERE expires_at IS NULL OR expires_at > NOW();
CREATE INDEX idx_chat_mutes_channel ON chat_mutes(channel_id);

-- Reports (Module 7)
CREATE TABLE reports (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id   UUID NOT NULL REFERENCES users(id) ON DELETE SET NULL,
  target_type   VARCHAR(32) NOT NULL
    CHECK (target_type IN ('message', 'user', 'thread', 'post', 'dm_message')),
  target_id     UUID NOT NULL,
  reason        TEXT NOT NULL,
  category      VARCHAR(32),
  status        VARCHAR(16) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  reviewed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at   TIMESTAMPTZ,
  resolution    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_reports_status_created ON reports(status, created_at DESC);
CREATE INDEX idx_reports_target         ON reports(target_type, target_id);

-- Webhook out (singleton)
CREATE TABLE octoguard_webhook (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url        TEXT,
  secret     TEXT,
  enabled    BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Settings reports (anti-abuse paramétrable, singleton)
CREATE TABLE reports_settings (
  id                        INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  rate_limit_per_hour       INT NOT NULL DEFAULT 5 CHECK (rate_limit_per_hour >= 0),
  cooldown_per_target_hours INT NOT NULL DEFAULT 24 CHECK (cooldown_per_target_hours >= 0),
  enabled                   BOOLEAN NOT NULL DEFAULT true,
  updated_at                TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO reports_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Settings filtre haineux (admin-freedom : désactivable)
-- Géré via env NODYX_HATE_FILTER_ENABLED ou via table community_settings
-- (à créer si elle n'existe pas, voir audit avant d'ajouter)

COMMIT;
```

**Note importante** : pas de table `octoguard_logs`. Tout passe par `admin_audit_log` existante.

---

## Organisation fichiers

### Backend (`nodyx-core/`)

```
src/
├── services/
│   └── octoguard/
│       ├── index.ts          # init, hook pipeline, cache rules
│       ├── automod.ts        # matchers + applyAction
│       ├── welcome.ts        # service on user signup
│       ├── commands.ts       # detection !cmd + cooldown
│       ├── mutes.ts          # cache + check + apply
│       ├── reports.ts        # CRUD + anti-abuse
│       ├── envMigration.ts   # one-shot import BLOCKED_CONTENT_PATTERNS → DB
│       ├── webhook.ts        # POST out + HMAC
│       └── bench.ts          # script perf (1000 msg/s)
├── routes/
│   └── octoguard.ts          # admin API + reports public
├── socket/
│   └── index.ts              # hook (modifié pour appeler pipeline)
├── locales/
│   ├── octoguard.fr.json
│   └── octoguard.en.json
└── migrations/
    ├── 088_community_bans_expires_at.sql
    └── 089_octoguard_phase1.sql
```

### Frontend (`nodyx-frontend/`)

```
src/routes/admin/octoguard/
├── +page.svelte              # vue d'ensemble + onglets
├── +page.server.ts
├── automod/+page.svelte
├── welcome/+page.svelte
├── commands/+page.svelte
├── mutes/+page.svelte
├── reports/+page.svelte
└── logs/+page.svelte
```

---

## i18n

- Backend : `nodyx-core/locales/octoguard.{fr,en}.json` chargés au boot.
- Events Socket.IO **n'envoient pas de texte localisé**. Ils envoient `i18n_key + params + event_id` ; le front résout.
- Clés type : `octoguard.message.deleted`, `octoguard.mute.applied`, `octoguard.warn.given`.

---

## Roadmap

| Phase | Contenu | Délai estimé |
|---|---|---|
| **Phase 1** (cette spec) | Auto-mod + Welcome + Commandes + Mute + Reports + Webhook | ≤ 2 semaines |
| Phase 2 | XP / niveaux / leaderboard (SQLite isolée) | +2 semaines |
| Phase 3 | Forums (auto-mod threads/posts), reaction roles, posts programmés, triggers texte, **voice metadata sans audio** (yudin-s) | +3 semaines |
| Phase 4 | Bot API v1 externe (REST + Socket.IO + SDK Python) + WebRTC voice bot (`aiortc`) | non daté |

### Pourquoi SQLite séparée Phase 2

Le système d'XP écrit à très haute fréquence. Isoler dans une SQLite OctoGuard offre :
- Aucune pollution Postgres par une table `xp_users` qui grossit.
- Désactivation propre de l'XP (détacher le `.sqlite`).
- Backup/restore indépendant.
- Admins refusant la gamification : zéro table parasite Postgres.

**Tradeoff** : pas de JOIN SQL `users ↔ xp_users`. Géré en deux requêtes + fusion code.

---

## Limitations explicites Phase 1

- Pas de bot vocal (Phase 4).
- Pas d'XP / leveling (Phase 2).
- Pas de couverture forums (Phase 3) ; auto-mod sur chat uniquement.
- Pas d'embed riche dans les commandes (markdown brut).
- Pas d'API externe pour bots tiers (Phase 4).
- Pas de `kick` Discord-style (n'existe pas dans le modèle Nodyx ; `ban_temp` avec durée courte fait équivalent fonctionnel).
- Pas d'anti-flood paramétrable côté OctoGuard (déjà couvert par `socket/rateLimiter.ts`).

---

## Critères d'acceptation

1. Un admin crée une règle regex anti-mot. Un message contenant le mot est supprimé et logué dans `admin_audit_log` avec `action='octoguard.delete_message'`.
2. Welcome activé : un nouvel inscrit reçoit le message public, et (si activé) un DM système avec badge `[Système]`.
3. Commande `!regles` créée et invocable avec cooldown respecté.
4. Logs admin (`/admin/octoguard/logs`) affichent toutes les actions OctoGuard et permettent l'**Undo** pour les actions réversibles.
5. Un utilisateur `owner`/`admin`/`moderator` n'est jamais affecté par les règles.
6. Bench `npm run bench:octoguard` valide **p95 < 5ms** sur 1000 msg/s pendant 60s.
7. Migrations 088 + 089 s'exécutent proprement sur une base à 087, idempotentes (DO block + IF NOT EXISTS).
8. Règle en `dry_run: true` log avec `metadata.would_be: true`, n'exécute pas l'action.
9. Webhook out reçoit POST signé HMAC-SHA256 pour chaque action.
10. `OCTOGUARD_ENABLED=false` court-circuite tout (latence ajoutée = 0 vérifiée).
11. Mute applied : le user reçoit `chat:blocked` avec `muted_until: ISO` et ne peut plus poster.
12. Mute expire automatiquement (worker purge).
13. Report soumis par un user, visible dans inbox admin, action prise, status mis à jour.
14. **Aucune table doublon** créée vs existant : pas de `octoguard_logs`, pas de duplication de `community_bans`, pas de duplication de filtre haineux.

---

## Notes d'implémentation

- **Cache règles** : `Map<id, CompiledRule>` en RAM, invalidé via Redis pub/sub `octoguard:invalidate` à chaque CRUD admin.
- **Cache immunisation** : LRU TTL 30s par `user_id`, valeur `{ role, grade_ids[] }`.
- **Cache mutes** : LRU TTL 60s par `user_id`, valeur `MuteEntry[]`.
- **Logs async via Redis queue** : `LPUSH octoguard:logqueue` non bloquant. Worker `setInterval(1000, flushBatch)` `RPOP` jusqu'à 100 entries, insert batch dans `admin_audit_log`.
- **`event_id` partout** : UUID v4 généré côté backend, inclus dans chaque event Socket.IO `chat:blocked`, `octoguard:action_taken`, et dans `metadata.event_id` de chaque ligne `admin_audit_log`.
- **Webhook HMAC** : header `X-Octoguard-Signature: sha256=<hex>` sur body JSON brut.
- **ReDoS protection** : regex admin compilées avec `re2` ou wrapper timeout 100ms.
- **Tests** :
  - Unit : matchers (regex, caps, link_domain, mention_spam, link_spam).
  - Integration : pipeline complet sur Socket.IO mock.
  - Bench : `services/octoguard/bench.ts` simule 1000 msg/s pendant 60s, asserte p95 < 5ms.

---

## Changements v2.0 → v2.1 (admin-freedom)

- **AJOUTÉ** : section "Principe fondamental : admin-freedom" en tête de spec, qui pose l'architecture éthique à deux niveaux (instance libre, annuaire curé).
- **CHANGÉ** : filtre haineux `contentFilter.ts` devient désactivable via env `NODYX_HATE_FILTER_ENABLED` ou setting DB, derrière une modale d'avertissement (friction informée, pas blocage). Admin assume sa responsabilité légale.
- **CHANGÉ** : `OCTOGUARD_ENABLED` par défaut `false`. Table `octoguard_automod_rules` part vide. Aucune règle préchargée, aucune politique imposée.
- **CHANGÉ** : durées de sanctions deviennent libres (format `{value, unit}`), plus d'enum strict 15m/1h/etc.
- **AJOUTÉ** : action `notify_only` qui ne touche pas l'utilisateur, log + webhook admin seulement.
- **AJOUTÉ** : anti-abuse reports paramétrable (`reports_settings` singleton, valeurs par défaut configurables et désactivables).
- **NOTÉ** : la modération éthique du réseau Nodyx se fait via le directory (spec 018-directory-moderation à venir), pas dans OctoGuard.

---

## Changements v1.1 → v2.0 (audit-based)

- **SUPPRIMÉ** : table `octoguard_logs`, logs unifiés dans `admin_audit_log` existante.
- **SUPPRIMÉ** : règle de type `flood`, couvert par `socket/rateLimiter.ts` existant.
- **AJOUTÉ** : Module 6 Mute / Timeout (manquant identifié dans l'audit).
- **AJOUTÉ** : Module 7 Reports utilisateur (manquant identifié dans l'audit).
- **AJOUTÉ** : `event_id` dans toutes les actions et events (proposition yudin-s).
- **AJOUTÉ** : compatibilité descendante avec `BLOCKED_CONTENT_PATTERNS` env var.
- **CHANGÉ** : `ban_temp` utilise `community_bans` + `expires_at` (migration 088 légère, utile globalement).
- **PRÉCISÉ** : pipeline Socket.IO chat:send avec point de hook exact (après rate-limit existant ligne 398, avant addMessage).
- **PRÉCISÉ** : Phase 3 inclut voice metadata sans audio (proposition yudin-s).
- **PRÉCISÉ** : la couche burst rate-limit reste dans `socket/rateLimiter.ts`, OctoGuard est la couche **contenu** par-dessus.
