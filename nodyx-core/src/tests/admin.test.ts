import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  redis: {
    exists:   vi.fn().mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1)),
    setex:    vi.fn().mockResolvedValue('OK'),
    set:      vi.fn().mockResolvedValue('OK'),
    del:      vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
    incr:     vi.fn().mockResolvedValue(1),
    expire:   vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../models/channel', () => ({
  list:   vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  remove: vi.fn(),
  reorder: vi.fn(),
}))

vi.mock('../socket/io', () => ({ io: null }))

// Mock adminOnly: passes with auth header, rejects without
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    const header = req.headers.authorization
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    // Check for a "non-admin" marker in tests
    if (header.includes('notadmin')) {
      return reply.code(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
    }
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

// ── Imports ───────────────────────────────────────────────────

import { db, redis } from '../config/database'
import adminRoutes from '../routes/admin'

// ── Helpers ───────────────────────────────────────────────────

const COMMUNITY_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const USER_UUID      = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function makeAdminToken() {
  return jwt.sign({ userId: USER_UUID, username: 'admin' }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

const STATS_ROW = { total: 10, new_this_week: 2 }

// ── Tests — GET /admin/stats ──────────────────────────────────

describe('GET /api/v1/admin/stats', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.resetAllMocks()
    // Stats endpoint makes 13 db.query calls total:
    // 1 getCommunityId + 8 Promise.all (users/threads/posts/categories/events/polls/assets/chat/dm)
    // + 2 activity Promise.all + 1 topContrib + 1 recentMembers
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: COMMUNITY_UUID }], rowCount: 1 } as any) // getCommunityId
      .mockResolvedValueOnce({ rows: [STATS_ROW], rowCount: 1 } as any)              // users count
      .mockResolvedValueOnce({ rows: [{ total: 5, new_this_week: 1, locked: 0, pinned: 0 }], rowCount: 1 } as any) // threads
      .mockResolvedValueOnce({ rows: [{ total: 20, new_this_week: 3 }], rowCount: 1 } as any) // posts
      .mockResolvedValueOnce({ rows: [{ total: 4 }], rowCount: 1 } as any)            // categories
      .mockResolvedValue({ rows: [], rowCount: 0 } as any)                            // all remaining queries (events/polls/assets/chat/dm/activity/topContrib/recentMembers)

    app = await buildApp(a => a.register(adminRoutes, { prefix: '/api/v1/admin' }))
  })

  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/stats' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 403 for non-admin user', async () => {
    const token = jwt.sign({ userId: USER_UUID, username: 'notadmin' }, process.env.JWT_SECRET!, { expiresIn: '7d' })
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/admin/stats',
      headers: { Authorization: `Bearer ${token}notadmin` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('returns 200 with stats for admin user', async () => {
    const token = makeAdminToken()
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/admin/stats',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.users).toBeDefined()
    expect(body.threads).toBeDefined()
    expect(body.posts).toBeDefined()
    expect(typeof body.online).toBe('number')
  })

  it('includes activity_last_7_days array in stats response', async () => {
    const token = makeAdminToken()
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/admin/stats',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.activity_last_7_days)).toBe(true)
    expect(Array.isArray(body.top_contributors)).toBe(true)
  })
})

// ── Tests — GET /admin/members ────────────────────────────────

describe('GET /api/v1/admin/members', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.resetAllMocks()
    app = await buildApp(a => a.register(adminRoutes, { prefix: '/api/v1/admin' }))
  })

  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/members' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 200 with member list for admin', async () => {
    const fakeMember = {
      user_id:      USER_UUID,
      username:     'testuser',
      role:         'member',
      joined_at:    new Date(),
      email:        'test@nodyx.dev',
      avatar:       null,
      registered_at: new Date(),
      grade_id:     null,
      grade_name:   null,
      grade_color:  null,
      thread_count: 2,
      post_count:   5,
    }
    // getCommunityId may be cached from stats tests; use mockImplementation to route by SQL
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM communities')) {
        return { rows: [{ id: COMMUNITY_UUID }], rowCount: 1 } as any
      }
      return { rows: [fakeMember], rowCount: 1 } as any
    })

    const token = makeAdminToken()
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/admin/members',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.members)).toBe(true)
    expect(body.members[0].username).toBe('testuser')
  })
})

// ── Tests — PATCH /admin/members/:userId ─────────────────────

describe('PATCH /api/v1/admin/members/:userId', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.resetAllMocks()
    app = await buildApp(a => a.register(adminRoutes, { prefix: '/api/v1/admin' }))
  })

  it('returns 400 for invalid role value', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [{ id: COMMUNITY_UUID }], rowCount: 1 } as any)

    const token = makeAdminToken()
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/admin/members/${USER_UUID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { role: 'superadmin' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('returns 200 when role is updated to admin', async () => {
    // getCommunityId may be cached; route by SQL content
    vi.mocked(db.query).mockImplementation(async (sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM communities')) {
        return { rows: [{ id: COMMUNITY_UUID }], rowCount: 1 } as any
      }
      if (typeof sql === 'string' && sql.includes('community_members') && !sql.includes('SELECT id FROM communities')) {
        return { rows: [{ role: 'member', username: 'testuser' }], rowCount: 1 } as any
      }
      // UPDATE community_members
      return { rows: [], rowCount: 1 } as any
    })

    const token = makeAdminToken()
    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/admin/members/${USER_UUID}`,
      headers: { Authorization: `Bearer ${token}` },
      payload: { role: 'admin' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
  })
})

// ── Tests — POST /admin/members/:userId/ban (honnêteté du ban IP) ─────────────
//
// L'UI affichait « IP bannie » même quand aucune IP publique n'était connue
// (registration_ip = 127.0.0.1 pour tous depuis la bascule tunnel). La réponse
// porte désormais ip_ban_applied : null quand rien n'a pu être banni.

describe('POST /api/v1/admin/members/:userId/ban', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.resetAllMocks()
    vi.mocked(redis.set).mockResolvedValue('OK' as any)
    vi.mocked(redis.del).mockResolvedValue(1 as any)
    vi.mocked(redis.smembers).mockResolvedValue([] as any)
    app = await buildApp(a => a.register(adminRoutes, { prefix: '/api/v1/admin' }))
  })

  function router(userRow: Record<string, unknown>) {
    vi.mocked(db.query).mockImplementation(async (sql: any) => {
      const q = String(sql)
      if (q.includes('FROM communities')) return { rows: [{ id: COMMUNITY_UUID }], rowCount: 1 } as any
      if (q.includes('FROM users u')) return { rows: [userRow], rowCount: 1 } as any
      return { rows: [], rowCount: 1 } as any
    })
  }

  it('ip_ban_applied = null quand aucune IP publique connue (registration_ip loopback)', async () => {
    router({ username: 'nerti', email: 'x@example.com', registration_ip: '127.0.0.1', last_seen_ip: null, role: 'member' })

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/admin/members/${USER_UUID}/ban`,
      headers: { Authorization: `Bearer ${makeAdminToken()}` },
      payload: { reason: 'spam', ban_ip: true, ban_email: true },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ip_ban_requested).toBe(true)
    expect(body.ip_ban_applied).toBeNull()
    // aucune écriture ip_bans
    const ipBanInsert = vi.mocked(db.query).mock.calls.find(c => String(c[0]).includes('INTO ip_bans'))
    expect(ipBanInsert).toBeUndefined()
  })

  it('ip_ban_applied = last_seen_ip quand une IP publique est connue', async () => {
    router({ username: 'nerti', email: 'x@example.com', registration_ip: '127.0.0.1', last_seen_ip: '31.215.70.26', role: 'member' })

    const res = await app.inject({
      method:  'POST',
      url:     `/api/v1/admin/members/${USER_UUID}/ban`,
      headers: { Authorization: `Bearer ${makeAdminToken()}` },
      payload: { reason: 'spam', ban_ip: true },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ip_ban_applied).toBe('31.215.70.26')
    const ipBanInsert = vi.mocked(db.query).mock.calls.find(c => String(c[0]).includes('INTO ip_bans'))
    expect(ipBanInsert?.[1]).toEqual(expect.arrayContaining(['31.215.70.26']))
  })
})
