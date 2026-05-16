# OctoGuard, modérateur automatique pour Nodyx

**Version** : 1.1 (Phase 1, livrable pour migration)
**Statut** : Spécification technique
**Mascotte** : pieuvre Nodyx + bouclier
**Objectif** : système natif de modération automatique, bienvenue et commandes personnalisées, intégré au core Nodyx, sans dépendance à un bot externe.
**Cible de livraison** : ≤ 2 semaines.

---

## Contexte & contraintes Nodyx

- **Mono-tenant strict** : Nodyx applique "une instance = une communauté". Pas de `guildId`, pas de multi-tenant. Toute la config OctoGuard est globale à l'instance.
- **Identifiants UUID** partout (cohérence avec le reste du schéma).
- **Système de rôles à 2 étages** : `users.role` (enum `owner`/`admin`/`moderator`/`member`) + table `grades` (grades custom communautaires). OctoGuard gère les deux dans ses listes d'immunisation.
- **Voice WebRTC P2P mesh** : pas de bot vocal possible avant Phase 4 (peer WebRTC headless via `aiortc`).
- **DMs E2E (ECDH P-256 + AES-GCM v2.0.0)** : une exception encadrée est faite pour le welcome DM, marqué `is_system: true` et affiché avec un badge `[Système]` côté UI.
- **Pas de notion de `kick`** : on n'a pas le modèle "rejoindre/quitter un serveur" Discord. On utilise `ban_temp` (table `community_bans` existante + `expires_at`).
- **Pas d'embed riche** : messages chat = markdown brut. Les commandes répondent en markdown texte.
- **Bot API v1 externe** : reportée Phase 4. OctoGuard couvre le besoin natif.
- **XP / niveaux / leaderboard** : reportés Phase 2.
- **Scope Phase 1 = chat uniquement.** Les forums (catégories/threads) sont en Phase 3.

---

## Principes généraux

- **Pipeline message** : tout event Socket.IO `chat:send` passe par OctoGuard **avant** le broadcast.
- **Performance cible** : p95 < 5ms de latence ajoutée par message.
- **Timeout de sécurité** : si le pipeline dépasse **50ms**, on bypass OctoGuard et on logue un warning. Jamais bloquer le chat.
- **Cache RAM** des règles compilées, invalidé via Redis pub/sub à chaque CRUD.
- **Logs asynchrones** : push dans une queue Redis, worker flush par batch (jamais d'INSERT bloquant dans le pipeline).
- **Mode dry-run** : action `report_only` ou flag `dry_run: true` qui log ce qui serait fait sans agir. Indispensable pour tester une regex sans bannir 200 personnes.
- **Undo** : chaque ligne de log propose un bouton "annuler" (sauf delete, irréversible).
- **Réutilisation** : OctoGuard appelle les services modération existants (`community_bans`, mute si présent). Ne duplique pas le système de ban.
- **Kill switch** : env `OCTOGUARD_ENABLED=false` court-circuite tout le pipeline (latence ajoutée = 0).
- **Redis keyPrefix** : le client redis Nodyx a déjà `keyPrefix: 'nodyx:'`. Les clés OctoGuard sont écrites **sans** ce préfixe dans le code (ex: `octoguard:rules`), sinon double préfixe.

---

## Module 1 : Auto-modération

### Types de règles

| Type | Paramètres | Actions possibles |
|------|------------|-------------------|
| `regex` | `pattern`, `flags` (string) | delete, warn, mute, ban_temp |
| `flood` | `messages`, `seconds` | mute, ban_temp |
| `caps` | `min_length`, `threshold_percent` | delete, warn |
| `link_domain` | `mode: whitelist\|blacklist`, `domains: []` | delete, warn, mute |
| `mention_spam` | `max_mentions` | delete, mute |
| `link_spam` | `max_links` | delete, warn |

### Actions

- **`delete`** : supprime le message. Émet un event Socket.IO privé à l'auteur (`octoguard:action_taken` avec `i18n_key`).
- **`warn`** : enregistre un avertissement (`octoguard_warns`). À N warns sur fenêtre glissante, escalade automatique (configurable par règle).
- **`mute`** : restreint le chat via le service mute (ou table dédiée si absent). Durées : `15m`, `1h`, `6h`, `1d`, `7d`, `perm`.
- **`ban_temp`** : appelle le service `community_bans` avec `expires_at`. Mêmes durées.
- **`report_only`** : aucune action, log avec `would_be: true`. Mode dry-run.

Le `kick` Discord n'a pas d'équivalent dans Nodyx, **pas implémenté**.

### Format JSON d'une règle (colonne `params` JSONB)

```json
{
  "name": "Anti gros mots",
  "type": "regex",
  "params": { "pattern": "\\b(merde|connard)\\b", "flags": "i" },
  "action": "delete",
  "action_duration": null,
  "escalation": { "warns_threshold": 3, "window_days": 7, "action": "mute", "duration": "1h" },
  "immunized_role_types": ["owner", "admin", "moderator"],
  "immunized_grade_ids": ["uuid-grade-vip"],
  "enabled": true,
  "dry_run": false
}
```

Anti-flood :
```json
{
  "name": "Anti-flood",
  "type": "flood",
  "params": { "messages": 5, "seconds": 10 },
  "action": "mute",
  "action_duration": "15m"
}
```

Par défaut, `owner` / `admin` / `moderator` sont immunisés. Les grades custom sont opt-in.

---

## Module 2 : Welcome

### Comportement

- **Message public** dans un channel chat configuré.
- **DM système** (optionnel) : message non chiffré marqué `is_system: true`. Exception explicite au flux E2E. L'UI affiche un badge `[Système]` distinctif.
- **Auto-grade** : attribution d'un `grade_id` par défaut à l'inscription.
- **Variables** : `{user}`, `{userMention}`, `{communityName}`, `{rulesUrl}`.

### Config (table singleton)

```json
{
  "channel_id": "uuid",
  "public_message": "Bienvenue {userMention} sur {communityName} !",
  "dm_message": "Salut {user}, voici le règlement : {rulesUrl}",
  "dm_enabled": true,
  "auto_grade_id": "uuid-grade-newcomer",
  "enabled": true
}
```

---

## Module 3 : Commandes custom

### Principe

Un membre tape `!commande` dans le chat. OctoGuard répond avec un message texte/markdown. Pas d'embed (non supporté par Nodyx).

### Interface admin

- Nom (sans `!`)
- Réponse (markdown brut)
- Cooldown par utilisateur (secondes, 0 = pas de cooldown)
- Channels autorisés (NULL = tous)
- Rôles/grades autorisés (NULL = tous)
- Toggle on/off

Cooldown stocké côté Redis : `octoguard:cooldown:{commandId}:{userId}` avec TTL.

---

## Module 4 : Logs & Undo

Toutes les actions OctoGuard sont enregistrées dans `octoguard_logs`. UI admin avec filtres (utilisateur, action, date, règle).

### Undo

- `mute`, `ban_temp`, `warn` : annulables en un clic (le log gagne `undone_at` + `undone_by`).
- `delete` : irréversible (le message est définitivement supprimé). Bouton désactivé.

### Asynchrone

Pour ne pas bloquer le pipeline, les inserts logs passent par une **queue Redis** :
- Push : `LPUSH octoguard:logqueue {json}` non bloquant.
- Worker périodique (toutes les 1s) qui `RPOP` jusqu'à 100 entrées et fait un INSERT batch.

---

## Module 5 (optionnel) : Webhook sortant

Pour chaque action OctoGuard, possibilité de POST vers un URL externe (admin Discord, ntfy, Slack, etc.).

Payload :
```json
{
  "action": "mute",
  "user_id": "uuid",
  "username": "...",
  "rule": "Anti pub",
  "reason": "...",
  "duration": "15m",
  "at": "2026-05-16T10:32:00Z"
}
```

Signature HMAC-SHA256 dans header `X-Octoguard-Signature` (secret partagé). Configurable globalement (singleton).

---

## Routes API

Préfixe : `/api/v1/admin/octoguard`, middleware `adminOnly`.

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/rules` | Liste règles |
| POST | `/rules` | Créer règle |
| PUT | `/rules/:id` | Modifier règle |
| DELETE | `/rules/:id` | Supprimer règle |
| GET | `/welcome` | Lire config welcome |
| PUT | `/welcome` | Modifier config welcome |
| GET | `/commands` | Liste commandes |
| POST | `/commands` | Créer commande |
| PUT | `/commands/:id` | Modifier commande |
| DELETE | `/commands/:id` | Supprimer commande |
| GET | `/logs?action=&user_id=&from=&to=&page=` | Logs paginés |
| POST | `/logs/:id/undo` | Annuler une action |
| GET | `/webhook` | Lire config webhook |
| PUT | `/webhook` | Modifier webhook |
| POST | `/bench` | Lance le bench perf (interne, admin only) |

---

## Pipeline d'exécution

Hook dans `nodyx-core/src/socket/index.ts` sur l'event `chat:send`, **avant broadcast**.

```typescript
async function octoGuardPipeline(message: ChatMessage, user: User): Promise<PipelineResult> {
  if (!process.env.OCTOGUARD_ENABLED) return { allow: true }

  const start = performance.now()

  // 1. Cache RAM des règles (invalidation Redis pub/sub sur CRUD)
  const rules = getRulesCache()

  // 2. Cache immunisation (LRU TTL 30s)
  if (isImmunized(user)) return { allow: true }

  // 3. Évaluation séquentielle, premier match gagne
  for (const rule of rules.filter(r => r.enabled)) {
    if (matches(rule, message, user)) {
      const wouldBe = rule.dry_run || rule.action === 'report_only'
      if (!wouldBe) await applyAction(rule, user, message)
      logAsync({ action: rule.action, rule_id: rule.id, would_be: wouldBe, ... })
      metrics.observe('octoguard.pipeline.ms', performance.now() - start)
      return { allow: wouldBe || rule.action !== 'delete' }
    }
  }

  metrics.observe('octoguard.pipeline.ms', performance.now() - start)
  return { allow: true }
}
```

**Timeout de sécurité** : le hook enveloppe l'appel dans `Promise.race([pipeline(), timeout(50)])`. Si timeout, bypass + warning.

---

## Migration SQL

`nodyx-core/src/migrations/085_octoguard_phase1.sql`

```sql
-- OctoGuard Phase 1, mono-tenant (une instance = une communauté)

CREATE TABLE octoguard_automod_rules (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(100) NOT NULL,
  type                  VARCHAR(32) NOT NULL
    CHECK (type IN ('regex','flood','caps','link_domain','mention_spam','link_spam')),
  params                JSONB NOT NULL DEFAULT '{}'::jsonb,
  action                VARCHAR(32) NOT NULL
    CHECK (action IN ('delete','warn','mute','ban_temp','report_only')),
  action_duration       VARCHAR(16),
  escalation            JSONB,
  immunized_role_types  TEXT[] DEFAULT ARRAY['owner','admin','moderator'],
  immunized_grade_ids   UUID[] DEFAULT '{}',
  dry_run               BOOLEAN DEFAULT false,
  enabled               BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

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

CREATE TABLE octoguard_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action          VARCHAR(32) NOT NULL,
  rule_id         UUID REFERENCES octoguard_automod_rules(id) ON DELETE SET NULL,
  channel_id      UUID,
  message_excerpt TEXT,
  reason          TEXT,
  duration        VARCHAR(16),
  would_be        BOOLEAN DEFAULT false,
  undone_at       TIMESTAMPTZ,
  undone_by       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE octoguard_warns (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id     UUID REFERENCES octoguard_automod_rules(id) ON DELETE SET NULL,
  reason      TEXT,
  cleared_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE octoguard_webhook (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  url        TEXT,
  secret     TEXT,
  enabled    BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_octoguard_logs_user    ON octoguard_logs(user_id, created_at DESC);
CREATE INDEX idx_octoguard_logs_action  ON octoguard_logs(action, created_at DESC);
CREATE INDEX idx_octoguard_warns_user   ON octoguard_warns(user_id) WHERE cleared_at IS NULL;
CREATE INDEX idx_octoguard_commands_cmd ON octoguard_commands(command) WHERE enabled = true;
```

Note : `octoguard_welcome` et `octoguard_webhook` utilisent le pattern singleton (`id = 1 CHECK`) puisque la configuration est globale à l'instance.

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
│       ├── logs.ts           # queue async writer
│       ├── webhook.ts        # POST out + HMAC
│       └── bench.ts          # script perf (1000 msg/s)
├── routes/
│   └── octoguard.ts          # admin API
├── socket/
│   └── index.ts              # hook avant broadcast chat:send
├── locales/
│   ├── octoguard.fr.json
│   └── octoguard.en.json
└── migrations/
    └── 085_octoguard_phase1.sql
```

### Frontend (`nodyx-frontend/`)

```
src/routes/admin/octoguard/
├── +page.svelte              # navigation onglets
├── +page.server.ts           # load global
├── automod/+page.svelte
├── welcome/+page.svelte
├── commands/+page.svelte
└── logs/+page.svelte
```

---

## i18n

Réutilise le système existant Nodyx :

- Backend : fichiers `nodyx-core/locales/octoguard.{fr,en}.json` chargés au démarrage.
- Les events Socket.IO `octoguard:action_taken` n'envoient **pas de texte localisé**. Ils envoient une `i18n_key` + `params` ; le front résout.
- Exemples de clés : `octoguard.message.deleted`, `octoguard.mute.applied`, `octoguard.warn.given`.

---

## Roadmap

| Phase | Contenu | Délai estimé |
|-------|---------|--------------|
| **Phase 1** (cette spec) | Auto-mod + Welcome + Commandes + Logs + Webhook | ≤ 2 semaines |
| Phase 2 | XP / niveaux / leaderboard (SQLite isolée) | +2 semaines |
| Phase 3 | Forums (auto-mod threads/posts), reaction roles, posts programmés, triggers texte | +3 semaines |
| Phase 4 | Bot API v1 externe (REST + Socket.IO + SDK Python) + WebRTC voice bot (`aiortc`) | non daté |

### Pourquoi une SQLite séparée pour la Phase 2 (XP)

Le système d'XP écrit à très haute fréquence (chaque message du chat = lookup + update). Isoler ces tables dans une SQLite dédiée OctoGuard offre :

- Aucune pollution de la DB Postgres principale par une table `xp_users` qui grossit indéfiniment.
- Désactivation propre de l'XP sans toucher au core (détacher le fichier `.sqlite`).
- Backup/restore indépendant de la donnée "addictive".
- Les admins refusant la gamification ont zéro table parasite côté Postgres.

**Tradeoff** : pas de JOIN SQL `users` ↔ `xp_users`. À gérer en deux requêtes + fusion en code (lookup batch par UUID, cache LRU si besoin).

---

## Limitations explicites Phase 1

- Pas de bot vocal (Phase 4)
- Pas d'XP / leveling (Phase 2)
- Pas de couverture forums (Phase 3) ; auto-mod sur chat uniquement
- Pas d'embed riche dans les commandes (markdown brut)
- Pas d'API externe pour bots tiers (Phase 4)
- Pas de `kick` (n'existe pas dans le modèle Nodyx, équivalent fonctionnel = `ban_temp 5m`)

---

## Critères d'acceptation

1. Un admin crée une règle regex "anti-gros-mot". Un message contenant ce mot est supprimé et logué.
2. Un admin active la welcome. Un nouvel inscrit reçoit le message public et (si activé) le DM système avec badge `[Système]`.
3. Un admin crée la commande `!regles`. Tout membre peut l'invoquer avec cooldown respecté.
4. Un admin consulte les logs avec filtres et peut undo un mute en un clic.
5. Les utilisateurs `owner` / `admin` / `moderator` ne sont jamais affectés par les règles.
6. Le bench `npm run bench:octoguard` valide **p95 < 5ms** avec 1000 messages/s simulés sur 60s.
7. La migration 085 s'exécute proprement sur une base existante à 084.
8. Une règle en `dry_run: true` log les actions sans les exécuter (`would_be: true` en base).
9. Le webhook (si activé) reçoit un POST avec signature HMAC-SHA256 valide pour chaque action.
10. Désactiver via `OCTOGUARD_ENABLED=false` court-circuite tout le pipeline (zéro latence ajoutée vérifiée par le bench).

---

## Notes d'implémentation

- **Cache règles** : `Map<id, CompiledRule>` en RAM. Invalidé via Redis pub/sub sur channel `octoguard:invalidate` à chaque CRUD admin.
- **Cache immunisation** : LRU avec TTL 30s par `user_id`, valeur = `{ role, grade_ids[] }`. Rechargé à la volée.
- **Anti-flood** : `Map<userId, number[]>` en RAM, timestamps glissants, purge au write.
- **Logs async** : `LPUSH octoguard:logqueue {json}` non bloquant ; worker `setInterval(1000, flushBatch)` `RPOP` jusqu'à 100 entries et INSERT batch.
- **Webhook HMAC** : signature header `X-Octoguard-Signature: sha256=<hex>` calculée sur le body JSON brut + secret.
- **Tests** :
  - Unit : matchers (regex, flood, caps, link_domain, mention_spam, link_spam).
  - Integration : pipeline complet sur Socket.IO mock.
  - Bench : `services/octoguard/bench.ts` génère 1000 msg/s pendant 60s, asserte p95.
- **Telemetry** : compteurs `octoguard.actions.{action_type}.count`, histogramme `octoguard.pipeline.ms`.
- **Sécurité** : les regex admin sont compilées avec timeout (`re2` ou wrapper avec setTimeout) pour prévenir ReDoS.
