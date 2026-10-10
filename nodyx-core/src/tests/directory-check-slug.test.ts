/**
 * GET /api/directory/check/:slug — le slug est-il libre ? (04/10/2026)
 *
 * L'installeur le demande AVANT de compiler l'instance. Avant, il ne le
 * découvrait qu'en s'inscrivant, une fois le frontend compilé pour
 * `<slug>.nodyx.org` ; en cas de conflit il changeait le slug après coup sans
 * recompiler, et le frontend appelait le domaine d'une AUTRE communauté.
 *
 * La route ne doit rien révéler de plus que POST /register (409) : pas de
 * statut, pas d'URL, pas de nom.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  },
}))

import { db, redis } from '../config/database'
import directoryRoutes from '../routes/directory'

async function check(slug: string) {
  const app = await buildApp(async (a) => { await a.register(directoryRoutes, { prefix: '/api' }) })
  const res = await app.inject({ method: 'GET', url: `/api/directory/check/${encodeURIComponent(slug)}` })
  await app.close()
  return res
}

beforeEach(() => {
  vi.mocked(db.query).mockReset()
  vi.mocked(redis.incr).mockResolvedValue(1)
})

describe('GET /api/directory/check/:slug', () => {
  it('slug libre : available true', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    const res = await check('ma-communaute')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ slug: 'ma-communaute', available: true })
  })

  it('slug pris : available false, raison « taken », et RIEN d’autre (ni statut, ni url, ni nom)', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ id: 1, status: 'active', url: 'https://x', name: 'X' }], rowCount: 1 } as any)
    const res = await check('club-des-joueurs')
    expect(res.json()).toEqual({ slug: 'club-des-joueurs', available: false, reason: 'taken' })
  })

  it('slug réservé à l’infrastructure : refusé SANS toucher à la base', async () => {
    const res = await check('relay')
    expect(res.json()).toEqual({ slug: 'relay', available: false, reason: 'reserved' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('slug invalide (format de /register) : refusé SANS toucher à la base', async () => {
    for (const bad of ['ab', 'Majuscules', '-tiret', 'a'.repeat(64), "x'; DROP TABLE"]) {
      const res = await check(bad)
      expect(res.json().available, bad).toBe(false)
      expect(res.json().reason, bad).toBe('invalid')
    }
    expect(db.query).not.toHaveBeenCalled()
  })

  it('la requête SQL est paramétrée', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    await check('ma-communaute')
    const [sql, params] = vi.mocked(db.query).mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/WHERE slug = \$1/)
    expect(params).toEqual(['ma-communaute'])
  })

  it('limitée en débit (30 / min / IP, comme la recherche)', async () => {
    vi.mocked(redis.incr).mockResolvedValue(31)
    const res = await check('ma-communaute')
    expect(res.statusCode).toBe(429)
    expect(db.query).not.toHaveBeenCalled()
  })
})
