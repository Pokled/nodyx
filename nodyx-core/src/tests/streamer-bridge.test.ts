// ─── Streamer Hub — bridge outbound (Nodyx → Twitch chat) ────────────────────
// Couvre les chemins de relayMessageToTwitch : no_streamer, stream_offline,
// mode test bypass, prefix, troncature, Helix error, drop_reason.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}))

const { findPrimaryStreamerMock, getDecryptedTokensMock, refreshAndPersistMock } = vi.hoisted(() => ({
  findPrimaryStreamerMock:  vi.fn(),
  getDecryptedTokensMock:   vi.fn(),
  refreshAndPersistMock:    vi.fn(),
}))

const { auditMock } = vi.hoisted(() => ({
  auditMock: vi.fn().mockResolvedValue(undefined),
}))

const { enqueueOutboundMock, startOutboundWorkerMock } = vi.hoisted(() => ({
  enqueueOutboundMock:     vi.fn().mockResolvedValue({ length: 1, overflowAlerted: false }),
  startOutboundWorkerMock: vi.fn(),
}))

vi.mock('../config/database', () => ({
  db:    { query: dbQueryMock },
  redis: {},
}))

vi.mock('../services/streamer/tokenService', () => ({
  findPrimaryStreamer:  findPrimaryStreamerMock,
  getDecryptedTokens:   getDecryptedTokensMock,
  refreshAndPersist:    refreshAndPersistMock,
}))

vi.mock('../services/streamer/audit', () => ({
  audit: auditMock,
}))

vi.mock('../services/streamer/chatOutboundQueue', () => ({
  enqueueOutbound:      enqueueOutboundMock,
  startOutboundWorker:  startOutboundWorkerMock,
}))

vi.mock('../services/streamer/providers/twitchProvider', () => ({
  twitchProvider: { id: 'twitch' },
}))

// fetch global stub
const fetchMock = vi.fn()
;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

import { relayMessageToTwitch } from '../services/streamer/twitchChatBridge'

const FUTURE_DATE = new Date(Date.now() + 60 * 60 * 1000)  // expires_at +1h

function primaryRow() {
  return {
    id:         'oauth-uuid-1',
    externalId: '123456',  // broadcaster_id Twitch
    expiresAt:  FUTURE_DATE,
  }
}

function streamerLiveRow() {
  return { rows: [{ id: 'session-uuid-1' }] }
}

function streamerOfflineRow() {
  return { rows: [] }
}

beforeEach(() => {
  vi.resetAllMocks()
  enqueueOutboundMock.mockResolvedValue({ length: 1, overflowAlerted: false })
  process.env.STREAMER_TWITCH_CLIENT_ID = 'test-client-id'
  delete process.env.STREAMER_CHAT_TEST_MODE
  delete process.env.STREAMER_CHAT_NO_PREFIX
})

afterEach(() => {
  delete process.env.STREAMER_TWITCH_CLIENT_ID
  delete process.env.STREAMER_CHAT_TEST_MODE
  delete process.env.STREAMER_CHAT_NO_PREFIX
})

describe('relayMessageToTwitch — gardes', () => {
  it('refuse un provider non Twitch', async () => {
    const r = await relayMessageToTwitch({
      provider:       'owncast' as 'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })
    expect(r).toEqual({ ok: false, reason: 'unsupported_provider' })
    expect(findPrimaryStreamerMock).not.toHaveBeenCalled()
  })

  it('retourne no_streamer si aucun token primary', async () => {
    findPrimaryStreamerMock.mockResolvedValueOnce(null)
    const r = await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })
    expect(r).toEqual({ ok: false, reason: 'no_streamer' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retourne stream_offline si aucune session ouverte', async () => {
    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'tok' })
    dbQueryMock.mockResolvedValueOnce(streamerOfflineRow())
    const r = await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })
    expect(r).toEqual({ ok: false, reason: 'stream_offline' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('STREAMER_CHAT_TEST_MODE bypass le check stream live', async () => {
    process.env.STREAMER_CHAT_TEST_MODE = '1'
    // Le module lit l'env à l'import — il faut le ré-importer pour que la
    // valeur soit prise en compte. Vitest cache modules → on doit reset.
    vi.resetModules()
    const { relayMessageToTwitch: relayFresh } = await import('../services/streamer/twitchChatBridge')

    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'tok' })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ message_id: 'mid', is_sent: true }] }),
    })

    const r = await relayFresh({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })
    expect(r).toEqual({ ok: true })
    expect(dbQueryMock).not.toHaveBeenCalled()  // pas de check session en TEST_MODE
  })
})

describe('relayMessageToTwitch — token refresh', () => {
  it('refresh le token si expires_at < 5 min', async () => {
    const expiringSoon = new Date(Date.now() + 60 * 1000)  // +1min
    findPrimaryStreamerMock.mockResolvedValueOnce({
      ...primaryRow(),
      expiresAt: expiringSoon,
    })
    refreshAndPersistMock.mockResolvedValueOnce(undefined)
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'fresh-tok' })
    dbQueryMock.mockResolvedValueOnce(streamerLiveRow())
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ message_id: 'mid', is_sent: true }] }),
    })

    await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })

    expect(refreshAndPersistMock).toHaveBeenCalledTimes(1)
  })

  it('retourne no_streamer si le refresh throw', async () => {
    const expiringSoon = new Date(Date.now() + 60 * 1000)
    findPrimaryStreamerMock.mockResolvedValueOnce({
      ...primaryRow(),
      expiresAt: expiringSoon,
    })
    refreshAndPersistMock.mockRejectedValueOnce(new Error('twitch 5xx'))
    const r = await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })
    expect(r).toEqual({ ok: false, reason: 'no_streamer' })
  })
})

describe('relayMessageToTwitch — message formatting', () => {
  function setupHappyPath() {
    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'tok' })
    dbQueryMock.mockResolvedValueOnce(streamerLiveRow())
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ message_id: 'mid', is_sent: true }] }),
    })
  }

  it('préfixe le message avec [username] par défaut', async () => {
    setupHappyPath()
    await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello world',
    })
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, string>
    expect(body.message).toBe('[alice] hello world')
    expect(body.broadcaster_id).toBe('123456')
    expect(body.sender_id).toBe('123456')
  })

  it('STREAMER_CHAT_NO_PREFIX désactive le préfixe', async () => {
    process.env.STREAMER_CHAT_NO_PREFIX = '1'
    vi.resetModules()
    const { relayMessageToTwitch: relayFresh } = await import('../services/streamer/twitchChatBridge')

    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'tok' })
    dbQueryMock.mockResolvedValueOnce(streamerLiveRow())
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ message_id: 'mid', is_sent: true }] }),
    })

    await relayFresh({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, string>
    expect(body.message).toBe('hello')
  })

  it('tronque les messages > 500 chars', async () => {
    setupHappyPath()
    const longText = 'a'.repeat(600)
    await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           longText,
    })
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as Record<string, string>
    expect(body.message.length).toBe(500)
    expect(body.message.startsWith('[alice] ')).toBe(true)
  })
})

describe('relayMessageToTwitch — erreurs Helix', () => {
  it('audit + retourne reason sur 401 Twitch', async () => {
    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'expired-tok' })
    dbQueryMock.mockResolvedValueOnce(streamerLiveRow())
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '{"error":"Unauthorized"}',
    })

    const r = await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })

    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/^http_401:/)
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0]![0].status).toBe('failed')
  })

  it('audit + retourne dropped:msg_duplicate si is_sent=false', async () => {
    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'tok' })
    dbQueryMock.mockResolvedValueOnce(streamerLiveRow())
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ message_id: '', is_sent: false, drop_reason: { code: 'msg_duplicate', message: 'duplicate' } }],
      }),
    })

    const r = await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('dropped:msg_duplicate')
    expect(auditMock).toHaveBeenCalledTimes(1)
  })

  it('échoue avec no_client_id si STREAMER_TWITCH_CLIENT_ID absent', async () => {
    delete process.env.STREAMER_TWITCH_CLIENT_ID
    vi.resetModules()
    const { relayMessageToTwitch: relayFresh } = await import('../services/streamer/twitchChatBridge')

    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'tok' })
    dbQueryMock.mockResolvedValueOnce(streamerLiveRow())

    const r = await relayFresh({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })

    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no_client_id')
  })
})

describe('relayMessageToTwitch — 429 → queue (§6.5)', () => {
  it('enqueue le message formaté et retourne rate_limited_queued sans audit dropped', async () => {
    findPrimaryStreamerMock.mockResolvedValueOnce(primaryRow())
    getDecryptedTokensMock.mockResolvedValueOnce({ accessToken: 'tok' })
    dbQueryMock.mockResolvedValueOnce(streamerLiveRow())
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      text: async () => '{"error":"Too Many Requests"}',
    })

    const r = await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })

    expect(r).toEqual({ ok: false, reason: 'rate_limited_queued' })
    expect(enqueueOutboundMock).toHaveBeenCalledTimes(1)
    expect(enqueueOutboundMock.mock.calls[0]![0]).toBe('[alice] hello')
    // 429 n'est PAS un drop, donc pas d'audit failed
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('stream_offline et no_streamer ne sont PAS auditées (bruit)', async () => {
    findPrimaryStreamerMock.mockResolvedValueOnce(null)  // no_streamer
    const r1 = await relayMessageToTwitch({
      provider:       'twitch',
      authorUsername: 'alice',
      authorUserId:   'u1',
      text:           'hello',
    })
    expect(r1.reason).toBe('no_streamer')
    expect(auditMock).not.toHaveBeenCalled()
    expect(enqueueOutboundMock).not.toHaveBeenCalled()
  })
})
