import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

const { query } = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('../config/database', () => ({
  db: { query },
  redis: {
    exists: vi.fn().mockResolvedValue(0),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    get:    vi.fn().mockResolvedValue(null),
  },
}))

vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    if (req.headers.authorization !== 'Bearer admin') {
      return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    }
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

const logAction = vi.fn()
vi.mock('../routes/admin', () => ({ logAction: (...a: unknown[]) => logAction(...a) }))

import appearanceRoutes from '../routes/appearance'
import {
  ShellThemeSchema, normalizeShellTheme, parseStoredShellTheme, isSafeBackdropUrl,
  SHELL_KEY_DRAFT, SHELL_KEY_PUBLISHED,
} from '../utils/shellTheme'

const VALID = { accent: '#FFB020', backdrop: 'banner', intensity: 60, default_mode: 'dark' } as const

// ── Schéma ────────────────────────────────────────────────────

describe('ShellThemeSchema', () => {
  it('accepte une ambiance valide', () => {
    expect(ShellThemeSchema.safeParse(VALID).success).toBe(true)
  })

  it.each([
    ['accent sans #',            { ...VALID, accent: 'ffb020' }],
    ['accent 3 chiffres',        { ...VALID, accent: '#fb0' }],
    ['accent avec CSS injecté',  { ...VALID, accent: '#ffb020;background:url(x)' }],
    ['intensité > 100',          { ...VALID, intensity: 101 }],
    ['intensité négative',       { ...VALID, intensity: -1 }],
    ['intensité décimale',       { ...VALID, intensity: 12.5 }],
    ['décor inconnu',            { ...VALID, backdrop: 'video' }],
    ['mode inconnu',             { ...VALID, default_mode: 'sepia' }],
    ['clé en trop (CSS libre)',  { ...VALID, css: 'body{display:none}' }],
    ['décor perso sans url',     { ...VALID, backdrop: 'custom' }],
  ])('refuse : %s', (_label, value) => {
    expect(ShellThemeSchema.safeParse(value).success).toBe(false)
  })
})

describe('isSafeBackdropUrl', () => {
  it.each([
    '/uploads/banners/abc-123.webp',
    'https://images.example.org/fond.jpg',
  ])('accepte %s', url => expect(isSafeBackdropUrl(url)).toBe(true))

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'http://non-chiffre.example/fond.jpg',
    '/uploads/../../etc/passwd',
    '//evil.example/x.png',
    '/api/v1/admin/users',
    '/uploads//evil.example/x.png',
    '/uploads/a"onerror="x.png',
    'https://' + 'a'.repeat(600) + '.png',
  ])('refuse %s', url => expect(isSafeBackdropUrl(url)).toBe(false))
})

describe('normalizeShellTheme / parseStoredShellTheme', () => {
  it('accent en minuscules, url retirée si le décor n’est pas personnalisé', () => {
    expect(normalizeShellTheme({ ...VALID, backdrop_url: '/uploads/x.png' })).toEqual({
      accent: '#ffb020', backdrop: 'banner', backdrop_url: null, intensity: 60, default_mode: 'dark',
    })
  })

  it('valeur stockée corrompue ou invalide : null, jamais une exception', () => {
    expect(parseStoredShellTheme(null)).toBeNull()
    expect(parseStoredShellTheme('{pas du json')).toBeNull()
    expect(parseStoredShellTheme(JSON.stringify({ ...VALID, accent: 'rouge' }))).toBeNull()
  })

  it('relit une valeur valide sous sa forme canonique', () => {
    expect(parseStoredShellTheme(JSON.stringify(VALID))?.accent).toBe('#ffb020')
  })
})

// ── Routes ────────────────────────────────────────────────────

describe('/api/v1/admin/appearance', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    vi.resetAllMocks()
    app = await buildApp(a => a.register(appearanceRoutes, { prefix: '/api/v1/admin/appearance' }))
  })

  const call = (method: 'GET' | 'PUT' | 'POST' | 'DELETE', url: string, payload?: unknown, auth = 'Bearer admin') =>
    app.inject({ method, url: '/api/v1/admin/appearance' + url, headers: auth ? { authorization: auth } : {}, payload: payload as any })

  // Toutes les clés écrites par ces routes : jamais autre chose que les deux
  // clés d'ambiance (instance_settings est aussi copié dans process.env).
  const writtenKeys = () => query.mock.calls
    .filter(([sql]) => /INSERT|DELETE/.test(String(sql)))
    .flatMap(([, params]) => (params as unknown[]).filter(p => typeof p === 'string' && p.startsWith('theme_')))

  it.each([
    ['GET', '/'], ['PUT', '/draft'], ['DELETE', '/draft'], ['POST', '/publish'],
  ] as const)('%s %s refusé sans droits admin, sans toucher la base', async (method, url) => {
    const res = await call(method, url, VALID, '')
    expect(res.statusCode).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('GET renvoie la version publiée et le brouillon, relus et validés', async () => {
    query.mockResolvedValueOnce({ rows: [
      { key: SHELL_KEY_PUBLISHED, value: JSON.stringify(VALID) },
      { key: SHELL_KEY_DRAFT,     value: '{corrompu' },
    ] })
    const res = await call('GET', '/')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ published: { ...VALID, accent: '#ffb020', backdrop_url: null }, draft: null })
  })

  it('PUT /draft refuse une valeur invalide avec un code stable, sans écrire', async () => {
    const res = await call('PUT', '/draft', { ...VALID, accent: 'red' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
    expect(query).not.toHaveBeenCalled()
  })

  it('PUT /draft enregistre la forme canonique dans le brouillon, jamais dans la version publique', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await call('PUT', '/draft', VALID)
    expect(res.statusCode).toBe(200)
    const [sql, params] = query.mock.calls[0]
    expect(String(sql)).toMatch(/INSERT INTO instance_settings/)
    expect(params[0]).toBe(SHELL_KEY_DRAFT)
    expect(JSON.parse(params[1] as string)).toEqual({ ...VALID, accent: '#ffb020', backdrop_url: null })
    expect(params[2]).toBe('admin-uuid')
    expect(writtenKeys()).toEqual([SHELL_KEY_DRAFT])
  })

  it('DELETE /draft abandonne le brouillon seulement', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await call('DELETE', '/draft')
    expect(res.statusCode).toBe(200)
    expect(query.mock.calls[0][1]).toEqual([SHELL_KEY_DRAFT])
  })

  it('POST /publish sans brouillon : 409 NO_DRAFT, rien d’écrit', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('NO_DRAFT')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('POST /publish revalide : un brouillon modifié hors API n’est jamais publié', async () => {
    query.mockResolvedValueOnce({ rows: [{ key: SHELL_KEY_DRAFT, value: JSON.stringify({ ...VALID, accent: 'url(javascript:x)' }) }] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DRAFT_INVALID')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('POST /publish : une seule instruction retire le brouillon RELU et l’installe comme version publique', async () => {
    const raw = JSON.stringify({ ...VALID, accent: '#ffb020', backdrop_url: null })
    query
      .mockResolvedValueOnce({ rows: [{ key: SHELL_KEY_DRAFT, value: raw }] })
      .mockResolvedValueOnce({ rows: [{ value: raw }] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(200)
    expect(res.json().published.accent).toBe('#ffb020')
    const [sql, params] = query.mock.calls[1]
    expect(String(sql)).toMatch(/WITH d AS \(\s*DELETE FROM instance_settings WHERE key = \$1 AND value = \$2/)
    expect(params).toEqual([SHELL_KEY_DRAFT, raw, SHELL_KEY_PUBLISHED, 'admin-uuid'])
    expect(logAction).toHaveBeenCalledWith('admin-uuid', 'publish_appearance', 'instance', null, null, expect.objectContaining({ accent: '#ffb020' }))
  })

  it('POST /publish : brouillon réenregistré pendant la publication, 409 DRAFT_CHANGED', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ key: SHELL_KEY_DRAFT, value: JSON.stringify(VALID) }] })
      .mockResolvedValueOnce({ rows: [] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DRAFT_CHANGED')
    expect(logAction).not.toHaveBeenCalled()
  })
})
