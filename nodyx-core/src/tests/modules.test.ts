/**
 * Tests for the module system — admin.ts module routes
 * GET  /api/v1/admin/modules/public  (no auth)
 * GET  /api/v1/admin/modules         (adminOnly)
 * PATCH /api/v1/admin/modules/:id    (adminOnly, blocks core, invalidates Redis)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    del:    vi.fn().mockResolvedValue(1),
    set:    vi.fn().mockResolvedValue('OK'),
    get:    vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('banned:') ? 0 : 1)
    ),
    incr:     vi.fn().mockResolvedValue(1),
    expire:   vi.fn().mockResolvedValue(1),
    ttl:      vi.fn().mockResolvedValue(60),
    setex:    vi.fn().mockResolvedValue('OK'),
    sadd:     vi.fn().mockResolvedValue(1),
    srem:     vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../socket/io', () => ({
  io: { to: vi.fn().mockReturnValue({ emit: vi.fn() }) },
}))

import { db, redis } from '../config/database'
import adminRoutes   from '../routes/admin'

// ── Helpers ───────────────────────────────────────────────────────────────────

function restoreRedis() {
  vi.mocked(redis.exists).mockImplementation((key: string) =>
    Promise.resolve(key.startsWith('banned:') ? 0 : 1)
  )
  vi.mocked(redis.setex).mockResolvedValue('OK')
}

const SECRET = process.env.JWT_SECRET!

function makeToken(userId: string, username: string) {
  return jwt.sign({ userId, username }, SECRET, { expiresIn: '1h' })
}

const ADMIN_TOKEN  = makeToken('admin-uuid', 'adminuser')
const MEMBER_TOKEN = makeToken('member-uuid', 'member')
const AUTH_ADMIN   = `Bearer ${ADMIN_TOKEN}`
const AUTH_MEMBER  = `Bearer ${MEMBER_TOKEN}`

const FAKE_MODULES = [
  { id: 'auth',     family: 'core',      enabled: true },
  { id: 'forum',    family: 'core',      enabled: true },
  { id: 'chat',     family: 'community', enabled: true },
  { id: 'wiki',     family: 'community', enabled: false },
  { id: 'calendar', family: 'community', enabled: true },
  { id: 'polls',    family: 'community', enabled: true },
]

// adminOnly middleware: first resolves communityId via getInstanceCommunityId (needs {id}),
// then queries community_members for role.  Route by SQL content to handle both.
function mockAdminAuth() {
  vi.mocked(db.query).mockImplementation(async (sql: string) => {
    const s = String(sql)
    if (s.includes('FROM communities')) {
      return { rows: [{ id: 'comm-uuid' }], rowCount: 1 } as any
    }
    if (s.includes('community_members')) {
      return { rows: [{ role: 'admin', community_id: 'comm-uuid', community_name: 'Test' }], rowCount: 1 } as any
    }
    return { rows: [], rowCount: 0 } as any
  })
}

function mockMemberAuth() {
  vi.mocked(db.query).mockImplementation(async (sql: string) => {
    const s = String(sql)
    if (s.includes('FROM communities')) {
      return { rows: [{ id: 'comm-uuid' }], rowCount: 1 } as any
    }
    if (s.includes('community_members')) {
      return { rows: [{ role: 'member', community_id: 'comm-uuid' }], rowCount: 1 } as any
    }
    return { rows: [], rowCount: 0 } as any
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /modules/public
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/modules/public', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('returns module list without authentication', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: FAKE_MODULES } as any)
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/modules/public' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.modules).toBeInstanceOf(Array)
    expect(body.modules.length).toBe(FAKE_MODULES.length)
  })

  it('returns only id, family, enabled fields', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: FAKE_MODULES } as any)
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/modules/public' })
    const mod = res.json().modules[0]
    expect(mod).toHaveProperty('id')
    expect(mod).toHaveProperty('family')
    expect(mod).toHaveProperty('enabled')
  })

  it('correctly reflects disabled module state', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: FAKE_MODULES } as any)
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/modules/public' })
    const wikiMod = res.json().modules.find((m: any) => m.id === 'wiki')
    expect(wikiMod.enabled).toBe(false)
  })

  it('returns empty array when no modules configured', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as any)
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/modules/public' })
    expect(res.statusCode).toBe(200)
    expect(res.json().modules).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /modules
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/modules', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/modules' })
    expect(res.statusCode).toBe(401)
  })

  it('requires admin role — member gets 403', async () => {
    mockMemberAuth()
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/modules',
      headers: { Authorization: AUTH_MEMBER },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns full module list for admin', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin', community_id: 'c1', community_name: 'Nodyx' }] } as any) // adminOnly
      .mockResolvedValueOnce({ rows: FAKE_MODULES } as any) // SELECT modules

    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/modules',
      headers: { Authorization: AUTH_ADMIN },
    })
    expect(res.statusCode).toBe(200)
    // GET /modules returns rows array directly (no wrapper object)
    expect(res.json()).toHaveLength(FAKE_MODULES.length)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /modules/:id
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/modules/:id', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/modules/wiki',
      headers: { 'content-type': 'application/json' },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(401)
  })

  it('requires admin role', async () => {
    mockMemberAuth()
    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/modules/wiki',
      headers: { 'content-type': 'application/json', Authorization: AUTH_MEMBER },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 404 when module does not exist', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin', community_id: 'c1', community_name: 'N' }] } as any)
      .mockResolvedValueOnce({ rows: [] } as any) // module not found

    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/modules/nonexistent',
      headers: { 'content-type': 'application/json', Authorization: AUTH_ADMIN },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(404)
  })

  it('blocks toggling core modules with 403', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin', community_id: 'c1', community_name: 'N' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'auth', family: 'core', enabled: true }] } as any)

    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/modules/auth',
      headers: { 'content-type': 'application/json', Authorization: AUTH_ADMIN },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toMatch(/core/)
  })

  it('enables a disabled module and invalidates Redis cache', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin', community_id: 'c1', community_name: 'N' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'wiki', family: 'community', enabled: false }] } as any) // SELECT
      .mockResolvedValueOnce({ rows: [{ id: 'wiki', family: 'community', enabled: true }] } as any)  // UPDATE
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)  // logAction

    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/modules/wiki',
      headers: { 'content-type': 'application/json', Authorization: AUTH_ADMIN },
      payload: { enabled: true },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    // Redis cache must be invalidated
    expect(redis.del).toHaveBeenCalledWith('module:wiki:enabled')
  })

  it('disables an enabled module and invalidates Redis cache', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin', community_id: 'c1', community_name: 'N' }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'chat', family: 'community', enabled: true }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 'chat', family: 'community', enabled: false }] } as any)
      .mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)

    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/modules/chat',
      headers: { 'content-type': 'application/json', Authorization: AUTH_ADMIN },
      payload: { enabled: false },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().success).toBe(true)
    expect(redis.del).toHaveBeenCalledWith('module:chat:enabled')
  })

  it('rejects invalid body (enabled must be boolean)', async () => {
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ role: 'admin', community_id: 'c1', community_name: 'N' }] } as any)

    const app = await buildApp(app => adminRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/modules/wiki',
      headers: { 'content-type': 'application/json', Authorization: AUTH_ADMIN },
      payload: { enabled: 'yes' }, // string instead of boolean
    })
    expect(res.statusCode).toBe(400)
  })
})
