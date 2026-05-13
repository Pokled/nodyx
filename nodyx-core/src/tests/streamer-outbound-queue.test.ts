// ─── Streamer Hub — chat outbound queue (rate-limit recovery) ───────────────
// Couvre : enqueue + overflow alert, backoff exponentiel, pop/reschedule/drop,
// worker tick (succès/rate-limited/erreur/expired/max attempts).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { redisZaddMock, redisZcardMock, redisZrangebyscoreMock, redisZremMock } = vi.hoisted(() => ({
  redisZaddMock:          vi.fn().mockResolvedValue(1),
  redisZcardMock:         vi.fn().mockResolvedValue(0),
  redisZrangebyscoreMock: vi.fn().mockResolvedValue([]),
  redisZremMock:          vi.fn().mockResolvedValue(1),
}))

const { auditMock } = vi.hoisted(() => ({
  auditMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../config/database', () => ({
  db:    {},
  redis: {
    zadd:          redisZaddMock,
    zcard:         redisZcardMock,
    zrangebyscore: redisZrangebyscoreMock,
    zrem:          redisZremMock,
  },
}))

vi.mock('../services/streamer/audit', () => ({
  audit: auditMock,
}))

import {
  enqueueOutbound,
  popDueMessages,
  rescheduleOutbound,
  dropOutbound,
  nextBackoffMs,
  getQueueLength,
  MAX_QUEUE_BEFORE_ALERT,
  MESSAGE_TTL_MS,
  MAX_ATTEMPTS,
  type QueuedMessage,
} from '../services/streamer/chatOutboundQueue'

beforeEach(() => {
  vi.resetAllMocks()
  redisZaddMock.mockResolvedValue(1)
  redisZcardMock.mockResolvedValue(0)
  redisZrangebyscoreMock.mockResolvedValue([])
  redisZremMock.mockResolvedValue(1)
  auditMock.mockResolvedValue(undefined)
})

describe('nextBackoffMs — backoff exponentiel capé', () => {
  it('progresse 1s → 2s → 4s → 8s → 16s → 30s', () => {
    expect(nextBackoffMs(0)).toBe(1000)
    expect(nextBackoffMs(1)).toBe(2000)
    expect(nextBackoffMs(2)).toBe(4000)
    expect(nextBackoffMs(3)).toBe(8000)
    expect(nextBackoffMs(4)).toBe(16000)
    expect(nextBackoffMs(5)).toBe(30000)  // 32s capé à 30s
    expect(nextBackoffMs(10)).toBe(30000)
  })
})

describe('enqueueOutbound', () => {
  it('zadd avec score = now et audit queued', async () => {
    redisZcardMock.mockResolvedValueOnce(3)
    const before = Date.now()
    const r = await enqueueOutbound('[alice] hello')
    const after = Date.now()

    expect(redisZaddMock).toHaveBeenCalledTimes(1)
    const [key, score, member] = redisZaddMock.mock.calls[0]!
    expect(key).toBe('streamer:chat:send_queue')
    expect(typeof score).toBe('number')
    expect(score as number).toBeGreaterThanOrEqual(before)
    expect(score as number).toBeLessThanOrEqual(after)
    const parsed = JSON.parse(member as string) as QueuedMessage
    expect(parsed.text).toBe('[alice] hello')
    expect(parsed.attempts).toBe(0)
    expect(parsed.expiresAt - parsed.enqueuedAt).toBe(MESSAGE_TTL_MS)

    expect(r.length).toBe(3)
    expect(r.overflowAlerted).toBe(false)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_relay_queued',
      status: 'success',
    }))
  })

  it('alerte overflow si queue > MAX_QUEUE_BEFORE_ALERT', async () => {
    redisZcardMock.mockResolvedValueOnce(MAX_QUEUE_BEFORE_ALERT + 1)
    const r = await enqueueOutbound('msg')
    expect(r.overflowAlerted).toBe(true)
    expect(auditMock).toHaveBeenCalledTimes(2)  // queued + queue_overflow
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_relay_queue_overflow',
      status: 'failed',
    }))
  })
})

describe('popDueMessages', () => {
  it('ZRANGEBYSCORE 0..now + ZREM + parse', async () => {
    const msg: QueuedMessage = {
      id: 'mid-1', text: 'hi', enqueuedAt: 1, expiresAt: 100000, attempts: 0,
    }
    redisZrangebyscoreMock.mockResolvedValueOnce([JSON.stringify(msg)])
    const due = await popDueMessages(50_000)
    expect(redisZrangebyscoreMock).toHaveBeenCalledWith('streamer:chat:send_queue', 0, 50_000, 'LIMIT', 0, 10)
    expect(redisZremMock).toHaveBeenCalledTimes(1)
    expect(due).toEqual([msg])
  })

  it('skip silencieusement les membres JSON invalides', async () => {
    redisZrangebyscoreMock.mockResolvedValueOnce(['not-json', JSON.stringify({
      id: 'x', text: 't', enqueuedAt: 0, expiresAt: 1, attempts: 0,
    })])
    const due = await popDueMessages()
    expect(due).toHaveLength(1)
    expect(due[0]!.id).toBe('x')
  })

  it('retourne [] si queue vide (pas de ZREM)', async () => {
    redisZrangebyscoreMock.mockResolvedValueOnce([])
    const due = await popDueMessages()
    expect(due).toEqual([])
    expect(redisZremMock).not.toHaveBeenCalled()
  })
})

describe('rescheduleOutbound', () => {
  it('re-enqueue avec attempts++ et score = now + backoff', async () => {
    const now = Date.now()
    const msg: QueuedMessage = {
      id: 'mid', text: 't', enqueuedAt: now, expiresAt: now + 60_000, attempts: 0,
    }
    await rescheduleOutbound(msg)
    expect(redisZaddMock).toHaveBeenCalledTimes(1)
    const [, score, member] = redisZaddMock.mock.calls[0]!
    const parsed = JSON.parse(member as string) as QueuedMessage
    expect(parsed.attempts).toBe(1)
    expect(score as number).toBeGreaterThanOrEqual(now + 2000 - 50)  // attempts=1 → 2s
  })

  it('drop si nextRetryAt >= expiresAt (au lieu de re-enqueue)', async () => {
    const now = Date.now()
    const msg: QueuedMessage = {
      id: 'mid', text: 't', enqueuedAt: now, expiresAt: now + 100, attempts: 4,
    }
    await rescheduleOutbound(msg)
    expect(redisZaddMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_relay_dropped',
      status: 'failed',
      metadata: expect.objectContaining({ reason: 'expired_before_retry' }),
    }))
  })
})

describe('dropOutbound', () => {
  it('audit chat_relay_dropped avec reason', async () => {
    const msg: QueuedMessage = {
      id: 'mid', text: 'long text', enqueuedAt: 0, expiresAt: 1, attempts: 3,
    }
    await dropOutbound(msg, 'http_500:server crashed')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_relay_dropped',
      status: 'failed',
      metadata: expect.objectContaining({
        reason:   'http_500:server crashed',
        attempts: 3,
      }),
    }))
  })
})

describe('getQueueLength', () => {
  it('retourne zcard', async () => {
    redisZcardMock.mockResolvedValueOnce(42)
    expect(await getQueueLength()).toBe(42)
  })
  it('retourne 0 si Redis erreur', async () => {
    redisZcardMock.mockRejectedValueOnce(new Error('boom'))
    expect(await getQueueLength()).toBe(0)
  })
})

describe('worker tick — comportement par cas', () => {
  // On teste via popDueMessages + dispatch mocké
  // (le worker setInterval n'est pas testé directement, juste sa logique de batch)
  function makeMsg(over: Partial<QueuedMessage> = {}): QueuedMessage {
    const now = Date.now()
    return { id: 'mid', text: 't', enqueuedAt: now, expiresAt: now + 60_000, attempts: 0, ...over }
  }

  it('dispatch ok → audit chat_relay_sent fromQueue=true', async () => {
    const { _testInternals } = await import('../services/streamer/chatOutboundQueue')
    const msg = makeMsg()
    redisZrangebyscoreMock.mockResolvedValueOnce([JSON.stringify(msg)])
    const dispatch = vi.fn().mockResolvedValue({ ok: true })

    await _testInternals.tick(dispatch)

    expect(dispatch).toHaveBeenCalledWith(msg.text)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_relay_sent',
      status: 'success',
      metadata: expect.objectContaining({ fromQueue: true }),
    }))
  })

  it('dispatch rateLimited → reschedule (ZADD à nouveau)', async () => {
    const { _testInternals } = await import('../services/streamer/chatOutboundQueue')
    const msg = makeMsg()
    redisZrangebyscoreMock.mockResolvedValueOnce([JSON.stringify(msg)])
    const dispatch = vi.fn().mockResolvedValue({ ok: false, rateLimited: true })

    await _testInternals.tick(dispatch)

    expect(redisZaddMock).toHaveBeenCalledTimes(1)
    const parsed = JSON.parse(redisZaddMock.mock.calls[0]![2] as string) as QueuedMessage
    expect(parsed.attempts).toBe(1)
  })

  it('dispatch erreur logique → drop sans reschedule', async () => {
    const { _testInternals } = await import('../services/streamer/chatOutboundQueue')
    const msg = makeMsg()
    redisZrangebyscoreMock.mockResolvedValueOnce([JSON.stringify(msg)])
    const dispatch = vi.fn().mockResolvedValue({ ok: false, rateLimited: false, reason: 'http_400' })

    await _testInternals.tick(dispatch)

    expect(redisZaddMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'chat_relay_dropped',
      metadata: expect.objectContaining({ reason: 'http_400' }),
    }))
  })

  it('message expiré → drop expired_in_queue, pas de dispatch', async () => {
    const { _testInternals } = await import('../services/streamer/chatOutboundQueue')
    const expired = makeMsg({ expiresAt: Date.now() - 1000 })
    redisZrangebyscoreMock.mockResolvedValueOnce([JSON.stringify(expired)])
    const dispatch = vi.fn()

    await _testInternals.tick(dispatch)

    expect(dispatch).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action:   'chat_relay_dropped',
      metadata: expect.objectContaining({ reason: 'expired_in_queue' }),
    }))
  })

  it('max attempts atteint → drop max_attempts', async () => {
    const { _testInternals } = await import('../services/streamer/chatOutboundQueue')
    const msg = makeMsg({ attempts: MAX_ATTEMPTS })
    redisZrangebyscoreMock.mockResolvedValueOnce([JSON.stringify(msg)])
    const dispatch = vi.fn()

    await _testInternals.tick(dispatch)

    expect(dispatch).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action:   'chat_relay_dropped',
      metadata: expect.objectContaining({ reason: 'max_attempts' }),
    }))
  })

  it('dispatch throw → reschedule (pas de drop)', async () => {
    const { _testInternals } = await import('../services/streamer/chatOutboundQueue')
    const msg = makeMsg()
    redisZrangebyscoreMock.mockResolvedValueOnce([JSON.stringify(msg)])
    const dispatch = vi.fn().mockRejectedValue(new Error('network'))

    await _testInternals.tick(dispatch)

    expect(redisZaddMock).toHaveBeenCalledTimes(1)
  })
})
