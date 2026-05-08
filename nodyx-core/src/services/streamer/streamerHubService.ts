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

// Dès Phase 2 (chat bridge), on demande aussi user:read:chat / user:write:chat.
// On exporte la liste élargie pour faciliter la transition sans refactor des
// routes côté caller.
export const STREAMER_HUB_SCOPES = [
  ...PHASE_1_SCOPES,
  'user:read:chat',
  'user:write:chat',
  'channel:read:polls',
] as const

// Scopes minimaux pour le viewer flow : on a juste besoin d'identifier le user
// Twitch et de récupérer son login. Pas besoin de lire son chat, ses subs, etc.
export const VIEWER_SCOPES = ['user:read:email'] as const

// ── Subscribe EventSub events Phase 1 + 2 (§5.2 + §6.1 spec) ───────────────

interface SubscribeSpec {
  eventType: string
  version:   string
  condition: Record<string, string>
  // Scope user requis pour cette subscription. Si le streamer connecté n'a
  // pas accordé ce scope, on skip silencieusement (pas d'erreur). Permet de
  // dégrader gracieusement quand on ajoute des events Phase 2+ sur des
  // anciennes connexions Phase 1.
  requiredScope?: string
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
    // channel.chat.message exige le scope user:read:chat sur le user_id
    // (qui est le lecteur du chat, ici le streamer lit son propre chat).
    {
      eventType: 'channel.chat.message',
      version:   '1',
      condition: { broadcaster_user_id: broadcasterId, user_id: broadcasterId },
      requiredScope: 'user:read:chat',
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
}): Promise<SubscribeResult[]> {
  const appToken = await args.provider.getAppAccessToken()
  const specs    = buildSubscribeSpecs(args.broadcasterId)
  const granted  = new Set(args.grantedScopes ?? [])
  const results: SubscribeResult[] = []

  // Liste les subs existantes côté Twitch UNE FOIS pour pouvoir dédupliquer.
  // Évite la dérive "27 subs sur Twitch alors qu'on en veut 10" qu'on avait
  // au premier sync de Phase 2.
  let existingSubs: Awaited<ReturnType<StreamerProvider['listEventSubscriptions']>> = []
  try {
    existingSubs = await args.provider.listEventSubscriptions(appToken)
  } catch (err) {
    console.error('[streamerHub] listEventSubscriptions failed (continuing without dedup)', err)
  }

  // Lazy-load le user access token : on ne le récupère que si une spec en a besoin.
  let userToken: string | null = null
  let userTokenLoaded = false

  for (const spec of specs) {
    // Skip si scope requis non accordé.
    if (spec.requiredScope && !granted.has(spec.requiredScope)) {
      results.push({
        eventType: spec.eventType,
        status:    'skipped',
        reason:    `missing_scope:${spec.requiredScope}`,
      })
      continue
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

    // Choix du token : user access token si requiredScope (event user-scoped),
    // sinon app access token (events broadcaster-scoped).
    let accessToken = appToken
    if (spec.requiredScope) {
      if (!userTokenLoaded) {
        userToken = await getValidUserAccessToken(args.provider)
        userTokenLoaded = true
      }
      if (!userToken) {
        results.push({
          eventType: spec.eventType,
          status:    'failed',
          error:     'no_valid_user_access_token',
        })
        continue
      }
      accessToken = userToken
    }

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
        accessToken,
        eventType:  spec.eventType,
        condition:  { ...spec.condition, version: spec.version },
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
      results.push({
        eventType: spec.eventType,
        status:    'failed',
        error:     (err as Error).message,
      })
    }
  }

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

  // 5. Subscribe aux events Phase 1+2 (skip ceux dont le scope manque)
  const subscribeResults = await subscribeAllStreamerEvents({
    provider:      args.provider,
    broadcasterId: user.id,
    publicBase:    args.publicBase,
    grantedScopes: tokens.scopes,
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
