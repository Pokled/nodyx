import { describe, it, expect, vi, beforeEach } from 'vitest'

// Un live s'annonce UNE fois par session, même si Twitch renvoie « stream.online »
// (streamer_sessions n'a pas de contrainte d'unicité : ON CONFLICT ne protégeait de rien).

const { q, announceLive } = vi.hoisted(() => ({ q: vi.fn(), announceLive: vi.fn() }))
vi.mock('../config/database', () => ({ db: { query: q }, redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }))
vi.mock('../services/webhooks/announce', () => ({ announceLive }))
vi.mock('../services/streamer/twitchProfile', () => ({ getTwitchProfile: vi.fn(async () => null) }))
vi.mock('../socket/io', () => ({ io: null }))

import { ingestEvent } from '../services/streamer/streamerHubService'

let sessions: string[] = []
beforeEach(() => {
  vi.clearAllMocks(); sessions = []
  q.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const s = sql.replace(/\s+/g, ' ')
    if (s.includes('SELECT 1 FROM streamer_sessions')) return { rows: sessions.includes(params[1] as string) ? [{ '?column?': 1 }] : [] }
    if (s.includes('INSERT INTO streamer_sessions')) { sessions.push(params[1] as string); return { rows: [{ external_id: params[1] }] } }
    return { rows: [] }
  })
})

const online = (id: string) => ({ provider: 'twitch' as const, eventType: 'stream.online', payload: { event: { id, started_at: '2026-11-12T20:00:00Z', broadcaster_user_name: 'Pokled', broadcaster_user_login: 'pokled' } } })

describe('un live s’annonce une seule fois', () => {
  it('la même session reçue deux fois : une seule annonce', async () => {
    await ingestEvent(online('stream-1') as never).catch(() => {})
    await ingestEvent(online('stream-1') as never).catch(() => {})
    expect(announceLive).toHaveBeenCalledTimes(1)
    expect(announceLive).toHaveBeenCalledWith('Pokled', null, null, 'https://twitch.tv/pokled')
  })
  it('une nouvelle session : une nouvelle annonce', async () => {
    await ingestEvent(online('stream-1') as never).catch(() => {})
    await ingestEvent(online('stream-2') as never).catch(() => {})
    expect(announceLive).toHaveBeenCalledTimes(2)
  })
})
