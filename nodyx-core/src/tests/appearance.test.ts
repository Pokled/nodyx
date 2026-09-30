import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

// ── Mocks ─────────────────────────────────────────────────────

const { query, clientQuery, release } = vi.hoisted(() => ({ query: vi.fn(), clientQuery: vi.fn(), release: vi.fn() }))

vi.mock('../config/database', () => ({
  db: { query, connect: vi.fn(async () => ({ query: clientQuery, release })) },
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
const getCommunityId = vi.fn()
vi.mock('../routes/admin', () => ({
  logAction: (...a: unknown[]) => logAction(...a),
  getCommunityId: (...a: unknown[]) => getCommunityId(...a),
}))

import appearanceRoutes from '../routes/appearance'
import {
  ShellThemeSchema, normalizeShellTheme, parseStoredShellTheme, isSafeBackdropUrl,
  IdentityDraftSchema, SHELL_KEY_DRAFT, SHELL_KEY_PUBLISHED, IDENTITY_KEY_DRAFT,
} from '../utils/shellTheme'

const VALID = { accent: '#FFB020', backdrop: 'banner', intensity: 60, default_mode: 'dark' } as const

// ── Schéma ────────────────────────────────────────────────────

describe('ShellThemeSchema', () => {
  it('accepte une ambiance valide, avec ou sans le réglage des fonds', () => {
    expect(ShellThemeSchema.safeParse(VALID).success).toBe(true)
    expect(ShellThemeSchema.safeParse({ ...VALID, neutrals: 'graphite' }).success).toBe(true)
    expect(ShellThemeSchema.safeParse({ ...VALID, neutrals: 'black' }).success).toBe(true)
  })

  it('une ambiance publiée AVANT le réglage des fonds reste relue, en gris teintés', () => {
    expect(parseStoredShellTheme(JSON.stringify(VALID))?.neutrals).toBe('tinted')
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
    ['fonds inconnus',           { ...VALID, neutrals: 'rose' }],
  ])('refuse : %s', (_label, value) => {
    expect(ShellThemeSchema.safeParse(value).success).toBe(false)
  })
})

describe('isSafeBackdropUrl', () => {
  it.each([
    '/uploads/banners/abc-123.webp',
    'https://images.example.org/fond.jpg',
    '/ambiances/cyberpunk.jpg',
    '/ambiances/sepia.webp',
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
    '/ambiances/../uploads/x.jpg',
    '/ambiances/Cyber.JPG',
    '/ambiances/sous/dossier.jpg',
    '/ambiances/cyberpunk.svg',
    '/ambiances/cyberpunk.jpg?x=1',
    'https://' + 'a'.repeat(600) + '.png',
  ])('refuse %s', url => expect(isSafeBackdropUrl(url)).toBe(false))
})

describe('styles par zone (partie 3)', () => {
  const FULL = {
    accent: '#FF3FA4', surface: '#101828', opacity: 80, blur: 12, border_color: '#334155', border_width: 1,
    radius: 16, shadow: 40, image: { url: '/ambiances/cyberpunk.jpg', x: 50, y: 30, zoom: 120, veil: 60 }, font: 'rounded',
  }

  it('accepte une zone entièrement stylée, et normalise ses couleurs', () => {
    const r = ShellThemeSchema.safeParse({ ...VALID, zones: { sidebar: FULL, rail: { accent: '#00FF00' } } })
    expect(r.success).toBe(true)
    const n = normalizeShellTheme(r.data!)
    expect(n.zones?.sidebar?.accent).toBe('#ff3fa4')
    expect(n.zones?.rail?.accent).toBe('#00ff00')
  })

  it('une zone vide disparaît : elle suit l’ambiance', () => {
    const n = normalizeShellTheme({ ...VALID, zones: { header: {} } } as any)
    expect(n.zones).toBeUndefined()
  })

  it.each([
    ['zone inconnue',              { widget: { accent: '#ffffff' } }],
    ['réglage inconnu (CSS libre)', { sidebar: { css: 'display:none' } }],
    ['couleur avec CSS injecté',   { sidebar: { accent: '#fff;background:url(x)' } }],
    ['opacité hors bornes',        { sidebar: { opacity: 150 } }],
    ['flou démesuré',              { sidebar: { blur: 400 } }],
    ['bordure trop épaisse',       { sidebar: { border_width: 20 } }],
    ['arrondi démesuré',           { sidebar: { radius: 999 } }],
    ['police inconnue',            { sidebar: { font: 'Comic Sans' } }],
    ['image javascript:',          { sidebar: { image: { url: 'javascript:alert(1)', x: 50, y: 50, zoom: 100, veil: 0 } } }],
    ['image data:',                { sidebar: { image: { url: 'data:image/png;base64,AA', x: 50, y: 50, zoom: 100, veil: 0 } } }],
    ['image sans recadrage',       { sidebar: { image: { url: '/uploads/a.png' } } }],
    ['zoom hors bornes',           { sidebar: { image: { url: '/uploads/a.png', x: 50, y: 50, zoom: 1000, veil: 0 } } }],
  ])('refuse : %s', (_l, zones) => {
    expect(ShellThemeSchema.safeParse({ ...VALID, zones }).success).toBe(false)
  })
})

describe('IdentityDraftSchema', () => {
  it('accepte un logo seul, une bannière seule, ou un retrait (null)', () => {
    expect(IdentityDraftSchema.safeParse({ logo_url: '/uploads/logos/a.png' }).success).toBe(true)
    expect(IdentityDraftSchema.safeParse({ banner_url: null }).success).toBe(true)
  })
  it.each([
    ['vide', {}],
    ['javascript:', { logo_url: 'javascript:alert(1)' }],
    ['remontée de dossier', { banner_url: '/uploads/../../etc/passwd' }],
    ['clé inconnue', { logo_url: '/uploads/a.png', name: 'x' }],
  ])('refuse : %s', (_l, v) => expect(IdentityDraftSchema.safeParse(v).success).toBe(false))
})

describe('normalizeShellTheme / parseStoredShellTheme', () => {
  it('accent en minuscules, url retirée si le décor n’est pas personnalisé', () => {
    expect(normalizeShellTheme({ ...VALID, backdrop_url: '/uploads/x.png' })).toEqual({
      accent: '#ffb020', backdrop: 'banner', backdrop_url: null, intensity: 60, default_mode: 'dark', neutrals: 'tinted',
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
    ['PUT', '/draft/identity'], ['DELETE', '/draft/identity'],
  ] as const)('%s %s refusé sans droits admin, sans toucher la base', async (method, url) => {
    const res = await call(method, url, VALID, '')
    expect(res.statusCode).toBe(401)
    expect(query).not.toHaveBeenCalled()
  })

  it('GET renvoie ambiance ET identité, publiées et en brouillon, relues et validées', async () => {
    getCommunityId.mockResolvedValue('comm-1')
    query
      .mockResolvedValueOnce({ rows: [
        { key: SHELL_KEY_PUBLISHED, value: JSON.stringify(VALID) },
        { key: SHELL_KEY_DRAFT,     value: '{corrompu' },
        { key: IDENTITY_KEY_DRAFT,  value: JSON.stringify({ logo_url: '/uploads/logos/n.png' }) },
      ] })
      .mockResolvedValueOnce({ rows: [{ logo_url: '/uploads/logos/a.png', banner_url: null }] })
    const res = await call('GET', '/')
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      published: { ...VALID, accent: '#ffb020', backdrop_url: null, neutrals: 'tinted' },
      draft: null,
      identity: { published: { logo_url: '/uploads/logos/a.png', banner_url: null }, draft: { logo_url: '/uploads/logos/n.png' } },
    })
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
    expect(JSON.parse(params[1] as string)).toEqual({ ...VALID, accent: '#ffb020', backdrop_url: null, neutrals: 'tinted' })
    expect(params[2]).toBe('admin-uuid')
    expect(writtenKeys()).toEqual([SHELL_KEY_DRAFT])
  })

  it('DELETE /draft abandonne les DEUX brouillons, jamais la version publiée', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await call('DELETE', '/draft')
    expect(res.statusCode).toBe(200)
    expect(query.mock.calls[0][1]).toEqual([SHELL_KEY_DRAFT, IDENTITY_KEY_DRAFT])
  })

  it('DELETE /draft/identity ne retire QUE le brouillon d’identité', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await call('DELETE', '/draft/identity')
    expect(res.statusCode).toBe(200)
    expect(query.mock.calls[0][1]).toEqual([IDENTITY_KEY_DRAFT])
  })

  it('PUT /draft/identity refuse une adresse dangereuse, sans écrire', async () => {
    const res = await call('PUT', '/draft/identity', { logo_url: 'javascript:alert(1)' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('VALIDATION_ERROR')
    expect(query).not.toHaveBeenCalled()
  })

  it('PUT /draft/identity enregistre le brouillon d’identité (null = retirer)', async () => {
    query.mockResolvedValueOnce({ rows: [] })
    const res = await call('PUT', '/draft/identity', { logo_url: '/uploads/logos/n.png', banner_url: null })
    expect(res.statusCode).toBe(200)
    expect(query.mock.calls[0][1]).toEqual([IDENTITY_KEY_DRAFT, JSON.stringify({ logo_url: '/uploads/logos/n.png', banner_url: null }), 'admin-uuid'])
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

  // Requêtes exécutées DANS la transaction, sans BEGIN/COMMIT/ROLLBACK.
  const txSql = () => clientQuery.mock.calls.map(c => String(c[0])).filter(q => !/^(BEGIN|COMMIT|ROLLBACK)$/.test(q))
  const txOps = () => clientQuery.mock.calls.map(c => String(c[0])).filter(q => /^(BEGIN|COMMIT|ROLLBACK)$/.test(q))

  it('POST /publish : dans une transaction, retire le brouillon RELU et l’installe comme version publique', async () => {
    const raw = JSON.stringify({ ...VALID, accent: '#ffb020', backdrop_url: null })
    query.mockResolvedValueOnce({ rows: [{ key: SHELL_KEY_DRAFT, value: raw }] })
    clientQuery.mockImplementation(async (q: string) => /WITH d AS/.test(q) ? { rows: [{ value: raw }] } : { rows: [] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(200)
    expect(res.json().published.accent).toBe('#ffb020')
    const call1 = clientQuery.mock.calls.find(c => /WITH d AS/.test(String(c[0])))!
    expect(String(call1[0])).toMatch(/WITH d AS \(\s*DELETE FROM instance_settings WHERE key = \$1 AND value = \$2/)
    expect(call1[1]).toEqual([SHELL_KEY_DRAFT, raw, SHELL_KEY_PUBLISHED, 'admin-uuid'])
    expect(txOps()).toEqual(['BEGIN', 'COMMIT'])
    expect(release).toHaveBeenCalled()
    expect(logAction).toHaveBeenCalledWith('admin-uuid', 'publish_appearance', 'instance', null, null, expect.objectContaining({ ambiance: expect.objectContaining({ accent: '#ffb020' }) }))
  })

  it('POST /publish : brouillon réenregistré pendant la publication, tout est annulé (ROLLBACK, 409)', async () => {
    query.mockResolvedValueOnce({ rows: [{ key: SHELL_KEY_DRAFT, value: JSON.stringify(VALID) }] })
    clientQuery.mockResolvedValue({ rows: [] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('DRAFT_CHANGED')
    expect(txOps()).toEqual(['BEGIN', 'ROLLBACK'])
    expect(logAction).not.toHaveBeenCalled()
  })

  it('POST /publish : ambiance ET identité publiées ensemble, identité écrite dans communities', async () => {
    getCommunityId.mockResolvedValue('comm-1')
    const rawA = JSON.stringify(VALID), rawI = JSON.stringify({ banner_url: '/uploads/banners/b.jpg' })
    query.mockResolvedValueOnce({ rows: [{ key: SHELL_KEY_DRAFT, value: rawA }, { key: IDENTITY_KEY_DRAFT, value: rawI }] })
    clientQuery.mockImplementation(async (q: string) => /RETURNING/.test(q) ? { rows: [{ value: rawA, key: IDENTITY_KEY_DRAFT }] } : { rows: [] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(200)
    const upd = clientQuery.mock.calls.find(c => /UPDATE communities/.test(String(c[0])))!
    expect(String(upd[0])).toBe('UPDATE communities SET banner_url = $1 WHERE id = $2')
    expect(upd[1]).toEqual(['/uploads/banners/b.jpg', 'comm-1'])
    expect(txOps()).toEqual(['BEGIN', 'COMMIT'])
  })

  it('POST /publish : identité changée pendant la publication, l’AMBIANCE n’est pas publiée non plus', async () => {
    getCommunityId.mockResolvedValue('comm-1')
    const rawA = JSON.stringify(VALID), rawI = JSON.stringify({ logo_url: null })
    query.mockResolvedValueOnce({ rows: [{ key: SHELL_KEY_DRAFT, value: rawA }, { key: IDENTITY_KEY_DRAFT, value: rawI }] })
    clientQuery.mockImplementation(async (q: string) => /WITH d AS/.test(q) ? { rows: [{ value: rawA }] } : { rows: [] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(409)
    expect(txOps()).toEqual(['BEGIN', 'ROLLBACK'])
    expect(txSql().some(q => /UPDATE communities/.test(q))).toBe(false)
  })

  it('POST /publish : identité seule, sans ambiance en brouillon', async () => {
    getCommunityId.mockResolvedValue('comm-1')
    const rawI = JSON.stringify({ logo_url: '/uploads/logos/n.png' })
    query.mockResolvedValueOnce({ rows: [{ key: IDENTITY_KEY_DRAFT, value: rawI }] })
    clientQuery.mockImplementation(async (q: string) => /RETURNING key/.test(q) ? { rows: [{ key: IDENTITY_KEY_DRAFT }] } : { rows: [] })
    const res = await call('POST', '/publish')
    expect(res.statusCode).toBe(200)
    expect(txSql().some(q => /WITH d AS/.test(q))).toBe(false)
    expect(res.json()).toEqual({ published: null, identity: { logo_url: '/uploads/logos/n.png' } })
  })
})
