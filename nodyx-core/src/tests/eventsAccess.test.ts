/**
 * Un événement « Privé » n'est lisible que par les membres de la communauté : même règle
 * que la liste (GET /events). Avant le 13/11/2026, la lecture par identifiant et
 * l'inscription ne vérifiaient rien.
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
// Droits (lot socle du 14/11) : membre simple par défaut ; un test peut en décider autrement
vi.mock('../services/permissions', async (orig) => ({
  ...(await orig<typeof import('../services/permissions')>()),
  getAccess: vi.fn(async () => ({ role: 'member', rank: 0, permissions: [] })),
}))
vi.mock('../services/webhooks/announce', () => ({ announceCalendarEvent: vi.fn() }))

import { db, redis } from '../config/database'
import eventRoutes from '../routes/events'

const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })

const EVENT = (isPublic: boolean) => ({
  id: 'ev1', title: 'Réunion de l’équipe', description: '<p>ordre du jour</p>', is_public: isPublic,
  community_id: 'c1', rsvp_enabled: true, max_attendees: null, going_count: 0,
  starts_at: '2026-12-01T19:00:00Z',
})

/** La base : un événement, et `members` = les comptes membres de la communauté c1. */
function world(isPublic: boolean, members: string[]) {
  const writes: string[] = []
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('FROM community_members WHERE community_id = $1 AND user_id = $2'))
      return { rows: members.includes(params[1]) ? [{ '?column?': 1 }] : [] } as any
    if (s.includes('FROM events e') && s.includes('WHERE e.id = $1')) return { rows: [EVENT(isPublic)] } as any
    if (s.includes('FROM events WHERE id = $1')) return { rows: [EVENT(isPublic)] } as any
    if (s.includes('SELECT e.author_id'))       return { rows: [{ author_id: 'auteur', community_id: 'c1' }] } as any
    if (s.includes('INSERT INTO event_rsvps'))  { writes.push(params[1]); return { rows: [] } as any }
    return { rows: [] } as any
  })
  return writes
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked((db as any).connect).mockImplementation(async () => ({ query: (...a: any[]) => (db.query as any)(...a), release: () => {} }))
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
})

describe('Lire un événement par son identifiant', () => {
  it('public : lisible sans compte', async () => {
    world(true, [])
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'GET', url: '/ev1' })
    expect(res.statusCode).toBe(200)
    expect(res.json().event.title).toBe('Réunion de l’équipe')
  })

  it('privé, sans compte : 404 comme un événement inexistant, et RIEN de son contenu', async () => {
    world(false, ['lea'])
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'GET', url: '/ev1' })
    expect(res.statusCode).toBe(404)
    expect(res.json().code).toBe('EVENT_NOT_FOUND')
    expect(res.body).not.toContain('Réunion')
    expect(res.body).not.toContain('ordre du jour')
  })

  it('privé, compte NON membre : 404', async () => {
    world(false, ['lea'])
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'GET', url: '/ev1', headers: { Authorization: `Bearer ${tokenOf('etranger')}` } })
    expect(res.statusCode).toBe(404)
    expect(res.body).not.toContain('Réunion')
  })

  it('privé, membre : lisible, et l’identifiant de communauté ne fuit pas dans la réponse', async () => {
    world(false, ['lea'])
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'GET', url: '/ev1', headers: { Authorization: `Bearer ${tokenOf('lea')}` } })
    expect(res.statusCode).toBe(200)
    expect(res.json().event.title).toBe('Réunion de l’équipe')
    expect(res.json().event.community_id).toBeUndefined()
  })
})

describe('S’inscrire (RSVP)', () => {
  it('privé, compte NON membre : 404, aucune inscription écrite', async () => {
    const writes = world(false, ['lea'])
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'POST', url: '/ev1/rsvp', headers: { Authorization: `Bearer ${tokenOf('etranger')}` }, payload: { status: 'going' } })
    expect(res.statusCode).toBe(404)
    expect(writes).toHaveLength(0)
  })

  it('privé, membre : inscription acceptée', async () => {
    const writes = world(false, ['lea'])
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'POST', url: '/ev1/rsvp', headers: { Authorization: `Bearer ${tokenOf('lea')}` }, payload: { status: 'going' } })
    expect(res.statusCode).toBe(200)
    expect(writes).toEqual(['lea'])
  })

  it('public, n’importe quel compte : inscription acceptée (comportement inchangé)', async () => {
    const writes = world(true, [])
    const app = await buildApp(a => eventRoutes(a))
    const res = await app.inject({ method: 'POST', url: '/ev1/rsvp', headers: { Authorization: `Bearer ${tokenOf('etranger')}` }, payload: { status: 'going' } })
    expect(res.statusCode).toBe(200)
    expect(writes).toEqual(['etranger'])
  })
})
