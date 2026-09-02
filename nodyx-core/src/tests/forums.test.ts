import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) },
  redis: {
    exists: vi.fn().mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1)),
    setex:  vi.fn().mockResolvedValue('OK'),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../models/thread', () => ({
  list:            vi.fn(),
  findById:        vi.fn(),
  create:          vi.fn(),
  update:          vi.fn(),
  remove:          vi.fn(),
  incrementViews:  vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../models/post', () => ({
  list:              vi.fn(),
  listByThread:      vi.fn().mockResolvedValue([]),
  create:            vi.fn(),
  update:            vi.fn(),
  remove:            vi.fn(),
  getAuthorAndThread: vi.fn(),
}))

vi.mock('../models/community', () => ({
  findBySlug:    vi.fn(),
  findById:      vi.fn(),
  getCategories: vi.fn().mockResolvedValue([]),
  getMember:     vi.fn(),
  createCategory: vi.fn(),
}))

vi.mock('../models/reaction',     () => ({ list: vi.fn(), toggle: vi.fn() }))
vi.mock('../models/thanks',       () => ({ hasGiven: vi.fn(), give: vi.fn() }))
vi.mock('../models/notification', () => ({
  create:         vi.fn(),
  getUnreadCount: vi.fn().mockResolvedValue(0),
}))
vi.mock('../utils/mentions',      () => ({ resolveMentions: vi.fn().mockResolvedValue([]) }))
vi.mock('../socket/io',           () => ({ io: null }))

vi.mock('../models/tag', () => ({
  listByCommunity:    vi.fn().mockResolvedValue([]),
  attach:             vi.fn(),
  detach:             vi.fn(),
  getTagsForThread:   vi.fn().mockResolvedValue([]),
  getTagsForThreads:  vi.fn().mockResolvedValue(new Map()),
  setThreadTags:      vi.fn().mockResolvedValue(undefined),
}))

// ── Imports ───────────────────────────────────────────────────

import * as ThreadModel from '../models/thread'
import * as PostModel   from '../models/post'
import { redis, db }    from '../config/database'
import forumRoutes      from '../routes/forums'

// ── Helpers ───────────────────────────────────────────────────

// Valid RFC 4122 UUIDs (Zod v4 requires proper version nibble)
const CATEGORY_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
const THREAD_UUID   = '550e8400-e29b-41d4-a716-446655440000'
const USER_UUID     = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'

function makeToken(userId = USER_UUID, username = 'testuser') {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

const FAKE_THREAD = {
  id:          THREAD_UUID,
  category_id: CATEGORY_UUID,
  author_id:   USER_UUID,
  title:       'Test thread',
  is_pinned:   false,
  is_locked:   false,
  views:       0,
  created_at:  new Date(),
  updated_at:  new Date(),
}

const FAKE_POST = {
  id:         '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  thread_id:  THREAD_UUID,
  author_id:  USER_UUID,
  content:    '<p>Reply</p>',
  created_at: new Date(),
  updated_at: new Date(),
}

// ── Tests ─────────────────────────────────────────────────────

describe('GET /api/v1/forums/threads', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('returns 200 with empty thread list for a valid category_id', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    `/api/v1/forums/threads?category_id=${CATEGORY_UUID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(Array.isArray(body.threads)).toBe(true)
  })

  it('returns 400 when category_id is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/forums/threads',
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 404 when category_id is an unknown slug', async () => {
    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/forums/threads?category_id=not-a-known-slug',
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('POST /api/v1/forums/threads', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      payload: { category_id: CATEGORY_UUID, title: 'Hello world', content: '<p>Test</p>' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when token is invalid', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: 'Bearer bad.token' },
      payload: { category_id: CATEGORY_UUID, title: 'Hello world', content: '<p>Test</p>' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('creates a thread when authenticated with valid body', async () => {
    vi.mocked(ThreadModel.create).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Hello world', content: '<p>Test content</p>' },
    })

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toHaveProperty('thread')
  })

  it('returns 400 when title is missing', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, content: '<p>Test</p>' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/forums/posts', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('returns 401 when not authenticated', async () => {
    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when thread does not exist', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(null as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('returns 403 when thread is locked', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, is_locked: true } as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('THREAD_LOCKED')
  })

  it('creates a post in an open thread', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/posts',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { thread_id: THREAD_UUID, content: '<p>Reply</p>' },
    })

    expect(res.statusCode).toBe(201)
  })
})

// ── Durcissement vitrine (incident nerti 2026-09-01) ──────────
//
// 1. POST /threads : une catégorie post_min_role != 'member' refuse un membre.
// 2. PATCH /threads/:id : is_featured est réservé aux admins/owners.

describe('POST /api/v1/forums/threads — catégorie restreinte', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const COMMUNITY_UUID = '7ba7b810-9dad-11d1-80b4-00c04fd430c8'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  function routeQueries(opts: { postMinRole: string; memberRole: string | null }) {
    vi.mocked(db.query).mockImplementation((sql: any) => {
      const q = String(sql)
      if (q.includes('post_min_role FROM categories')) {
        return Promise.resolve({ rows: [{ community_id: COMMUNITY_UUID, post_min_role: opts.postMinRole }], rowCount: 1 } as any)
      }
      if (q.includes('FROM community_bans')) {
        return Promise.resolve({ rows: [], rowCount: 0 } as any)
      }
      if (q.includes('role FROM community_members')) {
        return Promise.resolve({ rows: opts.memberRole ? [{ role: opts.memberRole }] : [], rowCount: opts.memberRole ? 1 : 0 } as any)
      }
      return Promise.resolve({ rows: [], rowCount: 0 } as any)
    })
  }

  it('renvoie 403 CATEGORY_RESTRICTED pour un membre dans une catégorie admin-only', async () => {
    routeQueries({ postMinRole: 'admin', memberRole: 'member' })

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Alsouq Alshabi', content: '<p>spam</p>' },
    })

    expect(res.statusCode).toBe(403)
    expect(JSON.parse(res.body).code).toBe('CATEGORY_RESTRICTED')
    expect(ThreadModel.create).not.toHaveBeenCalled()
  })

  it('laisse un admin poster dans la même catégorie', async () => {
    routeQueries({ postMinRole: 'admin', memberRole: 'admin' })
    vi.mocked(ThreadModel.create).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Release v3', content: '<p>notes</p>' },
    })

    expect(res.statusCode).toBe(201)
  })

  it('non-régression : catégorie ouverte (member) accepte un membre', async () => {
    routeQueries({ postMinRole: 'member', memberRole: 'member' })
    vi.mocked(ThreadModel.create).mockResolvedValueOnce(FAKE_THREAD as any)
    vi.mocked(PostModel.create).mockResolvedValueOnce(FAKE_POST as any)

    const res = await app.inject({
      method:  'POST',
      url:     '/api/v1/forums/threads',
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { category_id: CATEGORY_UUID, title: 'Coucou', content: '<p>hello</p>' },
    })

    expect(res.statusCode).toBe(201)
  })
})

describe('PATCH /api/v1/forums/threads/:id — is_featured réservé aux admins', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  const OTHER_AUTHOR = '8ba7b810-9dad-11d1-80b4-00c04fd430c8'

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(redis.incr).mockResolvedValue(1 as any)
    vi.mocked(redis.expire).mockResolvedValue(1 as any)
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/api/v1/forums' }))
  })

  it('renvoie 403 pour un modérateur (pas admin)', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: OTHER_AUTHOR } as any)
    // isMod -> moderator (true) ; isAdmin -> moderator (false)
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'moderator' }], rowCount: 1 } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { is_featured: true },
    })

    expect(res.statusCode).toBe(403)
    expect(ThreadModel.update).not.toHaveBeenCalled()
  })

  it('laisse un admin mettre en avant', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValueOnce({ ...FAKE_THREAD, author_id: OTHER_AUTHOR } as any)
    vi.mocked(db.query).mockResolvedValue({ rows: [{ role: 'admin' }], rowCount: 1 } as any)
    vi.mocked(ThreadModel.update).mockResolvedValueOnce({ ...FAKE_THREAD, is_featured: true } as any)

    const res = await app.inject({
      method:  'PATCH',
      url:     `/api/v1/forums/threads/${THREAD_UUID}`,
      headers: { authorization: `Bearer ${makeToken()}` },
      payload: { is_featured: true },
    })

    expect(res.statusCode).toBe(200)
    expect(ThreadModel.update).toHaveBeenCalledWith(THREAD_UUID, expect.objectContaining({ is_featured: true }))
  })
})
