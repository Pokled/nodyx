import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

// ── Mocks (hoisted before imports) ───────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn().mockResolvedValue({ rows: [{ id: 'community-uuid' }], rowCount: 1 }),
  },
  redis: {
    set:   vi.fn().mockResolvedValue('OK'),
    del:   vi.fn().mockResolvedValue(1),
    get:   vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockResolvedValue(1),
    incr:  vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    setex: vi.fn().mockResolvedValue('OK'),
    ttl:   vi.fn().mockResolvedValue(60),
  },
}))

vi.mock('../models/user', () => ({
  findByEmail:     vi.fn(),
  findByUsername:  vi.fn(),
  create:          vi.fn(),
  verifyPassword:  vi.fn(),
}))

// ── Imports (after mocks) ─────────────────────────────────────

import * as UserModel from '../models/user'
import authRoutes from '../routes/auth'

// ── Helpers ───────────────────────────────────────────────────

// With password — for findByEmail (login flow needs it)
const FAKE_USER = {
  id:         'user-uuid-1',
  username:   'testuser',
  email:      'test@nexus.dev',
  password:   '$2b$12$hashedpassword',
  avatar:     null,
  bio:        null,
  points:     0,
  created_at: new Date(),
  updated_at: new Date(),
}

// Without password — for create (PublicUser return type)
const FAKE_PUBLIC_USER = {
  id:         'user-uuid-1',
  username:   'testuser',
  email:      'test@nexus.dev',
  avatar:     null,
  bio:        null,
  points:     0,
  created_at: new Date(),
  updated_at: new Date(),
}

// ── Tests ─────────────────────────────────────────────────────

describe('POST /api/v1/auth/register', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(authRoutes, { prefix: '/api/v1/auth' }))
  })

  it('returns 201 with token when valid data', async () => {
    vi.mocked(UserModel.findByEmail).mockResolvedValueOnce(null)
    vi.mocked(UserModel.findByUsername).mockResolvedValueOnce(null)
    vi.mocked(UserModel.create).mockResolvedValueOnce(FAKE_PUBLIC_USER)

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/register',
      payload: { username: 'testuser', email: 'test@nexus.dev', password: 'password123' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('token')
    expect(body.user.username).toBe('testuser')
    expect(body.user).not.toHaveProperty('password')
  })

  it('returns 409 when email is already taken', async () => {
    vi.mocked(UserModel.findByEmail).mockResolvedValueOnce(FAKE_USER)
    vi.mocked(UserModel.findByUsername).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/register',
      payload: { username: 'newuser', email: 'test@nexus.dev', password: 'password123' },
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('EMAIL_TAKEN')
  })

  it('returns 409 when username is already taken', async () => {
    vi.mocked(UserModel.findByEmail).mockResolvedValueOnce(null)
    vi.mocked(UserModel.findByUsername).mockResolvedValueOnce(FAKE_USER)

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/register',
      payload: { username: 'testuser', email: 'other@nexus.dev', password: 'password123' },
    })

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body).code).toBe('USERNAME_TAKEN')
  })

  it('returns 400 when username is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/register',
      payload: { username: 'ab', email: 'test@nexus.dev', password: 'password123' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when email is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/register',
      payload: { username: 'testuser', email: 'not-an-email', password: 'password123' },
    })

    expect(res.statusCode).toBe(400)
  })

  it('returns 400 when password is too short', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/register',
      payload: { username: 'testuser', email: 'test@nexus.dev', password: 'short' },
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/auth/login', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(authRoutes, { prefix: '/api/v1/auth' }))
  })

  it('returns 200 with token on valid credentials', async () => {
    vi.mocked(UserModel.findByEmail).mockResolvedValueOnce(FAKE_USER)
    vi.mocked(UserModel.verifyPassword).mockResolvedValueOnce(true)

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/login',
      payload: { email: 'test@nexus.dev', password: 'password123' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body).toHaveProperty('token')
    expect(body.user).not.toHaveProperty('password')
  })

  it('returns 401 when user does not exist', async () => {
    vi.mocked(UserModel.findByEmail).mockResolvedValueOnce(null)

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/login',
      payload: { email: 'unknown@nexus.dev', password: 'password123' },
    })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).code).toBe('INVALID_CREDENTIALS')
  })

  it('returns 401 when password is wrong', async () => {
    vi.mocked(UserModel.findByEmail).mockResolvedValueOnce(FAKE_USER)
    vi.mocked(UserModel.verifyPassword).mockResolvedValueOnce(false)

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/login',
      payload: { email: 'test@nexus.dev', password: 'wrongpassword' },
    })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).code).toBe('INVALID_CREDENTIALS')
  })

  it('returns 400 when body is missing fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/login',
      payload: { email: 'test@nexus.dev' }, // missing password
    })

    expect(res.statusCode).toBe(400)
  })
})

describe('POST /api/v1/auth/logout', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildApp(a => a.register(authRoutes, { prefix: '/api/v1/auth' }))
  })

  it('returns 401 when no token is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/logout',
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 401 when token is invalid', async () => {
    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/logout',
      headers: { authorization: 'Bearer invalid.jwt.token' },
    })

    expect(res.statusCode).toBe(401)
  })

  it('returns 200 on valid session logout', async () => {
    // Build a real token signed with the test secret
    const jwt = await import('jsonwebtoken')
    const token = jwt.default.sign(
      { userId: FAKE_USER.id, username: FAKE_USER.username },
      process.env.JWT_SECRET!,
      { expiresIn: '7d' }
    )

    // Redis reports the session as alive
    const { redis } = await import('../config/database')
    vi.mocked(redis.exists).mockResolvedValueOnce(1 as any)

    const res = await app.inject({
      method: 'POST',
      url:    '/api/v1/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).message).toBe('Logged out')
  })
})
