import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// Droits réels de l'équipe (CDC SPECS/NODYX_MODERATION_CDC.md, E1).
// D1 : un grade AJOUTE des droits, il n'en retire jamais.
// D2 : le rôle modérateur est le socle (moderate_content + moderate_members).
// D4 : bannir n'est pas dans le socle du modérateur, un grade peut le donner.
// Garde-fous : jamais d'action sur un rang égal ou supérieur (sauf admin),
// jamais de grade qui accorde une permission qu'on n'a pas.

// ── Un petit monde : qui est qui dans la communauté c1 ────────────────────────

type Member = { role: string; permissions: Record<string, boolean> | null }
const world: Record<string, Member> = {}
const U = {
  owner:     '11111111-1111-4111-8111-111111111111',
  admin:     '22222222-2222-4222-8222-222222222222',
  mod:       '33333333-3333-4333-8333-333333333333',
  mod2:      '44444444-4444-4444-8444-444444444444',
  member:    '55555555-5555-4555-8555-555555555555',
  bannisseur:'66666666-6666-4666-8666-666666666666', // modérateur + grade ban_members
  gradeur:   '77777777-7777-4777-8777-777777777777', // membre + grade manage_grades
}
const { THREAD, POST, GRADE_BAN, GRADE_TITLE } = vi.hoisted(() => ({
  THREAD:      '550e8400-e29b-41d4-a716-446655440000',
  POST:        '650e8400-e29b-41d4-a716-446655440000',
  GRADE_BAN:   '88888888-8888-4888-8888-888888888888',
  GRADE_TITLE: '99999999-9999-4999-8999-999999999999',
}))

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get:    vi.fn().mockResolvedValue(null),
    setex:  vi.fn().mockResolvedValue('OK'),
    exists: vi.fn().mockResolvedValue(1),
    incr:   vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
  },
}))

vi.mock('../models/community', () => ({
  findBySlug: vi.fn().mockResolvedValue({ id: 'c1', slug: 'nodyx' }),
  findById:   vi.fn().mockResolvedValue({ id: 'c1', slug: 'nodyx' }),
  getMember:  vi.fn(),
  getMembers: vi.fn().mockResolvedValue([]),
  getCategories: vi.fn().mockResolvedValue([]),
  createCategory: vi.fn().mockResolvedValue({ id: 'cat' }),
}))

vi.mock('../models/grade', () => ({
  listByCommunity: vi.fn().mockResolvedValue([]),
  findById: vi.fn(async (id: string) => id === GRADE_BAN
    ? { id, community_id: 'c1', permissions: { ban_members: true } }
    : id === GRADE_TITLE ? { id, community_id: 'c1', permissions: {} } : null),
  create: vi.fn().mockResolvedValue({ id: 'new-grade' }),
  update: vi.fn().mockResolvedValue({ id: 'g' }),
  remove: vi.fn().mockResolvedValue(true),
  assignToMember: vi.fn().mockResolvedValue({ found: true, gradeValid: true }),
}))

vi.mock('../models/thread', () => ({
  findById: vi.fn(), update: vi.fn().mockResolvedValue({ id: THREAD }), remove: vi.fn(),
  create: vi.fn(), incrementViews: vi.fn(),
}))
vi.mock('../models/post', () => ({
  getAuthorAndThread: vi.fn(), removeById: vi.fn(), updateContent: vi.fn(),
  create: vi.fn(), listByThread: vi.fn(),
}))
vi.mock('../models/reputation', () => ({ awardPoints: vi.fn(), REPUTATION: { THREAD: 10, REPLY: 2 } }))
vi.mock('../models/tag', () => ({ setThreadTags: vi.fn(), getTagsForThread: vi.fn().mockResolvedValue([]), getTagsForThreads: vi.fn() }))
vi.mock('../socket/io', () => ({ io: null }))

import { db, redis } from '../config/database'
import * as ThreadModel from '../models/thread'
import * as PostModel from '../models/post'
import * as GradeModel from '../models/grade'
import { effectivePermissions, invalidatePermissions, GRADE_PERMISSIONS, getAccess } from '../services/permissions'
import { requirePermission } from '../middleware/permissions'
import forumRoutes from '../routes/forums'
import communityRoutes from '../routes/communities'

function routeDb() {
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql)
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }], rowCount: 1 }
    if (s.includes('FROM threads t JOIN categories')) return { rows: [{ community_id: 'c1' }], rowCount: 1 }
    // getAccess et la cible d'une attribution de grade : (community_id, user_id)
    if (s.includes('FROM community_members cm') && s.includes('community_grades cg')) {
      const m = world[String(params[1])]
      return { rows: m ? [m] : [], rowCount: m ? 1 : 0 }
    }
    return { rows: [], rowCount: 0 }
  }) as never)
}

const token = (userId: string) => `Bearer ${jwt.sign({ userId, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redis.get).mockResolvedValue(null)
  // Session vivante, personne n'est banni (clé banned:<id> absente)
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  Object.assign(world, {
    [U.owner]:      { role: 'owner', permissions: null },
    [U.admin]:      { role: 'admin', permissions: null },
    [U.mod]:        { role: 'moderator', permissions: null },
    [U.mod2]:       { role: 'moderator', permissions: null },
    [U.member]:     { role: 'member', permissions: null },
    [U.bannisseur]: { role: 'moderator', permissions: { ban_members: true } },
    [U.gradeur]:    { role: 'member', permissions: { manage_grades: true } },
  })
  routeDb()
})

// ── Le calcul ─────────────────────────────────────────────────────────────────

describe('effectivePermissions : socle du rôle + grade', () => {
  it('membre sans grade : aucune permission d’équipe', () => {
    expect(effectivePermissions('member', null)).toEqual([])
  })
  it('modérateur : modérer les contenus et les membres, pas bannir (D2, D4)', () => {
    expect(effectivePermissions('moderator', null)).toEqual(['moderate_content', 'moderate_members'])
  })
  it('admin et propriétaire : tout', () => {
    expect(effectivePermissions('admin', null)).toEqual([...GRADE_PERMISSIONS])
    expect(effectivePermissions('owner', null)).toEqual([...GRADE_PERMISSIONS])
  })
  it('un grade AJOUTE (D1)', () => {
    expect(effectivePermissions('moderator', { ban_members: true })).toEqual(['moderate_content', 'moderate_members', 'ban_members'])
  })
  it('un grade ne RETIRE jamais (D1)', () => {
    expect(effectivePermissions('moderator', { moderate_content: false, moderate_members: false })).toEqual(['moderate_content', 'moderate_members'])
  })
  it('ignore les clés inconnues et les anciennes clés can_*', () => {
    expect(effectivePermissions('member', { can_moderate: true, hack: true, ban_members: 'yes' as never })).toEqual([])
  })
  it('un non-membre n’hérite de rien, même avec des permissions', () => {
    expect(effectivePermissions(null, { ban_members: true })).toEqual([])
  })
})

describe('cache et invalidation', () => {
  it('lit le cache Redis s’il existe, sans toucher la base', async () => {
    vi.mocked(redis.get).mockImplementation((async (k: string) =>
      k.startsWith('perms:ver:') ? '4' : JSON.stringify({ role: 'moderator', rank: 1, permissions: ['moderate_content'] })) as never)
    const a = await getAccess('c1', U.member)
    expect(a.permissions).toEqual(['moderate_content'])
    expect(db.query).not.toHaveBeenCalled()
    expect(vi.mocked(redis.get).mock.calls[1][0]).toBe(`perms:c1:4:${U.member}`)
  })
  it('invalider = incrémenter la version de la communauté', async () => {
    await invalidatePermissions('c1')
    expect(redis.incr).toHaveBeenCalledWith('perms:ver:c1')
  })
})

// ── Le garde des routes de l'équipe ───────────────────────────────────────────

describe('requirePermission', () => {
  async function app(permission: 'ban_members' | 'moderate_content') {
    const a = Fastify({ logger: false })
    a.get('/x', { preHandler: [requirePermission(permission)] }, async (req) => ({ ok: true, perms: req.access?.permissions }))
    await a.ready()
    return a
  }
  it('401 sans jeton', async () => {
    const res = await (await app('moderate_content')).inject({ method: 'GET', url: '/x' })
    expect(res.statusCode).toBe(401)
  })
  it('401 si la session est morte', async () => {
    vi.mocked(redis.exists).mockResolvedValue(0 as never)
    const res = await (await app('moderate_content')).inject({ method: 'GET', url: '/x', headers: { authorization: token(U.admin) } })
    expect(res.statusCode).toBe(401)
  })
  it('403 pour un membre', async () => {
    const res = await (await app('moderate_content')).inject({ method: 'GET', url: '/x', headers: { authorization: token(U.member) } })
    expect(res.statusCode).toBe(403)
  })
  it('le modérateur passe sur moderate_content', async () => {
    const res = await (await app('moderate_content')).inject({ method: 'GET', url: '/x', headers: { authorization: token(U.mod) } })
    expect(res.statusCode).toBe(200)
  })
  it('le modérateur est refusé sur ban_members (D4)', async () => {
    const res = await (await app('ban_members')).inject({ method: 'GET', url: '/x', headers: { authorization: token(U.mod) } })
    expect(res.statusCode).toBe(403)
  })
  it('un modérateur avec le grade ban_members passe (D1 + D4)', async () => {
    const res = await (await app('ban_members')).inject({ method: 'GET', url: '/x', headers: { authorization: token(U.bannisseur) } })
    expect(res.statusCode).toBe(200)
  })
})

// ── Le forum ──────────────────────────────────────────────────────────────────

describe('forum : moderate_content', () => {
  let a: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { a = await buildApp(x => x.register(forumRoutes, { prefix: '/f' })) })

  const pin = (who: string) => a.inject({ method: 'PATCH', url: `/f/threads/${THREAD}`, headers: { authorization: token(who) }, payload: { is_pinned: true } })

  it('un modérateur peut ÉPINGLER (réservé aux admins avant)', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: U.member } as never)
    expect((await pin(U.mod)).statusCode).toBe(200)
  })
  it('un membre ne peut pas épingler le fil d’un autre', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: U.mod } as never)
    expect((await pin(U.member)).statusCode).toBe(403)
  })
  it('un modérateur ne touche pas au fil d’un admin (rang)', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: U.admin } as never)
    expect((await pin(U.mod)).statusCode).toBe(403)
  })
  it('ni à celui d’un autre modérateur (rang égal)', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: U.mod2 } as never)
    expect((await pin(U.mod)).statusCode).toBe(403)
  })
  it('un admin peut agir sur le fil d’un autre admin', async () => {
    vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: U.admin } as never)
    const other = '23232323-2323-4323-8323-232323232323'
    world[other] = { role: 'admin', permissions: null }
    expect((await pin(other)).statusCode).toBe(200)
  })

  const del = (who: string) => a.inject({ method: 'DELETE', url: `/f/posts/${POST}`, headers: { authorization: token(who) } })
  it('un modérateur supprime le message d’un membre', async () => {
    vi.mocked(PostModel.getAuthorAndThread).mockResolvedValue({ author_id: U.member, thread_id: THREAD } as never)
    expect((await del(U.mod)).statusCode).toBe(204)
    expect(PostModel.removeById).toHaveBeenCalledWith(POST)
  })
  it('un membre ne supprime pas le message d’un autre', async () => {
    vi.mocked(PostModel.getAuthorAndThread).mockResolvedValue({ author_id: U.mod, thread_id: THREAD } as never)
    expect((await del(U.member)).statusCode).toBe(403)
    expect(PostModel.removeById).not.toHaveBeenCalled()
  })
  it('l’auteur supprime toujours son propre message', async () => {
    vi.mocked(PostModel.getAuthorAndThread).mockResolvedValue({ author_id: U.member, thread_id: THREAD } as never)
    expect((await del(U.member)).statusCode).toBe(204)
  })
})

// ── Les grades ────────────────────────────────────────────────────────────────

describe('grades : manage_grades et anti-escalade', () => {
  let a: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { a = await buildApp(x => x.register(communityRoutes, { prefix: '/c' })) })

  const create = (who: string, permissions: Record<string, boolean>) =>
    a.inject({ method: 'POST', url: '/c/nodyx/grades', headers: { authorization: token(who) }, payload: { name: 'G', permissions } })
  const assign = (who: string, target: string, grade_id: string | null) =>
    a.inject({ method: 'PATCH', url: `/c/nodyx/members/${target}/grade`, headers: { authorization: token(who) }, payload: { grade_id } })

  it('un modérateur sans manage_grades ne crée pas de grade', async () => {
    expect((await create(U.mod, {})).statusCode).toBe(403)
  })
  it('un membre avec le grade manage_grades crée un grade titre', async () => {
    expect((await create(U.gradeur, {})).statusCode).toBe(201)
  })
  it('mais pas un grade qui donne un droit qu’il n’a pas (escalade)', async () => {
    const res = await create(U.gradeur, { ban_members: true })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('GRADE_ESCALATION')
    expect(GradeModel.create).not.toHaveBeenCalled()
  })
  it('un admin crée n’importe quel grade', async () => {
    expect((await create(U.admin, { ban_members: true, manage_octoguard: true })).statusCode).toBe(201)
  })
  it('attribuer invalide les droits de la communauté', async () => {
    expect((await assign(U.admin, U.member, GRADE_TITLE)).statusCode).toBe(200)
    expect(redis.incr).toHaveBeenCalledWith('perms:ver:c1')
  })
  it('on ne donne pas un grade plus puissant que soi', async () => {
    const res = await assign(U.gradeur, U.member, GRADE_BAN)
    expect(res.statusCode).toBe(403)
    expect(GradeModel.assignToMember).not.toHaveBeenCalled()
  })
  it('sous le rang d’admin, on ne touche pas au grade d’un rang égal ou supérieur', async () => {
    world[U.mod] = { role: 'moderator', permissions: { manage_grades: true } }
    const res = await assign(U.mod, U.mod2, GRADE_TITLE)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('RANK_TOO_LOW')
  })
  it('on peut se donner un grade titre à soi-même', async () => {
    expect((await assign(U.gradeur, U.gradeur, GRADE_TITLE)).statusCode).toBe(200)
  })
})
