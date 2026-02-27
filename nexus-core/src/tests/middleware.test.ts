import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'

// ── Mocks ─────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn(),
  },
  redis: {
    exists: vi.fn(),
    setex:  vi.fn().mockResolvedValue('OK'),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl:    vi.fn().mockResolvedValue(60),
  },
}))

// ── Imports ───────────────────────────────────────────────────

import { redis, db } from '../config/database'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { rateLimit } from '../middleware/rateLimit'

// ── Helpers ───────────────────────────────────────────────────

function makeToken(payload = { userId: 'user-uuid', username: 'testuser' }) {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '7d' })
}

async function buildProtectedApp() {
  const app = Fastify({ logger: false })

  // A route that requires authentication
  app.get('/protected', { preHandler: [requireAuth] }, async (req) => {
    return { userId: req.user!.userId }
  })

  // A route with optional auth
  app.get('/optional', { preHandler: [optionalAuth] }, async (req) => {
    return { authenticated: !!req.user }
  })

  await app.ready()
  return app
}

// ── requireAuth tests ─────────────────────────────────────────

describe('requireAuth middleware', () => {
  let app: Awaited<ReturnType<typeof buildProtectedApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildProtectedApp()
  })

  it('returns 401 when no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/protected' })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when token is malformed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer not.a.valid.jwt' },
    })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when JWT is valid but session not in Redis', async () => {
    vi.mocked(redis.exists).mockResolvedValueOnce(0 as any)

    const token = makeToken()
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).code).toBe('SESSION_EXPIRED')
  })

  it('passes and attaches user when token + session are valid', async () => {
    vi.mocked(redis.exists).mockResolvedValueOnce(1 as any)

    const token = makeToken()
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).userId).toBe('user-uuid')
  })

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Token somethingelse' },
    })

    expect(res.statusCode).toBe(401)
  })
})

// ── optionalAuth tests ────────────────────────────────────────

describe('optionalAuth middleware', () => {
  let app: Awaited<ReturnType<typeof buildProtectedApp>>

  beforeEach(async () => {
    vi.clearAllMocks()
    app = await buildProtectedApp()
  })

  it('passes without error when no token is provided', async () => {
    const res = await app.inject({ method: 'GET', url: '/optional' })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).authenticated).toBe(false)
  })

  it('attaches user when valid token is provided', async () => {
    vi.mocked(redis.exists).mockResolvedValueOnce(1 as any)

    const token = makeToken()
    const res = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { authorization: `Bearer ${token}` },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).authenticated).toBe(true)
  })

  it('passes without error when token is invalid (silently ignored)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/optional',
      headers: { authorization: 'Bearer bad.token.here' },
    })

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).authenticated).toBe(false)
  })
})

// ── rateLimit tests ───────────────────────────────────────────

describe('rateLimit middleware', () => {
  it('passes on first request and sets rate limit headers', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce(1 as any)

    const app = Fastify({ logger: false })
    app.get('/ping', { preHandler: [rateLimit] }, async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/ping' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['x-ratelimit-limit']).toBe('100')
    expect(res.headers['x-ratelimit-remaining']).toBe('99')
  })

  it('returns 429 when rate limit is exceeded', async () => {
    vi.mocked(redis.incr).mockResolvedValueOnce(101 as any)
    vi.mocked(redis.ttl as any).mockResolvedValueOnce(42)

    const app = Fastify({ logger: false })
    app.get('/ping', { preHandler: [rateLimit] }, async () => ({ ok: true }))
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/ping' })

    expect(res.statusCode).toBe(429)
    expect(JSON.parse(res.body).code).toBe('RATE_LIMITED')
    expect(res.headers['retry-after']).toBe('42')
  })
})
