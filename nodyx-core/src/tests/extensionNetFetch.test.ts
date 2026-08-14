import { describe, it, expect, vi } from 'vitest'
import { proxyFetch, type ProxyContext, type Transport, type RawResponse } from '../extensions/netFetch'

// Le TRANSPORT est remplace, jamais le garde d'adresse.
//
// Remplacer le garde reviendrait a tester un systeme qui n'est pas celui qu'on
// livre. En remplacant le transport, on eprouve toute l'orchestration pendant
// que le garde reste exactement celui de production, et deux tests le montrent
// en le laissant refuser pour de vrai.
//
// Ce qui reste non couvert par un test portable : la traversee d'une vraie
// socket. Assume et ecrit, plutot que simule.

function ctx(over: Partial<ProxyContext> = {}): ProxyContext {
  return {
    granted: over.granted ?? {
      'api.tmdb.example': { methods: ['GET'], paths: ['/3/*'], secret: 'TMDB' },
      'cdn.tmdb.example': { methods: ['GET'], paths: ['/*'] },
    },
    allowPrivate: over.allowPrivate ?? new Set(),
    secrets:      over.secrets      ?? { TMDB: 'SECRET-DE-L-INSTANCE' },
    recipes:      over.recipes,
  }
}

function transportOf(...responses: Array<Partial<RawResponse>>): { t: Transport; calls: Array<{ url: string; headers: Record<string, string> }> } {
  const calls: Array<{ url: string; headers: Record<string, string> }> = []
  let i = 0
  const t: Transport = async (url, _m, headers) => {
    calls.push({ url: url.toString(), headers: { ...headers } })
    const r = responses[Math.min(i++, responses.length - 1)]
    return { status: 200, headers: {}, body: '', ...r }
  }
  return { t, calls }
}

describe('appel nominal', () => {
  it('rend le corps et filtre les en-tetes de reponse', async () => {
    const { t } = transportOf({
      status: 200, body: '{"ok":true}',
      headers: { 'content-type': 'application/json', 'set-cookie': 'trace=1', 'x-powered-by': 'php' },
    })
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/movie/603' }, ctx(), t)
    if (!r.ok) throw new Error('refuse a tort : ' + r.code)
    expect(r.response.body).toBe('{"ok":true}')
    expect(r.response.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('injecte le secret sans que l extension ait pu le nommer ni le placer', async () => {
    const { t, calls } = transportOf({})
    await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1', headers: { 'X-Vole': 'donne' } }, ctx(), t)
    expect(calls[0].headers.authorization).toBe('Bearer SECRET-DE-L-INSTANCE')
    expect(calls[0].headers['x-vole']).toBeUndefined()
  })

  it('place le secret en parametre quand la recette de l instance le dit', async () => {
    const { t, calls } = transportOf({})
    await proxyFetch(
      { url: 'https://api.tmdb.example/3/movie/1' },
      ctx({ recipes: { 'api.tmdb.example': { mode: 'query', param: 'api_key' } } }),
      t,
    )
    expect(calls[0].url).toContain('api_key=SECRET-DE-L-INSTANCE')
    expect(calls[0].headers.authorization).toBeUndefined()
  })
})

describe('redirections : chaque saut est une nouvelle cible', () => {
  it('suit une redirection vers un hote lui aussi accorde', async () => {
    const { t, calls } = transportOf(
      { status: 302, headers: { location: 'https://cdn.tmdb.example/img/a.jpg' } },
      { status: 200, body: 'IMAGE' },
    )
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1' }, ctx(), t)
    if (!r.ok) throw new Error('refuse a tort : ' + r.code)
    expect(r.response.body).toBe('IMAGE')
    expect(calls).toHaveLength(2)
  })

  it('refuse une redirection vers un hote NON accorde', async () => {
    // Le contournement le plus simple d'une liste blanche.
    const { t } = transportOf({ status: 302, headers: { location: 'https://evil.example/vole' } })
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1' }, ctx(), t)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.code).toBe('HOST_NOT_ALLOWED')
      expect(r.message).toContain('redirection refusée')
    }
  })

  it('refuse une redirection vers un chemin hors des prefixes du meme hote', async () => {
    const { t } = transportOf({ status: 302, headers: { location: '/4/account/secret' } })
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1' }, ctx(), t)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('PATH_NOT_ALLOWED')
  })

  it('N EMPORTE PAS le secret vers l autre hote', async () => {
    // Le secret appartient a l'hote qui l'a declare, pas au voyage.
    const { t, calls } = transportOf(
      { status: 302, headers: { location: 'https://cdn.tmdb.example/img/a.jpg' } },
      { status: 200, body: 'IMAGE' },
    )
    await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1' }, ctx(), t)
    expect(calls[0].headers.authorization).toBe('Bearer SECRET-DE-L-INSTANCE')
    expect(calls[1].headers.authorization).toBeUndefined()
  })

  it('coupe une boucle de redirection', async () => {
    const { t } = transportOf({ status: 302, headers: { location: 'https://api.tmdb.example/3/loop' } })
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/loop' }, ctx(), t)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('TOO_MANY_REDIRECTS')
  })
})

describe('traduction des erreurs de transport', () => {
  it.each([
    ['EPRIVATEADDR', 'PRIVATE_ADDRESS'],
    ['ERESPTOOBIG',  'RESPONSE_TOO_LARGE'],
    ['ETIMEDOUT',    'UPSTREAM_TIMEOUT'],
    ['ECONNREFUSED', 'UPSTREAM_ERROR'],
  ])('%s devient %s', async (nodeCode, expected) => {
    const t: Transport = async () => { throw Object.assign(new Error('boum'), { code: nodeCode }) }
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1' }, ctx(), t)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe(expected)
  })

  it('ne divulgue pas le detail interne d une panne distante', async () => {
    const t: Transport = async () => { throw new Error('getaddrinfo ENOTFOUND interne.vpc.local') }
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1' }, ctx(), t)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).not.toContain('vpc.local')
  })
})

describe('le garde de production, laisse a l oeuvre', () => {
  it('refuse la boucle locale AVANT tout transport', async () => {
    const t = vi.fn()
    const granted = { localhost: { methods: ['GET'], paths: ['/*'] } }
    const r = await proxyFetch({ url: 'http://localhost/admin' }, ctx({ granted, allowPrivate: new Set(['localhost']) }), t as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('HOST_FORBIDDEN')
    expect(t).not.toHaveBeenCalled()          // aucune socket n'a ete ouverte
  })

  it('refuse un hote non accorde AVANT tout transport', async () => {
    const t = vi.fn()
    const r = await proxyFetch({ url: 'https://ailleurs.example/x' }, ctx(), t as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('HOST_NOT_ALLOWED')
    expect(t).not.toHaveBeenCalled()
  })

  it('refuse un corps demesure AVANT tout transport', async () => {
    const t = vi.fn()
    const r = await proxyFetch({ url: 'https://api.tmdb.example/3/movie/1', body: 'x'.repeat(100_000) }, ctx(), t as never)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.code).toBe('INVALID_ARGUMENT')
    expect(t).not.toHaveBeenCalled()
  })
})
