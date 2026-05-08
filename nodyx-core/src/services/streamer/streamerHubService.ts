// ─── Streamer Hub — orchestration service ───────────────────────────────────
// Façade unique pour les routes : OAuth flow, subscriptions EventSub,
// state Redis, dispatch events. Pas de logique HTTP ici (les routes parsent
// les requests, ce service prend des arguments propres).

import { redis, db } from '../../config/database'
import { randomBytes } from 'node:crypto'
import {
  saveStreamerTokens,
  findPrimaryStreamer,
  type StreamerTokenRow,
} from './tokenService'
import { createSubscription, listSubscriptions, setExternalSubId } from './eventsubService'
import { recordEvent } from './eventService'
import { pushEventToChat } from './streamerChat'
import { audit } from './audit'
import { twitchProvider } from './providers/twitchProvider'
import type { StreamerProvider, ProviderId } from './providers/_types'

// ── State CSRF (OAuth) ───────────────────────────────────────────────────────

const STATE_PREFIX      = 'streamer:oauth:state:'
const STATE_TTL_SECONDS = 600  // 10 min

interface OAuthState {
  adminUserId: string
  ip:          string
  createdAt:   number
}

export async function createOAuthState(args: {
  adminUserId: string
  ip:          string
}): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  const payload: OAuthState = {
    adminUserId: args.adminUserId,
    ip:          args.ip,
    createdAt:   Date.now(),
  }
  await redis.set(STATE_PREFIX + token, JSON.stringify(payload), 'EX', STATE_TTL_SECONDS)
  return token
}

export async function consumeOAuthState(token: string): Promise<OAuthState | null> {
  const key   = STATE_PREFIX + token
  const value = await redis.get(key)
  if (!value) return null
  await redis.del(key)
  try { return JSON.parse(value) as OAuthState } catch { return null }
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

// ── Subscribe EventSub events Phase 1 (§5.2 spec) ───────────────────────────

interface SubscribeSpec {
  eventType: string
  version:   string
  condition: Record<string, string>
}

function buildSubscribeSpecsForPhase1(broadcasterId: string): SubscribeSpec[] {
  return [
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
  ]
}

export interface SubscribeResult {
  eventType:     string
  status:        'created' | 'failed'
  externalSubId?: string
  error?:        string
}

export async function subscribeAllStreamerEvents(args: {
  provider:      StreamerProvider
  broadcasterId: string
  publicBase:    string  // ex https://nodyx.org
}): Promise<SubscribeResult[]> {
  const appToken = await args.provider.getAppAccessToken()
  const specs    = buildSubscribeSpecsForPhase1(args.broadcasterId)
  const results: SubscribeResult[] = []

  for (const spec of specs) {
    try {
      const hmacSecret = randomBytes(32).toString('base64url').slice(0, 64) // 64 ASCII chars (10..100 OK)
      const placeholder = await createSubscription({
        provider:      args.provider.id,
        externalSubId: 'pending',
        eventType:     spec.eventType,
        hmacSecret,
      })

      const callbackUrl = `${args.publicBase.replace(/\/+$/, '')}/api/v1/integrations/twitch/eventsub/${placeholder.callbackNonce}`
      const created = await args.provider.createEventSubscription({
        appAccessToken: appToken,
        eventType:      spec.eventType,
        condition:      { ...spec.condition, version: spec.version },
        callbackUrl,
        hmacSecret,
      })

      // Set le vrai external_sub_id reçu de Twitch (le placeholder était 'pending').
      // Note : Twitch peut avoir déjà appelé /eventsub/:nonce pour la verification
      // entre l'INSERT et ici. Le webhook handler markEnabledById(sub.id) fait
      // référence au rowId stable, donc l'enabled_at est déjà set même si le
      // status était 'pending' au moment de la verification.
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

  return results
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

  // 5. Subscribe aux events Phase 1
  const subscribeResults = await subscribeAllStreamerEvents({
    provider:      args.provider,
    broadcasterId: user.id,
    publicBase:    args.publicBase,
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
  // visibilité dans l'UI chat existante. Author = primary streamer (le user
  // Nodyx qui a OAuth-connecté Twitch). Best-effort : si la résolution
  // échoue, on a déjà persisté l'event en DB.
  try {
    const primary = await findPrimaryStreamer(args.provider)
    if (primary?.userId) {
      await pushEventToChat({
        provider:  args.provider,
        eventType: args.eventType,
        payload:   args.payload,
        authorId:  primary.userId,
      })
    }
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
