/**
 * Tests for GET /api/v1/search
 * Validates: query required, type filter, limit/offset, community resolution
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    exists: vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl:    vi.fn().mockResolvedValue(60),
    setex:  vi.fn().mockResolvedValue('OK'),
  },
}))

import { db }        from '../config/database'
import searchRoutes  from '../routes/search'

const FAKE_THREAD = {
  id: 'thread-uuid-1',
  title: 'Installation de Nodyx',
  created_at: '2026-03-28T00:00:00Z',
  author_username: 'Pokled',
  category_id: 'cat-uuid-1',
  category_name: 'Guides & Documentation',
  headline: 'Installation de <mark>Nodyx</mark> en une commande',
}

const FAKE_POST = {
  id: 'post-uuid-1',
  thread_id: 'thread-uuid-1',
  created_at: '2026-03-28T10:00:00Z',
  thread_title: 'Installation de Nodyx',
  category_id: 'cat-uuid-1',
  author_username: 'Pokled',
  headline: 'Utilise <mark>Nodyx</mark> sur Ubuntu 24.04',
}

// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/search', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('returns 400 when q is missing', async () => {
    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
  })

  it('returns 400 when q is empty string', async () => {
    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=' })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when q exceeds 200 chars', async () => {
    const app = await buildApp(app => searchRoutes(app))
    const longQ = 'a'.repeat(201)
    const res = await app.inject({ method: 'GET', url: `/?q=${longQ}` })
    expect(res.statusCode).toBe(400)
  })

  it('returns 400 for invalid type param', async () => {
    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=nodyx&type=users' })
    expect(res.statusCode).toBe(400)
  })

  it('returns threads and posts for type=all (default)', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] } as any) // getCommunityId
      .mockResolvedValueOnce({ rows: [FAKE_THREAD] } as any)  // threads query
      .mockResolvedValueOnce({ rows: [FAKE_POST] } as any)    // posts query

    // Reset module-level community cache by re-importing fresh
    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=nodyx' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.query).toBe('nodyx')
    expect(body.threads).toBeInstanceOf(Array)
    expect(body.posts).toBeInstanceOf(Array)
  })

  it('returns only threads for type=threads', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] } as any)
      .mockResolvedValueOnce({ rows: [FAKE_THREAD] } as any)

    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=nodyx&type=threads' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.threads).toHaveLength(1)
    expect(body.posts).toHaveLength(0)
  })

  it('returns only posts for type=posts', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] } as any)
      .mockResolvedValueOnce({ rows: [FAKE_POST] } as any)

    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=nodyx&type=posts' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.threads).toHaveLength(0)
    expect(body.posts).toHaveLength(1)
  })

  it('returns empty results when no community configured', async () => {
    // Use mockImplementation to route by SQL — works regardless of _communityId cache state
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (String(sql).includes('communities')) return { rows: [] } as any
      return { rows: [] } as any
    })

    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=nodyx' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.threads).toHaveLength(0)
    expect(body.posts).toHaveLength(0)
  })

  it('returns empty array when no results match', async () => {
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (String(sql).includes('communities')) return { rows: [{ id: 'c1' }] } as any
      return { rows: [] } as any  // threads and posts both empty
    })

    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=aucunresultatpossible' })
    expect(res.statusCode).toBe(200)
    expect(res.json().threads).toHaveLength(0)
    expect(res.json().posts).toHaveLength(0)
  })

  it('respects limit parameter (max 50)', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'c1' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)
      .mockResolvedValueOnce({ rows: [] } as any)

    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=nodyx&limit=10' })
    expect(res.statusCode).toBe(200)
    const callsWithLimit = vi.mocked(db.query).mock.calls
      .filter(([sql]) => String(sql).includes('LIMIT'))
    expect(callsWithLimit.length).toBeGreaterThan(0)
    // Limit 10 should be passed as param
    expect(callsWithLimit.some(([, params]) => (params as any[]).includes(10))).toBe(true)
  })

  it('rejects limit > 50', async () => {
    const app = await buildApp(app => searchRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/?q=nodyx&limit=100' })
    expect(res.statusCode).toBe(400)
  })
})
