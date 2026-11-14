/**
 * Socle du calendrier (audit du 14/11/2026, SPECS/NODYX_EVENEMENTS_AUDIT.md) :
 * bornes au serveur, droits par getAccess, inscription à la dernière place atomique.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

vi.mock('../config/database', () => ({
  db: { query: vi.fn(), connect: vi.fn() },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))
vi.mock('../socket/io', () => ({ io: { emit: vi.fn() } }))
vi.mock('../services/webhooks/announce', () => ({ announceCalendarEvent: vi.fn() }))
const { access } = vi.hoisted(() => ({ access: new Map<string, { role: string | null; rank: number; permissions: string[] }>() }))
vi.mock('../services/permissions', async (orig) => ({
  ...(await orig<typeof import('../services/permissions')>()),
  getAccess: vi.fn(async (_c: string, u: string) => access.get(u) ?? { role: null, rank: -1, permissions: [] }),
}))

import { db, redis } from '../config/database'
import eventRoutes from '../routes/events'

const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
const as = (u: string) => ({ Authorization: `Bearer ${tokenOf(u)}` })
const FUTURE = '2027-01-10T19:00:00Z', PAST = '2020-01-10T19:00:00Z'

let ev: Record<string, any>
let going: { user: string }[]
let txLog: string[]

function world() {
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql).replace(/\s+/g, ' ')
    txLog.push(s.slice(0, 160))
    if (s.includes('SELECT community_id FROM community_members WHERE user_id')) return { rows: [{ community_id: 'c1' }] } as any
    if (s.includes('SELECT e.author_id')) return { rows: [{ author_id: ev.author_id, community_id: 'c1' }] } as any
    if (s.includes('FOR UPDATE')) return { rows: [{ max_attendees: ev.max_attendees }] } as any
    if (s.includes('COUNT(*) FILTER')) return { rows: [{ going: going.length, mine: going.some(g => g.user === params[1]) ? 1 : 0 }] } as any
    if (s.includes('FROM events WHERE id = $1')) return { rows: [ev] } as any
    if (s.includes('SELECT starts_at, ends_at FROM events')) return { rows: [{ starts_at: ev.starts_at, ends_at: ev.ends_at }] } as any
    if (s.includes('INSERT INTO event_rsvps')) { going.push({ user: params[1] }); return { rows: [] } as any }
    if (s.includes('INSERT INTO events') || s.includes('UPDATE events SET')) return { rows: [{ ...ev, id: 'ev1' }] } as any
    if (s.includes('FROM users WHERE id')) return { rows: [{ id: params[0], username: params[0], avatar: null }] } as any
    return { rows: [] } as any
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked((db as any).connect).mockImplementation(async () => ({ query: (...a: any[]) => (db.query as any)(...a), release: () => {} }))
  access.clear()
  access.set('lea', { role: 'member', rank: 0, permissions: [] })
  access.set('modo', { role: 'member', rank: 0, permissions: ['moderate_content'] })   // grade « Modérer »
  access.set('gardien', { role: 'owner', rank: 4, permissions: ['moderate_content', 'moderate_members'] })
  ev = { id: 'ev1', title: 'Soirée jeux', is_public: true, community_id: 'c1', author_id: 'lea', rsvp_enabled: true,
    max_attendees: null, is_cancelled: false, starts_at: FUTURE, ends_at: null }
  going = []; txLog = []
  world()
})

describe('Le serveur borne ce qu’il reçoit', () => {
  const create = (payload: Record<string, unknown>) => async () =>
    (await buildApp(a => eventRoutes(a))).inject({ method: 'POST', url: '/', headers: as('lea'), payload: { title: 'Soirée jeux', starts_at: FUTURE, ...payload } })
  it('lien d’achat : https seulement (javascript: refusé)', async () => {
    expect((await create({ ticket_url: 'javascript:alert(1)' })()).statusCode).toBe(400)
    expect((await create({ ticket_url: 'http://exemple.fr/billet' })()).statusCode).toBe(400)
    expect((await create({ ticket_url: 'https://helloasso.com/billet' })()).statusCode).toBe(201)
  })
  it('coordonnées dans les bornes du globe', async () => {
    expect((await create({ location_lat: 200, location_lng: 3 })()).statusCode).toBe(400)
    expect((await create({ location_lat: 50.6, location_lng: 3.05 })()).statusCode).toBe(201)
  })
  it('la fin ne précède pas le début (création)', async () => {
    expect((await create({ ends_at: '2027-01-10T18:00:00Z' })()).statusCode).toBe(400)
  })
  it('la fin ne précède pas le début (modification d’un seul des deux)', async () => {
    const res = await (await buildApp(a => eventRoutes(a))).inject({ method: 'PATCH', url: '/ev1', headers: as('lea'), payload: { ends_at: '2027-01-10T18:00:00Z' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('EVENT_ENDS_BEFORE_START')
  })
})

describe('Qui gère un événement', () => {
  const patch = async (who: string) => (await buildApp(a => eventRoutes(a))).inject({ method: 'PATCH', url: '/ev1', headers: as(who), payload: { location: 'Salle 2' } })
  it('l’autrice, membre : oui', async () => { expect((await patch('lea')).statusCode).toBe(200) })
  it('l’autrice partie ou bannie : NON (elle gardait la main)', async () => {
    access.delete('lea')
    const res = await patch('lea')
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('EVENT_FORBIDDEN')
  })
  it('un modérateur (rôle) : oui', async () => {
    access.set('modo2', { role: 'moderator', rank: 1, permissions: ['moderate_content', 'moderate_members'] })
    expect((await patch('modo2')).statusCode).toBe(200)
  })
  it('un grade « Modérer » : oui pour un événement sans auteur (le grade était ignoré)', async () => {
    ev.author_id = null
    expect((await patch('modo')).statusCode).toBe(200)
  })
  it('un grade « Modérer » n’agit pas sur un membre de même rang (règle du CDC modération, comme au forum)', async () => {
    expect((await patch('modo')).statusCode).toBe(403)
  })
  it('un membre sans droit : non', async () => { access.set('max', { role: 'member', rank: 0, permissions: [] }); expect((await patch('max')).statusCode).toBe(403) })
  it('un modérateur ne touche pas l’événement du propriétaire', async () => { ev.author_id = 'gardien'; expect((await patch('modo')).statusCode).toBe(403) })
  it('le propriétaire touche tout', async () => { expect((await patch('gardien')).statusCode).toBe(200) })
})

describe('S’inscrire', () => {
  const rsvp = async (who: string, status = 'going') => (await buildApp(a => eventRoutes(a))).inject({ method: 'POST', url: '/ev1/rsvp', headers: as(who), payload: { status } })
  it('événement annulé : refusé', async () => { ev.is_cancelled = true; expect((await rsvp('lea')).json().code).toBe('EVENT_CANCELLED') })
  it('événement passé : refusé', async () => { ev.starts_at = PAST; expect((await rsvp('lea')).json().code).toBe('EVENT_PAST') })
  it('dernière place : verrou, recompte, inscription, validation (dans cet ordre)', async () => {
    ev.max_attendees = 2; going = [{ user: 'max' }]
    expect((await rsvp('lea')).statusCode).toBe(200)
    const i = (k: string) => txLog.findIndex(l => l.includes(k))
    expect(i('BEGIN')).toBeGreaterThan(-1)
    expect(i('FOR UPDATE')).toBeGreaterThan(i('BEGIN'))
    expect(i('COUNT(*) FILTER')).toBeGreaterThan(i('FOR UPDATE'))
    expect(i('INSERT INTO event_rsvps')).toBeGreaterThan(i('COUNT(*) FILTER'))
    expect(i('COMMIT')).toBeGreaterThan(i('INSERT INTO event_rsvps'))
  })
  it('complet : refusé, rien n’est écrit, la transaction est annulée', async () => {
    ev.max_attendees = 1; going = [{ user: 'max' }]
    const res = await rsvp('lea')
    expect(res.json().code).toBe('EVENT_FULL')
    expect(going).toHaveLength(1)
    expect(txLog.some(l => l.startsWith('ROLLBACK'))).toBe(true)
  })
  it('déjà inscrit quand c’est complet : re-cliquer « J’y vais » reste accepté', async () => {
    ev.max_attendees = 1; going = [{ user: 'lea' }]
    expect((await rsvp('lea')).statusCode).toBe(200)
  })
  it('« Peut-être » ne compte pas dans la jauge', async () => {
    ev.max_attendees = 1; going = [{ user: 'max' }]
    expect((await rsvp('lea', 'maybe')).statusCode).toBe(200)
  })
})

describe('Le prix revient en nombre', () => {
  it('les lectures convertissent le prix (NUMERIC arrivait en texte : « 0.00 » n’était pas gratuit)', async () => {
    await (await buildApp(a => eventRoutes(a))).inject({ method: 'GET', url: '/ev1' })
    expect(vi.mocked(db.query).mock.calls.some(c => String(c[0]).includes('e.ticket_price::float8 AS ticket_price'))).toBe(true)
  })
})
