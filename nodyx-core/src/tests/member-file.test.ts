import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// La fiche membre (CDC SPECS/NODYX_MODERATION_CDC.md, E3) : la frise, les
// notes (D5), l'avertissement, et la sourdine qui s'applique enfin.

const { U, THREAD } = vi.hoisted(() => ({
  U: {
    admin:  '22222222-2222-4222-8222-222222222222',
    mod:    '33333333-3333-4333-8333-333333333333',
    mod2:   '44444444-4444-4444-8444-444444444444',
    member: '55555555-5555-4555-8555-555555555555',
    owner:  '11111111-1111-4111-8111-111111111111',
  },
  THREAD: '550e8400-e29b-41d4-a716-446655440000',
}))

type Member = { role: string; permissions: Record<string, boolean> | null }
const world: Record<string, Member> = {}
const calls: Array<{ sql: string; params: unknown[] }> = []
let fileRows: Record<string, unknown[]> = {}

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), set: vi.fn(), del: vi.fn(), smembers: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('../models/notification', () => ({ create: vi.fn().mockResolvedValue({}), getUnreadCount: vi.fn().mockResolvedValue(1) }))
vi.mock('../models/channel', () => ({ list: vi.fn().mockResolvedValue([]), create: vi.fn(), remove: vi.fn(), reorder: vi.fn() }))
vi.mock('../socket/io', () => ({ io: null }))
vi.mock('../services/octoguard', () => ({ isUserMuted: vi.fn().mockResolvedValue({ muted: false }) }))
vi.mock('../models/thread', () => ({ findById: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), incrementViews: vi.fn() }))
vi.mock('../models/post', () => ({ create: vi.fn(), getAuthorAndThread: vi.fn(), listByThread: vi.fn() }))
vi.mock('../models/reputation', () => ({ awardPoints: vi.fn(), REPUTATION: { THREAD: 10, REPLY: 2 } }))

import { db, redis } from '../config/database'
import * as NotificationModel from '../models/notification'
import * as ThreadModel from '../models/thread'
import * as PostModel from '../models/post'
import { isUserMuted } from '../services/octoguard'
import { buildMemberFile } from '../services/memberFile'
import adminRoutes from '../routes/admin'
import forumRoutes from '../routes/forums'

function routeDb() {
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }], rowCount: 1 }
    if (s.includes('FROM community_members cm') && s.includes('community_grades cg ON cg.id = cm.grade_id AND')) {
      const m = world[String(params[1])]
      return { rows: m ? [m] : [], rowCount: m ? 1 : 0 }
    }
    if (s.startsWith('SELECT cm.role, u.username FROM users u')) {
      const m = world[String(params[1])]
      return { rows: m ? [{ role: m.role, username: 'cible' }] : [], rowCount: m ? 1 : 0 }
    }
    if (s.startsWith('INSERT INTO octoguard_warns')) return { rows: [{ id: 'w1', created_at: 'now' }], rowCount: 1 }
    if (s.startsWith('INSERT INTO member_notes')) return { rows: [{ id: 'n1', created_at: 'now' }], rowCount: 1 }
    if (s.startsWith('DELETE FROM member_notes')) return { rows: [], rowCount: 1 }
    for (const [needle, rows] of Object.entries(fileRows)) if (s.includes(needle)) return { rows, rowCount: rows.length }
    return { rows: [], rowCount: 0 }
  }) as never)
}

const token = (userId: string) => `Bearer ${jwt.sign({ userId, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  fileRows = {}
  vi.mocked(redis.get).mockResolvedValue(null)
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  vi.mocked(isUserMuted).mockResolvedValue({ muted: false } as never)
  Object.assign(world, {
    [U.owner]: { role: 'owner', permissions: null },
    [U.admin]: { role: 'admin', permissions: null },
    [U.mod]: { role: 'moderator', permissions: null },
    [U.mod2]: { role: 'moderator', permissions: null },
    [U.member]: { role: 'member', permissions: null },
  })
  routeDb()
})

describe('buildMemberFile : une seule frise', () => {
  it('mêle avertissements, journal, signalements et notes, du plus récent au plus ancien', async () => {
    fileRows = {
      'FROM users u LEFT JOIN community_members cm': [{ id: U.member, username: 'lisa', avatar: null, created_at: '2026-01-01', role: 'member', joined_at: '2026-01-02', grade_name: null, grade_color: null, threads: 2, posts: 9, messages: 40 }],
      'FROM community_bans b': [],
      'FROM chat_mutes cm': [{ id: 'm1', channel_id: null, channel_name: null, reason: 'calme-toi', expires_at: '2026-11-03', by: 'mod' }],
      'FROM octoguard_warns w': [{ id: 'w1', reason: 'insulte', cleared_at: null, at: '2026-11-02T10:00', by: 'mod', rule_name: null }],
      'FROM admin_audit_log': [{ id: 7, action: 'voice_kick', actor_username: 'mod', metadata: {}, at: '2026-11-02T12:00' }],
      'FROM reports r WHERE r.target_author_id': [{ id: 'r1', target_type: 'post', category: 'harassment', reason: '', status: 'open', snapshot: 'texte', target_link: '/forum/x', at: '2026-11-02T08:00' }],
      'FROM member_notes n': [{ id: 'n1', body: 'à surveiller', at: '2026-11-02T11:00', by: 'admin', author_id: U.admin }],
    }
    const f = await buildMemberFile('c1', U.member)
    expect(f!.timeline.map(i => i.kind)).toEqual(['audit', 'note', 'warn', 'report'])
    expect(f!.status).toMatchObject({ banned: null, warns_active: 1, reports_open: 1 })
    expect(f!.status.mutes).toHaveLength(1)
    expect(f!.member).toMatchObject({ username: 'lisa', posts: 9, messages: 40 })
  })
  it('ne compte pas un avertissement deux fois (table + journal)', async () => {
    fileRows = { 'FROM users u LEFT JOIN community_members cm': [{ id: U.member, username: 'lisa' }] }
    await buildMemberFile('c1', U.member)
    const auditSql = calls.find(c => c.sql.includes('FROM admin_audit_log'))!.sql
    expect(auditSql).toContain("action NOT IN ('warn_user', 'octoguard.warn_user')")
  })
  it('un compte inexistant ou système : pas de fiche', async () => {
    expect(await buildMemberFile('c1', U.member)).toBeNull()
  })
})

describe('routes de la fiche', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(adminRoutes, { prefix: '/a' })) })

  const warn = (who: string, target: string, reason = 'Propos insultants envers Tom') =>
    app.inject({ method: 'POST', url: `/a/members/${target}/warn`, headers: { authorization: token(who) }, payload: { reason } })

  it('un membre n’ouvre pas la fiche d’un autre', async () => {
    const res = await app.inject({ method: 'GET', url: `/a/members/${U.mod}/file`, headers: { authorization: token(U.member) } })
    expect(res.statusCode).toBe(403)
  })
  it('un modérateur avertit un membre : avertissement enregistré, membre notifié avec le motif', async () => {
    const res = await warn(U.mod, U.member)
    expect(res.statusCode).toBe(201)
    const ins = calls.find(c => c.sql.startsWith('INSERT INTO octoguard_warns'))!
    expect(ins.params).toEqual([U.member, 'Propos insultants envers Tom', U.mod])
    expect(NotificationModel.create).toHaveBeenCalledWith({ user_id: U.member, type: 'moderation_warning', meta: { reason: 'Propos insultants envers Tom', warn_id: 'w1' } })   // warn_id : « Contester » (lot 8)
  })
  it('un modérateur n’avertit pas un autre modérateur (rang)', async () => {
    const res = await warn(U.mod, U.mod2)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('RANK_TOO_LOW')
  })
  it('personne n’avertit le propriétaire, ni soi-même', async () => {
    expect((await warn(U.admin, U.owner)).statusCode).toBe(403)
    expect((await warn(U.admin, U.admin)).statusCode).toBe(403)
  })
  it('un motif trop court est refusé', async () => {
    expect((await warn(U.mod, U.member, 'x')).statusCode).toBe(400)
  })
  it('écrire une note : elle porte son auteur', async () => {
    const res = await app.inject({ method: 'POST', url: `/a/members/${U.member}/notes`, headers: { authorization: token(U.mod) }, payload: { body: 'Déjà averti en privé' } })
    expect(res.statusCode).toBe(201)
    expect(calls.find(c => c.sql.startsWith('INSERT INTO member_notes'))!.params).toEqual(['c1', U.member, U.mod, 'Déjà averti en privé'])
  })
  it('supprimer une note : un modérateur seulement les siennes, un admin toutes', async () => {
    const del = (who: string) => app.inject({ method: 'DELETE', url: `/a/members/${U.member}/notes/0e7c2a3c-1b2d-4e5f-8a9b-0c1d2e3f4a5b`, headers: { authorization: token(who) } })
    await del(U.mod)
    expect(calls.filter(c => c.sql.startsWith('DELETE FROM member_notes')).at(-1)!.params.slice(3)).toEqual([false, U.mod])
    await del(U.admin)
    expect(calls.filter(c => c.sql.startsWith('DELETE FROM member_notes')).at(-1)!.params[3]).toBe(true)
  })
})

describe('la sourdine s’applique enfin, au forum aussi', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => {
    app = await buildApp(a => a.register(forumRoutes, { prefix: '/f' }))
    vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: U.admin, is_locked: false, category_id: 'cat' } as never)
    vi.mocked(PostModel.create).mockResolvedValue({ id: 'p1' } as never)
  })
  const reply = () => app.inject({ method: 'POST', url: '/f/posts', headers: { authorization: token(U.member) }, payload: { thread_id: THREAD, content: '<p>bonjour</p>' } })

  it('une sourdine globale bloque la réponse au forum', async () => {
    vi.mocked(isUserMuted).mockResolvedValue({ muted: true, channel_id: null, expires_at: '2026-11-03T10:00:00Z' } as never)
    const res = await reply()
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: 'MUTED', expires_at: '2026-11-03T10:00:00Z' })
    expect(PostModel.create).not.toHaveBeenCalled()
  })
  it('une sourdine limitée à un salon du chat ne bloque pas le forum', async () => {
    vi.mocked(isUserMuted).mockResolvedValue({ muted: true, channel_id: 'chan-1', expires_at: null } as never)
    expect((await reply()).statusCode).toBe(201)
  })
})

describe('journal : une sourdine posée à la main porte le nom de son auteur', () => {
  it('logOctoGuardAction transmet actor_id, le journal résout le pseudo', async () => {
    const { logOctoGuardAction } = await import('../services/octoguard/logger')
    logOctoGuardAction({
      action: 'octoguard.mute_user', target_type: 'user', target_id: U.member, target_label: null,
      actor_id: U.mod, metadata: { event_id: 'e1', actor: 'admin' },
    })
    await new Promise(r => setTimeout(r, 20))
    const ins = calls.find(c => c.sql.startsWith('INSERT INTO admin_audit_log'))!
    expect(ins.sql).toContain('COALESCE((SELECT username FROM users WHERE id = $7::uuid), $1)')
    expect(ins.params[0]).toBe('octoguard:auto')
    expect(ins.params[6]).toBe(U.mod)
  })
  it('sans auteur humain, l’action reste à OctoGuard', async () => {
    const { logOctoGuardAction } = await import('../services/octoguard/logger')
    logOctoGuardAction({ action: 'octoguard.delete_message', target_type: 'message', target_id: 'x', target_label: null, metadata: { event_id: 'e2', actor: 'octoguard:auto' } })
    await new Promise(r => setTimeout(r, 20))
    expect(calls.find(c => c.sql.startsWith('INSERT INTO admin_audit_log'))!.params[6]).toBeNull()
  })
})
