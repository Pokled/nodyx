// ─── Streamer Hub — emotes render + cache ─────────────────────────────────────
// Couvre : fragments Twitch natifs, fallback text + BTTV/FFZ/7TV par mot,
// escape HTML, cache Redis 24h, fetch providers tolérants aux erreurs.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { redisGetMock, redisSetMock, redisDelMock } = vi.hoisted(() => ({
  redisGetMock: vi.fn(),
  redisSetMock: vi.fn().mockResolvedValue('OK'),
  redisDelMock: vi.fn().mockResolvedValue(1),
}))

vi.mock('../config/database', () => ({
  db:    {},
  redis: {
    get: redisGetMock,
    set: redisSetMock,
    del: redisDelMock,
  },
}))

const fetchMock = vi.fn()
;(globalThis as { fetch?: typeof fetch }).fetch = fetchMock as unknown as typeof fetch

import { renderChatMessage, invalidateChannelEmotes } from '../services/streamer/emotes'

beforeEach(() => {
  vi.resetAllMocks()
  redisSetMock.mockResolvedValue('OK')
  redisDelMock.mockResolvedValue(1)
})

describe('renderChatMessage — fragments Twitch natifs', () => {
  it('remplace un fragment emote par <img> CDN Twitch', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify({ byCode: {}, fetchedAt: Date.now() }))
    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                'hi Kappa world',
      fragments: [
        { type: 'text',  text: 'hi ' },
        { type: 'emote', text: 'Kappa', emote: { id: '25' } },
        { type: 'text',  text: ' world' },
      ],
    })
    expect(html).toContain('<img src="https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0"')
    expect(html).toContain('alt="Kappa"')
    expect(html).toContain('hi ')
    expect(html).toContain('world')
  })

  it('escape les caractères HTML dans le texte', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify({ byCode: {}, fetchedAt: Date.now() }))
    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                '<script>alert(1)</script> & "quote"',
    })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('rend les fragments cheermote et mention comme du texte (avec emotes provider matchés)', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify({
      byCode: { KEKW: 'https://cdn.7tv.app/emote/abc/2x.webp' },
      fetchedAt: Date.now(),
    }))
    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                '',
      fragments: [
        { type: 'mention',   text: '@alice ' },
        { type: 'cheermote', text: 'Cheer100 ', cheermote: { prefix: 'Cheer', bits: 100 } },
        { type: 'text',      text: 'KEKW' },
      ],
    })
    expect(html).toContain('@alice')
    expect(html).toContain('Cheer100')
    expect(html).toContain('<img src="https://cdn.7tv.app/emote/abc/2x.webp"')
  })
})

describe('renderChatMessage — fallback text + providers tiers', () => {
  it('matche un code BTTV/FFZ/7TV par mot exact', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify({
      byCode: { peepoHappy: 'https://cdn.betterttv.net/emote/abc/2x.webp' },
      fetchedAt: Date.now(),
    }))
    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                'hello peepoHappy friends',
    })
    expect(html).toContain('<img src="https://cdn.betterttv.net/emote/abc/2x.webp"')
    expect(html).toContain('hello')
    expect(html).toContain('friends')
  })

  it('ne matche PAS un substring (peepoHappy123 reste du texte)', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify({
      byCode: { peepoHappy: 'https://cdn.betterttv.net/emote/abc/2x.webp' },
      fetchedAt: Date.now(),
    }))
    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                'peepoHappy123',
    })
    expect(html).not.toContain('<img')
    expect(html).toContain('peepoHappy123')
  })

  it('préserve les whitespace entre tokens', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify({ byCode: {}, fetchedAt: Date.now() }))
    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                'a   b\tc',
    })
    expect(html).toBe('a   b\tc')
  })
})

describe('cache emotes — Redis hit/miss', () => {
  it('hit cache Redis : aucun appel HTTP aux providers', async () => {
    redisGetMock.mockResolvedValueOnce(JSON.stringify({
      byCode: { KEKW: 'https://cdn.7tv.app/emote/xyz/2x.webp' },
      fetchedAt: Date.now(),
    }))
    await renderChatMessage({ twitchBroadcasterId: '42', text: 'KEKW' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('miss cache : fetch les 3 providers en parallèle + écrit le cache', async () => {
    redisGetMock.mockResolvedValueOnce(null)
    // BTTV
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ channelEmotes: [{ id: 'b1', code: 'bttvA' }], sharedEmotes: [] }),
    })
    // FFZ
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sets: { '1': { emoticons: [{ name: 'ffzA', urls: { '2': '//cdn.ffz/abc' } }] } } }),
    })
    // 7TV
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emote_set: { emotes: [{ name: 'sevenA', data: { id: 's1' } }] } }),
    })

    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                'bttvA ffzA sevenA',
    })

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(redisSetMock).toHaveBeenCalledTimes(1)
    expect(redisSetMock.mock.calls[0]![2]).toBe('EX')
    expect(redisSetMock.mock.calls[0]![3]).toBe(24 * 3600)
    expect(html).toContain('https://cdn.betterttv.net/emote/b1/2x.webp')
    expect(html).toContain('https://cdn.ffz/abc')
    expect(html).toContain('https://cdn.7tv.app/emote/s1/2x.webp')
  })

  it('si un provider échoue (404), les 2 autres restent fonctionnels', async () => {
    redisGetMock.mockResolvedValueOnce(null)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404 })  // BTTV down
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ sets: {} }),
    })
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ emote_set: { emotes: [{ name: 'survivor', data: { id: 's9' } }] } }),
    })

    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                'survivor',
    })
    expect(html).toContain('https://cdn.7tv.app/emote/s9/2x.webp')
    expect(redisSetMock).toHaveBeenCalled()
  })

  it('si fetch throw, dégrade en cache vide sans crash', async () => {
    redisGetMock.mockResolvedValueOnce(null)
    fetchMock.mockRejectedValue(new Error('network'))
    const html = await renderChatMessage({
      twitchBroadcasterId: '42',
      text:                'plain text',
    })
    expect(html).toBe('plain text')
  })
})

describe('invalidateChannelEmotes', () => {
  it('appelle redis.del avec la bonne clé', async () => {
    await invalidateChannelEmotes('42')
    expect(redisDelMock).toHaveBeenCalledWith('streamer:emotes:ch:42')
  })
})
