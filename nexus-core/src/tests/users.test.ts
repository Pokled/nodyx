import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  },
  redis: {
    exists: vi.fn().mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1)),
    set:    vi.fn().mockResolvedValue('OK'),
    del:    vi.fn().mockResolvedValue(1),
    setex:  vi.fn().mockResolvedValue('OK'),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl:    vi.fn().mockResolvedValue(60),
  },
}))

vi.mock('../models/user', () => ({
  findById:    vi.fn(),
  findByEmail: vi.fn(),
}))

// ── Imports ───────────────────────────────────────────────────

import * as UserModel from '../models/user'
import { db, redis }  from '../config/database'
import userRoutes     from '../routes/users'

// ── Helpers ───────────────────────────────────────────────────

const USER_UUID      = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const COMMUNITY_UUID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

function makeToken(userId = USER_UUID, username = 'testuser') {
  return jwt.sign({ userId, username }, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

const FAKE_PROFILE = {
  user_id:      USER_UUID,
  display_name: 'Test User',
  bio:          null,
  status:       null,
  location:     null,
  avatar_url:   null,
  banner_url:   null,
  tags:         [],
  links:        [],
  metadata:     null,
  updated_at:   new Date(),
}

// ── Tests — PATCH /me/profile ─────────────────────────────────

describe('PATCH /api/v1/users/me/profile', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    vi.mocked(db.query).mockResolvedValue({ rows: [FAKE_PROFILE], rowCount: 1 } as any)
    app = await buildApp(a => a.register(userRoutes, { prefix: '/api/v1/users' }))
  })

  it('returns 401 without auth token', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url:    '/api/v1/users/me/profile',
      payload: { bio: 'hello' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('returns 400 when body is empty', async () => {
    const token = makeToken()
    const res = await app.inject({
      method:  'PATCH',
      url:     '/api/v1/users/me/profile',
      headers: { Authorization: `Bearer ${token}` },
      payload: {},
    })
    expect(res.statusCode).toBe(400)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('EMPTY_UPDATE')
  })

  it('returns 200 with updated profile on valid bio patch', async () => {
    const token = makeToken()
    const res = await app.inject({
      method:  'PATCH',
      url:     '/api/v1/users/me/profile',
      headers: { Authorization: `Bearer ${token}` },
      payload: { bio: 'My new bio' },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.profile).toBeDefined()
  })

  it('returns 200 and merges metadata theme', async () => {
    const token = makeToken()
    const theme = { bg: '#000000', cardBg: '#111111', cardBorder: '#222222', accent: '#7c3aed', text: '#ffffff', textMuted: '#9ca3af' }
    const res = await app.inject({
      method:  'PATCH',
      url:     '/api/v1/users/me/profile',
      headers: { Authorization: `Bearer ${token}` },
      payload: { metadata: { theme } },
    })
    expect(res.statusCode).toBe(200)
    // Verify db.query was called with metadata merge syntax
    const calls = vi.mocked(db.query).mock.calls
    const updateCall = calls.find(c => (c[0] as string).includes('metadata = metadata ||'))
    expect(updateCall).toBeDefined()
  })

  it('returns 400 on invalid name_color format', async () => {
    const token = makeToken()
    const res = await app.inject({
      method:  'PATCH',
      url:     '/api/v1/users/me/profile',
      headers: { Authorization: `Bearer ${token}` },
      payload: { name_color: 'not-a-color' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('synchronises users.avatar when avatar_url is updated', async () => {
    const token = makeToken()
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [FAKE_PROFILE], rowCount: 1 } as any) // UPDATE user_profiles
      .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any)              // UPDATE users SET avatar

    const res = await app.inject({
      method:  'PATCH',
      url:     '/api/v1/users/me/profile',
      headers: { Authorization: `Bearer ${token}` },
      payload: { avatar_url: '/uploads/test.jpg' },
    })
    expect(res.statusCode).toBe(200)
    const calls = vi.mocked(db.query).mock.calls
    const avatarSync = calls.find(c => (c[0] as string).includes('UPDATE users SET avatar'))
    expect(avatarSync).toBeDefined()
  })
})

// ── Tests — GET /:username/profile ────────────────────────────

describe('GET /api/v1/users/:username/profile', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(userRoutes, { prefix: '/api/v1/users' }))
  })

  it('returns 200 with profile data for existing user', async () => {
    const profileRow = {
      id:           USER_UUID,
      username:     'testuser',
      points:       42,
      created_at:   new Date(),
      display_name: 'Test User',
      avatar_url:   null,
      banner_url:   null,
      bio:          'Hello',
      tags:         [],
      links:        [],
      metadata:     { theme: { accent: '#7c3aed' } },
    }
    vi.mocked(db.query).mockResolvedValue({ rows: [profileRow], rowCount: 1 } as any)

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/users/testuser/profile',
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.username).toBe('testuser')
    expect(body.metadata).toEqual({ theme: { accent: '#7c3aed' } })
  })

  it('returns 404 for unknown username', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [], rowCount: 0 } as any)

    const res = await app.inject({
      method: 'GET',
      url:    '/api/v1/users/nobody/profile',
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('NOT_FOUND')
  })
})

// ── Tests — GET /me ───────────────────────────────────────────

describe('GET /api/v1/users/me', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    vi.mocked(redis.exists).mockImplementation((key: string) => Promise.resolve(key.startsWith('banned:') ? 0 : 1))
    app = await buildApp(a => a.register(userRoutes, { prefix: '/api/v1/users' }))
  })

  it('returns 401 without auth token', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/users/me' })
    expect(res.statusCode).toBe(401)
  })

  it('returns 404 when user not found in DB', async () => {
    vi.mocked(UserModel.findById).mockResolvedValue(null as any)
    const token = makeToken()
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/users/me',
      headers: { Authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(404)
  })

  it('returns 200 with user and role when found', async () => {
    const fakeUser = { id: USER_UUID, username: 'testuser', email: 'test@nexus.dev' }
    vi.mocked(UserModel.findById).mockResolvedValue(fakeUser as any)
    vi.mocked(db.query)
      .mockResolvedValueOnce({ rows: [{ id: COMMUNITY_UUID }], rowCount: 1 } as any) // community
      .mockResolvedValueOnce({ rows: [{ role: 'admin', grade_name: null, grade_color: null }], rowCount: 1 } as any) // role

    const token = makeToken()
    const res = await app.inject({
      method:  'GET',
      url:     '/api/v1/users/me',
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.user.id).toBe(USER_UUID)
    expect(body.user.role).toBe('admin')
  })
})
