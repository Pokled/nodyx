/**
 * Tests for /api/v1/notifications
 * Routes: GET /, GET /unread-count, GET /vapid-public-key,
 *         POST /subscribe, DELETE /subscribe,
 *         PATCH /:id/read, PATCH /read-all, DELETE /read
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    exists: vi.fn().mockImplementation((key: string) =>
      Promise.resolve(key.startsWith('banned:') ? 0 : 1)
    ),
    incr:     vi.fn().mockResolvedValue(1),
    expire:   vi.fn().mockResolvedValue(1),
    ttl:      vi.fn().mockResolvedValue(60),
    setex:    vi.fn().mockResolvedValue('OK'),
    set:      vi.fn().mockResolvedValue('OK'),
    del:      vi.fn().mockResolvedValue(1),
    sadd:     vi.fn().mockResolvedValue(1),
    srem:     vi.fn().mockResolvedValue(1),
    smembers: vi.fn().mockResolvedValue([]),
  },
}))

vi.mock('../models/notification', () => ({
  listForUser:    vi.fn(),
  getUnreadCount: vi.fn(),
  markAsRead:     vi.fn().mockResolvedValue(undefined),
  markAllAsRead:  vi.fn().mockResolvedValue(undefined),
  deleteAllRead:  vi.fn(),
}))

// web-push is not configured in test env
vi.mock('web-push', () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}))

import { db, redis }        from '../config/database'
import * as NotifModel      from '../models/notification'
import notificationRoutes   from '../routes/notifications'

// ── Helpers ───────────────────────────────────────────────────────────────────

function restoreRedis() {
  vi.mocked(redis.exists).mockImplementation((key: string) =>
    Promise.resolve(key.startsWith('banned:') ? 0 : 1)
  )
  vi.mocked(redis.setex).mockResolvedValue('OK')
}

const SECRET = process.env.JWT_SECRET!
const TOKEN  = jwt.sign({ userId: 'user-uuid-1', username: 'testuser' }, SECRET, { expiresIn: '1h' })
const AUTH   = `Bearer ${TOKEN}`

const FAKE_NOTIF = {
  id:           'notif-uuid-1',
  user_id:      'user-uuid-1',
  type:         'thread_reply',
  is_read:      false,
  created_at:   '2026-03-28T10:00:00Z',
  actor_username: 'otheruser',
  actor_avatar:   null,
  thread_title:   'Mon super thread',
  thread_id:      'thread-uuid-1',
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/notifications', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/' })
    expect(res.statusCode).toBe(401)
  })

  it('returns notification list', async () => {
    vi.mocked(NotifModel.listForUser).mockResolvedValueOnce([FAKE_NOTIF] as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { Authorization: AUTH },
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.notifications).toBeInstanceOf(Array)
    expect(body.notifications[0].type).toBe('thread_reply')
  })

  it('returns empty list when no notifications', async () => {
    vi.mocked(NotifModel.listForUser).mockResolvedValueOnce([] as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/',
      headers: { Authorization: AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().notifications).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /unread-count
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/notifications/unread-count', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/unread-count' })
    expect(res.statusCode).toBe(401)
  })

  it('returns correct count', async () => {
    vi.mocked(NotifModel.getUnreadCount).mockResolvedValueOnce(7 as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/unread-count',
      headers: { Authorization: AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().count).toBe(7)
  })

  it('returns 0 when all read', async () => {
    vi.mocked(NotifModel.getUnreadCount).mockResolvedValueOnce(0 as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'GET', url: '/unread-count',
      headers: { Authorization: AUTH },
    })
    expect(res.json().count).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// GET /vapid-public-key
// ─────────────────────────────────────────────────────────────────────────────

describe('GET /api/v1/notifications/vapid-public-key', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('returns 503 when VAPID not configured (test env has no VAPID keys)', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({ method: 'GET', url: '/vapid-public-key' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'Push notifications not configured' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// POST /subscribe
// ─────────────────────────────────────────────────────────────────────────────

describe('POST /api/v1/notifications/subscribe', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('returns 503 when VAPID not configured', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/subscribe',
      headers: { 'content-type': 'application/json', Authorization: AUTH },
      payload: { endpoint: 'https://push.example.com/sub1', keys: { p256dh: 'key', auth: 'authkey' } },
    })
    expect(res.statusCode).toBe(503)
  })

  it('requires authentication', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'POST', url: '/subscribe',
      headers: { 'content-type': 'application/json' },
      payload: { endpoint: 'https://push.example.com/sub1', keys: { p256dh: 'k', auth: 'a' } },
    })
    expect(res.statusCode).toBe(401)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /subscribe
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/notifications/subscribe', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/subscribe',
      headers: { 'content-type': 'application/json' },
      payload: { endpoint: 'https://push.example.com/sub1' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when endpoint missing', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/subscribe',
      headers: { 'content-type': 'application/json', Authorization: AUTH },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'Missing endpoint' })
  })

  it('deletes subscription and returns 204', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/subscribe',
      headers: { 'content-type': 'application/json', Authorization: AUTH },
      payload: { endpoint: 'https://push.example.com/sub1' },
    })
    expect(res.statusCode).toBe(204)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id/read
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/notifications/:id/read', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({ method: 'PATCH', url: '/notif-uuid-1/read' })
    expect(res.statusCode).toBe(401)
  })

  it('marks notification as read and returns 204', async () => {
    vi.mocked(NotifModel.markAsRead).mockResolvedValueOnce(undefined as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/notif-uuid-1/read',
      headers: { Authorization: AUTH },
    })
    expect(res.statusCode).toBe(204)
    expect(NotifModel.markAsRead).toHaveBeenCalledWith('notif-uuid-1', 'user-uuid-1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /read-all
// ─────────────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/notifications/read-all', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({ method: 'PATCH', url: '/read-all' })
    expect(res.statusCode).toBe(401)
  })

  it('marks all as read and returns 204', async () => {
    vi.mocked(NotifModel.markAllAsRead).mockResolvedValueOnce(undefined as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'PATCH', url: '/read-all',
      headers: { Authorization: AUTH },
    })
    expect(res.statusCode).toBe(204)
    expect(NotifModel.markAllAsRead).toHaveBeenCalledWith('user-uuid-1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /read
// ─────────────────────────────────────────────────────────────────────────────

describe('DELETE /api/v1/notifications/read', () => {
  beforeEach(() => { vi.resetAllMocks(); restoreRedis() })

  it('requires authentication', async () => {
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({ method: 'DELETE', url: '/read' })
    expect(res.statusCode).toBe(401)
  })

  it('deletes read notifications and returns count', async () => {
    vi.mocked(NotifModel.deleteAllRead).mockResolvedValueOnce(12 as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/read',
      headers: { Authorization: AUTH },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().deleted).toBe(12)
  })

  it('returns 0 when nothing to delete', async () => {
    vi.mocked(NotifModel.deleteAllRead).mockResolvedValueOnce(0 as any)
    const app = await buildApp(app => notificationRoutes(app))
    const res = await app.inject({
      method: 'DELETE', url: '/read',
      headers: { Authorization: AUTH },
    })
    expect(res.json().deleted).toBe(0)
  })
})
