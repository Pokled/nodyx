/**
 * Tests for /api/v1/wiki — full CRUD + role-based access
 * Routes: GET /, GET /:slug, POST /, PATCH /:slug, DELETE /:slug
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get:    vi.fn(),
    setex:  vi.fn().mockResolvedValue('OK'),
    exists: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('banned:') ? 0 : 1)
    ),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl:    vi.fn().mockResolvedValue(60),
    set:    vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    sadd:     vi.fn().mockResolvedValue(1),
    srem:     vi.fn().mockResolvedValue(1),
  },
}))

import { db, redis } from '../config/database'
import wikiRoutes from '../routes/wiki'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = process.env.JWT_SECRET!

function makeToken(userId: string, username: string) {
  return jwt.sign({ userId, username }, SECRET, { expiresIn: '1h' })
}

const MEMBER_TOKEN = makeToken('member-uuid', 'member')
const ADMIN_TOKEN  = makeToken('admin-uuid', 'adminuser')
const MOD_TOKEN    = makeToken('mod-uuid', 'moduser')
const OWNER_TOKEN  = makeToken('owner-uuid', 'owner')

const FAKE_PAGE = {
  id:               'page-uuid-1',
  slug:             'guide-demarrage-a1b2c3d4',
  title:            'Guide de démarrage',
  content:          '<h2>Introduction</h2><p>Bienvenue sur Nodyx.</p>',
  excerpt:          'Guide complet pour démarrer.',
  category:         'Documentation',
  is_public:        false,
  views:            42,
  created_at:       '2026-03-01T00:00:00Z',
  updated_at:       '2026-03-28T00:00:00Z',
  author_id:        'admin-uuid',
  author_username:  'adminuser',
  author_avatar:    null,
  editor_username:  null,
}

// Always make Redis module cache return enabled
function mockModuleEnabled() {
  vi.mocked(redis.get).mockResolvedValue('1')
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /
// ─────────────────────────────────────────────────────────────────────────────

function restoreRedis() {
  vi.mocked(redis.exists).mockImplementation((key: string) =>
    Promise.resolve(key.startsWith('banned:') ? 0 : 1)
  )
  vi.mocked(redis.setex).mockResolvedValue('OK')
}

describe('GET /api/v1/wiki', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    mockModuleEnabled()
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 503 when wiki module is disabled', async () => {
    vi.mocked(redis.get).mockResolvedValue('0')
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'module_disabled' })
  })

  it('returns page list and categories for authenticated member', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_PAGE], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ category: 'Documentation' }], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.pages).toBeInstanceOf(Array)
    expect(body.categories).toContain('Documentation')
  })

  it('filters by category query param', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/?category=Documentation',
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
    // Verify category filter was applied (SQL should include it)
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[0]).toMatch(/category/)
    expect(call[1]).toContain('Documentation')
  })

  it('filters by search query param', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_PAGE], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/?search=guide',
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
    const call = vi.mocked(db.query).mock.calls[0]
    expect(call[0]).toMatch(/ILIKE/)
    expect(call[1]).toContain('%guide%')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /:slug
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/wiki/:slug', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    mockModuleEnabled()
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/guide-demarrage-a1b2c3d4' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for unknown slug', async () => {
    mockModuleEnabled()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/page-inconnue-xxxxxxxx',
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toMatchObject({ error: 'Page introuvable.' })
  })

  it('returns full page content', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_PAGE], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // view counter (fire-and-forget)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'GET', url: `/${FAKE_PAGE.slug}`,
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.title).toBe('Guide de démarrage')
    expect(body.content).toContain('<h2>Introduction</h2>')
  })

  it('increments view counter asynchronously', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_PAGE], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any) // UPDATE views

    const app = await buildApp(app => wikiRoutes(app))
    await app.inject({
      method: 'GET', url: `/${FAKE_PAGE.slug}`,
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    // Give async view update time to fire
    await new Promise(r => setTimeout(r, 10))
    const calls = vi.mocked(db.query).mock.calls
    expect(calls.some(([sql]) => String(sql).includes('views = views + 1'))).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST / — create page
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/wiki', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  const VALID_BODY = {
    title:    'Architecture Nodyx',
    content:  '<p>Fastify + SvelteKit</p>',
    category: 'Technique',
    is_public: false,
  }

  it('requires authentication', async () => {
    mockModuleEnabled()
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: { 'content-type': 'application/json' },
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects member role with 403', async () => {
    mockModuleEnabled()
    // getUserRole returns 'member'
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${MEMBER_TOKEN}`,
      },
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(403)
  })

  it('allows admin to create a page', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }], rowCount: 1 } as any) // getUserRole
      .mockResolvedValueOnce({ rows: [{ id: 'new-page-uuid', slug: 'architecture-nodyx-ab12cd34' }], rowCount: 1 } as any) // INSERT

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().slug).toMatch(/architecture-nodyx-/)
  })

  it('allows moderator to create a page', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'moderator' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'new-page-uuid', slug: 'architecture-nodyx-cd56ef78' }], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${MOD_TOKEN}`,
      },
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(201)
  })

  it('allows owner to create a page', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'new-page-uuid', slug: 'architecture-nodyx-gh90ij01' }], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${OWNER_TOKEN}`,
      },
      payload: VALID_BODY,
    })
    expect(res.statusCode).toBe(201)
  })

  it('rejects empty title with 400', async () => {
    mockModuleEnabled()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'admin' }], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      payload: { ...VALID_BODY, title: '' },
    })
    expect(res.statusCode).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:slug — update page
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/wiki/:slug', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    mockModuleEnabled()
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: `/${FAKE_PAGE.slug}`,
      headers: { 'content-type': 'application/json' },
      payload: { title: 'Updated' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 for unknown slug', async () => {
    mockModuleEnabled()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/inexistant-slug-xxxxxxxx',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      payload: { title: 'Updated' },
    })
    expect(res.statusCode).toBe(404)
  })

  it('blocks member who is not the author', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'page-uuid-1', author_id: 'other-user-uuid' }], rowCount: 1 } as any) // SELECT existing
      .mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any) // getUserRole

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: `/${FAKE_PAGE.slug}`,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${MEMBER_TOKEN}`,
      },
      payload: { title: 'Try to edit' },
    })
    expect(res.statusCode).toBe(403)
  })

  it('allows author (member) to edit their own page', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'page-uuid-1', author_id: 'member-uuid' }], rowCount: 1 } as any) // SELECT existing (author = member)
      .mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any)   // getUserRole
      .mockResolvedValueOnce({ rows: [{ slug: FAKE_PAGE.slug }], rowCount: 1 } as any) // UPDATE

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: `/${FAKE_PAGE.slug}`,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${MEMBER_TOKEN}`,
      },
      payload: { title: 'My Updated Title' },
    })
    expect(res.statusCode).toBe(200)
  })

  it('allows admin to edit any page', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: 'page-uuid-1', author_id: 'other-uuid' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [{ slug: FAKE_PAGE.slug }], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: `/${FAKE_PAGE.slug}`,
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${ADMIN_TOKEN}`,
      },
      payload: { content: '<p>Updated content</p>' },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().slug).toBe(FAKE_PAGE.slug)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:slug
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/wiki/:slug', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    mockModuleEnabled()
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({ method: 'DELETE', url: `/${FAKE_PAGE.slug}` })
    expect(res.statusCode).toBe(401)
  })

  it('blocks member with 403', async () => {
    mockModuleEnabled()
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ role: 'member' }], rowCount: 1 } as any)
    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: `/${FAKE_PAGE.slug}`,
      headers: { Authorization: `Bearer ${MEMBER_TOKEN}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('blocks owner if role check fails (owner IS allowed)', async () => {
    // owner SHOULD be allowed — verify the fix works
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'owner' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any) // DELETE returns rowCount 1

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: `/${FAKE_PAGE.slug}`,
      headers: { Authorization: `Bearer ${OWNER_TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ success: true })
  })

  it('allows admin to delete', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: `/${FAKE_PAGE.slug}`,
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('allows moderator to delete', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'moderator' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: `/${FAKE_PAGE.slug}`,
      headers: { Authorization: `Bearer ${MOD_TOKEN}` },
    })
    expect(res.statusCode).toBe(200)
  })

  it('returns 404 when page does not exist', async () => {
    mockModuleEnabled()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin' }], rowCount: 1 } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any) // DELETE found nothing

    const app = await buildApp(app => wikiRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/inexistant-page-xxxxxxxx',
      headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
    })
    expect(res.statusCode).toBe(404)
  })
})
