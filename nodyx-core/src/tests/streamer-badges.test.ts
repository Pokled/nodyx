// ─── Streamer Hub — badges Twitch render + cache ────────────────────────────
// Couvre §6.3 badges : Helix global/channel, cache Redis (global 7j, channel
// 24h, app token 50j), précédence channel > global, escape HTML.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { redisGetMock, redisSetMock, redisDelMock } = vi.hoisted(() => ({
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn().mockResolvedValue('OK'),
  redisDelMock: vi.fn().mockResolvedValue(1),
}))

const { getAppAccessTokenMock } = vi.hoisted(() => ({
  getAppAccessTokenMock: vi.fn(),
}))

vi.mock('../config/database', () => ({
  db:    {},
  redis: {
    get: redisGetMock,
    set: redisSetMock,
    del: redisDelMock,
  },
}))

vi.mock('../services/streamer/providers/twitchProvider', () => ({
  twitchProvider: { getAppAccessToken: getAppAccessTokenMock },
}))

const fetchMock = vi.fn()
;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

import { renderBadges, invalidateBadgesCache, _testInternals } from '../services/streamer/badges'

beforeEach(() => {
  vi.resetAllMocks()
  redisSetMock.mockResolvedValue('OK')
  redisDelMock.mockResolvedValue(1)
  process.env.STREAMER_TWITCH_CLIENT_ID = 'test-client-id'
})

describe('renderBadges — payload vide', () => {
  it('retourne "" si pas de badges', async () => {
    const html = await renderBadges({ badges: undefined, broadcasterId: '42' })
    expect(html).toBe('')
    expect(getAppAccessTokenMock).not.toHaveBeenCalled()
  })

  it('retourne "" si badges = []', async () => {
    const html = await renderBadges({ badges: [], broadcasterId: '42' })
    expect(html).toBe('')
  })
})

describe('renderBadges — résolution globale + channel', () => {
  function setupAppToken() {
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-token-cached')
      return Promise.resolve(null)
    })
  }

  it('résout un badge global', async () => {
    setupAppToken()
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-tok')
      return Promise.resolve(null)
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [
        { set_id: 'premium', versions: [{ id: '1', image_url_2x: 'https://cdn.tw/prem.png', title: 'Prime Gaming', image_url_1x: '', image_url_4x: '' }] },
      ] }),
    })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

    const html = await renderBadges({
      badges:        [{ set_id: 'premium', id: '1' }],
      broadcasterId: '42',
    })
    expect(html).toContain('https://cdn.tw/prem.png')
    expect(html).toContain('class="twitch-badges"')
    expect(html).toContain('class="streamer-badge"')
    expect(html).toContain('alt="Prime Gaming"')
  })

  it('channel override global (badge subscriber custom)', async () => {
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-tok')
      return Promise.resolve(null)
    })
    // global
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [
        { set_id: 'subscriber', versions: [{ id: '0', image_url_2x: 'https://cdn.tw/sub-default.png', title: 'Subscriber', image_url_1x: '', image_url_4x: '' }] },
      ] }),
    })
    // channel
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [
        { set_id: 'subscriber', versions: [{ id: '0', image_url_2x: 'https://cdn.tw/sub-CUSTOM.png', title: 'Custom Subscriber', image_url_1x: '', image_url_4x: '' }] },
      ] }),
    })

    const html = await renderBadges({
      badges:        [{ set_id: 'subscriber', id: '0', info: '12' }],
      broadcasterId: '42',
    })
    expect(html).toContain('sub-CUSTOM.png')
    expect(html).not.toContain('sub-default.png')
    // info '12' apparaît dans le title
    expect(html).toContain('title="Custom Subscriber (12)"')
  })

  it('skip silencieusement les badges introuvables', async () => {
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-tok')
      return Promise.resolve(null)
    })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

    const html = await renderBadges({
      badges:        [{ set_id: 'mystery_badge', id: '99' }],
      broadcasterId: '42',
    })
    expect(html).toBe('')
  })

  it('escape les caractères HTML dans title/url', async () => {
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-tok')
      return Promise.resolve(null)
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [
        { set_id: 'moderator', versions: [{
          id:           '1',
          image_url_2x: 'https://cdn.tw/mod.png?x="evil"',
          title:        '<script>alert(1)</script>',
          image_url_1x: '', image_url_4x: '',
        }] },
      ] }),
    })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

    const html = await renderBadges({
      badges:        [{ set_id: 'moderator', id: '1' }],
      broadcasterId: '42',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;evil&quot;')
  })
})

describe('renderBadges — cache Redis', () => {
  it('hit cache global+channel : aucun fetch HTTP', async () => {
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-tok')
      if (key === 'streamer:badges:global')    return Promise.resolve(JSON.stringify({ 'premium:1': { url: 'g.png', title: 'Prime' } }))
      if (key === 'streamer:badges:ch:42')     return Promise.resolve(JSON.stringify({}))
      return Promise.resolve(null)
    })
    await renderBadges({
      badges:        [{ set_id: 'premium', id: '1' }],
      broadcasterId: '42',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('miss cache : fetch global + channel + écrit caches avec bons TTL', async () => {
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-tok')
      return Promise.resolve(null)
    })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

    await renderBadges({
      badges:        [{ set_id: 'premium', id: '1' }],
      broadcasterId: '42',
    })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const setCalls = redisSetMock.mock.calls
    const globalCache  = setCalls.find(c => c[0] === 'streamer:badges:global')
    const channelCache = setCalls.find(c => c[0] === 'streamer:badges:ch:42')
    expect(globalCache).toBeDefined()
    expect(globalCache![3]).toBe(7  * 24 * 3600)  // 7 jours
    expect(channelCache).toBeDefined()
    expect(channelCache![3]).toBe(24 * 3600)  // 24h
  })

  it("App Access Token miss : fetch /token + cache 50j", async () => {
    redisGetMock.mockResolvedValue(null)  // pas de token, pas de badges
    getAppAccessTokenMock.mockResolvedValueOnce('fresh-app-token')
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })

    await renderBadges({
      badges:        [{ set_id: 'premium', id: '1' }],
      broadcasterId: '42',
    })

    expect(getAppAccessTokenMock).toHaveBeenCalledTimes(1)
    const tokCache = redisSetMock.mock.calls.find(c => c[0] === 'streamer:badges:app_token')
    expect(tokCache).toBeDefined()
    expect(tokCache![3]).toBe(50 * 24 * 3600)
  })

  it('dégrade en "" si App Access Token impossible à obtenir', async () => {
    redisGetMock.mockResolvedValue(null)
    getAppAccessTokenMock.mockRejectedValueOnce(new Error('twitch 503'))
    const html = await renderBadges({
      badges:        [{ set_id: 'premium', id: '1' }],
      broadcasterId: '42',
    })
    expect(html).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('dégrade en "" si fetch Helix renvoie 500', async () => {
    redisGetMock.mockImplementation((key: string) => {
      if (key === 'streamer:badges:app_token') return Promise.resolve('app-tok')
      return Promise.resolve(null)
    })
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    const html = await renderBadges({
      badges:        [{ set_id: 'premium', id: '1' }],
      broadcasterId: '42',
    })
    expect(html).toBe('')
  })
})

describe('invalidateBadgesCache', () => {
  it('del le cache d\'une chaîne spécifique', async () => {
    await invalidateBadgesCache('42')
    expect(redisDelMock).toHaveBeenCalledWith('streamer:badges:ch:42')
  })
  it('del le cache global si pas de broadcasterId', async () => {
    await invalidateBadgesCache()
    expect(redisDelMock).toHaveBeenCalledWith('streamer:badges:global')
  })
})

describe('flatten (helper interne)', () => {
  it('aplatit set_id + versions en "set_id:id" → { url, title }', () => {
    const map = _testInternals.flatten([
      { set_id: 'subscriber', versions: [
        { id: '0',  image_url_2x: 'a.png', title: 'Sub 1m', image_url_1x: '', image_url_4x: '' },
        { id: '3',  image_url_2x: 'b.png', title: 'Sub 3m', image_url_1x: '', image_url_4x: '' },
      ] },
      { set_id: 'moderator', versions: [
        { id: '1', image_url_2x: 'm.png', title: 'Mod', image_url_1x: '', image_url_4x: '' },
      ] },
    ])
    expect(map).toEqual({
      'subscriber:0': { url: 'a.png', title: 'Sub 1m' },
      'subscriber:3': { url: 'b.png', title: 'Sub 3m' },
      'moderator:1':  { url: 'm.png', title: 'Mod' },
    })
  })
})
