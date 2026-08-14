import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { FastifyInstance } from 'fastify'
import { buildApp } from './helpers/buildApp'
import { verifyExtensionToken } from '../extensions/token'

const SECRET = 'secret-de-test'
const ORIGIN = 'https://instance.example'

const MANIFEST = {
  api: 1,
  id: 'demo-ext',
  version: '1.0.0',
  license: 'MIT',
  default_locale: 'en',
  label: '@label',
  description: '@description',
  surfaces: [
    { type: 'widget', id: 'main', entry: 'ui/widget.js', label: '@label' },
    { type: 'page', path: 'demo', entry: 'ui/page.js' },
  ],
}

const dbQuery = vi.fn()

const redisIncr = vi.fn().mockResolvedValue(1)
vi.mock('../config/database', () => ({
  db:    { query: (...a: unknown[]) => dbQuery(...a) },
  redis: {
    exists: vi.fn().mockResolvedValue(0),
    setex:  vi.fn().mockResolvedValue('OK'),
    incr:   (...a: unknown[]) => redisIncr(...a),
    // Doit rendre une promesse : le vrai ioredis en rend une, et la route y
    // enchaine un .catch(). Un mock qui rend undefined fabrique un faux 500.
    expire: vi.fn().mockResolvedValue(1),
  },
}))
vi.mock('../middleware/rateLimit', () => ({ rateLimit: vi.fn(async () => {}) }))
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: { headers: Record<string, string> }, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!req.headers.authorization) return reply.code(401).send({ error: 'Unauthorized' })
  }),
}))
vi.mock('../middleware/auth', () => ({
  optionalAuth: vi.fn(async (req: { headers: Record<string, string>; user?: unknown }) => {
    if (req.headers.authorization === 'Bearer membre') req.user = { userId: 'user-42', username: 'ada' }
  }),
}))

let app: FastifyInstance

beforeEach(async () => {
  dbQuery.mockReset()
  process.env.JWT_SECRET   = SECRET
  process.env.FRONTEND_URL = ORIGIN
  const { extensionRoutes } = await import('../routes/extensions')
  app = await buildApp(async (a) => { await a.register(extensionRoutes, { prefix: '/api/v1' }) })
})

function installedRow(over: Record<string, unknown> = {}) {
  return { id: 'demo-ext', manifest: MANIFEST, version: '1.0.0', enabled: true, granted: ['identity', 'storage.user'], ...over }
}

const session = (body: unknown, auth?: string) => app.inject({
  method: 'POST', url: '/api/v1/extensions/demo-ext/session',
  headers: auth ? { authorization: auth } : {},
  payload: body,
})

describe('frappe du jeton de surface', () => {
  it('rend un jeton lié à l extension, la surface et l utilisateur', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow()] })
    const r = await session({ surface: 'widget:main' }, 'Bearer membre')
    expect(r.statusCode).toBe(200)

    const { token, expiresIn } = JSON.parse(r.body)
    expect(expiresIn).toBe(600)

    const v = verifyExtensionToken(token, { instanceId: ORIGIN, extensionId: 'demo-ext', surface: 'widget:main' }, SECRET)
    if (!v.ok) throw new Error('jeton refusé à tort : ' + v.code)
    expect(v.claims.sub).toBe('user-42')
    expect(v.claims.prm).toEqual(['identity', 'storage.user'])
  })

  it('rend un jeton anonyme à un visiteur, sans échouer', async () => {
    // Les vues publiques sont vues par des gens sans compte : une extension
    // doit pouvoir s'y monter.
    dbQuery.mockResolvedValue({ rows: [installedRow()] })
    const r = await session({ surface: 'page' })
    expect(r.statusCode).toBe(200)
    const v = verifyExtensionToken(JSON.parse(r.body).token, { instanceId: ORIGIN, extensionId: 'demo-ext', surface: 'page' }, SECRET)
    if (!v.ok) throw new Error('jeton refusé à tort')
    expect(v.claims.sub).toBeNull()
  })

  it('porte les capacités ACCORDÉES, pas celles du manifeste', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow({ granted: [] })] })
    const r = await session({ surface: 'page' }, 'Bearer membre')
    const v = verifyExtensionToken(JSON.parse(r.body).token, { instanceId: ORIGIN, extensionId: 'demo-ext', surface: 'page' }, SECRET)
    if (!v.ok) throw new Error('jeton refusé à tort')
    expect(v.claims.prm).toEqual([])
  })

  it('refuse une surface absente du manifeste installé', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow()] })
    const r = await session({ surface: 'widget:inconnu' }, 'Bearer membre')
    expect(r.statusCode).toBe(404)
    expect(JSON.parse(r.body).code).toBe('SURFACE_NOT_FOUND')
  })

  it.each(['', 'page/../evil', 'widget:MAJ', 'widget:'])('refuse la surface mal formée %p', async (surface) => {
    dbQuery.mockResolvedValue({ rows: [installedRow()] })
    const r = await session({ surface })
    expect(r.statusCode).toBe(400)
  })

  it('refuse une extension désactivée', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow({ enabled: false })] })
    const r = await session({ surface: 'page' }, 'Bearer membre')
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('EXTENSION_DISABLED')
  })

  it('refuse une extension inconnue', async () => {
    dbQuery.mockResolvedValue({ rows: [] })
    const r = await session({ surface: 'page' })
    expect(r.statusCode).toBe(404)
  })

  it('le jeton frappé ne vaut pas pour une autre surface', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow()] })
    const { token } = JSON.parse((await session({ surface: 'page' }, 'Bearer membre')).body)
    const v = verifyExtensionToken(token, { instanceId: ORIGIN, extensionId: 'demo-ext', surface: 'widget:main' }, SECRET)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe('TOKEN_WRONG_SURFACE')
  })
})

describe('administration', () => {
  it('exige une authentification sur la liste', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/extensions' })
    expect(r.statusCode).toBe(401)
  })

  it('liste les extensions installées', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow()] })
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/extensions', headers: { authorization: 'Bearer admin' } })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).extensions).toHaveLength(1)
  })

  it('bascule l état actif', async () => {
    dbQuery.mockResolvedValue({ rows: [], rowCount: 1 })
    const r = await app.inject({
      method: 'PATCH', url: '/api/v1/admin/extensions/demo-ext',
      headers: { authorization: 'Bearer admin' }, payload: { enabled: false },
    })
    expect(r.statusCode).toBe(200)
    expect(dbQuery.mock.calls[0][0]).toContain('UPDATE installed_extensions')
  })

  it('rend 404 quand la bascule ne touche aucune ligne', async () => {
    dbQuery.mockResolvedValue({ rows: [], rowCount: 0 })
    const r = await app.inject({
      method: 'PATCH', url: '/api/v1/admin/extensions/absente',
      headers: { authorization: 'Bearer admin' }, payload: { enabled: true },
    })
    expect(r.statusCode).toBe(404)
  })

  it('refuse un identifiant mal formé à la suppression', async () => {
    const r = await app.inject({
      method: 'DELETE', url: '/api/v1/admin/extensions/MAJUSCULES',
      headers: { authorization: 'Bearer admin' },
    })
    expect(r.statusCode).toBe(400)
    expect(dbQuery).not.toHaveBeenCalled()
  })

  it('exige une authentification pour installer', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/admin/extensions/install' })
    expect(r.statusCode).toBe(401)
  })
})

// ── Stockage, authentifie par le jeton d'extension ─────────────────────────

describe('stockage', () => {
  const MANIFEST_STORAGE = {
    ...MANIFEST,
    permissions: { storage: { user: '1mb' } },
  }

  async function tokenFor(granted: string[] = ['storage.user']) {
    dbQuery.mockResolvedValue({ rows: [installedRow({ granted, manifest: MANIFEST_STORAGE })] })
    const r = await session({ surface: 'page' }, 'Bearer membre')
    return JSON.parse(r.body).token as string
  }

  const call = (token: string, body: unknown, surface = 'page') => app.inject({
    method: 'POST', url: '/api/v1/extensions/demo-ext/storage',
    headers: { authorization: `Bearer ${token}`, 'x-nodyx-surface': surface },
    payload: body,
  })

  it('lit une cle avec un jeton valide', async () => {
    const token = await tokenFor()
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: MANIFEST_STORAGE, enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ value: [603] }] })
    const r = await call(token, { op: 'get', key: 'watched' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).result).toEqual([603])
  })

  it('refuse sans jeton', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/v1/extensions/demo-ext/storage',
      headers: { 'x-nodyx-surface': 'page' }, payload: { op: 'get', key: 'k' },
    })
    expect(r.statusCode).toBe(401)
    expect(JSON.parse(r.body).code).toBe('TOKEN_MISSING')
  })

  it('refuse un jeton frappe pour une AUTRE surface', async () => {
    const token = await tokenFor()
    const r = await call(token, { op: 'get', key: 'k' }, 'widget:main')
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('TOKEN_WRONG_SURFACE')
  })

  it('refuse une capacite non accordee, meme avec un jeton valide', async () => {
    const token = await tokenFor([])            // aucune capacite accordee
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [{ manifest: MANIFEST_STORAGE, enabled: true }] })
    const r = await call(token, { op: 'get', key: 'k' })
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('PERMISSION_DENIED')
  })

  it('refuse quand l extension a ete desactivee entre temps', async () => {
    const token = await tokenFor()
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [{ manifest: MANIFEST_STORAGE, enabled: false }] })
    const r = await call(token, { op: 'get', key: 'k' })
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('EXTENSION_DISABLED')
  })

  it('plafonne les ecritures par membre', async () => {
    const token = await tokenFor()
    redisIncr.mockResolvedValueOnce(31)
    const r = await call(token, { op: 'set', key: 'k', value: 1 })
    expect(r.statusCode).toBe(429)
    expect(JSON.parse(r.body).code).toBe('RATE_LIMITED')
  })

  it('ne plafonne PAS les lectures', async () => {
    const token = await tokenFor()
    redisIncr.mockClear()
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: MANIFEST_STORAGE, enabled: true }] })
      .mockResolvedValueOnce({ rows: [] })
    await call(token, { op: 'get', key: 'k' })
    expect(redisIncr).not.toHaveBeenCalled()
  })

  it('rend 507 quand le quota est atteint', async () => {
    const token = await tokenFor()
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: MANIFEST_STORAGE, enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ n: 1, total: 1024 * 1024 }] })
    const r = await call(token, { op: 'set', key: 'k', value: 'x'.repeat(100) })
    expect(r.statusCode).toBe(507)
    expect(JSON.parse(r.body).code).toBe('QUOTA_EXCEEDED')
  })

  it('refuse une operation inconnue', async () => {
    const token = await tokenFor()
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [{ manifest: MANIFEST_STORAGE, enabled: true }] })
    const r = await call(token, { op: 'truncate' })
    expect(r.statusCode).toBe(400)
  })
})
