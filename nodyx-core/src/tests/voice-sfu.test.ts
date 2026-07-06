/**
 * Tests du relais SFU (socket/voiceSfu.ts) — doctrine "laisse rien passer".
 *
 * Vérifie les invariants de la doctrine chirurgicale :
 * 1. DORMANT sans VOICE_SFU_URL (aucun fetch, réponse sfu_disabled)
 * 2. Gardes : uuid, rôle communauté, rate limit, payloads bornés/hostiles
 * 3. Identité = socket.data (jamais le payload client)
 * 4. Daemon mort => erreur propre, jamais d'exception
 * 5. Nettoyage garanti au disconnect
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { dbQueryMock } = vi.hoisted(() => ({
  dbQueryMock: vi.fn(),
}))

vi.mock('../config/database', () => ({
  db:    { query: dbQueryMock },
  redis: {},
}))

import { registerVoiceSfuHandlers } from '../socket/voiceSfu'

// ── Harnais socket factice ────────────────────────────────────────────────────

const CHANNEL = '01234567-89ab-4cde-8f01-23456789abcd'
const DAEMON  = 'http://127.0.0.1:3901'

type Handler = (...args: unknown[]) => void | Promise<void>

// userId unique par défaut : le rate limiter est RÉEL et ses buckets persistent
// entre les tests (limite 5 joins/10s par user). C'est voulu : on le teste aussi.
let _seq = 0
function makeHarness(userId = `user-${Date.now()}-${_seq++}`) {
  const handlers = new Map<string, Handler>()
  const roomEmit = vi.fn()
  const socketToEmit = vi.fn()
  const socket = {
    id:   'socket-1',
    data: { userId, username: 'jo' },
    on:   (ev: string, fn: Handler) => { handlers.set(ev, fn) },
    to:   vi.fn(() => ({ emit: socketToEmit })),
    emit: vi.fn(),
  }
  const server = {
    to: vi.fn(() => ({ emit: roomEmit })),
  }
  registerVoiceSfuHandlers(socket as never, server as never)
  const fire = async (ev: string, ...args: unknown[]) => {
    await handlers.get(ev)!(...args)
  }
  return { handlers, fire, socket, server, roomEmit, socketToEmit }
}

/** Ack qui capture sa réponse. */
function ack() {
  const calls: Record<string, unknown>[] = []
  const cb = (r: Record<string, unknown>) => { calls.push(r) }
  return { cb, get last() { return calls[calls.length - 1] }, calls }
}

/** Réponse daemon standard. */
function daemonJson(body: Record<string, unknown>, status = 200) {
  return { status, json: async () => body } as Response
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  process.env.VOICE_SFU_URL   = DAEMON
  process.env.VOICE_SFU_TOKEN = 'test-token-0123456789abcdef'
  // Rôle communauté par défaut : membre légitime.
  dbQueryMock.mockResolvedValue({ rows: [{ role: 'member' }] })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.VOICE_SFU_URL
  delete process.env.VOICE_SFU_TOKEN
})

// ── 1. Dormance ───────────────────────────────────────────────────────────────

describe('dormance (flag OFF)', () => {
  it('répond sfu_disabled et ne contacte RIEN quand VOICE_SFU_URL est absent', async () => {
    delete process.env.VOICE_SFU_URL
    const h = makeHarness()
    const a = ack()
    await h.fire('voice:sfu_join', CHANNEL, a.cb)
    expect(a.last).toEqual({ ok: false, error: 'sfu_disabled' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(dbQueryMock).not.toHaveBeenCalled() // même pas de requête DB
  })

  it('tous les handlers sont dormants sans le flag', async () => {
    delete process.env.VOICE_SFU_URL
    const h = makeHarness()
    for (const ev of ['voice:sfu_connect', 'voice:sfu_produce', 'voice:sfu_consume', 'voice:sfu_publications']) {
      const a = ack()
      await h.fire(ev, { channelId: CHANNEL }, a.cb)
      expect(a.last.error, ev).toBe('sfu_disabled')
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 2. Gardes ─────────────────────────────────────────────────────────────────

describe('gardes', () => {
  it('rejette un channelId non-uuid sans toucher au daemon', async () => {
    const h = makeHarness()
    const a = ack()
    await h.fire('voice:sfu_join', 'pas-un-uuid', a.cb)
    expect(a.last).toEqual({ ok: false, error: 'bad_channel' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejette un non-membre de la communauté (forbidden)', async () => {
    dbQueryMock.mockResolvedValue({ rows: [] })
    const h = makeHarness()
    const a = ack()
    await h.fire('voice:sfu_join', CHANNEL, a.cb)
    expect(a.last).toEqual({ ok: false, error: 'forbidden' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('un cb manquant ou non-fonction est ignoré sans crash', async () => {
    const h = makeHarness()
    await expect(h.fire('voice:sfu_join', CHANNEL, 'pas-une-fonction')).resolves.toBeUndefined()
    await expect(h.fire('voice:sfu_join', CHANNEL)).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rate limit : la 6e jointure en 10 s est rejetée', async () => {
    const h = makeHarness('user-rate-limited-test')
    fetchMock.mockResolvedValue(daemonJson({ ok: true, mode: 'mesh', migrated: [] }))
    const results: (string | undefined)[] = []
    for (let i = 0; i < 6; i++) {
      const a = ack()
      await h.fire('voice:sfu_join', CHANNEL, a.cb)
      results.push(a.last.error as string | undefined)
    }
    expect(results.slice(0, 5).every(e => e === undefined)).toBe(true)
    expect(results[5]).toBe('rate_limited')
  })

  it('un payload client trop gros est rejeté (payload_too_large)', async () => {
    const h = makeHarness()
    const a = ack()
    await h.fire('voice:sfu_produce', {
      channelId: CHANNEL, kind: 'audio', rtpParameters: { junk: 'x'.repeat(70_000) },
    }, a.cb)
    expect(a.last).toEqual({ ok: false, error: 'payload_too_large' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('kind inconnu rejeté, producerId hostile rejeté', async () => {
    const h = makeHarness()
    const a1 = ack()
    await h.fire('voice:sfu_produce', { channelId: CHANNEL, kind: 'exploit', rtpParameters: {} }, a1.cb)
    expect(a1.last.error).toBe('bad_kind')
    const a2 = ack()
    await h.fire('voice:sfu_consume', { channelId: CHANNEL, producerId: 'x'.repeat(500), rtpCapabilities: {} }, a2.cb)
    expect(a2.last.error).toBe('bad_producer')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 3. Identité serveur ───────────────────────────────────────────────────────

describe('identité', () => {
  it("le participant envoyé au daemon vient de socket.data, jamais du payload", async () => {
    const h = makeHarness('vrai-user')
    fetchMock.mockResolvedValue(daemonJson({ ok: true, mode: 'mesh', migrated: [] }))
    const a = ack()
    // Le client tente d'usurper : le champ participant du payload doit être ignoré.
    await h.fire('voice:sfu_join', CHANNEL, a.cb)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.participant).toBe('vrai-user')
    // Et le Bearer du daemon est bien posé.
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token-0123456789abcdef')
  })
})

// ── 4. Chemins heureux ────────────────────────────────────────────────────────

describe('flow SFU', () => {
  it('join en mode mesh : ok simple, pas de caps demandées', async () => {
    const h = makeHarness()
    fetchMock.mockResolvedValueOnce(daemonJson({ ok: true, mode: 'mesh', migrated: [] }))
    const a = ack()
    await h.fire('voice:sfu_join', CHANNEL, a.cb)
    expect(a.last).toEqual({ ok: true, mode: 'mesh' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('join en mode SFU : renvoie caps + transportParams parsés, annonce la bascule', async () => {
    const h = makeHarness()
    fetchMock
      .mockResolvedValueOnce(daemonJson({
        ok: true, mode: 'sfu', transport: 't-9',
        migrated: [{ participant: 'u2', transport: 't-2' }],
      }))
      .mockResolvedValueOnce(daemonJson({ ok: true, caps: '{"codecs":[{"mimeType":"audio/opus"}]}' }))
      .mockResolvedValueOnce(daemonJson({ ok: true, params: '{"id":"t-9","iceParameters":{"a":1}}' }))
    const a = ack()
    await h.fire('voice:sfu_join', CHANNEL, a.cb)
    expect(a.last.ok).toBe(true)
    expect(a.last.mode).toBe('sfu')
    expect((a.last.caps as { codecs: unknown[] }).codecs).toHaveLength(1)
    expect((a.last.transportParams as { id: string }).id).toBe('t-9')
    // La bascule (migrated non vide) est annoncée au salon vocal.
    expect(h.server.to).toHaveBeenCalledWith(`voice:${CHANNEL}`)
    expect(h.roomEmit).toHaveBeenCalledWith('voice:sfu_mode', { channelId: CHANNEL, mode: 'sfu' })
  })

  it('produce : annonce voice:sfu_new_producer aux autres', async () => {
    const h = makeHarness('user-jonathan')
    fetchMock.mockResolvedValueOnce(daemonJson({ ok: true, producer: 'prod-1' }))
    const a = ack()
    await h.fire('voice:sfu_produce', { channelId: CHANNEL, kind: 'audio', rtpParameters: { codecs: [] } }, a.cb)
    expect(a.last).toEqual({ ok: true, producerId: 'prod-1' })
    expect(h.socket.to).toHaveBeenCalledWith(`voice:${CHANNEL}`)
    expect(h.socketToEmit).toHaveBeenCalledWith('voice:sfu_new_producer', {
      channelId: CHANNEL, producerId: 'prod-1', kind: 'audio', userId: 'user-jonathan',
    })
  })

  it('consume : renvoie consumerId + params parsés', async () => {
    const h = makeHarness()
    fetchMock.mockResolvedValueOnce(daemonJson({
      ok: true, consumer: 'cons-1', params: '{"id":"cons-1","rtpParameters":{"codecs":[]}}',
    }))
    const a = ack()
    await h.fire('voice:sfu_consume', { channelId: CHANNEL, producerId: 'prod-1', rtpCapabilities: {} }, a.cb)
    expect(a.last.ok).toBe(true)
    expect(a.last.consumerId).toBe('cons-1')
    expect((a.last.params as { id: string }).id).toBe('cons-1')
  })
})

// ── 5. Panne du daemon ────────────────────────────────────────────────────────

describe('dégradation gracieuse', () => {
  it('daemon injoignable : erreur propre, aucune exception', async () => {
    const h = makeHarness()
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const a = ack()
    await expect(h.fire('voice:sfu_join', CHANNEL, a.cb)).resolves.toBeUndefined()
    expect(a.last).toEqual({ ok: false, error: 'sfu_unreachable' })
  })

  it('erreur métier du daemon relayée telle quelle', async () => {
    const h = makeHarness()
    fetchMock.mockResolvedValueOnce(daemonJson({ ok: false, error: 'salon plein' }, 409))
    const a = ack()
    await h.fire('voice:sfu_join', CHANNEL, a.cb)
    expect(a.last).toEqual({ ok: false, error: 'salon plein' })
  })

  it('réponse daemon non-JSON : erreur propre', async () => {
    const h = makeHarness()
    fetchMock.mockResolvedValueOnce({ status: 502, json: async () => { throw new Error('html') } } as never)
    const a = ack()
    await h.fire('voice:sfu_join', CHANNEL, a.cb)
    expect(a.last).toEqual({ ok: false, error: 'sfu_bad_response_502' })
  })
})

// ── 6. Nettoyage au disconnect ────────────────────────────────────────────────

describe('nettoyage', () => {
  it('un disconnect après join envoie leave au daemon pour chaque salon', async () => {
    const h = makeHarness('user-disconnect-test')
    fetchMock.mockResolvedValue(daemonJson({ ok: true, mode: 'mesh', migrated: [] }))
    await h.fire('voice:sfu_join', CHANNEL, ack().cb)
    fetchMock.mockClear()

    await h.fire('disconnect')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(`${DAEMON}/v1/leave`)
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ room: CHANNEL, participant: 'user-disconnect-test' })
  })

  it('leave explicite retire le salon du nettoyage', async () => {
    const h = makeHarness()
    fetchMock.mockResolvedValue(daemonJson({ ok: true, mode: 'mesh', migrated: [] }))
    await h.fire('voice:sfu_join', CHANNEL, ack().cb)
    await h.fire('voice:sfu_leave', CHANNEL, ack().cb)
    fetchMock.mockClear()

    await h.fire('disconnect')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
