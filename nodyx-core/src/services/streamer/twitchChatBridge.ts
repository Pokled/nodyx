// ─── Streamer Hub — outbound chat bridge (Nodyx → Twitch) ──────────────────
// Quand un membre Nodyx écrit dans le channel #twitch-chat, on relaie le
// message vers le chat Twitch via Helix POST /chat/messages.
//
// Convention :
//   - Le message est POST avec sender_id = broadcaster_id = streamer Twitch.
//     Le streamer "héberge" donc tous les messages relayés.
//   - Le contenu est préfixé par [NodyxAuthor] pour que les viewers Twitch
//     comprennent que ce n'est pas le streamer qui écrit directement.
//   - Garde-fou §6.4 : on ne relaie QUE si le streamer est actuellement en
//     live (streamer_sessions.ended_at IS NULL). Sinon on persiste côté
//     Nodyx mais on ne spam pas un chat offline. Mode test (env var) bypass.
//   - Recovery §6.5 : si Helix retourne 429 (rate-limit), on enqueue dans
//     chatOutboundQueue qui retry avec backoff exponentiel.

import { db } from '../../config/database'
import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { audit } from './audit'
import { twitchProvider } from './providers/twitchProvider'
import { enqueueOutbound, startOutboundWorker } from './chatOutboundQueue'
import type { ProviderId } from './providers/_types'

const RELAY_PREFIX_DISABLED = process.env.STREAMER_CHAT_NO_PREFIX === '1'
const RELAY_TEST_MODE       = process.env.STREAMER_CHAT_TEST_MODE === '1'

// ── Stream live check (§6.4) ────────────────────────────────────────────────

async function isStreamerLive(broadcasterExternalId: string): Promise<boolean> {
  if (RELAY_TEST_MODE) return true
  // Une instance Nodyx = un streamer principal, donc une seule row ouverte
  // dans streamer_sessions à un instant T. Le lifecycle (open/close) est
  // géré par handleStreamerEvent sur stream.online / stream.offline.
  const r = await db.query<{ id: string }>(
    `SELECT id FROM streamer_sessions
     WHERE provider = 'twitch' AND external_id IS NOT NULL
       AND ended_at IS NULL
     LIMIT 1`,
  )
  void broadcasterExternalId
  return r.rows.length > 0
}

// ── Helix POST /chat/messages (Twitch send) ─────────────────────────────────

interface HelixSendChatResponse {
  data?: Array<{
    message_id:  string
    is_sent:     boolean
    drop_reason?: { code: string; message: string } | null
  }>
}

type PostResult =
  | { ok: true; messageId: string }
  | { ok: false; rateLimited: true; status: number }
  | { ok: false; rateLimited: false; reason: string }

async function postTwitchChatMessage(args: {
  userAccessToken: string
  broadcasterId:   string
  senderId:        string
  message:         string
}): Promise<PostResult> {
  const clientId = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!clientId) return { ok: false, rateLimited: false, reason: 'no_client_id' }

  const res = await fetch('https://api.twitch.tv/helix/chat/messages', {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${args.userAccessToken}`,
      'Client-Id':     clientId,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      broadcaster_id: args.broadcasterId,
      sender_id:      args.senderId,
      message:        args.message,
    }),
  })

  if (res.status === 429) {
    return { ok: false, rateLimited: true, status: 429 }
  }

  if (!res.ok) {
    const body = await res.text()
    return { ok: false, rateLimited: false, reason: `http_${res.status}:${body.slice(0, 200)}` }
  }

  const data = await res.json() as HelixSendChatResponse
  const sent = data.data?.[0]
  if (!sent) return { ok: false, rateLimited: false, reason: 'empty_response' }
  if (!sent.is_sent) {
    return { ok: false, rateLimited: false, reason: `dropped:${sent.drop_reason?.code ?? 'unknown'}` }
  }
  return { ok: true, messageId: sent.message_id }
}

// ── Token freshness ─────────────────────────────────────────────────────────
// Le user access token Twitch dure ~4h. On refresh proactivement quand il
// expirera dans < 5 min pour éviter un 401 en pleine session de stream.

async function getValidStreamerAccessToken(): Promise<{ token: string; broadcasterId: string } | null> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return null

  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  const expiresInMs = primary.expiresAt.getTime() - Date.now()
  if (expiresInMs < REFRESH_MARGIN_MS) {
    try {
      await refreshAndPersist({ provider: twitchProvider, rowId: primary.id })
    } catch (err) {
      console.error('[twitchChatBridge] refresh failed', err)
      return null
    }
  }

  const decrypted = await getDecryptedTokens(primary.id)
  if (!decrypted) return null
  return { token: decrypted.accessToken, broadcasterId: primary.externalId }
}

// ── Dispatcher (utilisé par le path direct ET le worker queue) ──────────────
// Prend un message déjà formaté (préfixe + truncation), résout token frais,
// check stream live, envoie via Helix. Retourne un Result discriminé pour
// que la queue puisse décider rescheduler vs drop.

async function dispatchToTwitch(text: string): Promise<
  | { ok: true }
  | { ok: false; rateLimited: true }
  | { ok: false; rateLimited: false; reason: string }
> {
  const tok = await getValidStreamerAccessToken()
  if (!tok) return { ok: false, rateLimited: false, reason: 'no_streamer' }

  const live = await isStreamerLive(tok.broadcasterId)
  if (!live) return { ok: false, rateLimited: false, reason: 'stream_offline' }

  const r = await postTwitchChatMessage({
    userAccessToken: tok.token,
    broadcasterId:   tok.broadcasterId,
    senderId:        tok.broadcasterId,
    message:         text,
  })

  if (r.ok) return { ok: true }
  if (r.rateLimited) return { ok: false, rateLimited: true }
  return { ok: false, rateLimited: false, reason: r.reason }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface RelayResult {
  ok:      boolean
  reason?: string  // 'stream_offline', 'no_streamer', 'rate_limited_queued', etc.
}

export async function relayMessageToTwitch(args: {
  provider:       ProviderId
  authorUsername: string
  authorUserId:   string | null
  text:           string
}): Promise<RelayResult> {
  if (args.provider !== 'twitch') return { ok: false, reason: 'unsupported_provider' }

  // Pré-formatage : prefix + truncation 500 chars (limite Twitch).
  const prefix  = RELAY_PREFIX_DISABLED ? '' : `[${args.authorUsername}] `
  const message = (prefix + args.text).slice(0, 500)

  const r = await dispatchToTwitch(message)

  if (r.ok) return { ok: true }

  if (r.rateLimited) {
    // 429 → on absorbe dans la queue, le worker retry avec backoff.
    await enqueueOutbound(message)
    return { ok: false, reason: 'rate_limited_queued' }
  }

  // stream_offline et no_streamer sont des états attendus (pas d'audit pour
  // éviter le bruit). Tout autre échec : audit pour diagnostic.
  if (r.reason !== 'stream_offline' && r.reason !== 'no_streamer') {
    await audit({
      action:    'chat_relay_dropped',
      status:    'failed',
      userId:    args.authorUserId,
      metadata:  {
        reason:         r.reason,
        authorUsername: args.authorUsername,
        textLength:     message.length,
      },
    })
  }
  return { ok: false, reason: r.reason }
}

// Démarre le worker queue. À appeler une fois au boot (depuis index.ts).
// Idempotent : startOutboundWorker garde un singleton interne.
export function startChatOutboundWorker(): void {
  startOutboundWorker(dispatchToTwitch)
}

// Export pour tests ou usage admin debug
export const _testInternals = { isStreamerLive, postTwitchChatMessage, dispatchToTwitch }
