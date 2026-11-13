/**
 * Annonces en direct d'un événement (Socket.IO). `io.emit` part vers TOUTES les connexions,
 * y compris un compte retiré de la communauté qui garde sa session. Avant le 13/11/2026,
 * un événement privé y passait en entier. Règle : seul un PUBLIC est annoncé, sans
 * identifiant de communauté ; un privé n'est annoncé à personne.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))
vi.mock('../socket/io', () => ({ io: { emit: vi.fn() } }))
vi.mock('../services/webhooks/announce', () => ({ announceCalendarEvent: vi.fn() }))

import { db, redis } from '../config/database'
import { io } from '../socket/io'
import eventRoutes from '../routes/events'

const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
const auth = { Authorization: `Bearer ${tokenOf('lea')}` }

const ROW = (isPublic: boolean) => ({
  id: 'ev1', title: 'Réunion de l’équipe', description: '<p>les sanctions du mois</p>', location: 'Salle 2',
  is_public: isPublic, community_id: 'c1', author_id: 'lea', rsvp_enabled: true, max_attendees: null, going_count: 0,
  starts_at: '2026-12-01T19:00:00Z',
})

/** lea est membre et autrice. `isPublic` = état de l'événement en base (après écriture). */
function world(isPublic: boolean) {
  vi.mocked(db.query).mockImplementation(async (sql: any) => {
    const s = String(sql)
    if (s.includes('SELECT community_id FROM community_members WHERE user_id')) return { rows: [{ community_id: 'c1' }] } as any
    if (s.includes('FROM community_members WHERE community_id = $1 AND user_id = $2')) return { rows: [{ role: 'member' }] } as any
    if (s.includes('INSERT INTO events') || s.includes('UPDATE events SET')) return { rows: [ROW(isPublic)] } as any
    if (s.includes('DELETE FROM events')) return { rows: s.includes('RETURNING') ? [{ is_public: isPublic }] : [] } as any
    if (s.includes('SELECT e.author_id')) return { rows: [{ author_id: 'lea', community_id: 'c1' }] } as any
    if (s.includes('FROM events WHERE id = $1')) return { rows: [ROW(isPublic)] } as any
    if (s.includes('FROM users WHERE id')) return { rows: [{ id: 'lea', username: 'lea', avatar: null }] } as any
    return { rows: [] } as any
  })
}

const emitted = () => vi.mocked(io!.emit).mock.calls.map(c => [c[0], JSON.stringify(c[1])] as const)

const actions: [string, (app: any) => Promise<any>][] = [
  ['création', app => app.inject({ method: 'POST', url: '/', headers: auth, payload: { title: 'Réunion de l’équipe', starts_at: '2026-12-01T19:00:00Z', is_public: false } })],
  ['modification', app => app.inject({ method: 'PATCH', url: '/ev1', headers: auth, payload: { location: 'Salle 2' } })],
  ['suppression', app => app.inject({ method: 'DELETE', url: '/ev1', headers: auth })],
  ['inscription', app => app.inject({ method: 'POST', url: '/ev1/rsvp', headers: auth, payload: { status: 'going' } })],
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
})

describe('Événement PRIVÉ : rien n’est annoncé à toutes les connexions', () => {
  for (const [name, act] of actions) {
    it(name, async () => {
      world(false)
      const res = await act(await buildApp(a => eventRoutes(a)))
      expect(res.statusCode).toBeLessThan(300)
      expect(emitted()).toEqual([])
    })
  }
})

describe('Événement PUBLIC : annoncé comme avant, sans identifiant de communauté', () => {
  for (const [name, act] of actions) {
    it(name, async () => {
      world(true)
      const res = await act(await buildApp(a => eventRoutes(a)))
      expect(res.statusCode).toBeLessThan(300)
      const sent = emitted()
      expect(sent).toHaveLength(1)
      expect(sent[0][1]).not.toContain('community_id')
    })
  }
})

describe('Modifier un seul champ ne touche QUE ce champ', () => {
  function updates() {
    const q = vi.mocked(db.query).mock.calls.map(c => String(c[0])).find(s => s.includes('UPDATE events SET'))!
    return q.slice(q.indexOf('SET') + 3, q.indexOf('WHERE')).split(',').map(x => x.trim().split(' ')[0])
  }

  it('« Annuler l’événement » ({ is_cancelled }) : ni public, ni description, ni inscriptions réécrits', async () => {
    world(false)
    const res = await (await buildApp(a => eventRoutes(a))).inject({ method: 'PATCH', url: '/ev1', headers: auth, payload: { is_cancelled: true } })
    expect(res.statusCode).toBe(200)
    expect(updates()).toEqual(['is_cancelled', 'updated_at', 'last_indexed_at'])
  })

  it('changer le lieu seul ne change que le lieu', async () => {
    world(false)
    await (await buildApp(a => eventRoutes(a))).inject({ method: 'PATCH', url: '/ev1', headers: auth, payload: { location: 'Salle 3' } })
    expect(updates()).toEqual(['location', 'updated_at', 'last_indexed_at'])
  })

  it('la création garde ses valeurs par défaut (public, sans inscriptions, EUR)', async () => {
    world(true)
    await (await buildApp(a => eventRoutes(a))).inject({ method: 'POST', url: '/', headers: auth, payload: { title: 'Soirée', starts_at: '2026-12-01T19:00:00Z' } })
    const call = vi.mocked(db.query).mock.calls.find(c => String(c[0]).includes('INSERT INTO events'))!
    const p = call[1] as unknown[]
    expect(p[3]).toBe('')        // description
    expect(p[9]).toBe(false)     // is_all_day
    expect(p[10]).toBe(true)     // is_public
    expect(p[12]).toEqual([])    // tags
    expect(p[13]).toBe(false)    // rsvp_enabled
    expect(p[16]).toBe('EUR')    // ticket_currency
  })
})
