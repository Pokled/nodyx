// « # » (lot C4) : la marque d'endroit, le nettoyeur, et le nom relu pour CHAQUE lecteur.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))
vi.mock('../middleware/requireModule', () => ({ isModuleEnabled: vi.fn(async () => true), requireModule: () => async () => {} }))

import { db, redis } from '../config/database'
import { sanitize } from '../utils/sanitize'
import { PLACE_VALUE, resolvePlaces, foldText } from '../services/places'
import linksRoutes from '../routes/links'

const EV_PUB = '11111111-1111-4111-8111-111111111111'
const EV_PRIV = '22222222-2222-4222-8222-222222222222'
const CHAN = '33333333-3333-4333-8333-333333333333'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: u }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('SELECT community_id FROM community_members WHERE user_id')) return { rows: params[0] === 'lea' ? [{ community_id: 'c1' }] : [] } as any
    if (s.includes('FROM community_members WHERE community_id = $1 AND user_id = $2')) return { rows: params[1] === 'lea' ? [{ '?column?': 1 }] : [] } as any
    if (s.includes('FROM events WHERE id = ANY')) return { rows: [
      { id: EV_PUB, title: 'Soirée jeux', is_public: true, community_id: 'c1' },
      { id: EV_PRIV, title: 'Réunion secrète de l’équipe', is_public: false, community_id: 'c1' },
    ].filter(e => params[0].includes(e.id)) } as any
    if (s.includes('FROM channels WHERE id = ANY')) return { rows: params[1] === 'c1' ? [{ id: CHAN, name: 'général' }] : [] } as any
    return { rows: [] } as any
  })
})

describe('la marque d’endroit', () => {
  it('« <sorte>:<uuid> », six sortes, rien d’autre', () => {
    for (const k of ['channel', 'event', 'thread', 'wiki', 'poll', 'board']) expect(PLACE_VALUE.test(`${k}:${EV_PUB}`)).toBe(true)
    for (const v of ['user:' + EV_PUB, 'event:abc', `event:${EV_PUB} `, `javascript:${EV_PUB}`, '']) expect(PLACE_VALUE.test(v)).toBe(false)
  })
  it('le nettoyeur garde une vraie marque, retire une marque inventée (et garde le lien)', () => {
    const ok = sanitize(`<p><a href="/calendar/${EV_PUB}" data-place="event:${EV_PUB}">#Soirée</a></p>`)
    expect(ok).toContain(`data-place="event:${EV_PUB}"`)
    const bad = sanitize(`<p><a href="/x" data-place="user:${EV_PUB}" onclick="x()">#Piège</a></p>`)
    expect(bad).not.toContain('data-place')
    expect(bad).not.toContain('onclick')
    expect(bad).toContain('href="/x"')
  })
  it('recherche sans accents, comme la base (œ → o)', () => {
    expect(foldText('Soirée Œnologie')).toBe('soiree onologie')
  })
})

describe('le nom relu pour chaque lecteur', () => {
  it('membre : événement privé et salon lisibles', async () => {
    const r = await resolvePlaces([`event:${EV_PRIV}`, `channel:${CHAN}`], 'lea')
    expect(r).toEqual([
      { ref: `event:${EV_PRIV}`, ok: true, kind: 'event', title: 'Réunion secrète de l’équipe', url: `/calendar/${EV_PRIV}` },
      { ref: `channel:${CHAN}`, ok: true, kind: 'channel', title: 'général', url: `/chat?channel=${CHAN}` },
    ])
  })
  it('visiteur sans compte : l’événement public oui, le privé et le salon NON, sans nom', async () => {
    const r = await resolvePlaces([`event:${EV_PUB}`, `event:${EV_PRIV}`, `channel:${CHAN}`], null)
    expect(r[0]).toMatchObject({ ok: true, title: 'Soirée jeux' })
    expect(r[1]).toEqual({ ref: `event:${EV_PRIV}`, ok: false })
    expect(r[2]).toEqual({ ref: `channel:${CHAN}`, ok: false })
    expect(JSON.stringify(r)).not.toContain('secrète')
  })
  it('inexistant et interdit : la même réponse (on ne révèle pas qu’il existe)', async () => {
    const r = await resolvePlaces([`event:${EV_PRIV}`, `event:44444444-4444-4444-8444-444444444444`], 'etranger')
    expect(r.map(x => x.ok)).toEqual([false, false])
    expect(Object.keys(r[0]).sort()).toEqual(Object.keys(r[1]).sort())
  })
})

describe('les routes', () => {
  it('suggestion : compte exigé, 64 caractères au plus', async () => {
    const app = await buildApp(a => linksRoutes(a))
    expect((await app.inject({ method: 'GET', url: '/places?q=soi' })).statusCode).toBe(401)
    expect((await app.inject({ method: 'GET', url: `/places?q=${'x'.repeat(65)}`, headers: { authorization: token('lea') } })).json().code).toBe('PLACE_QUERY_INVALID')
    expect((await app.inject({ method: 'GET', url: '/places?q=', headers: { authorization: token('lea') } })).statusCode).toBe(200)
  })
  it('résolution : sans compte possible, refs bornées et vérifiées', async () => {
    const app = await buildApp(a => linksRoutes(a))
    const ok = await app.inject({ method: 'POST', url: '/places/resolve', payload: { refs: [`event:${EV_PUB}`] } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().places[0]).toMatchObject({ ok: true, title: 'Soirée jeux' })
    expect((await app.inject({ method: 'POST', url: '/places/resolve', payload: { refs: ['n’importe quoi'] } })).json().code).toBe('PLACE_REFS_INVALID')
    expect((await app.inject({ method: 'POST', url: '/places/resolve', payload: { refs: Array(51).fill(`event:${EV_PUB}`) } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/places/resolve', payload: { refs: [] } })).statusCode).toBe(400)
  })
})
