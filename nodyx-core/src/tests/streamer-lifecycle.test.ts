// ─── Streamer Hub — ingestEvent lifecycle (sessions + bypass chat.message) ──
// Garantit que stream.online INSERT une session, stream.offline UPDATE ended_at,
// et que channel.chat.message ne pollue PAS streamer_events (volume trop élevé).

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}))

const { recordEventMock, pushEventToChatMock, pushTwitchChatMessageMock } = vi.hoisted(() => ({
  recordEventMock:         vi.fn().mockResolvedValue(undefined),
  pushEventToChatMock:     vi.fn().mockResolvedValue(undefined),
  pushTwitchChatMessageMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../config/database', () => ({
  db:    { query: dbQueryMock },
  redis: {},
}))

vi.mock('../services/streamer/eventService', () => ({
  recordEvent: recordEventMock,
}))

vi.mock('../services/streamer/streamerChat', () => ({
  pushEventToChat:         pushEventToChatMock,
  pushTwitchChatMessage:   pushTwitchChatMessageMock,
  ensureTwitchChatChannel: vi.fn(),
  getInstanceCommunityId:  vi.fn(),
}))

vi.mock('../services/streamer/tokenService', () => ({
  saveStreamerTokens:  vi.fn(),
  findPrimaryStreamer: vi.fn(),
  getDecryptedTokens:  vi.fn(),
  refreshAndPersist:   vi.fn(),
}))

vi.mock('../services/streamer/eventsubService', () => ({
  createSubscription:  vi.fn(),
  listSubscriptions:   vi.fn(),
  setExternalSubId:    vi.fn(),
}))

vi.mock('../services/streamer/audit', () => ({
  audit: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../services/streamer/providers/twitchProvider', () => ({
  twitchProvider: { id: 'twitch' },
}))

import { ingestEvent } from '../services/streamer/streamerHubService'

beforeEach(() => {
  vi.resetAllMocks()
  recordEventMock.mockResolvedValue(undefined)
  pushEventToChatMock.mockResolvedValue(undefined)
  pushTwitchChatMessageMock.mockResolvedValue(undefined)
})

describe('ingestEvent — channel.chat.message (Phase 2 bypass)', () => {
  it('NE PERSISTE PAS dans streamer_events (volume)', async () => {
    await ingestEvent({
      provider:  'twitch',
      eventType: 'channel.chat.message',
      payload:   { event: { message: { text: 'hi' } } },
    })
    expect(recordEventMock).not.toHaveBeenCalled()
    expect(pushEventToChatMock).not.toHaveBeenCalled()
    expect(dbQueryMock).not.toHaveBeenCalled()
  })

  it('délègue à pushTwitchChatMessage', async () => {
    const payload = { event: { message: { text: 'hi' }, chatter_user_login: 'alice' } }
    await ingestEvent({
      provider:  'twitch',
      eventType: 'channel.chat.message',
      payload,
    })
    expect(pushTwitchChatMessageMock).toHaveBeenCalledTimes(1)
    expect(pushTwitchChatMessageMock.mock.calls[0]![0]).toMatchObject({
      provider: 'twitch',
      payload,
    })
  })

  it('si pushTwitchChatMessage throw, ne fait pas crasher ingestEvent', async () => {
    pushTwitchChatMessageMock.mockRejectedValueOnce(new Error('boom'))
    await expect(ingestEvent({
      provider:  'twitch',
      eventType: 'channel.chat.message',
      payload:   { event: { message: { text: 'hi' } } },
    })).resolves.toBeUndefined()
  })
})

describe('ingestEvent — stream.online (lifecycle open)', () => {
  it('INSERT une row streamer_sessions avec external_id = stream_id', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] })  // catch-all (user_id lookup, etc.)
    await ingestEvent({
      provider:  'twitch',
      eventType: 'stream.online',
      payload: {
        event: {
          id:                   'stream-id-42',
          started_at:           '2026-05-10T10:00:00Z',
          type:                 'live',
          broadcaster_user_id:  '123',
        },
      },
    })
    const insertCall = dbQueryMock.mock.calls.find(c => /INSERT INTO streamer_sessions/.test(c[0] as string))
    expect(insertCall).toBeDefined()
    expect(insertCall![1]).toEqual(['twitch', 'stream-id-42', '2026-05-10T10:00:00Z'])
    expect(recordEventMock).toHaveBeenCalled()
    expect(pushEventToChatMock).toHaveBeenCalled()
  })

  it('skip INSERT si event.id manquant (payload partiel)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] })
    await ingestEvent({
      provider:  'twitch',
      eventType: 'stream.online',
      payload:   { event: { started_at: '2026-05-10T10:00:00Z' } },  // pas d'id
    })
    const insertCall = dbQueryMock.mock.calls.find(c => /INSERT INTO streamer_sessions/.test(c[0] as string))
    expect(insertCall).toBeUndefined()
    expect(recordEventMock).toHaveBeenCalled()  // event quand même enregistré
  })

  it("INSERT a 'ON CONFLICT DO NOTHING' (idempotent vs replays)", async () => {
    dbQueryMock.mockResolvedValue({ rows: [] })
    await ingestEvent({
      provider:  'twitch',
      eventType: 'stream.online',
      payload: { event: { id: 'sid', started_at: '2026-05-10T10:00:00Z' } },
    })
    const insertCall = dbQueryMock.mock.calls.find(c => /INSERT INTO streamer_sessions/.test(c[0] as string))
    expect(insertCall![0] as string).toMatch(/ON CONFLICT DO NOTHING/)
  })
})

describe('ingestEvent — stream.offline (lifecycle close)', () => {
  it('UPDATE ended_at = NOW() sur les sessions ouvertes du provider', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] })
    await ingestEvent({
      provider:  'twitch',
      eventType: 'stream.offline',
      payload:   { event: { broadcaster_user_id: '123' } },
    })
    const updateCall = dbQueryMock.mock.calls.find(c => /UPDATE streamer_sessions/.test(c[0] as string))
    expect(updateCall).toBeDefined()
    expect(updateCall![0] as string).toMatch(/ended_at = NOW\(\)/)
    expect(updateCall![0] as string).toMatch(/ended_at IS NULL/)
    expect(updateCall![1]).toEqual(['twitch'])
  })

  it('ne crash pas si UPDATE échoue (catch.error)', async () => {
    // Premier appel = lookup user_id (succès, rows vides) ; second = UPDATE (rejet).
    dbQueryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ rows: [] })
    await expect(ingestEvent({
      provider:  'twitch',
      eventType: 'stream.offline',
      payload:   { event: {} },
    })).resolves.toBeUndefined()
  })
})

describe('ingestEvent — events Phase 1 normaux', () => {
  it('persiste channel.follow dans streamer_events via recordEvent', async () => {
    dbQueryMock.mockResolvedValueOnce({ rows: [{ id: 'user-nodyx-1' }] })  // twitch_id lookup match
    await ingestEvent({
      provider:  'twitch',
      eventType: 'channel.follow',
      payload:   { event: { user_id: 'tw-user-42', user_login: 'bob' } },
    })
    expect(recordEventMock).toHaveBeenCalledTimes(1)
    expect(recordEventMock.mock.calls[0]![0]).toMatchObject({
      provider:  'twitch',
      eventType: 'channel.follow',
      userId:    'user-nodyx-1',
    })
    expect(pushEventToChatMock).toHaveBeenCalledTimes(1)
  })
})
