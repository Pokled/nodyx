import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

// La réponse que la 2.12.0 a mise en cache, juste avant le nodyx-update.
const STALE = JSON.stringify({
  current_version: '2.12.0', latest_version: '2.13.0', has_update: true,
  release_url: 'https://github.com/Pokled/nodyx/releases/tag/v2.13.0',
})

vi.mock('../config/database', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  redis: {
    // L'ancienne clé, sans version, contient la réponse de la 2.12.0.
    get:    vi.fn(async (key: string) => (key === 'update_check' ? STALE : null)),
    set:    vi.fn().mockResolvedValue('OK'),
    exists: vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../utils/version', () => ({ NODYX_VERSION: '2.13.0' }))
vi.mock('../socket/io', () => ({ io: null }))
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any) => { req.user = { userId: 'admin-uuid', username: 'admin' } }),
}))

import { redis } from '../config/database'
import adminRoutes from '../routes/admin'

// ── Tests ─────────────────────────────────────────────────────

describe('GET /api/v1/admin/update-check', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const realFetch = globalThis.fetch

  beforeEach(async () => {
    vi.mocked(redis.set).mockClear()
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      tag_name: 'v2.13.0', html_url: 'https://github.com/Pokled/nodyx/releases/tag/v2.13.0',
    }), { status: 200 })) as any
    app = await buildApp(a => a.register(adminRoutes, { prefix: '/api/v1/admin' }))
  })
  afterEach(() => { globalThis.fetch = realFetch })

  it('après une mise à jour, ne ressert pas la réponse mise en cache par l’ancienne version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/update-check', headers: { Authorization: 'Bearer x' } })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.current_version).toBe('2.13.0')
    expect(body.has_update).toBe(false)
  })

  it('met en cache sous une clé qui porte la version en cours', async () => {
    await app.inject({ method: 'GET', url: '/api/v1/admin/update-check', headers: { Authorization: 'Bearer x' } })
    expect(vi.mocked(redis.set).mock.calls[0]?.[0]).toBe('update_check:2.13.0')
  })
})
