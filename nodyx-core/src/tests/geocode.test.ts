// « Trouver sur la carte » : le pont respecte les règles d'utilisation de Nominatim
// (https://operations.osmfoundation.org/policies/nominatim/).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

const { store } = vi.hoisted(() => ({ store: new Map<string, string>() }))
vi.mock('../config/database', () => ({
  db: { query: vi.fn(async () => ({ rows: [] })) },
  redis: {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    setex: vi.fn(async (k: string, _t: number, v: string) => { store.set(k, v); return 'OK' }),
    exists: vi.fn(async () => 0), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))

import { geocodeSearch, userAgent, normalizeQuery, langOf, _resetGeocoderForTests, GeoError } from '../services/geocode'
import geoRoutes from '../routes/geo'
import { redis } from '../config/database'

const LILLE = [{ display_name: 'Lille Grand Palais, Lille, France', lat: '50.6292', lon: '3.0773', type: 'exhibition_centre' }]
const fake = (body: unknown = LILLE, ok = true) => vi.fn(async (_u: string, _i?: RequestInit) => ({ ok, json: async () => body }) as unknown as Response)

beforeEach(() => {
  store.clear(); _resetGeocoderForTests(); vi.clearAllMocks()
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  delete process.env.NODYX_GEOCODER
  process.env.FRONTEND_URL = 'https://communaute.exemple'
})
afterEach(() => { delete process.env.NODYX_GEOCODER })

describe('le pont vers OpenStreetMap', () => {
  it('trouve un lieu : libellé, coordonnées, sorte', async () => {
    const f = fake()
    expect(await geocodeSearch('Lille Grand Palais', 'fr', f as never)).toEqual([{ label: 'Lille Grand Palais, Lille, France', lat: 50.6292, lng: 3.0773, kind: 'exhibition_centre' }])
    const url = String(f.mock.calls[0][0])
    expect(url).toContain('nominatim.openstreetmap.org/search?format=jsonv2&limit=5')
    expect(url).toContain('accept-language=fr')
  })
  it('s’identifie comme Nodyx et l’instance, sans donnée personnelle', async () => {
    const f = fake()
    await geocodeSearch('Béthune', 'fr', f as never)
    const ua = (f.mock.calls[0][1]!.headers as Record<string, string>)['User-Agent']
    expect(ua).toMatch(/^Nodyx\/\S+ \(\+https:\/\/communaute\.exemple\)$/)
    expect(ua).not.toMatch(/@/)
    expect(userAgent()).toBe(ua)
  })
  it('une même recherche n’est demandée qu’UNE fois (cache), majuscules et espaces confondus', async () => {
    const f = fake()
    await geocodeSearch('Lille Grand Palais', 'fr', f as never)
    await geocodeSearch('  lille   grand PALAIS ', 'fr', f as never)
    expect(f).toHaveBeenCalledTimes(1)
    expect(normalizeQuery('  Lille   Grand ')).toBe('lille grand')
  })
  it('jamais plus d’une requête par seconde pour toute l’instance', async () => {
    const at: number[] = []
    const f = vi.fn(async () => { at.push(Date.now()); return { ok: true, json: async () => LILLE } as unknown as Response })
    await Promise.all(['a lieu', 'b lieu', 'c lieu'].map(q => geocodeSearch(q, 'fr', f as never)))
    expect(at).toHaveLength(3)
    expect(at[1] - at[0]).toBeGreaterThanOrEqual(1050)
    expect(at[2] - at[1]).toBeGreaterThanOrEqual(1050)
  }, 10_000)
  it('file pleine : « réessaie dans un instant » au lieu d’empiler', async () => {
    const f = fake()
    const all = await Promise.allSettled(Array.from({ length: 7 }, (_, i) => geocodeSearch(`lieu ${i}`, 'fr', f as never)))
    const busy = all.filter(r => r.status === 'rejected' && (r.reason as GeoError).code === 'GEO_BUSY')
    expect(busy.length).toBeGreaterThanOrEqual(1)
    expect(f.mock.calls.length).toBeLessThanOrEqual(5)
  }, 15_000)
  it('NODYX_GEOCODER=off : coupé, sans aucune requête (exigence d’OpenStreetMap)', async () => {
    process.env.NODYX_GEOCODER = 'off'
    const f = fake()
    await expect(geocodeSearch('Lille', 'fr', f as never)).rejects.toMatchObject({ code: 'GEO_DISABLED' })
    expect(f).not.toHaveBeenCalled()
  })
  it('service en panne : erreur claire, rien en cache', async () => {
    const f = fake({}, false)
    await expect(geocodeSearch('Lille', 'fr', f as never)).rejects.toMatchObject({ code: 'GEO_UNAVAILABLE' })
    expect(store.size).toBe(0)
  })
  it('réponses absurdes écartées, 5 au plus', async () => {
    const many = [{ display_name: 'faux', lat: '999', lon: '3' }, ...Array.from({ length: 8 }, (_, i) => ({ display_name: `L${i}`, lat: '50', lon: String(i) }))]
    const r = await geocodeSearch('beaucoup', 'fr', fake(many) as never)
    expect(r).toHaveLength(5)
    expect(r.every(x => x.label !== 'faux')).toBe(true)
  })
  it('langue : connue ou anglais', () => { expect(langOf('fr-FR')).toBe('fr'); expect(langOf('xx')).toBe('en'); expect(langOf(undefined)).toBe('en') })
})

describe('la route', () => {
  const token = `Bearer ${jwt.sign({ userId: 'u1', username: 'u1' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
  it('sans compte : 401', async () => {
    const app = await buildApp(a => geoRoutes(a))
    expect((await app.inject({ method: 'GET', url: '/search?q=Lille' })).statusCode).toBe(401)
  })
  it('trop court : 400 GEO_QUERY_INVALID', async () => {
    const app = await buildApp(a => geoRoutes(a))
    const r = await app.inject({ method: 'GET', url: '/search?q=ab', headers: { authorization: token } })
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('GEO_QUERY_INVALID')
  })
  it('coupé : 503 GEO_DISABLED, et /status le dit', async () => {
    process.env.NODYX_GEOCODER = 'off'
    const app = await buildApp(a => geoRoutes(a))
    const r = await app.inject({ method: 'GET', url: '/search?q=Lille', headers: { authorization: token } })
    expect(r.statusCode).toBe(503); expect(r.json().code).toBe('GEO_DISABLED')
    expect((await app.inject({ method: 'GET', url: '/status', headers: { authorization: token } })).json()).toEqual({ enabled: false })
  })
  it('en cache : résultats et attribution', async () => {
    store.set(`geo:search:fr:${(await import('crypto')).createHash('sha256').update('lille').digest('hex').slice(0, 32)}`, JSON.stringify([{ label: 'Lille', lat: 50.6, lng: 3.06, kind: 'city' }]))
    const app = await buildApp(a => geoRoutes(a))
    const r = await app.inject({ method: 'GET', url: '/search?q=Lille&lang=fr', headers: { authorization: token } })
    expect(r.statusCode).toBe(200)
    expect(r.json()).toEqual({ results: [{ label: 'Lille', lat: 50.6, lng: 3.06, kind: 'city' }], attribution: '© OpenStreetMap contributors' })
  })
})
