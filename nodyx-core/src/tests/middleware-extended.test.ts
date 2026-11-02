/**
 * Tests for: requireModule, validate.
 * (Les droits de l'équipe sont testés dans permissions.test.ts.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import { z } from 'zod'
import jwt from 'jsonwebtoken'

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock('../config/database', () => ({
  db:    { query: vi.fn() },
  redis: {
    get:    vi.fn(),
    setex:  vi.fn().mockResolvedValue('OK'),
    exists: vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl:    vi.fn().mockResolvedValue(60),
  },
}))

import { db, redis } from '../config/database'
import { requireModule }   from '../middleware/requireModule'
import { validate }        from '../middleware/validate'
import { requireAuth }     from '../middleware/auth'

// ── Helpers ───────────────────────────────────────────────────────────────────

const SECRET = process.env.JWT_SECRET!

function makeToken(payload = { userId: 'user-uuid', username: 'testuser' }) {
  return jwt.sign(payload, SECRET, { expiresIn: '1h' })
}

const TOKEN = makeToken()
const AUTH  = `Bearer ${TOKEN}`

// ─────────────────────────────────────────────────────────────────────────────
// requireModule
// ─────────────────────────────────────────────────────────────────────────────

describe('requireModule', () => {
  beforeEach(() => { vi.resetAllMocks() })

  async function buildModuleApp(moduleId: string) {
    const app = Fastify({ logger: false })
    app.get('/test', { preHandler: [requireModule(moduleId)] }, async () => ({ ok: true }))
    await app.ready()
    return app
  }

  it('passes when Redis cache says enabled (1)', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce('1')
    const app = await buildModuleApp('wiki')
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('blocks with 503 when Redis cache says disabled (0)', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce('0')
    const app = await buildModuleApp('wiki')
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'module_disabled', module: 'wiki' })
  })

  it('cache miss — DB enabled → passes and caches', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ enabled: true }], rowCount: 1 } as any)
    const app = await buildModuleApp('chat')
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
    expect(redis.setex).toHaveBeenCalledWith('module:chat:enabled', 60, '1')
  })

  it('cache miss — DB disabled → 503 and caches 0', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ enabled: false }], rowCount: 1 } as any)
    const app = await buildModuleApp('calendar')
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(503)
    expect(redis.setex).toHaveBeenCalledWith('module:calendar:enabled', 60, '0')
  })

  it('cache miss — module not in DB → treated as disabled', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null)
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [], rowCount: 0 } as any)
    const app = await buildModuleApp('unknown-module')
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(503)
  })

  it('fails open when Redis throws (never blocks legitimate traffic)', async () => {
    vi.mocked(redis.get).mockRejectedValueOnce(new Error('Redis connection refused'))
    const app = await buildModuleApp('wiki')
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
  })

  it('fails open when DB throws', async () => {
    vi.mocked(redis.get).mockResolvedValueOnce(null)
    vi.mocked(db.query).mockRejectedValueOnce(new Error('DB down'))
    const app = await buildModuleApp('wiki')
    const res = await app.inject({ method: 'GET', url: '/test' })
    expect(res.statusCode).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validate middleware
// ─────────────────────────────────────────────────────────────────────────────

describe('validate middleware', () => {
  beforeEach(() => { vi.resetAllMocks() })

  const BodySchema = z.object({
    title:   z.string().min(3).max(100),
    count:   z.number().int().positive(),
    active:  z.boolean().optional(),
  })
  const QuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional(),
    q:    z.string().min(1).optional(),
  })

  async function buildValidateApp() {
    const app = Fastify({ logger: false })
    app.post('/body', { preHandler: [validate({ body: BodySchema })] },
      async (req) => req.body)
    app.get('/query', { preHandler: [validate({ query: QuerySchema })] },
      async (req) => req.query)
    await app.ready()
    return app
  }

  it('passes valid body through', async () => {
    const app = await buildValidateApp()
    const res = await app.inject({
      method: 'POST', url: '/body',
      headers: { 'content-type': 'application/json' },
      payload: { title: 'Hello World', count: 5 },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ title: 'Hello World', count: 5 })
  })

  it('rejects missing required field with 400', async () => {
    const app = await buildValidateApp()
    const res = await app.inject({
      method: 'POST', url: '/body',
      headers: { 'content-type': 'application/json' },
      payload: { title: 'Hello' }, // missing count
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects title too short', async () => {
    const app = await buildValidateApp()
    const res = await app.inject({
      method: 'POST', url: '/body',
      headers: { 'content-type': 'application/json' },
      payload: { title: 'Hi', count: 1 },
    })
    expect(res.statusCode).toBe(400)
    const body = res.json()
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.error).toMatch(/title/)
  })

  it('rejects wrong type', async () => {
    const app = await buildValidateApp()
    const res = await app.inject({
      method: 'POST', url: '/body',
      headers: { 'content-type': 'application/json' },
      payload: { title: 'Valid Title', count: 'not-a-number' },
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
  })

  it('passes valid query params', async () => {
    const app = await buildValidateApp()
    const res = await app.inject({ method: 'GET', url: '/query?page=2&q=hello' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ page: 2, q: 'hello' })
  })

  it('rejects invalid query param (coercion fails)', async () => {
    const app = await buildValidateApp()
    const res = await app.inject({ method: 'GET', url: '/query?page=abc' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
  })
})

// checkPermission (jamais branché) a été remplacé le 02/11/2026 par
// requirePermission + services/permissions.ts : voir permissions.test.ts.
