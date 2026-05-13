// ─── Streamer Hub — outbound chat queue (Twitch rate-limit recovery) ────────
// Si Helix POST /chat/messages renvoie 429 (rate-limit), on persiste le message
// dans une sorted set Redis (score = nextRetryAt epoch ms). Un worker dépile
// par batch toutes les WORKER_TICK_MS et retry. Drop si expires_at dépassé
// (60s max) ou si attempts > MAX_ATTEMPTS. Alerte admin si queue > 50.
//
// Spec §6.5 + §15.bis #5 : limite Helix = 100 req/min compte régulier, 1500
// affilié/partenaire. Volume Nodyx normal très en dessous, donc cette queue
// existe pour absorber un burst exceptionnel (raid, hype train) sans perdre
// silencieusement de messages.

import { redis } from '../../config/database'
import { audit } from './audit'
import { randomUUID } from 'node:crypto'

const QUEUE_KEY              = 'streamer:chat:send_queue'
export const MAX_QUEUE_BEFORE_ALERT = 50
export const MESSAGE_TTL_MS  = 60 * 1000
export const MAX_ATTEMPTS    = 5
const WORKER_TICK_MS         = 2000
const BATCH_SIZE             = 10

export interface QueuedMessage {
  id:          string
  text:        string   // déjà formaté (prefix + truncation), prêt à send
  enqueuedAt:  number
  expiresAt:   number
  attempts:    number
}

export function nextBackoffMs(attempts: number): number {
  // 2^attempts secondes, capé à 30s. attempts=0 → 1s, =1 → 2s, =5 → 30s.
  return Math.min(Math.pow(2, attempts) * 1000, 30_000)
}

export async function getQueueLength(): Promise<number> {
  try { return await redis.zcard(QUEUE_KEY) } catch { return 0 }
}

export async function enqueueOutbound(text: string): Promise<{ length: number; overflowAlerted: boolean }> {
  const now = Date.now()
  const msg: QueuedMessage = {
    id:         randomUUID(),
    text,
    enqueuedAt: now,
    expiresAt:  now + MESSAGE_TTL_MS,
    attempts:   0,
  }
  await redis.zadd(QUEUE_KEY, now, JSON.stringify(msg))
  const length = await getQueueLength()
  let overflowAlerted = false

  await audit({
    action:   'chat_relay_queued',
    status:   'success',
    metadata: { textLength: text.length, queueLength: length },
  })

  if (length > MAX_QUEUE_BEFORE_ALERT) {
    overflowAlerted = true
    await audit({
      action:   'chat_relay_queue_overflow',
      status:   'failed',
      metadata: { queueLength: length, threshold: MAX_QUEUE_BEFORE_ALERT },
    })
    console.warn(`[chatOutboundQueue] OVERFLOW: queue length=${length} > ${MAX_QUEUE_BEFORE_ALERT}`)
  }

  return { length, overflowAlerted }
}

// Récupère et REMOVE les messages dont nextRetryAt <= now. Le retour est
// déjà parsé. Si parse fail, le membre est silencieusement skip (sera ZREM
// par la fenêtre de batch suivante).
export async function popDueMessages(now: number = Date.now()): Promise<QueuedMessage[]> {
  const members = await redis.zrangebyscore(QUEUE_KEY, 0, now, 'LIMIT', 0, BATCH_SIZE)
  if (members.length === 0) return []
  await redis.zrem(QUEUE_KEY, ...members)
  const parsed: QueuedMessage[] = []
  for (const m of members) {
    try { parsed.push(JSON.parse(m) as QueuedMessage) } catch { /* skip corrupted */ }
  }
  return parsed
}

// Re-enqueue un message avec un backoff (sur 429). attempts ++.
export async function rescheduleOutbound(msg: QueuedMessage): Promise<void> {
  const updated: QueuedMessage = { ...msg, attempts: msg.attempts + 1 }
  const nextRetryAt = Date.now() + nextBackoffMs(updated.attempts)
  // Si le prochain retry dépasse expiresAt, on drop direct.
  if (nextRetryAt >= updated.expiresAt) {
    await audit({
      action:   'chat_relay_dropped',
      status:   'failed',
      metadata: { reason: 'expired_before_retry', attempts: updated.attempts, textLength: updated.text.length },
    })
    return
  }
  await redis.zadd(QUEUE_KEY, nextRetryAt, JSON.stringify(updated))
}

// Drop définitif (audit). À appeler depuis le worker quand le message est
// expiré, trop d'attempts, ou échec non-recover (ex: auth, drop_reason).
export async function dropOutbound(msg: QueuedMessage, reason: string): Promise<void> {
  await audit({
    action:   'chat_relay_dropped',
    status:   'failed',
    metadata: { reason, attempts: msg.attempts, textLength: msg.text.length },
  })
}

// ── Worker ─────────────────────────────────────────────────────────────────

type Dispatcher = (text: string) => Promise<
  { ok: true } | { ok: false; rateLimited: true } | { ok: false; rateLimited: false; reason: string }
>

let _workerHandle: NodeJS.Timeout | null = null

export function startOutboundWorker(dispatch: Dispatcher): NodeJS.Timeout {
  if (_workerHandle) return _workerHandle
  _workerHandle = setInterval(() => { void tick(dispatch) }, WORKER_TICK_MS)
  return _workerHandle
}

export function stopOutboundWorker(): void {
  if (_workerHandle) {
    clearInterval(_workerHandle)
    _workerHandle = null
  }
}

async function tick(dispatch: Dispatcher): Promise<void> {
  let due: QueuedMessage[]
  try { due = await popDueMessages() } catch (err) {
    console.error('[chatOutboundQueue] popDueMessages failed', err)
    return
  }
  for (const msg of due) {
    // Expiré pendant qu'on dormait ?
    if (Date.now() > msg.expiresAt) {
      await dropOutbound(msg, 'expired_in_queue')
      continue
    }
    if (msg.attempts >= MAX_ATTEMPTS) {
      await dropOutbound(msg, 'max_attempts')
      continue
    }
    try {
      const r = await dispatch(msg.text)
      if (r.ok) {
        await audit({
          action:   'chat_relay_sent',
          status:   'success',
          metadata: { fromQueue: true, attempts: msg.attempts + 1, textLength: msg.text.length },
        })
        continue
      }
      if (r.rateLimited) {
        await rescheduleOutbound(msg)
        continue
      }
      await dropOutbound(msg, r.reason)
    } catch (err) {
      console.error('[chatOutboundQueue] dispatch throw, rescheduling', err)
      await rescheduleOutbound(msg)
    }
  }
}

// Export pour tests
export const _testInternals = { tick, QUEUE_KEY }
