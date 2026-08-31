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

  it('projette l identite cote SERVEUR, jamais l objet utilisateur entier', async () => {
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [installedRow({ granted: ['identity', 'identity:id', 'identity:username'] })] })
      .mockResolvedValueOnce({ rows: [{ id: 'user-42', username: 'ada' }] })
    const r = await session({ surface: 'page' }, 'Bearer membre')
    const body = JSON.parse(r.body)
    expect(body.user).toEqual({ id: 'user-42', username: 'ada' })

    // La requete ne LIT que les colonnes accordees : ramener le courriel pour
    // le jeter ensuite finirait par le laisser fuir dans un journal.
    const sql = dbQuery.mock.calls[1][0] as string
    expect(sql).toContain('SELECT id, username FROM users')
    expect(sql).not.toContain('email')
  })

  it('ne lit meme pas la table users quand identity n est pas accorde', async () => {
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [installedRow({ granted: ['storage.user'] })] })
    const r = await session({ surface: 'page' }, 'Bearer membre')
    expect(JSON.parse(r.body).user).toBeNull()
    expect(dbQuery).toHaveBeenCalledOnce()
  })

  it('rend un utilisateur nul pour un visiteur, sans echouer', async () => {
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [installedRow({ granted: ['identity', 'identity:id'] })] })
    const r = await session({ surface: 'page' })
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).user).toBeNull()
  })

  it('le jeton frappé ne vaut pas pour une autre surface', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow()] })
    const { token } = JSON.parse((await session({ surface: 'page' }, 'Bearer membre')).body)
    const v = verifyExtensionToken(token, { instanceId: ORIGIN, extensionId: 'demo-ext', surface: 'widget:main' }, SECRET)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.code).toBe('TOKEN_WRONG_SURFACE')
  })
})

// ── Surface activity : jeton + stockage (records, classement) ──────────────
// Cf SPECS/NODYX_ACTIVITIES_CDC.md §10. Une activité est une surface de
// stockage de plein droit : `RE_SURFACE` accepte `activity:<id>`, `/session`
// lui frappe un jeton, `/storage` marche tel quel.

describe('surface activity : jeton + stockage', () => {
  const MANIFEST_ACTIVITY = {
    ...MANIFEST,
    icon: 'icon.svg',
    surfaces: [{ type: 'activity', id: 'battle', entry: 'index.html', label: '@label' }],
    app: { url: 'https://github.com/x/y/releases/download/v1.0.0/app.zip', sha256: 'a'.repeat(64), bytes: 5000 },
    permissions: { storage: { user: '16kb', instance: '64kb', instance_write: true } },
  }

  const storeCall = (token: string, body: unknown) => app.inject({
    method: 'POST', url: '/api/v1/extensions/demo-ext/storage',
    headers: { authorization: `Bearer ${token}`, 'x-nodyx-surface': 'activity:battle' },
    payload: body,
  })

  async function activityToken(granted: string[]) {
    dbQuery.mockResolvedValue({ rows: [installedRow({ manifest: MANIFEST_ACTIVITY, granted })] })
    const r = await session({ surface: 'activity:battle' }, 'Bearer membre')
    return JSON.parse(r.body).token as string
  }

  it('frappe un jeton pour la surface activity du manifeste, lié à l utilisateur', async () => {
    const token = await activityToken(['storage.user'])
    const v = verifyExtensionToken(token, { instanceId: ORIGIN, extensionId: 'demo-ext', surface: 'activity:battle' }, SECRET)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.claims.sub).toBe('user-42')
  })

  it('refuse une surface activity absente du manifeste', async () => {
    dbQuery.mockResolvedValue({ rows: [installedRow({ manifest: MANIFEST_ACTIVITY })] })
    const r = await session({ surface: 'activity:inconnu' }, 'Bearer membre')
    expect(r.statusCode).toBe(404)
    expect(JSON.parse(r.body).code).toBe('SURFACE_NOT_FOUND')
  })

  it('écrit un record perso (scope user)', async () => {
    const token = await activityToken(['storage.user'])
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: MANIFEST_ACTIVITY, enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ n: 0, total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await storeCall(token, { op: 'set', key: 'stats', value: { games: 1, wins: 1 }, scope: 'user' })
    expect(r.statusCode).toBe(200)
  })

  it('refuse le classement partagé sans storage.instance.write', async () => {
    const token = await activityToken(['storage.user'])
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [{ manifest: MANIFEST_ACTIVITY, enabled: true }] })
    const r = await storeCall(token, { op: 'set', key: 'leaderboard', value: [], scope: 'instance' })
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('PERMISSION_DENIED')
  })

  it('accepte le classement partagé avec storage.instance.write (écriture de l arbitre)', async () => {
    const token = await activityToken(['storage.instance.read', 'storage.instance.write'])
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: MANIFEST_ACTIVITY, enabled: true }] })
      .mockResolvedValueOnce({ rows: [{ n: 0, total: 0 }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await storeCall(token, { op: 'set', key: 'leaderboard', value: [{ id: 'u-1', wins: 3 }], scope: 'instance' })
    expect(r.statusCode).toBe(200)
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

// ── Liste publique, ce que le frontend a le droit de savoir ────────────────

describe('liste publique', () => {
  const M = {
    ...MANIFEST,
    icon: 'icon.svg',
    label: '@label',
    description: '@desc',
    surfaces: [
      { type: 'widget', id: 'main', entry: 'ui/widget.js', label: '@w.label',
        default_height: 200,
        schema: [{ key: 'mood', type: 'select', label: '@f.mood', options: [{ value: 'a', label: '@o.a' }] }] },
      { type: 'page', path: 'demo', entry: 'ui/page.js', nav: { label: '@nav.label', icon: 'twemoji:star' } },
    ],
  }
  const MESSAGES = {
    en: { label: 'Demo', desc: 'A demo.', 'w.label': 'Widget', 'f.mood': 'Mood', 'o.a': 'A', 'nav.label': 'Demo page' },
    fr: { label: 'Démo', 'w.label': 'Widget FR' },
  }

  const publicList = (locale?: string) => app.inject({
    method: 'GET', url: `/api/v1/extensions/public${locale ? `?locale=${locale}` : ''}`,
  })

  beforeEach(() => {
    dbQuery.mockResolvedValue({ rows: [{ id: 'demo-ext', manifest: M, messages: MESSAGES, version: '1.0.0' }] })
  })

  it('resout les libelles cote serveur, dans la langue demandee', async () => {
    const r = await publicList('fr')
    const e = JSON.parse(r.body).extensions[0]
    expect(e.label).toBe('Démo')                       // traduit en francais
    expect(e.description).toBe('A demo.')              // repli sur la locale par defaut
    expect(e.surfaces[0].label).toBe('Widget FR')
  })

  it('resout aussi les libelles du schema et de ses options', async () => {
    const e = JSON.parse((await publicList()).body).extensions[0]
    expect(e.surfaces[0].schema[0].label).toBe('Mood')
    expect(e.surfaces[0].schema[0].options[0].label).toBe('A')
  })

  it('ne divulgue ni permissions accordees, ni empreinte, ni installateur', async () => {
    const body = (await publicList()).body
    for (const secret of ['granted', 'sha256', 'installed_by', 'permissions']) {
      expect(body).not.toContain(secret)
    }
  })

  it('pointe l icone vers la route d assets versionnee', async () => {
    const e = JSON.parse((await publicList()).body).extensions[0]
    expect(e.icon).toBe('/api/v1/extensions/demo-ext/1.0.0/assets/icon.svg')
  })

  it('resout tagline + captures pour la vitrine, jamais le chemin brut', async () => {
    dbQuery.mockResolvedValue({ rows: [{
      id: 'demo-ext', version: '1.0.0',
      messages: { en: { label: 'Demo', desc: 'A demo.', tag: 'Un jeu de folie' } },
      manifest: { ...M, tagline: '@tag', screenshots: ['media/cover.png', 'media/shot1.webp'] },
    }] })
    const e = JSON.parse((await publicList()).body).extensions[0]
    expect(e.tagline).toBe('Un jeu de folie')
    expect(e.screenshots).toEqual([
      '/api/v1/extensions/demo-ext/1.0.0/assets/media/cover.png',
      '/api/v1/extensions/demo-ext/1.0.0/assets/media/shot1.webp',
    ])
    expect((await publicList()).body).not.toContain('"media/cover.png"')
  })

  it('ne liste que les extensions activees', async () => {
    await publicList()
    expect(dbQuery.mock.calls[0][0]).toContain('WHERE enabled = true')
  })

  it('ignore un manifeste corrompu plutot que de servir n importe quoi', async () => {
    dbQuery.mockResolvedValue({ rows: [{ id: 'x', manifest: { api: 99 }, messages: {}, version: '1.0.0' }] })
    const r = await publicList()
    expect(r.statusCode).toBe(200)
    expect(JSON.parse(r.body).extensions).toEqual([])
  })

  it('expose une surface activity avec l URL servie par l instance, jamais le champ app', async () => {
    dbQuery.mockResolvedValue({ rows: [{
      id: 'kings-race', version: '0.3.0',
      messages: { en: { label: 'King\'s Race', desc: 'A TD.' }, fr: { label: 'Course aux Rois' } },
      manifest: {
        ...MANIFEST, id: 'kings-race', icon: 'icon.svg', label: '@label', description: '@desc',
        surfaces: [{ type: 'activity', id: 'battle', entry: 'index.html', label: '@label', default_aspect: '16:9' }],
        app: { url: 'https://github.com/x/y/releases/download/v0.3.0/app.zip', sha256: 'a'.repeat(64), bytes: 54000000 },
        permissions: { identity: ['username'], realtime: true },
      },
    }] })
    const e = JSON.parse((await publicList('fr')).body).extensions[0]
    expect(e.surfaces[0]).toMatchObject({
      type: 'activity', id: 'battle',
      appUrl: '/api/v1/extensions/kings-race/0.3.0/app/index.html?v=0.3.0',
      label: 'Course aux Rois', aspect: '16:9',
    })
    const body = (await publicList()).body
    // ni la capacité, ni l'URL/empreinte de récupération du bundle
    expect(body).not.toContain('realtime')
    expect(body).not.toContain('github.com')
    expect(body).not.toContain('sha256')
  })
})

// ── Proxy reseau ───────────────────────────────────────────────────────────

describe('proxy reseau', () => {
  const M = {
    ...MANIFEST,
    permissions: {
      network: {
        'api.tmdb.example': { methods: ['GET'], paths: ['/3/*'], secret: 'TMDB' },
        '10.0.0.5':         { methods: ['GET'], paths: ['/api/*'] },
      },
    },
  }

  async function tokenFor(granted: string[]) {
    dbQuery.mockResolvedValue({ rows: [installedRow({ granted, manifest: M })] })
    const r = await session({ surface: 'page' }, 'Bearer membre')
    return JSON.parse(r.body).token as string
  }

  const call = (token: string, body: unknown) => app.inject({
    method: 'POST', url: '/api/v1/extensions/demo-ext/fetch',
    headers: { authorization: `Bearer ${token}`, 'x-nodyx-surface': 'page' },
    payload: body,
  })

  it('refuse sans jeton', async () => {
    const r = await app.inject({
      method: 'POST', url: '/api/v1/extensions/demo-ext/fetch',
      headers: { 'x-nodyx-surface': 'page' }, payload: { url: 'https://api.tmdb.example/3/movie/1' },
    })
    expect(r.statusCode).toBe(401)
  })

  it('refuse quand aucun acces reseau n a ete accorde', async () => {
    const token = await tokenFor(['storage.user'])
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [{ manifest: M, enabled: true, granted: ['storage.user'] }] })
    const r = await call(token, { url: 'https://api.tmdb.example/3/movie/1' })
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('PERMISSION_DENIED')
  })

  it('refuse un hote declare au manifeste mais NON accorde par l admin', async () => {
    // L'intersection, jamais l'un des deux seul : le manifeste demande deux
    // hotes, l'admin n'en a accorde qu'un.
    const token = await tokenFor(['net:api.tmdb.example'])
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: M, enabled: true, granted: ['net:api.tmdb.example'] }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await call(token, { url: 'http://10.0.0.5/api/stock' })
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('HOST_NOT_ALLOWED')
  })

  it('refuse un chemin hors des prefixes declares', async () => {
    const token = await tokenFor(['net:api.tmdb.example'])
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: M, enabled: true, granted: ['net:api.tmdb.example'] }] })
      .mockResolvedValueOnce({ rows: [] })
    const r = await call(token, { url: 'https://api.tmdb.example/4/account' })
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('PATH_NOT_ALLOWED')
  })

  it('refuse une extension desactivee', async () => {
    const token = await tokenFor(['net:api.tmdb.example'])
    dbQuery.mockReset()
    dbQuery.mockResolvedValue({ rows: [{ manifest: M, enabled: false, granted: ['net:api.tmdb.example'] }] })
    const r = await call(token, { url: 'https://api.tmdb.example/3/movie/1' })
    expect(r.statusCode).toBe(403)
    expect(JSON.parse(r.body).code).toBe('EXTENSION_DISABLED')
  })

  it('ne renvoie JAMAIS la valeur d un secret', async () => {
    const token = await tokenFor(['net:api.tmdb.example'])
    dbQuery.mockReset()
    dbQuery
      .mockResolvedValueOnce({ rows: [{ manifest: M, enabled: true, granted: ['net:api.tmdb.example'] }] })
      .mockResolvedValueOnce({ rows: [{ name: 'TMDB', value: 'SECRET-ULTRA' }] })
    const r = await call(token, { url: 'https://api.tmdb.example/3/movie/1' })
    // L'appel sortant echoue (hote inexistant), mais rien ne doit fuir.
    expect(r.body).not.toContain('SECRET-ULTRA')
  })
})
