# OctoGuard — Session B : Cahier des charges (pipeline auto-mod)

**Référence spec parente** : `docs/specs/016-Octoguard/016-OctoGuard.md` v2.1.1
**Branche cible** : `feat/octoguard-phase-1`
**Estimation** : 1h30 à 2h
**Statut** : draft, en attente de validation Jonathan avant le code

---

## 1. Objectifs de Session B

À la fin de cette session, sur une instance Nodyx en local ou en prod :

1. Un admin peut créer manuellement une règle auto-mod dans la table `octoguard_automod_rules` (via SQL direct pour cette session, UI Session D).
2. Quand un message arrive dans `chat:send`, OctoGuard évalue les règles actives et applique la première qui match.
3. Les actions `delete`, `warn`, `notify_only`, `report_only` sont **fonctionnelles end-to-end**.
4. Les actions `mute` et `ban_temp` sont **stubbées** (logguent + bloquent comme `delete`, mais ne touchent pas encore aux tables `chat_mutes` / `community_bans`). Implémentation réelle en Session C.
5. Le système est **désactivable** via `OCTOGUARD_ENABLED=false` (défaut).
6. Le pipeline ne dégrade **jamais** le chat : timeout 50ms, bypass en cas d'erreur, jamais bloquer.
7. Le `tsc` build passe sans erreur.

**Critère d'acceptation explicite** : avec une règle regex `\bfreshtest\b` active et action `delete`, un message "hello freshtest" est supprimé silencieusement (pas broadcast) et logué dans `admin_audit_log`. Un message "hello world" passe normalement.

## 2. Hors-scope de Session B (explicite)

- **Pas de UI admin** (Session D).
- **Pas d'API REST admin pour CRUD règles** (Session D).
- **Pas de `mute` ni `ban_temp` réels** : stub seulement, on log "TODO Session C".
- **Pas de welcome / commandes / reports / webhook** (Sessions C et D).
- **Pas de envMigration BLOCKED_CONTENT_PATTERNS** (Session C).
- **Pas de Redis pub/sub** : Phase 1 mono-instance, invalidation directe in-process.
- **Pas de worker async pour les logs** : INSERT direct synchrone dans `admin_audit_log`. Optimisation queue Redis = Phase 4+ si besoin.
- **Pas de tests unitaires Vitest** dans cette session : un test smoke manuel suffit. Tests Vitest = session de stabilisation après Phase 1.
- **Pas de cache utilisateur** (role/grades). On fetch à chaque message pour Session B. Optim possible si bench montre un goulot.
- **Pas de ReDoS protection avec `re2`** : pour Session B, on compile avec RegExp natif + un timeout wrapper soft. `re2` à évaluer en stabilisation (lib npm `node-re2` nécessite compilation native).

## 3. Modules à créer

### 3.1 `services/octoguard/matchers.ts` (fonctions pures)

5 matchers indépendants, signature identique :

```ts
export interface MatchContext {
  content: string  // contenu sanitisé (post-sanitize HTML)
}

export interface MatchResult {
  matched: true
  excerpt: string  // extrait pertinent pour le log
}

export type Matcher = (ctx: MatchContext, params: AutomodRuleParams) => MatchResult | null

export const matchRegex:        Matcher
export const matchCaps:         Matcher
export const matchLinkDomain:   Matcher
export const matchMentionSpam:  Matcher
export const matchLinkSpam:     Matcher

// Dispatcher
export function matchRule(content: string, rule: AutomodRuleRow): MatchResult | null
```

**Comportement par matcher** :

| Matcher | Params | Logic |
|---|---|---|
| `matchRegex` | `pattern`, `flags` (default `'i'`) | Compile RegExp puis `.test()`. Timeout soft : si compile ou test prend >100ms, retourne null + warning. Excerpt = match[0]. |
| `matchCaps` | `min_length` (def 15), `threshold_percent` (def 70) | Strip HTML tags d'abord. Si len < min_length, return null. Compte les `[A-Z]` vs total alphas. Si ratio ≥ threshold, match. Excerpt = first 80 chars. |
| `matchLinkDomain` | `mode: 'whitelist'\|'blacklist'`, `domains[]` | Extract `https?://([^\s/]+)` regex. Si mode=blacklist et un domaine match, match. Si whitelist et un domaine n'est PAS dans la liste, match. Excerpt = URL trouvée. |
| `matchMentionSpam` | `max_mentions` (def 5) | Compte `@username` (regex `@[a-zA-Z0-9_-]+`). Si > max_mentions, match. Excerpt = count + first 3 mentions. |
| `matchLinkSpam` | `max_links` (def 2) | Compte les `https?://` distincts. Si > max_links, match. Excerpt = count. |

**Garde-fous** :
- Aucun matcher ne throw : try/catch interne, return null si erreur, log warning.
- Inputs invalides (params null, pattern non compilable) : retourne null silencieusement.
- Tous purs : pas de DB, pas de Redis, pas d'IO.

### 3.2 `services/octoguard/cache.ts`

État in-process des règles actives.

```ts
export async function reloadRules(): Promise<void>
export function getRules(): AutomodRuleRow[]      // copie sûre
export function clearRules(): void                // force vidage
```

**Implémentation** :
- Module-level `let _rules: AutomodRuleRow[] = []` + `let _loaded: boolean = false`.
- `reloadRules()` fait `SELECT * FROM octoguard_automod_rules WHERE enabled = true ORDER BY created_at ASC`. Désérialise `params`, `action_duration`, `escalation`, `immunized_role_types`, `immunized_grade_ids` proprement.
- `getRules()` retourne `_rules` directement (pas de copie pour perf ; les consommateurs ne mutent pas).
- Aucun TTL automatique. L'invalidation est explicite (Session D appellera `reloadRules()` après chaque CRUD admin).

### 3.3 `services/octoguard/logger.ts`

Wrapper INSERT direct dans `admin_audit_log` pour les actions automatiques.

```ts
export async function logOctoGuardAction(entry: ActionLogEntry): Promise<void>
```

**Implémentation** :
- INSERT brut dans `admin_audit_log` avec `actor_id = NULL`, `actor_username = 'octoguard:auto'`.
- `entry.action` doit commencer par `octoguard.` (sinon throw au dev, pas en prod : on log un warning et on continue).
- Wrapped en try/catch, **jamais throw**. Si l'INSERT échoue, log warning console, le pipeline continue.

**N'utilise PAS le `logAction()` existant** (qui exige actor_id non-null et fait un SELECT pour récupérer le username). Reste isolé pour ne pas casser l'existant.

### 3.4 `services/octoguard/pipeline.ts`

Orchestrateur. Le hook principal du pipeline.

```ts
export interface PipelineInput {
  content:    string              // post-sanitize, post-checkHtmlContent
  userCtx:    PipelineUserCtx     // { userId, role, gradeIds }
  channelId:  string
  messageId?: string              // si le message est déjà inséré (cas edit), sinon undefined
}

export async function runPipeline(input: PipelineInput): Promise<PipelineResult>
```

**Algorithme** :
1. Si `!isOctoGuardEnabled()` → return `{ blocked: false }` immédiat.
2. Wrap dans `Promise.race([pipeline(), timeoutPromise(50)])`. Si timeout : log warning, return `{ blocked: false }` (fail-open).
3. À l'intérieur de `pipeline()` :
   - `const rules = getRules()`. Si vide, return `{ blocked: false }`.
   - Pour chaque rule (ordre insertion) :
     - Si user **immunisé** (role ∈ immunized_role_types OU une de ses grades ∈ immunized_grade_ids), skip cette rule.
     - `match = matchRule(content, rule)`. Si null, suivante.
     - **Match** : générer un `event_id` UUID v4. Décider l'effet selon `rule.action` :
       - `delete` : `applyDelete()` ; return `{ blocked: true, reason, i18n_key, event_id }`.
       - `warn` : INSERT dans `octoguard_warns` + `applyDelete()` + checkEscalation. Return `{ blocked: true, ... }`.
       - `mute` : **STUB Session C**. Log "TODO mute Session C". Return `{ blocked: true, ... }` (comme delete).
       - `ban_temp` : **STUB Session C**. Log "TODO ban_temp Session C". Return `{ blocked: true, ... }`.
       - `notify_only` : log + webhook (webhook Session D : pour l'instant juste log). Return `{ blocked: false }`.
       - `report_only` (dry-run) : log avec `metadata.would_be: true`. Return `{ blocked: false }`.
     - Premier match wins. Aucune autre règle évaluée.
   - Aucune règle ne match → return `{ blocked: false }`.

**Garde-fous** :
- try/catch global. Toute exception → log warning, return `{ blocked: false }` (fail-open).
- Le pipeline ne throw **jamais** vers le caller.

### 3.5 Modifications de fichiers existants

**`services/octoguard/index.ts`** :
- `initOctoGuard()` : si activé, appelle `reloadRules()` au boot. Log "OctoGuard initialized with N rules".

**`src/index.ts` (point d'entrée backend)** :
- Ajouter un appel `await initOctoGuard()` après le boot du server (probablement après les migrations et avant `server.listen()`, ou juste après). Position à valider en lisant l'index.

**`socket/index.ts` chat:send handler** :
- Ajouter le hook entre étape 9 (ban check, ligne ~445) et étape 10 (addMessage, ligne ~447).
- ~10 lignes ajoutées, signature exacte ci-dessous.

## 4. Pipeline d'intégration (point de hook exact)

Dans `socket/index.ts`, handler `chat:send` :

```ts
// ... après ban check existant ligne ~445 ...

// ▼ OCTOGUARD HOOK (Session B)
if (isOctoGuardEnabled()) {
  const og = await runPipeline({
    content:   sanitized,
    userCtx:   { userId, role: userRow.role, gradeIds: userRow.grade_ids ?? [] },
    channelId,
  })
  if (og.blocked) {
    socket.emit('chat:blocked', {
      reason: og.reason ?? 'octoguard',
      octoguard: {
        i18n_key: og.i18n_key,
        event_id: og.event_id,
      },
    })
    return
  }
  // Si pipeline pas bloquant (notify_only, report_only, ou pas de match), on continue.
}
// ▲ FIN OCTOGUARD HOOK

const message = await ChannelModel.addMessage({ ... })
// ... reste inchangé
```

**Compatibilité rétro stricte** :
- L'event `chat:blocked` garde la clé `reason` (string), compatible 100% avec le frontend actuel qui ne lit que ça.
- La clé `octoguard` est nouvelle et facultative. Le frontend actuel l'ignore. Sera utilisée plus tard pour i18n côté front.

**Note importante sur `userRow.role` et `grade_ids`** : à vérifier en code. Si le pipeline `chat:send` actuel ne récupère pas ces champs dans la query d'access control (étape 4), il faudra l'enrichir. C'est probablement déjà le cas (role est récupéré pour le read-only check étape 5), mais grade_ids peut-être pas. À fixer dans Session B si manquant.

## 5. Comportement attendu, table exhaustive

| Cas | Règle | Message | Résultat attendu |
|---|---|---|---|
| OctoGuard désactivé | (peu importe) | "hello" | broadcast normal, pipeline bypass total |
| Aucune règle active | (table vide) | "hello" | broadcast normal |
| Match regex action delete | regex `\bfreshtest\b` → delete | "hello freshtest" | bloqué, log dans `admin_audit_log`, `chat:blocked` émis |
| Match regex sur user admin | regex `\bbad\b` → delete, immunized=admin | admin écrit "this is bad" | broadcast normal (immunisé) |
| Match regex sur user member avec grade VIP immunisé | regex → delete, immunized_grade=VIP | VIP member écrit "bad" | broadcast normal |
| Match caps | caps 70%/15 → delete | "HELLO WORLD WHAT ARE YOU DOING" | bloqué |
| Match link_domain blacklist | blacklist `discord.gg` → delete | "join https://discord.gg/abc" | bloqué |
| Match link_domain whitelist | whitelist `nodyx.org` → delete | "see https://example.com" | bloqué (pas dans whitelist) |
| Match link_domain whitelist OK | whitelist `nodyx.org` → delete | "see https://nodyx.org/doc" | broadcast normal |
| Match mention_spam | max 3 mentions → delete | "@a @b @c @d hi" | bloqué |
| Match link_spam | max 2 links → delete | 3 URLs dans le message | bloqué |
| action notify_only | regex → notify_only | "match" | broadcast normal, log avec `would_be: false` |
| action report_only (dry-run) | regex → report_only | "match" | broadcast normal, log avec `would_be: true` |
| action warn | regex → warn (1 fois) | "match" | bloqué, INSERT `octoguard_warns`, log |
| action warn avec escalation (3e warn → mute 1h) | regex → warn, esc 3w/7d/mute/1h | 3e match | warn n°3 + applique escalation mute (STUB Session C, donc log seulement) |
| action mute (STUB) | regex → mute | "match" | bloqué + log "TODO Session C" (pas d'INSERT dans chat_mutes) |
| action ban_temp (STUB) | regex → ban_temp | "match" | bloqué + log "TODO Session C" (pas d'INSERT dans community_bans) |
| Pipeline timeout (>50ms) | (peu importe) | "match" | broadcast normal (fail-open), warning loggué |
| Erreur DB pendant pipeline | (peu importe) | "match" | broadcast normal (fail-open), warning loggué |
| Pattern regex invalide | regex `[invalid` → delete | "match" | matcher retourne null, pas de match, broadcast normal |
| Message vide post-sanitize | (peu importe) | (HTML strip → "") | comportement existant inchangé (return silent étape 7) |

## 6. Garde-fous techniques (non-négociables)

| Garde-fou | Implémentation |
|---|---|
| Timeout pipeline | `Promise.race([pipeline(), timeoutPromise(50)])`. Si timeout, return `{ blocked: false }`. Log warning. |
| Fail-open partout | Toute exception dans le pipeline → log + return `{ blocked: false }`. Le chat continue. |
| Logs jamais bloquants | `logOctoGuardAction()` wrapped try/catch, jamais throw. Si Postgres down, le pipeline continue. |
| Regex DoS protection (soft) | Wrapper timeout 100ms autour du `.test()`. Si dépassé, return null + warning. Pas idéal sans `re2`, mais minimum. |
| RegExp compilation safe | try/catch autour de `new RegExp(...)`. Pattern invalide → matcher retourne null. |
| Kill switch global | `isOctoGuardEnabled()` checked en premier dans `runPipeline()` + `initOctoGuard()`. Bypass total possible sans redéploiement. |
| Immunization stricte | Vérifiée AVANT le matching pour économiser les CPU cycles sur les power users. |

## 7. Tests manuels à valider en fin de session

1. **Smoke build** : `cd nodyx-core && npm run build` → 0 erreur.
2. **Smoke pipeline désactivé** : `OCTOGUARD_ENABLED=false` (défaut), envoyer un message, broadcast normal. Vérifier qu'aucune trace OctoGuard dans les logs.
3. **Smoke pipeline activé, table vide** : `OCTOGUARD_ENABLED=true`, `octoguard_automod_rules` vide. Envoyer un message, broadcast normal. Aucune trace.
4. **Smoke match delete** : INSERT manuel d'une règle regex `\bfreshtest\b` → action `delete`. Envoyer "hello freshtest". Message NON broadcasté. Vérifier `admin_audit_log` contient une ligne `action='octoguard.delete_message'`, `actor_username='octoguard:auto'`.
5. **Smoke match notify_only** : Modifier la règle action → `notify_only`. Envoyer "hello freshtest". Message broadcasté normalement. `admin_audit_log` contient `action='octoguard.notify'`, `metadata.would_be=false`.
6. **Smoke immunization** : Mettre `immunized_role_types = ['owner']`. Envoyer "hello freshtest" en tant qu'owner. Broadcast normal, aucune ligne `admin_audit_log`.
7. **Smoke fail-open** : Désactiver la règle (`enabled=false`), `reloadRules()`. Envoyer "hello freshtest". Broadcast normal.

## 8. Risques identifiés et mitigations

| Risque | Impact | Mitigation |
|---|---|---|
| Le pipeline ralentit le chat | Mauvaise UX | Timeout 50ms strict + fail-open |
| Regex catastrophique (ReDoS) | DoS via message admin | Timeout soft 100ms sur `.test()`. Phase 2 : `re2` recommandée. |
| Erreur SQL pendant `reloadRules()` au boot | Crash backend | try/catch dans `initOctoGuard()`. Log error, démarre quand même (mode dégradé sans rules). |
| Mauvais userCtx (role manquant) | Immunization KO, ban admin par erreur | Fallback : si `role` undefined, traiter comme `'member'` (le moins privilégié). |
| Message muté envoyé en pipeline | Session B ne gère pas les mutes | À ne PAS traiter en B. Le check mute se fait à étape -1 (à ajouter Session C avant pipeline OctoGuard). |
| `event_id` collision | Non-unique → mauvais matching côté Bot API Phase 4 | UUID v4 (collision ~0). |
| Cache RAM stale entre boot et premier reload | Période courte sans règles actives | `reloadRules()` est appelé dans `initOctoGuard()` avant `server.listen()`. Donc règles chargées AVANT première requête. |

## 9. Décisions architecturales (avec justifications)

| Décision | Choix retenu | Justification |
|---|---|---|
| Position du hook | Entre ban check (étape 9) et addMessage (étape 10) | Après tous les checks existants pour ne pas dupliquer. Avant le broadcast pour pouvoir bloquer. |
| Format `chat:blocked` | Rétro-compatible : `reason: string` conservé, `octoguard?: {...}` ajouté | Audit montre que le frontend lit `reason`. Garder ce contrat évite régression. |
| `logAction()` existant | Non touché. Wrapper séparé `logOctoGuardAction()` | Modifier `logAction()` toucherait 20+ appels existants. Trop de risque pour un gain marginal. |
| Pub/sub Redis | Non implémenté en Phase 1 | Mono-instance. Invalidation in-process suffit. Pub/sub = Phase multi-process plus tard. |
| Comportement `warn` | Bloque le message ET INSERT warn | Sinon doublonne avec `notify_only`. Cohérent avec l'attente intuitive d'un "warn". |
| Cache utilisateur (role/grades) | Pas implémenté en B | Pas de bench pour justifier. À optim si pipeline.p95 > 5ms en charge réelle. |
| Logs async via queue Redis | Pas implémenté en B | INSERT direct synchrone. Si volumétrie devient problème, queue en optim. |
| Tests Vitest | Pas en B | Smoke tests manuels suffisent pour valider la fondation. Vitest complet en stabilisation. |
| ReDoS protection | Soft timeout (`setTimeout` + race) | `re2` (lib npm) nécessite compilation native, ajoute complexité install. À évaluer Phase stabilisation. |
| Migration env var `BLOCKED_CONTENT_PATTERNS` | Reportée Session C | C'est un nice-to-have qui ne bloque pas le pipeline. |

## 10. Livrables Session B

Fichiers créés :
- `nodyx-core/src/services/octoguard/matchers.ts` (5 matchers + dispatcher)
- `nodyx-core/src/services/octoguard/cache.ts` (reload/get/clear)
- `nodyx-core/src/services/octoguard/logger.ts` (wrapper INSERT direct)
- `nodyx-core/src/services/octoguard/pipeline.ts` (orchestrateur)

Fichiers modifiés :
- `nodyx-core/src/services/octoguard/index.ts` (initOctoGuard appelle reloadRules)
- `nodyx-core/src/index.ts` (appel initOctoGuard au boot)
- `nodyx-core/src/socket/index.ts` (hook chat:send après ban check)

Commits attendus : 1 seul commit avec un message clair référençant ce CDC ("conforme à `SESSION-B-CDC.md`").

Tag commit : `feat(octoguard): Session B, pipeline auto-mod opérationnel`.

---

## 11. Décision finale : protection ReDoS via `re2` + `safe-regex`

Cette section remplace la décision §6 sur le "soft timeout". Le soft timeout JavaScript est illusoire : `setTimeout` ne tue pas une regex en cours, le thread reste bloqué. Démontré sur le VPS Nodyx le 2026-05-17 : la regex `(a+)+$` contre `"a".repeat(30) + "!"` prend **84 secondes** en RegExp natif vs **0 ms** en `re2`. Pendant ces 84s, tout Nodyx est figé. Risque DoS inacceptable.

### Solution adoptée : combo `re2` + `safe-regex`

**Dépendances ajoutées au `nodyx-core/package.json`** :
- `re2` en `optionalDependencies` (binaires précompilés npm pour Linux x64/arm64, macOS, Windows ; build node-gyp en fallback)
- `safe-regex` en `dependencies` (pure JS, jamais d'échec install)
- `@types/safe-regex` en `devDependencies`

**Garanties** :
- **Mode strict** (`re2` dispo, cas du VPS Nodyx prod et 99% des installs) : tous les patterns admin sont compilés en RE2. Algorithme à matching linéaire. **ReDoS impossible by design** (mathématiquement, pas heuristiquement).
- **Mode dégradé** (`re2` absent, arch exotique) : `re2` non requis, install Nodyx continue. Patterns compilés en RegExp natif. Sécurité dégradée mais `safe-regex` à l'admission rejette les patterns évidemment catastrophiques.

### Wrapper `compileSafeRegex(pattern, flags)` dans `matchers.ts`

```ts
let _re2: any = null
try { _re2 = require('re2') } catch { /* mode dégradé */ }

export function compileSafeRegex(pattern: string, flags: string = 'i'): { test: (s: string) => boolean } | null {
  try {
    if (_re2) return new _re2(pattern, flags)
    return new RegExp(pattern, flags)
  } catch {
    return null  // pattern invalide
  }
}

export function hasRE2(): boolean { return _re2 !== null }
```

Les deux retours (`RE2` instance et `RegExp`) ont la même méthode `.test(string): boolean`. Le matcher est agnostique.

### Validation amont via `safe-regex` (Session D)

Quand l'admin POST une règle de type `regex`, **avant** l'INSERT :
1. Vérification `safeRegex(pattern)` ; si false → réponse 400 avec message clair : "Ce pattern peut causer un déni de service (regex catastrophique). Simplifie-le."
2. Tentative de compile avec `_re2` ; si throw → réponse 400 : "Pattern incompatible avec le moteur sécurisé re2 : <reason>."
3. Si tout passe, INSERT.

### Log au boot

Dans `initOctoGuard()` :
```ts
if (hasRE2()) {
  console.log('[octoguard] regex DoS protection: re2 native engine active')
} else {
  console.warn('[octoguard] re2 not installed, falling back to native RegExp + safe-regex admission check. Regex DoS protection is reduced.')
}
```

### Installeur Nodyx

Le `install.sh` propose d'installer `re2` et affiche un message clair selon le résultat. Mais comme `re2` est en `optionalDependencies`, l'install Nodyx **ne casse pas** si `re2` échoue (cas Alpine sans build tools, FreeBSD, etc.). À implémenter en stabilisation post-Phase 1.

### Verdict

C'est la solution carrée. Pas de risque résiduel sur les installs mainstream. Pas de blocage d'install sur les exotiques. Sécurité garantie mathématiquement en mode strict.

---

## 12. Validation Jonathan, points clés

Ce CDC est en attente de validation explicite avant le code. Points sur lesquels j'ai besoin d'un OK :

- **Comportement `warn`** : bloque le message ET INSERT warn (vs ne bloque pas et INSERT warn seulement).
- **Stub `mute` et `ban_temp` en B** : ils bloquent le message comme `delete` mais ne touchent pas aux tables (TODO Session C). OK ?
- **Format `chat:blocked` étendu** : `reason: string` + `octoguard?: { i18n_key, event_id }`. OK ?
- **Pas de Redis pub/sub en B** : invalidation directe in-process. OK ?
- **Pas de cache utilisateur** : on fetch role/grades à chaque message. À optim plus tard si nécessaire. OK ?
- **Protection ReDoS via re2 + safe-regex** : décrit §11. Test concret VPS validé (84s native vs 0ms re2). OK ?

Quand validé, on attaque le code en suivant ce CDC ligne par ligne.

---

## 13. Note Phase 2/3 : migration vers Rust

L'option Rust (lib `regex` Rust native, garanties linéaires comme RE2) a été évaluée et explicitement reportée à Phase 2/3 d'OctoGuard, dans le cadre de la migration progressive vers `nodyx-server` (crate Rust mentionné dans `phase3_rust.md`). Raisons :

1. Pour Session B, exposer la regex Rust à Node demanderait un binding natif (napi-rs ou neon) — c'est une session dédiée, pas un patch.
2. Build complexity x10 vs `re2` qui a déjà ses binaires précompilés sur npm.
3. La lib `regex` Rust et `re2` offrent les mêmes garanties théoriques. Migrer juste pour le plaisir d'être en Rust n'apporte pas de gain technique sur cette fonction isolée.

**Quand on attaquera `nodyx-server` (crate Rust)**, OctoGuard est un excellent candidat de priorité : surface bien délimitée, sécurité-sensible, perf-sensible. Le matcher regex pourra alors être natif Rust, ce qui sera l'évolution naturelle.
