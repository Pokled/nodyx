import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

// Ce qu'on crée doit pouvoir se modifier ensuite : les tags (renommer,
// recolorer) et les annonces de la barre du haut (texte, couleur, expiration).

const { getMemberMock } = vi.hoisted(() => ({ getMemberMock: vi.fn() }))
vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn(), exists: vi.fn().mockResolvedValue(1), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), del: vi.fn(), set: vi.fn(), smembers: vi.fn().mockResolvedValue([]) },
}))
vi.mock('../socket/io', () => ({ io: null }))
vi.mock('../middleware/auth', () => ({
  requireAuth: vi.fn(async (req: any, reply: any) => {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    req.user = { userId: h.slice(7), username: 'u' }
  }),
  optionalAuth: vi.fn(async () => {}),
}))
vi.mock('../models/community', async (orig) => ({
  ...(await orig() as object),
  findBySlug: vi.fn().mockResolvedValue({ id: 'c1' }),
  getMember: getMemberMock,
}))
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (req: any, reply: any) => {
    const h = req.headers.authorization
    if (!h?.startsWith('Bearer ')) return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    if (h.includes('notadmin')) return reply.code(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
    req.user = { userId: 'admin-uuid', username: 'admin' }
  }),
}))

import { db } from '../config/database'
import instanceRoutes from '../routes/instance'
import adminRoutes from '../routes/admin'

const TAG = '11111111-1111-4111-8111-111111111111'
const ANN = '33333333-3333-4333-8333-333333333333'
type Call = { sql: string; params: unknown[] }
let calls: Call[] = []
let tagRow: Record<string, unknown> | null
let uniqueViolation = false

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODYX_COMMUNITY_SLUG = 'banc'
  calls = []
  uniqueViolation = false
  tagRow = { id: TAG, community_id: 'c1', name: 'Jeux', slug: 'jeux', color: '#6366f1' }
  getMemberMock.mockImplementation(async (_c: string, u: string) => ({ role: u === 'membre' ? 'member' : 'admin' }))
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ')
    calls.push({ sql: s, params })
    if (s.startsWith('UPDATE tags') || s.startsWith('INSERT INTO tags')) {
      if (uniqueViolation) throw Object.assign(new Error('duplicate key'), { code: '23505' })
      if (s.startsWith('UPDATE tags') && (!tagRow || params[0] !== TAG || params[1] !== 'c1')) return { rows: [] }
      return { rows: [{ ...tagRow }] }
    }
    if (s.startsWith('UPDATE system_announcements')) return { rows: [{ id: ANN, message: 'm', color: 'indigo', is_active: true, created_at: '', expires_at: null }] }
    if (s.startsWith('INSERT INTO system_announcements')) return { rows: [{ id: ANN, message: 'm', color: 'indigo', is_active: true, created_at: '', expires_at: null }] }
    return { rows: [], rowCount: 0 }
  }) as never)
})

describe('tags : modifier après la création', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(instanceRoutes, { prefix: '/i' })) })
  const patch = (who: string | null, payload: unknown, id = TAG) =>
    app.inject({ method: 'PATCH', url: `/i/tags/${id}`, headers: who ? { authorization: `Bearer ${who}` } : {}, payload: payload as object })
  const upd = () => calls.find((c) => c.sql.startsWith('UPDATE tags'))

  it('renommer : le nom ET le slug suivent, limité à la communauté', async () => {
    const res = await patch('admin', { name: '  Jeux vidéo  ' })
    expect(res.statusCode).toBe(200)
    expect(res.json().tag.id).toBe(TAG)
    const u = upd()!
    expect(u.sql).toContain('WHERE id = $1 AND community_id = $2')
    expect(u.params).toEqual([TAG, 'c1', 'Jeux vidéo', 'jeux-video'])
  })
  it('recolorer seulement : le nom ne bouge pas', async () => {
    expect((await patch('admin', { color: '#22C55E' })).statusCode).toBe(200)
    const u = upd()!
    expect(u.sql).not.toContain('name =')
    expect(u.params).toEqual([TAG, 'c1', '#22C55E'])
  })
  it('nom déjà pris : 409 avec un code, pas une erreur 500', async () => {
    uniqueViolation = true
    const res = await patch('admin', { name: 'Doublon' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('TAG_NAME_TAKEN')
  })
  it('couleur invalide ou trop longue : refusée avant la base', async () => {
    for (const color of ['red', '#12345', '#1234567', 'javascript:x', 42]) {
      const res = await patch('admin', { color })
      expect(res.statusCode).toBe(400)
      expect(res.json().code).toBe('TAG_BAD_COLOR')
    }
    expect(upd()).toBeUndefined()
  })
  it('nom vide, trop long, ou rien à changer : refusé', async () => {
    expect((await patch('admin', { name: '   ' })).json().code).toBe('BAD_REQUEST')
    expect((await patch('admin', { name: 'x'.repeat(51) })).json().code).toBe('TAG_NAME_TOO_LONG')
    expect((await patch('admin', {})).json().code).toBe('INVALID_REQUEST')
    expect(upd()).toBeUndefined()
  })
  it('tag inconnu : 404 ; identifiant malformé : 400', async () => {
    tagRow = null
    expect((await patch('admin', { name: 'X' })).statusCode).toBe(404)
    expect((await patch('admin', { name: 'X' }, 'pas-un-uuid')).statusCode).toBe(400)
  })
  it('un membre ne modifie pas les tags, un anonyme non plus', async () => {
    expect((await patch('membre', { name: 'X' })).statusCode).toBe(403)
    expect((await patch(null, { name: 'X' })).statusCode).toBe(401)
    expect(upd()).toBeUndefined()
  })
  it('la liste donne, pour chaque tag, le nombre de sujets qui le portent', async () => {
    const res = await app.inject({ method: 'GET', url: '/i/tags' })
    expect(res.statusCode).toBe(200)
    const q = calls.find((c) => c.sql.includes('FROM tags t WHERE t.community_id = $1'))!
    expect(q.sql).toContain('(SELECT COUNT(*)::int FROM thread_tags tt WHERE tt.tag_id = t.id) AS thread_count')
    expect(q.params).toEqual(['c1'])
  })
  it('création : un nom déjà pris donne 409, une couleur invalide 400', async () => {
    const post = (payload: object) => app.inject({ method: 'POST', url: '/i/tags', headers: { authorization: 'Bearer admin' }, payload })
    expect((await post({ name: 'Ok', color: '#abcdef' })).statusCode).toBe(201)
    expect((await post({ name: 'Ok', color: 'rouge-vif-tres-long' })).json().code).toBe('TAG_BAD_COLOR')
    uniqueViolation = true
    expect((await post({ name: 'Ok' })).json().code).toBe('TAG_NAME_TAKEN')
  })
})

describe('annonces : modifier après la création', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(adminRoutes, { prefix: '/a' })) })
  const patch = (payload: unknown, who = 'admin', id = ANN) =>
    app.inject({ method: 'PATCH', url: `/a/announcements/${id}`, headers: { authorization: `Bearer ${who}` }, payload: payload as object })
  const upd = () => calls.find((c) => c.sql.startsWith('UPDATE system_announcements'))

  it('texte, couleur et expiration en une fois', async () => {
    const res = await patch({ message: '  Maintenance ce soir  ', color: 'amber', expires_at: '2026-11-20T17:00:00.000Z' })
    expect(res.statusCode).toBe(200)
    const u = upd()!
    expect(u.sql).toContain('message = $1, color = $2, expires_at = $3')
    expect(u.params).toEqual(['Maintenance ce soir', 'amber', '2026-11-20T17:00:00.000Z', ANN])
  })
  it('expiration à null : l’annonce ne s’arrête plus', async () => {
    expect((await patch({ expires_at: null })).statusCode).toBe(200)
    expect(upd()!.params).toEqual([null, ANN])
  })
  it('une date avec fuseau est enregistrée à la bonne heure (UTC)', async () => {
    await patch({ expires_at: '2026-11-20T18:00:00+01:00' })
    expect(upd()!.params[0]).toBe('2026-11-20T17:00:00.000Z')
  })
  it('couleur hors liste, date illisible, texte vide : refusés avec un code', async () => {
    expect((await patch({ color: 'magenta-fluo-qui-deborde' })).json().code).toBe('ANNOUNCEMENT_BAD_COLOR')
    expect((await patch({ expires_at: 'demain' })).json().code).toBe('ANNOUNCEMENT_BAD_EXPIRY')
    expect((await patch({ message: '   ' })).json().code).toBe('ANNOUNCEMENT_MESSAGE_REQUIRED')
    expect((await patch({}, 'admin', 'pas-un-uuid')).statusCode).toBe(400)
    expect(upd()).toBeUndefined()
  })
  it('activer / désactiver marche toujours comme avant', async () => {
    expect((await patch({ is_active: false })).statusCode).toBe(200)
    expect(upd()!.params).toEqual([false, ANN])
  })
  it('création : une date illisible est refusée au lieu de faire tomber la base', async () => {
    const res = await app.inject({ method: 'POST', url: '/a/announcements', headers: { authorization: 'Bearer admin' }, payload: { message: 'x', expires_at: 'n’importe quoi' } })
    expect(res.json().code).toBe('ANNOUNCEMENT_BAD_EXPIRY')
  })
  it('un non-admin ne modifie pas une annonce', async () => {
    expect((await patch({ message: 'x' }, 'notadmin')).statusCode).toBe(403)
    expect(upd()).toBeUndefined()
  })
})
