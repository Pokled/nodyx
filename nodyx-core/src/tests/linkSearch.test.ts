/** « Nodyx relié », 6b : la recherche de liens. Les requêtes SQL sont prouvées au banc (vraie base). */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

vi.mock('../config/database', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [] }) },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))
import { db, redis } from '../config/database'
import linksRoutes from '../routes/links'
import { likePattern } from '../services/linkSearch'

const AUTH = { Authorization: `Bearer ${jwt.sign({ userId: 'lea', username: 'lea' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}` }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.query).mockResolvedValue({ rows: [] } as any)
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
})

describe('jokers LIKE', () => {
  it('« 100% » et « a_b » sont cherchés tels quels', () => {
    expect(likePattern('100%', 'contains')).toBe('%100\\%%')
    expect(likePattern('a_b', 'prefix')).toBe('a\\_b%')
    expect(likePattern('c:\\x', 'contains')).toBe('%c:\\\\x%')
  })
})

describe('GET /links/search', () => {
  it('exige un compte', async () => {
    const app = await buildApp(a => linksRoutes(a))
    expect((await app.inject({ method: 'GET', url: '/search?q=soir' })).statusCode).toBe(401)
  })
  it.each([[''], ['   '], ['x'.repeat(101)]])('requête invalide « %s » : 400 avec un code stable', async (q) => {
    const app = await buildApp(a => linksRoutes(a))
    const res = await app.inject({ method: 'GET', url: '/search?q=' + encodeURIComponent(q), headers: AUTH })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('LINK_QUERY_INVALID')
  })
  it('types inconnus ignorés : aucune requête de contenu lancée', async () => {
    const app = await buildApp(a => linksRoutes(a))
    const res = await app.inject({ method: 'GET', url: '/search?q=soir&types=users,passwords', headers: AUTH })
    expect(res.json()).toEqual({ results: [] })
    const sql = vi.mocked(db.query).mock.calls.map(c => String(c[0])).join('\n')
    expect(sql).not.toMatch(/FROM threads|FROM events|FROM channels|wiki_pages|JOIN users/)
  })
  it('non membre : ni membres ni salons ne sont cherchés', async () => {
    const app = await buildApp(a => linksRoutes(a))
    await app.inject({ method: 'GET', url: '/search?q=lea&types=member,channel', headers: AUTH })
    const sql = vi.mocked(db.query).mock.calls.map(c => String(c[0])).join('\n')
    expect(sql).not.toMatch(/FROM channels|JOIN users u ON u.id = cm.user_id/)
  })
})
