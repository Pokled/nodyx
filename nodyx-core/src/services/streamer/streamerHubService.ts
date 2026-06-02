// ─── Streamer Hub — orchestration service ───────────────────────────────────
// Façade unique pour les routes : OAuth flow, subscriptions EventSub,
// state Redis, dispatch events. Pas de logique HTTP ici (les routes parsent
// les requests, ce service prend des arguments propres).

import { redis, db } from '../../config/database'
import { randomBytes } from 'node:crypto'
import {
  saveStreamerTokens,
  findPrimaryStreamer,
  getDecryptedTokens,
  refreshAndPersist,
  type StreamerTokenRow,
} from './tokenService'
import { createSubscription, listSubscriptions, setExternalSubId } from './eventsubService'
import { recordEvent } from './eventService'
import { pushEventToChat, pushTwitchChatMessage, ensureTwitchChatChannel, getInstanceCommunityId } from './streamerChat'
import { audit } from './audit'
import { io } from '../../socket/io'
import { twitchProvider } from './providers/twitchProvider'
import type { StreamerProvider, ProviderId } from './providers/_types'

// ── State CSRF (OAuth) ───────────────────────────────────────────────────────
// Le state discrimine deux flows :
//   - kind=streamer : connecter le compte Twitch principal de l'instance
//                     (admin only, OAuth complet avec tous les scopes)
//   - kind=viewer   : lier son compte Twitch personnel à son profil Nodyx
//                     (auth required, scope minimal user:read:email)
//
// Idempotence : Twitch peut callback /callback plusieurs fois quasi-simultanément
// (prefetch browser, retry interne, etc.). Le state est consommé une seule fois,
// mais on garde le payload sous une clé "consumed:" pendant 30s pour que les
// retries puissent se reconnaître comme des replays et rediriger gracieusement
// au lieu de retourner invalid_or_expired_state.

const STATE_PREFIX          = 'streamer:oauth:state:'
const STATE_CONSUMED_PREFIX = 'streamer:oauth:state-consumed:'
const STATE_TTL_SECONDS     = 600  // 10 min
const CONSUMED_TTL_SECONDS  = 30   // fenêtre de tolérance pour callbacks dupliqués

export type OAuthState =
  | { kind: 'streamer'; targetUserId: string; ip: string; createdAt: number }
  | { kind: 'viewer';   targetUserId: string; ip: string; createdAt: number }

export interface ConsumeResult {
  state:    OAuthState
  replayed: boolean  // true si déjà consommé une 1ère fois (callback dupliqué)
}

export async function createOAuthState(args: {
  kind:         OAuthState['kind']
  targetUserId: string  // adminUserId pour streamer, viewerUserId pour viewer
  ip:           string
}): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const payload: OAuthState = {
    kind:         args.kind,
    targetUserId: args.targetUserId,
    ip:           args.ip,
    createdAt:    Date.now(),
  }
  await redis.set(STATE_PREFIX + token, JSON.stringify(payload), 'EX', STATE_TTL_SECONDS)
  return token
}

export async function consumeOAuthState(token: string): Promise<ConsumeResult | null> {
  const key         = STATE_PREFIX + token
  const consumedKey = STATE_CONSUMED_PREFIX + token

  // 1. Tentative atomique : récupérer ET supprimer la clé fraîche
  // (ioredis getdel = GETDEL natif Redis 6.2+, atomique)
  const value = await redis.getdel(key)
  if (value) {
    let state: OAuthState
    try { state = JSON.parse(value) as OAuthState } catch { return null }
    // Stocker le résultat sous une clé séparée pour les replays imminents
    await redis.set(consumedKey, value, 'EX', CONSUMED_TTL_SECONDS).catch(() => {})
    return { state, replayed: false }
  }

  // 2. La clé principale est vide. Peut-être un callback dupliqué — checker
  // la clé "consumed" qui garde le payload 30s après la première consommation.
  const consumedValue = await redis.get(consumedKey)
  if (consumedValue) {
    try {
      const state = JSON.parse(consumedValue) as OAuthState
      return { state, replayed: true }
    } catch { return null }
  }

  // 3. Vraiment invalid ou expiré (>10min ou >30s après consommation).
  return null
}

// ── Provider registry ────────────────────────────────────────────────────────

export function getProvider(id: ProviderId): StreamerProvider {
  if (id === 'twitch') return twitchProvider
  throw new Error(`Provider non implémenté en Phase 1 : ${id}`)
}

// Scopes Phase 1 minimaux (cf spec §4.1 v2.2). Les scopes Phase 2 (chat) sont
// demandés en plus une fois la Phase 2 livrée.
export const PHASE_1_SCOPES = [
  'user:read:email',
  'channel:read:subscriptions',
  'bits:read',
  'moderator:read:followers',
] as const

// Phase 2 (chat bridge) — scopes spécifiques EventSub Chat + Helix Send :
//
// - user:read:chat   : prérequis pour channel.chat.message (sub user-scoped)
// - user:write:chat  : prérequis pour Helix POST /chat/messages (outbound)
// - user:bot         : exigé EN PLUS de user:read:chat quand le sub est créé
//                      via app access token (notre cas, vu que Twitch refuse
//                      les user tokens pour les webhook subscriptions). Subtil.
// - channel:bot      : exigé sur le broadcaster pour autoriser le bot à
//                      poster dans son chat. Comme broadcaster = streamer, il
//                      se l'accorde à lui-même.
// - channel:read:polls : Phase 4 récap polls
export const STREAMER_HUB_SCOPES = [
  ...PHASE_1_SCOPES,
  'user:read:chat',
  'user:write:chat',
  'user:bot',
  'channel:bot',
  'channel:read:polls',
  // Stream Control Panel (Phase 3) : éditer le titre + la catégorie du
  // stream depuis Nodyx, poser des markers VOD pendant le live. Couvre les
  // deux endpoints helix : PATCH /channels et POST /streams/markers.
  'channel:manage:broadcast',
  // Engagement (Phase 3, suite) : lancer/terminer sondages et prédictions.
  // channel:read:polls est déjà inclus plus haut, on ajoute le manage.
  'channel:manage:polls',
  'channel:read:predictions',
  'channel:manage:predictions',
  // Channel Points Rewards (Phase 3, suite) : CRUD sur les custom rewards
  // de la chaine + lecture/écriture des redemptions. Réservé Affiliate/Partner
  // côté Twitch, mais on demande le scope dès maintenant pour que les
  // streamers qualifiés y aient accès sans re-OAuth après upgrade.
  'channel:manage:redemptions',
] as const

// Scopes minimaux pour le viewer flow : on a juste besoin d'identifier le user
// Twitch et de récupérer son login. Pas besoin de lire son chat, ses subs, etc.
export const VIEWER_SCOPES = ['user:read:email'] as const

// ── Subscribe EventSub events Phase 1 + 2 (§5.2 + §6.1 spec) ───────────────

interface SubscribeSpec {
  eventType: string
  version:   string
  condition: Record<string, string>
  // Scopes user requis pour cette subscription. Si le streamer connecté n'a
  // pas accordé l'un de ces scopes, on skip silencieusement (pas d'erreur).
  // Permet de dégrader gracieusement quand on ajoute des events Phase 2+
  // sur des anciennes connexions qui n'ont pas tous les scopes.
  requiredScopes?: readonly string[]
}

function buildSubscribeSpecs(broadcasterId: string): SubscribeSpec[] {
  return [
    // ── Phase 1 — alertes streamer ────────────────────────────────────────
    // channel.follow v2 demande explicitement moderator_user_id (la nouvelle
    // API EventSub force le filtre côté streamer = lui-même)
    { eventType: 'channel.follow',             version: '2', condition: { broadcaster_user_id: broadcasterId, moderator_user_id: broadcasterId } },
    { eventType: 'channel.subscribe',          version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { eventType: 'channel.subscription.gift',  version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { eventType: 'channel.cheer',              version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { eventType: 'channel.raid',               version: '1', condition: { to_broadcaster_user_id: broadcasterId } },
    { eventType: 'channel.poll.begin',         version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { eventType: 'channel.poll.end',           version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { eventType: 'stream.online',              version: '1', condition: { broadcaster_user_id: broadcasterId } },
    { eventType: 'stream.offline',             version: '1', condition: { broadcaster_user_id: broadcasterId } },

    // ── Phase 2 — chat bridge ─────────────────────────────────────────────
    // channel.chat.message via app access token exige TROIS scopes du user_id :
    //   - user:read:chat   (lire le chat du user_id)
    //   - user:bot         (créer le sub via app token, exigé par Twitch quand
    //                       l'utilisateur agit comme un bot lecteur)
    //   - channel:bot      (autoriser le bot à intervenir sur la chaîne du
    //                       broadcaster ; ici broadcaster == user_id == streamer)
    //
    // Sans ces 3 scopes, Twitch refuse avec 403 "subscription missing proper
    // authorization". Le check ci-dessous skip la sub gracieusement si un
    // scope manque, plutôt que de tenter et échouer.
    {
      eventType: 'channel.chat.message',
      version:   '1',
      condition: { broadcaster_user_id: broadcasterId, user_id: broadcasterId },
      requiredScopes: ['user:read:chat', 'user:bot', 'channel:bot'],
    },
  ]
}

// Alias rétrocompatible (l'ancien nom apparaît encore dans les commits).
const buildSubscribeSpecsForPhase1 = buildSubscribeSpecs

export interface SubscribeResult {
  eventType:     string
  status:        'created' | 'exists' | 'skipped' | 'failed'
  externalSubId?: string
  error?:        string
  reason?:       string  // ex: 'missing_scope:user:read:chat', 'already_subscribed'
}

// Utilitaire : récupère un user access token frais pour le primary streamer.
// Auto-refresh si expirera dans < 5 min. Retourne null si pas de streamer
// connecté (sub user-scoped impossible) ou si le refresh échoue.
async function getValidUserAccessToken(provider: StreamerProvider): Promise<string | null> {
  const primary = await findPrimaryStreamer(provider.id)
  if (!primary) return null

  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  const expiresInMs = primary.expiresAt.getTime() - Date.now()
  if (expiresInMs < REFRESH_MARGIN_MS) {
    try {
      await refreshAndPersist({ provider, rowId: primary.id })
    } catch (err) {
      console.error('[streamerHub] proactive refresh failed', err)
      return null
    }
  }

  const decrypted = await getDecryptedTokens(primary.id)
  return decrypted?.accessToken ?? null
}

// Match une subscription existante côté Twitch contre une spec voulue.
// Compare type, version, et toutes les clés de condition (broadcaster_user_id,
// user_id, moderator_user_id, etc.).
function matchesSpec(existing: { type: string; version: string; condition: Record<string, string>; status: string }, spec: SubscribeSpec): boolean {
  if (existing.type    !== spec.eventType) return false
  if (existing.version !== spec.version)   return false
  // Twitch garde des subs en "enabled", "webhook_callback_verification_pending",
  // "webhook_callback_verification_failed", "notification_failures_exceeded",
  // "authorization_revoked", etc. On considère "enabled" et "*_pending" comme
  // match (ne pas re-créer). Les statuts d'erreur (failures_exceeded, revoked,
  // user_removed, version_removed) → on doit re-créer.
  const okStatuses = new Set(['enabled', 'webhook_callback_verification_pending'])
  if (!okStatuses.has(existing.status)) return false
  for (const [k, v] of Object.entries(spec.condition)) {
    if (existing.condition[k] !== v) return false
  }
  return true
}

export async function subscribeAllStreamerEvents(args: {
  provider:      StreamerProvider
  broadcasterId: string
  publicBase:    string  // ex https://nodyx.org
  grantedScopes?: readonly string[] | string[]  // scopes effectivement accordés par le streamer
  // Si true, DELETE toutes les subs Twitch existantes du broadcaster avant
  // de re-créer. À utiliser sur les reconnexions OAuth (les anciens secrets
  // HMAC sont perdus, leur webhook handler répondrait 404 → drift). Si false
  // (default), on dédup les existantes (status='exists', ne crée pas de row
  // DB côté Nodyx — utilisé pour les syncs incrémentaux).
  cleanupExisting?: boolean
}): Promise<SubscribeResult[]> {
  const appToken = await args.provider.getAppAccessToken()
  const specs    = buildSubscribeSpecs(args.broadcasterId)
  const granted  = new Set(args.grantedScopes ?? [])
  const results: SubscribeResult[] = []

  // Liste les subs existantes côté Twitch UNE FOIS.
  let existingSubs: Awaited<ReturnType<StreamerProvider['listEventSubscriptions']>> = []
  try {
    existingSubs = await args.provider.listEventSubscriptions(appToken)
  } catch (err) {
    console.error('[streamerHub] listEventSubscriptions failed (continuing without dedup)', err)
  }

  // Mode reconnexion : supprime toutes les subs existantes du broadcaster
  // (matched par condition.broadcaster_user_id ou .to_broadcaster_user_id ou
  // .user_id == broadcasterId) pour repartir de zéro. Les nouvelles seront
  // créées avec des secrets HMAC frais accessibles côté Nodyx.
  if (args.cleanupExisting && existingSubs.length > 0) {
    const ours = existingSubs.filter(s =>
      s.condition.broadcaster_user_id    === args.broadcasterId ||
      s.condition.to_broadcaster_user_id === args.broadcasterId ||
      s.condition.user_id                === args.broadcasterId,
    )
    for (const sub of ours) {
      try { await args.provider.deleteEventSubscription(appToken, sub.id) }
      catch (err) { console.error('[streamerHub] cleanup deleteEventSubscription failed', err) }
    }
    // Vide la liste des existantes pour que le matchesSpec ne skip plus
    existingSubs = []
  }

  // Lazy-load le user access token : on ne le récupère que si une spec en a besoin.
  let userToken: string | null = null
  let userTokenLoaded = false

  for (const spec of specs) {
    // Skip si un des scopes requis n'est pas accordé.
    if (spec.requiredScopes) {
      const missing = spec.requiredScopes.filter(s => !granted.has(s))
      if (missing.length > 0) {
        results.push({
          eventType: spec.eventType,
          status:    'skipped',
          reason:    `missing_scopes:${missing.join(',')}`,
        })
        continue
      }
    }

    // Skip si déjà subscribed côté Twitch.
    if (existingSubs.some(s => matchesSpec(s, spec))) {
      results.push({
        eventType: spec.eventType,
        status:    'exists',
        reason:    'already_subscribed_on_twitch',
      })
      continue
    }

    // Twitch exige un APP access token pour POST /eventsub/subscriptions
    // (les user tokens sont rejetés avec "auth must use app access token to
    // create webhook subscription"). Le scope check se fait côté Twitch en
    // examinant les tokens user actifs pour le user_id de la condition.
    // Pour channel.chat.message, le user_id (broadcaster) doit avoir accordé
    // user:read:chat + user:bot + channel:bot — vérifié via spec.requiredScope.
    try {
      const hmacSecret = randomBytes(32).toString('base64url').slice(0, 64)
      const placeholder = await createSubscription({
        provider:      args.provider.id,
        externalSubId: 'pending',
        eventType:     spec.eventType,
        hmacSecret,
      })

      const callbackUrl = `${args.publicBase.replace(/\/+$/, '')}/api/v1/integrations/twitch/eventsub/${placeholder.callbackNonce}`
      const created = await args.provider.createEventSubscription({
        accessToken: appToken,
        eventType:   spec.eventType,
        condition:   { ...spec.condition, version: spec.version },
        callbackUrl,
        hmacSecret,
      })

      await setExternalSubId(placeholder.id, created.externalSubId)

      results.push({
        eventType:     spec.eventType,
        status:        'created',
        externalSubId: created.externalSubId,
      })
    } catch (err) {
      // Pour le diagnostic : on garde le body Twitch dans error si possible.
      const e = err as Error & { body?: unknown }
      const errMsg = e.body
        ? `${e.message} — ${typeof e.body === 'string' ? e.body : JSON.stringify(e.body)}`
        : e.message
      results.push({
        eventType: spec.eventType,
        status:    'failed',
        error:     errMsg,
      })
    }
  }

  // Variables user token déclarées mais inutilisées vu qu'on est revenu à
  // l'app token uniquement. On les garde pour le moment au cas où Twitch
  // changerait de politique.
  void userToken
  void userTokenLoaded

  // Si chat.message subscribe a réussi (created OU déjà exists), auto-créer
  // le channel #twitch-chat pour qu'il apparaisse dans la liste avant même
  // le 1er message reçu.
  const chatSubOk = results.some(r =>
    r.eventType === 'channel.chat.message' && (r.status === 'created' || r.status === 'exists')
  )
  if (chatSubOk) {
    try {
      const communityId = await getInstanceCommunityId()
      if (communityId) await ensureTwitchChatChannel(communityId)
    } catch (err) {
      console.error('[streamerHub] ensureTwitchChatChannel failed', err)
    }
  }

  return results
}

// ── Sync subscriptions (admin-triggered) ────────────────────────────────────
// Ré-exécute subscribeAllStreamerEvents pour le primary streamer connecté.
// L'INSERT dans createSubscription a un ON CONFLICT (provider, event_type)
// DO UPDATE qui re-cycle nonce + secret HMAC. Côté Twitch, comme on souscrit
// avec une nouvelle URL callback (nonce différent), Twitch crée une nouvelle
// subscription sans casser l'ancienne — l'ancienne deviendra "failed" après
// quelques retries (404 sur l'ancien nonce dont la row a été UPDATED).
//
// Ce pattern marche pour ajouter des events Phase 2+ sur un streamer connecté
// en Phase 1, sans qu'il ait à se reconnecter.

export async function syncStreamerSubscriptions(args: {
  provider:    StreamerProvider
  publicBase:  string
}): Promise<{ ok: true; results: SubscribeResult[] } | { ok: false; reason: string }> {
  const primary = await findPrimaryStreamer(args.provider.id)
  if (!primary) return { ok: false, reason: 'no_primary_streamer' }

  const results = await subscribeAllStreamerEvents({
    provider:      args.provider,
    broadcasterId: primary.externalId,
    publicBase:    args.publicBase,
    grantedScopes: primary.scopes,
  })
  return { ok: true, results }
}

// ── OAuth callback flow (high-level orchestration) ──────────────────────────

export interface CompleteOAuthResult {
  streamer:      StreamerTokenRow
  email:         string | null
  subscribeResults: SubscribeResult[]
}

export async function completeOAuthCallback(args: {
  provider:    StreamerProvider
  code:        string
  redirectUri: string
  publicBase:  string
  adminUserId: string
  ip:          string
}): Promise<CompleteOAuthResult> {
  // 1. exchange code → tokens
  const tokens = await args.provider.exchangeCode(args.code, args.redirectUri)

  // 2. getCurrentUser (pour identifier le streamer)
  const user = await args.provider.getCurrentUser(tokens.accessToken)

  // 3. persist tokens chiffrés (is_streamer = true puisque c'est le primary)
  const saved = await saveStreamerTokens({
    provider:      args.provider.id,
    userId:        args.adminUserId,
    externalId:    user.id,
    externalLogin: user.login,
    accessToken:   tokens.accessToken,
    refreshToken:  tokens.refreshToken,
    scopes:        tokens.scopes,
    expiresAt:     new Date(Date.now() + tokens.expiresIn * 1000),
    isStreamer:    true,
  })

  // 4. lier twitch_id à l'admin user (mapping viewer §7 flow A appliqué à
  // l'admin lui-même puisqu'il est aussi un user Nodyx)
  await db.query(
    `UPDATE users SET twitch_id = $1, twitch_login = $2 WHERE id = $3`,
    [user.id, user.login, args.adminUserId],
  )

  // 5. Subscribe aux events Phase 1+2.
  // cleanupExisting:true = on est dans un OAuth callback (1ère connexion ou
  // reconnexion). Si reconnexion avec nouveaux scopes, les anciennes subs
  // Twitch ont des secrets HMAC perdus côté Nodyx → on DELETE et recrée.
  const subscribeResults = await subscribeAllStreamerEvents({
    provider:        args.provider,
    broadcasterId:   user.id,
    publicBase:      args.publicBase,
    grantedScopes:   tokens.scopes,
    cleanupExisting: true,
  })

  await audit({
    action:    'connect_twitch',
    status:    'success',
    userId:    args.adminUserId,
    ipAddress: args.ip,
    metadata:  {
      externalId:    user.id,
      externalLogin: user.login,
      scopesGranted: tokens.scopes,
      subscribedOk:  subscribeResults.filter(r => r.status === 'created').length,
      subscribedFail: subscribeResults.filter(r => r.status === 'failed').length,
    },
  })

  return {
    streamer:         saved,
    email:            user.email,
    subscribeResults,
  }
}

// ── Viewer OAuth flow : lier un compte Twitch à un user Nodyx existant ─────

export interface CompleteViewerOAuthResult {
  twitchId:       string
  twitchLogin:    string
  twitchEmail:    string | null
  alreadyLinkedTo: string | null  // username Nodyx si twitch_id déjà pris
}

export async function completeViewerOAuth(args: {
  provider:      StreamerProvider
  code:          string
  redirectUri:   string
  viewerUserId:  string
  ip:            string
}): Promise<CompleteViewerOAuthResult> {
  // 1. exchange code → tokens
  const tokens = await args.provider.exchangeCode(args.code, args.redirectUri)

  // 2. getCurrentUser
  const user = await args.provider.getCurrentUser(tokens.accessToken)

  // 3. Vérifier si ce twitch_id est déjà lié à un autre user Nodyx
  const existing = await db.query<{ username: string; id: string }>(
    `SELECT id, username FROM users WHERE twitch_id = $1 AND id != $2 LIMIT 1`,
    [user.id, args.viewerUserId],
  )
  if (existing.rows.length > 0) {
    await audit({
      action:    'connect_twitch',
      status:    'failed',
      userId:    args.viewerUserId,
      ipAddress: args.ip,
      metadata:  {
        kind:           'viewer',
        twitchId:       user.id,
        twitchLogin:    user.login,
        reason:         'twitch_id_already_linked',
        otherUserId:    existing.rows[0].id,
      },
    })
    return {
      twitchId:        user.id,
      twitchLogin:     user.login,
      twitchEmail:     user.email,
      alreadyLinkedTo: existing.rows[0].username,
    }
  }

  // 4. UPDATE le user Nodyx avec son twitch_id + login
  await db.query(
    `UPDATE users SET twitch_id = $1, twitch_login = $2 WHERE id = $3`,
    [user.id, user.login, args.viewerUserId],
  )

  await audit({
    action:    'connect_twitch',
    status:    'success',
    userId:    args.viewerUserId,
    ipAddress: args.ip,
    metadata:  {
      kind:        'viewer',
      twitchId:    user.id,
      twitchLogin: user.login,
    },
  })

  // Note : on jette les tokens viewer (access + refresh) après usage. Pas
  // besoin de les chiffrer / persister, on a juste utilisé le flow OAuth
  // pour vérifier que le user contrôle bien ce compte Twitch. Phase futur
  // pourrait les stocker pour des features comme "afficher mes subs aux
  // streamers Nodyx que je suis", mais hors Phase 1.
  void tokens

  return {
    twitchId:        user.id,
    twitchLogin:     user.login,
    twitchEmail:     user.email,
    alreadyLinkedTo: null,
  }
}

export async function unlinkViewerTwitch(args: {
  viewerUserId: string
  ip:           string
}): Promise<boolean> {
  const result = await db.query<{ twitch_login: string }>(
    `UPDATE users SET twitch_id = NULL, twitch_login = NULL
     WHERE id = $1 AND twitch_id IS NOT NULL
     RETURNING twitch_login`,
    [args.viewerUserId],
  )
  const ok = result.rows.length > 0
  await audit({
    action:    'disconnect_twitch',
    status:    ok ? 'success' : 'failed',
    userId:    args.viewerUserId,
    ipAddress: args.ip,
    metadata:  {
      kind:        'viewer',
      twitchLogin: result.rows[0]?.twitch_login,
    },
  })
  return ok
}

export async function getViewerLink(viewerUserId: string): Promise<{ twitchId: string; twitchLogin: string } | null> {
  const result = await db.query<{ twitch_id: string; twitch_login: string }>(
    `SELECT twitch_id, twitch_login FROM users WHERE id = $1`,
    [viewerUserId],
  )
  const row = result.rows[0]
  if (!row?.twitch_id) return null
  return { twitchId: row.twitch_id, twitchLogin: row.twitch_login }
}

// ── Reconcile / re-subscribe (admin manual trigger) ─────────────────────────

export async function listEventSubStatus(provider: ProviderId): Promise<{
  subscriptions: Awaited<ReturnType<typeof listSubscriptions>>
  primaryStreamer: StreamerTokenRow | null
}> {
  const [subs, primary] = await Promise.all([
    listSubscriptions(provider),
    findPrimaryStreamer(provider),
  ])
  return { subscriptions: subs, primaryStreamer: primary }
}

// ── Event ingestion (called from EventSub webhook) ──────────────────────────

export async function ingestEvent(args: {
  provider:    ProviderId
  eventType:   string
  payload:     Record<string, unknown>
  externalId?: string | null
}): Promise<void> {
  // ── Phase 2 — chat bridge inbound ──────────────────────────────────────
  // Les messages chat ont un volume très élevé (potentiellement 100+/min sur
  // un stream actif). On NE PERSISTE PAS dans streamer_events (la table
  // resterait propre pour les vrais events). On les pousse direct dans
  // #twitch-chat où ils sont déjà persistés via channel_messages.
  if (args.eventType === 'channel.chat.message') {
    // Command parser : !topclips et autres bots commands déclenchent des
    // actions Nodyx (overlays, etc) avant qu'on ne push le message dans
    // #twitch-chat. Non-blocking : si le handler plante, le message passe
    // quand même normalement.
    handleChatCommand(args.payload).catch(err =>
      console.error('[streamerHub] chat command handler failed', err))
    // Compteur de messages chat pour les chat timers (anti-spam chat vide).
    // Best-effort, ne bloque pas le flow inbound.
    import('./chatTimersService').then(m => m.bumpChatMessageCounter())
      .catch(() => {})
    try {
      await pushTwitchChatMessage({
        provider: args.provider,
        payload:  args.payload,
      })
    } catch (err) {
      console.error('[streamerHub] pushTwitchChatMessage failed', err)
    }
    return
  }

  // ── Phase 1 — events normaux ──────────────────────────────────────────
  // Map Twitch user_id présent dans le payload vers un user Nodyx via twitch_id
  // (linked par flow A/C). Si pas de match, user_id reste NULL.
  let userId: string | null = null
  const twitchUserId = extractTwitchUserId(args.eventType, args.payload)
  if (twitchUserId) {
    const lookup = await db.query<{ id: string }>(
      `SELECT id FROM users WHERE twitch_id = $1`,
      [twitchUserId],
    )
    userId = lookup.rows[0]?.id ?? null
  }

  // ── Phase 2 — sessions de stream ──────────────────────────────────────
  // Spec §5.2 : stream.online ouvre une session, stream.offline la ferme.
  // Nécessaire pour le check "stream live ?" du chat bridge outbound (§6.4).
  // Phase 4 ajoutera les stats agrégées (peak_viewers, etc).
  if (args.eventType === 'stream.online') {
    const evt = (args.payload as { event?: { id?: string; started_at?: string; type?: string; broadcaster_user_id?: string } }).event
    if (evt?.id && evt.started_at) {
      await db.query(
        `INSERT INTO streamer_sessions (provider, external_id, started_at)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [args.provider, evt.id, evt.started_at],
      ).catch(err => console.error('[streamerHub] streamer_sessions insert failed', err))
    }
  } else if (args.eventType === 'stream.offline') {
    // stream.offline n'a pas de stream_id, on clôt toutes les sessions
    // ouvertes du provider (en pratique il y en a au plus 1).
    await db.query(
      `UPDATE streamer_sessions SET ended_at = NOW()
       WHERE provider = $1 AND ended_at IS NULL`,
      [args.provider],
    ).catch(err => console.error('[streamerHub] streamer_sessions close failed', err))
  }

  await recordEvent({
    provider:   args.provider,
    eventType:  args.eventType,
    externalId: args.externalId ?? null,
    payload:    args.payload,
    userId,
  })

  // Push aussi un message système dans le channel #streamer-events pour
  // visibilité dans l'UI chat existante. Author = user "Nodyx" système
  // auto-créé (cf streamerChat.ensureSystemUser). Best-effort : si la
  // résolution échoue, l'event reste persisté en DB.
  //
  // stream.online et stream.offline ont leur propre formatage enrichi
  // (carte avec avatar/banner/titre/jeu pour l'annonce, podium + stats
  // agrégées pour le recap). On bypass pushEventToChat pour eux.
  if (args.eventType === 'stream.online') {
    try {
      const { getTwitchProfile } = await import('./twitchProfile')
      const { formatStreamOnlineAnnouncement, pushSystemMessageToChat } = await import('./streamerChat')
      const profile = await getTwitchProfile({ forceRefresh: true })   // refresh pour avoir titre/jeu en cours
      if (profile) {
        const html = formatStreamOnlineAnnouncement({
          displayName:    profile.user.displayName,
          login:          profile.user.login,
          avatarUrl:      profile.user.avatarUrl,
          bannerUrl:      profile.user.profileBannerUrl,
          thumbnailUrl:   profile.stream.thumbnailUrl,
          title:          profile.stream.title,
          gameName:       profile.stream.gameName,
          gameBoxArtUrl:  profile.stream.gameBoxArtUrl,
        })
        await pushSystemMessageToChat(html)
      }
    } catch (err) {
      console.error('[streamerHub] stream.online enriched announce failed, falling back to plain text', err)
      try { await pushEventToChat({ provider: args.provider, eventType: args.eventType, payload: args.payload }) } catch {}
    }
  } else if (args.eventType === 'stream.offline') {
    try {
      const sessionRow = await db.query<{ started_at: string; ended_at: string | null }>(
        `SELECT started_at, ended_at FROM streamer_sessions
         WHERE provider = $1 ORDER BY started_at DESC LIMIT 1`,
        [args.provider],
      ).then(r => r.rows[0])
      if (sessionRow && sessionRow.ended_at) {
        const { computeStreamRecap } = await import('./streamSessionRecap')
        const { getTwitchProfile } = await import('./twitchProfile')
        const { formatStreamRecap, pushSystemMessageToChat } = await import('./streamerChat')
        const [recap, profile] = await Promise.all([
          computeStreamRecap({ startedAt: sessionRow.started_at, endedAt: sessionRow.ended_at }),
          getTwitchProfile().catch(() => null),
        ])
        const html = formatStreamRecap({
          streamerName:        profile?.user.displayName ?? 'Streamer',
          startedAt:           recap.startedAt,
          endedAt:             recap.endedAt,
          topChatters:         recap.topChatters,
          totalMessages:       recap.totalMessages,
          topBitsDonors:       recap.topBitsDonors,
          totalBits:           recap.totalBits,
          subsCount:           recap.subsCount,
          giftSubsTotal:       recap.giftSubsTotal,
          raidsCount:          recap.raidsCount,
          raidersTotalViewers: recap.raidersTotalViewers,
          followersCount:      recap.followersCount,
        })
        await pushSystemMessageToChat(html)
      }
    } catch (err) {
      console.error('[streamerHub] stream.offline recap failed, falling back to plain text', err)
      try { await pushEventToChat({ provider: args.provider, eventType: args.eventType, payload: args.payload }) } catch {}
    }
  } else {
    try {
      await pushEventToChat({
        provider:  args.provider,
        eventType: args.eventType,
        payload:   args.payload,
      })
    } catch (err) {
      console.error('[streamerHub] pushEventToChat failed', err)
    }
  }

  // Live broadcast to the admin dashboard. Only admin sockets join the
  // 'admin:streamer-hub' room (see socket/index.ts handler for the role check),
  // so this never leaks event data to non-admin users.
  try {
    io?.to('admin:streamer-hub').emit('streamer:event', {
      id:         `live-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      provider:   args.provider,
      eventType:  args.eventType,
      payload:    args.payload,
      occurredAt: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[streamerHub] live broadcast failed', err)
  }

  // Avant dispatch socket : enrichit le payload avec avatarUrl du user
  // concerné (via cache Redis 24h + fallback helix). Les overlays reçoivent
  // l'avatar directement, zéro round-trip côté client.
  let enrichedPayload: Record<string, unknown> = args.payload
  try {
    const { enrichEventWithAvatar } = await import('./twitchAvatars')
    enrichedPayload = await enrichEventWithAvatar(args.eventType, args.payload)
  } catch { /* best-effort, on garde le payload original */ }

  // Dispatch vers les overlays OBS. Chaque overlay a son propre filtre :
  //   - alert_box     : reçoit follow / sub / gift / cheer / raid
  //   - stream_timer  : reçoit stream.online (reset chrono) + stream.offline (hide)
  // Les autres types (goal_bar, ticker, leaderboard) seront branchés dans
  // les slices à venir avec leurs propres ensembles d'events.
  try {
    if (io) {
      const { dispatchOverlayEvent } = await import('../../socket/overlay')
      const now = new Date().toISOString()
      if (ALERT_BOX_EVENT_TYPES.has(args.eventType)) {
        dispatchOverlayEvent(io, { kind: 'alert_box',    eventType: args.eventType, payload: enrichedPayload, occurredAt: now })
      }
      if (STREAM_TIMER_EVENT_TYPES.has(args.eventType)) {
        dispatchOverlayEvent(io, { kind: 'stream_timer', eventType: args.eventType, payload: enrichedPayload, occurredAt: now })
      }
      // Event ticker reçoit les 5 événements à afficher dans le bandeau
      // défilant (même set que l'alert box). Le client filtre côté page
      // selon sa config enabledEvents.
      if (ALERT_BOX_EVENT_TYPES.has(args.eventType)) {
        dispatchOverlayEvent(io, { kind: 'event_ticker', eventType: args.eventType, payload: enrichedPayload, occurredAt: now })
      }
    }
  } catch (err) {
    console.error('[streamerHub] overlay dispatch failed', err)
  }
}

// Types d'events qu'une overlay alert_box doit recevoir et célébrer visuellement.
const ALERT_BOX_EVENT_TYPES: ReadonlySet<string> = new Set([
  'channel.follow',
  'channel.subscribe',
  'channel.subscription.gift',
  'channel.cheer',
  'channel.raid',
])

// Types d'events que les overlays stream_timer consomment :
// online → reset le chrono à partir du started_at fourni dans le payload,
// offline → cache l'overlay (stream terminé).
const STREAM_TIMER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'stream.online',
  'stream.offline',
])

// Le user qui agit dans le payload dépend de l'event. Pour la plupart des
// events, c'est `user_id` (le viewer qui follow / sub / cheer). Pour les
// events stream.online/offline, il n'y a que le broadcaster, on ne lie pas.
function extractTwitchUserId(eventType: string, payload: Record<string, unknown>): string | null {
  const evt = (payload as { event?: Record<string, unknown> }).event
  if (!evt) return null

  switch (eventType) {
    case 'channel.follow':
    case 'channel.subscribe':
    case 'channel.subscription.gift':
    case 'channel.cheer':
      return (evt.user_id as string | undefined) ?? null
    case 'channel.raid':
      return (evt.from_broadcaster_user_id as string | undefined) ?? null
    case 'stream.online':
    case 'stream.offline':
    case 'channel.poll.begin':
    case 'channel.poll.end':
      return null
    default:
      return null
  }
}

// ── Chat commands ─────────────────────────────────────────────────────────
// Parse les messages chat Twitch pour déclencher des actions Nodyx via les
// préfixes ! classiques. Cooldown Redis pour éviter le spam.

interface ChatBadge { set_id: string; id: string }
interface ChatEventPayload {
  event?: {
    broadcaster_user_id?: string
    chatter_user_id?:     string
    chatter_user_name?:   string
    message?:             { text?: string }
    badges?:              ChatBadge[]
  }
}

const CHAT_CMD_COOLDOWN_SEC = 30
function cooldownKey(cmd: string): string { return `streamer:chatcmd:cooldown:${cmd}` }

interface ChatCmdContext {
  triggeredBy:   string
  args:          string[]   // tokens après le nom de la commande
  chatterUserId?: string    // Twitch user id de l'auteur (utilisé pour rate-limit par chatter)
  rawText?:      string     // message complet (utile pour les cmds qui veulent la query brute)
}

interface ChatCommandDef {
  name:        string                                          // ex. "!nodyx"
  modOnly:     boolean                                         // true = streamer/mod uniquement
  description: string                                          // pour !commands
  handler:     (ctx: ChatCmdContext) => Promise<void>
}

// Liste figée des noms hardcoded (utilisée par le service custom pour
// refuser la création d'une command qui shadowerait une command native).
export function getHardcodedCommandNames(): readonly string[] {
  return CHAT_COMMANDS.map(c => c.name)
}

const CHAT_COMMANDS: ChatCommandDef[] = [
  { name: '!nodyx',     modOnly: false, description: "Lien d'invite vers la communauté Nodyx",     handler: execNodyxCommand },
  { name: '!uptime',    modOnly: false, description: "Durée écoulée depuis le début du stream",    handler: execUptimeCommand },
  { name: '!commands',  modOnly: false, description: "Liste les commandes disponibles",            handler: execCommandsCommand },
  { name: '!topclips',  modOnly: true,  description: "Lance le top des clips dans l'overlay OBS",  handler: ctx => execTopClipsCommand(ctx.triggeredBy) },
  { name: '!so',        modOnly: true,  description: "Shoutout : !so @streamer pour highlighter une chaine",  handler: execShoutoutCommand },
  { name: '!highlight', modOnly: true,  description: "Place un marker dans la VOD au moment courant",          handler: execHighlightCommand },
  { name: '!nextsound', modOnly: false, description: "!nextsound <nom> : ajoute un son à la queue Soundboard",  handler: execNextSoundCommand },
  { name: '!ns',        modOnly: false, description: "Alias court de !nextsound",                                 handler: execNextSoundCommand },
]

async function handleChatCommand(payload: Record<string, unknown>): Promise<void> {
  const p = payload as ChatEventPayload
  const evt = p.event
  if (!evt) return

  const raw = evt.message?.text?.trim() ?? ''
  if (!raw.startsWith('!')) return
  const tokens      = raw.split(/\s+/)
  const cmdName     = tokens[0].toLowerCase()
  const args        = tokens.slice(1)
  const chatterName = evt.chatter_user_name ?? '?'

  const cmd = CHAT_COMMANDS.find(c => c.name === cmdName)

  // Helper local pour le check streamer/mod
  const isStreamerOrMod = (): boolean => {
    const chatter     = evt.chatter_user_id     ?? ''
    const broadcaster = evt.broadcaster_user_id ?? ''
    const badges      = evt.badges ?? []
    const isStreamer  = chatter && broadcaster && chatter === broadcaster
    const isMod       = badges.some(b => b.set_id === 'moderator' || b.set_id === 'broadcaster')
    return !!isStreamer || isMod
  }

  if (cmd) {
    console.log(`[chat-cmd] received "${cmd.name}" from ${chatterName}`)
    if (cmd.modOnly && !isStreamerOrMod()) {
      console.log(`[chat-cmd] denied (not streamer or mod): ${chatterName} on ${cmd.name}`)
      return
    }
    await cmd.handler({
      triggeredBy:   chatterName,
      args,
      chatterUserId: evt.chatter_user_id ?? undefined,
      rawText:       raw,
    }).catch(err => console.error(`[chat-cmd] handler for ${cmd.name} failed`, err))
    return
  }

  // Fallback : commande custom en DB ?
  try {
    const { findCustomCommand } = await import('./chatCommandsService')
    const custom = await findCustomCommand(cmdName)
    if (!custom) {
      console.log(`[chat-cmd] unknown command: "${raw}"`)
      return
    }
    console.log(`[chat-cmd] received custom "${custom.name}" from ${chatterName}`)
    if (custom.modOnly && !isStreamerOrMod()) {
      console.log(`[chat-cmd] denied (custom modOnly): ${chatterName} on ${custom.name}`)
      return
    }
    // Cooldown spécifique à la command custom (clé séparée des hardcoded).
    const cdKey = `streamer:chatcmd:cooldown:custom:${custom.id}`
    const onCd = await redis.get(cdKey).catch(() => null)
    if (onCd) {
      console.log(`[chat-cmd] custom "${custom.name}" on cooldown, ignored`)
      return
    }
    // Render template via le même helper que les timers.
    const { previewTimer } = await import('./chatTimersService')
    const rendered = (await previewTimer(custom.responseTemplate).catch(() => '')).trim()
    if (!rendered) return
    await sendBotMessage(rendered)
    await redis.set(cdKey, '1', 'EX', custom.cooldownSeconds).catch(() => {})
  } catch (err) {
    console.error('[chat-cmd] custom command dispatch failed', err)
  }
}

// ── Helpers d'envoi côté Twitch (utilisés par toutes les commands) ─────────

async function sendBotMessage(text: string): Promise<void> {
  try {
    const { relayMessageToTwitch } = await import('./twitchChatBridge')
    await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'Nodyx',
      authorUserId:   null,
      text,
    })
  } catch (err) {
    console.error('[chat-cmd] sendBotMessage failed', err)
  }
}

// ── !nodyx : invite vers l'instance Nodyx ──────────────────────────────────

async function execNodyxCommand(_ctx: ChatCmdContext): Promise<void> {
  const onCd = await redis.get(cooldownKey('nodyx')).catch(() => null)
  if (onCd) return

  const url = (process.env.FRONTEND_URL ?? '').replace(/\/$/, '')
  if (!url) {
    console.log('[chat-cmd] !nodyx ignored: FRONTEND_URL not set')
    return
  }
  await sendBotMessage(`Rejoins la communauté sur Nodyx : ${url} — salons, voice, événements, hors-Twitch et open-source`)
  await redis.set(cooldownKey('nodyx'), '1', 'EX', CHAT_CMD_COOLDOWN_SEC).catch(() => {})
}

// ── !uptime : durée du stream en cours ─────────────────────────────────────

async function execUptimeCommand(_ctx: ChatCmdContext): Promise<void> {
  const onCd = await redis.get(cooldownKey('uptime')).catch(() => null)
  if (onCd) return

  const r = await db.query<{ started_at: Date }>(
    `SELECT started_at FROM streamer_sessions
     WHERE provider = 'twitch' AND ended_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
  ).catch(() => null)

  const session = r?.rows[0]
  if (!session) {
    await sendBotMessage('Pas de stream en cours actuellement')
  } else {
    const ms      = Date.now() - new Date(session.started_at).getTime()
    const totalMin = Math.max(0, Math.floor(ms / 60_000))
    const h        = Math.floor(totalMin / 60)
    const m        = totalMin % 60
    const formatted = h > 0 ? `${h}h ${m}min` : `${m}min`
    await sendBotMessage(`Stream en live depuis ${formatted}`)
  }
  await redis.set(cooldownKey('uptime'), '1', 'EX', CHAT_CMD_COOLDOWN_SEC).catch(() => {})
}

// ── !commands : liste des commandes disponibles ─────────────────────────────

async function execCommandsCommand(_ctx: ChatCmdContext): Promise<void> {
  const onCd = await redis.get(cooldownKey('commands')).catch(() => null)
  if (onCd) return

  const publicNames = CHAT_COMMANDS.filter(c => !c.modOnly).map(c => c.name).join(' ')
  await sendBotMessage(`Commandes : ${publicNames}`)
  await redis.set(cooldownKey('commands'), '1', 'EX', CHAT_CMD_COOLDOWN_SEC).catch(() => {})
}

// ── !so : shoutout d'un autre streamer (mod/streamer only) ─────────────────

async function execShoutoutCommand(ctx: ChatCmdContext): Promise<void> {
  const onCd = await redis.get(cooldownKey('so')).catch(() => null)
  if (onCd) {
    console.log(`[chat-cmd] !so on cooldown, ignored from ${ctx.triggeredBy}`)
    return
  }

  const target = ctx.args[0]
  if (!target) {
    await sendBotMessage(`Usage : !so @streamer`)
    return
  }

  const { getUserByLogin, getChannelByBroadcasterId } = await import('./twitchStreamControl')
  const userRes = await getUserByLogin(target)
  if (!userRes.ok || !userRes.data) {
    console.log(`[chat-cmd] !so: user "${target}" not found`)
    return
  }
  const user = userRes.data

  const chanRes = await getChannelByBroadcasterId(user.id)
  const game  = chanRes.ok && chanRes.data ? chanRes.data.gameName : ''
  const title = chanRes.ok && chanRes.data ? chanRes.data.title    : ''

  const url = `https://twitch.tv/${user.login}`
  let msg = `Allez follow @${user.displayName} : ${url}`
  if (game)  msg += ` — actuellement sur ${game}`
  if (title) msg += ` (${title.slice(0, 80)})`

  await sendBotMessage(msg)
  await redis.set(cooldownKey('so'), '1', 'EX', CHAT_CMD_COOLDOWN_SEC).catch(() => {})
}

// ── !highlight : place un marker VOD au moment courant (mod/streamer only) ─

async function execHighlightCommand(ctx: ChatCmdContext): Promise<void> {
  const onCd = await redis.get(cooldownKey('highlight')).catch(() => null)
  if (onCd) {
    console.log(`[chat-cmd] !highlight on cooldown, ignored from ${ctx.triggeredBy}`)
    return
  }

  const description = ctx.args.join(' ').trim().slice(0, 140) || `Highlight by ${ctx.triggeredBy}`

  const { createMarker } = await import('./twitchStreamControl')
  const r = await createMarker({ description })
  if (!r.ok) {
    // 404 = stream offline, on l'annonce poliment côté chat
    if (r.status === 404) {
      await sendBotMessage(`Impossible de placer un marker : pas de stream en cours`)
    } else if (r.status === 403) {
      console.log(`[chat-cmd] !highlight: missing scope channel:manage:broadcast`)
    } else {
      console.log(`[chat-cmd] !highlight failed: ${r.status} ${r.reason}`)
    }
    return
  }

  // Audit log côté admin (réutilise l'action existante du Studio Live)
  await audit({
    action:    'vod_marker_created',
    status:    'success',
    userId:    null,
    metadata:  { description, viaChat: true, triggeredBy: ctx.triggeredBy, markerId: r.data.id },
  })

  const m  = Math.floor(r.data.positionSeconds / 60)
  const s  = Math.floor(r.data.positionSeconds % 60)
  const ts = `${m}:${s.toString().padStart(2, '0')}`
  await sendBotMessage(`Moment marqué dans la VOD à ${ts}`)
  await redis.set(cooldownKey('highlight'), '1', 'EX', CHAT_CMD_COOLDOWN_SEC).catch(() => {})
}

async function execTopClipsCommand(triggeredBy: string): Promise<void> {
  const onCd = await redis.get(cooldownKey("topclips")).catch(() => null)
  if (onCd) {
    console.log(`[chat-cmd] !topclips on cooldown, ignored from ${triggeredBy}`)
    return
  }

  const { listOverlays } = await import("./overlayService")
  const overlays = await listOverlays().catch(() => [])
  const target = overlays.find(o => o.overlayType === "clips_player" && !o.revokedAt)
  if (!target) {
    console.log("[chat-cmd] !topclips ignored: no clips_player overlay configured")
    return
  }

  const { listOwnTopClips } = await import("./twitchClips")
  const { getClipMp4Url } = await import("./twitchClipExtraction")

  // Fallback en cascade : 7d → 30d → all, pour toujours trouver quelque
  // chose tant qu'il y a au moins un clip sur la chaine.
  let clips = await listOwnTopClips("7d", 5)
  let period: '7d' | '30d' | 'all' = '7d'
  if (clips.length === 0) { clips = await listOwnTopClips("30d", 5); period = '30d' }
  if (clips.length === 0) { clips = await listOwnTopClips("all", 5); period = 'all' }
  if (clips.length === 0) {
    console.log("[chat-cmd] !topclips: no clips found on the channel at all")
    return
  }
  console.log(`[chat-cmd] !topclips: ${clips.length} clips found via period ${period}`)

  const enriched = await Promise.all(clips.map(async c => ({
    id:           c.id,
    embedUrl:     c.embedUrl,
    title:        c.title,
    creatorName:  c.creatorName,
    duration:     c.duration,
    thumbnailUrl: c.thumbnailUrl,
    viewCount:    c.viewCount,
    mp4Url:       await getClipMp4Url(c.id),
  })))

  if (io) {
    io.of("/overlay").to(`overlay:${target.id}`).emit("clips:play", { clips: enriched })
    console.log(`[chat-cmd] !topclips triggered by ${triggeredBy}, ${enriched.length} clips → overlay ${target.id}`)
  }

  // Feedback chat : on poste un message côté Twitch pour que les viewers voient
  // que la commande a bien été reçue et que les clips démarrent dans l'overlay.
  const label = period === '7d' ? '7 jours' : period === '30d' ? '30 jours' : 'total'
  try {
    const { relayMessageToTwitch } = await import('./twitchChatBridge')
    await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'Nodyx',
      authorUserId:   null,
      text:           `Top ${enriched.length} clip${enriched.length > 1 ? 's' : ''} en cours dans l'overlay (période : ${label})`,
    }).catch(err => console.error('[chat-cmd] feedback chat failed', err))
  } catch (err) {
    console.error('[chat-cmd] feedback chat import failed', err)
  }

  await redis.set(cooldownKey("topclips"), "1", "EX", CHAT_CMD_COOLDOWN_SEC).catch(() => {})
}

// !nextsound / !ns : ajoute un son à la queue Soundboard. Fuzzy match du titre
// pour qu'un viewer puisse taper juste "ixion" et matcher le titre complet.
// Anti-spam : rate-limit par chatter Twitch (via la couche queue service,
// même règle 30s / cap 3 / dédup que la page publique).
async function execNextSoundCommand(ctx: ChatCmdContext): Promise<void> {
  const chatterName = ctx.triggeredBy
  const chatterId   = ctx.chatterUserId

  // Query : tout ce qui suit la commande. On reconstitue depuis args parce que
  // le tokenizer de handleChatCommand split sur les espaces.
  const query = ctx.args.join(' ').trim()

  if (!query) {
    await sendBotMessage(`@${chatterName} usage : !nextsound <nom du son>  (ou !ns)`)
    return
  }
  if (!chatterId) {
    // Sans identité Twitch, on ne peut pas rate-limit proprement → on refuse
    // pour pas créer de back-door anti-spam.
    return
  }

  try {
    const [{ listStreamers }, { listPublicTracks }, { findTrackByQuery }, { addToQueue }] = await Promise.all([
      import('./tokenService'),
      import('./audioLibraryService'),
      import('./audioTrackMatcher'),
      import('./soundboardQueueService'),
    ])

    const streamers = await listStreamers('twitch').catch(() => [])
    const ownerUserId = streamers[0]?.userId
    if (!ownerUserId) return

    const tracks = await listPublicTracks(ownerUserId).catch(() => [])
    if (tracks.length === 0) {
      await sendBotMessage(`@${chatterName} aucun son public pour le moment.`)
      return
    }

    const match = findTrackByQuery(query, tracks)
    if (!match.best && match.ambiguous.length === 0) {
      await sendBotMessage(`@${chatterName} aucun son ne correspond à "${query.slice(0, 40)}". Liste : nodyx.org/soundboard`)
      return
    }
    if (!match.best && match.ambiguous.length > 0) {
      // Ambiguïté : on liste les top 3 pour que le user précise. On tronque
      // les titres pour pas exploser la limite Twitch (~500 chars).
      const picks = match.ambiguous.slice(0, 3).map(t => `"${t.title.slice(0, 40)}"`).join(', ')
      await sendBotMessage(`@${chatterName} précise — candidats : ${picks}`)
      return
    }

    // Match unique → push queue. On utilise une "actor key" préfixée tw: pour
    // le rate-limit dans le service queue (qui s'attend à une string IP en V1).
    const result = await addToQueue({
      ownerUserId,
      trackId:    match.best!.id,
      ip:         `tw:${chatterId}`,
      addedBy:    `@${chatterName}`,
      source:     'chat',
    })

    if (result.ok) {
      await sendBotMessage(`@${chatterName} "${match.best!.title.slice(0, 40)}" ajouté à la queue ✓`)
      return
    }
    switch (result.reason) {
      case 'disabled':
        await sendBotMessage(`@${chatterName} les ajouts viewers sont désactivés.`)
        return
      case 'rate_limit':
        await sendBotMessage(`@${chatterName} attends 30s avant ton prochain ajout.`)
        return
      case 'cap_per_ip':
        await sendBotMessage(`@${chatterName} tu as déjà 3 sons en queue, patiente.`)
        return
      case 'queue_full':
        await sendBotMessage(`@${chatterName} queue pleine, retente plus tard.`)
        return
      case 'duplicate':
        await sendBotMessage(`@${chatterName} "${match.best!.title.slice(0, 40)}" est déjà en queue.`)
        return
      case 'track_not_public':
      case 'track_not_found':
        await sendBotMessage(`@${chatterName} ce son n'est pas disponible.`)
        return
    }
  } catch (err) {
    console.error('[chat-cmd] !nextsound failed', err)
  }
}

