import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// OctoGuard 2 côté routes : le forum refuse ce qu'OctoGuard retient et ouvre
// un dossier au cran « signaler » ; l'API des règles connaît les endroits
// surveillés et refuse une expression régulière sans re2.

const { moderateMock, autoReportMock, re2, calls, THREAD, undo } = vi.hoisted(() => ({
  undo: { log: null as null | Record<string, unknown>, alreadyUndone: false, warnsCleared: 1 },
  moderateMock: vi.fn(),
  autoReportMock: vi.fn(),
  re2: { on: false },
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  THREAD: '550e8400-e29b-41d4-a716-446655440000',
}))

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
}))
vi.mock('../services/octoguard/moderate', async (orig) => ({
  textForModeration: ((await orig()) as { textForModeration: (h: string) => string }).textForModeration,
  moderateText: moderateMock,
  blockedBody: (v: { reason: string; i18n_key: string }) => ({ error: v.reason, code: 'OCTOGUARD_BLOCKED', i18n_key: v.i18n_key }),
  heldBody: (h: { id: string }) => ({ held: true, held_id: h.id, code: 'OCTOGUARD_HELD' }),
}))
vi.mock('../services/octoguard/autoReport', () => ({ fileAutoReport: autoReportMock }))
vi.mock('../services/octoguard', () => ({
  isUserMuted: vi.fn().mockResolvedValue({ muted: false }),
  hasRE2: () => re2.on,
  reloadRules: vi.fn(), assessPatternSafety: vi.fn(() => ({ valid: true })),
  applyMute: vi.fn(), removeMute: vi.fn(), getWebhookConfig: vi.fn(), setWebhookConfig: vi.fn(), invalidateWebhookConfig: vi.fn(),
}))
vi.mock('../models/thread', () => ({ findById: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn(), incrementViews: vi.fn() }))
vi.mock('../models/post', () => ({ create: vi.fn(), getAuthorAndThread: vi.fn(), listByThread: vi.fn(), updateContent: vi.fn() }))
vi.mock('../models/reputation', () => ({ awardPoints: vi.fn(), REPUTATION: { THREAD: 10, REPLY: 2 } }))
vi.mock('../socket/io', () => ({ io: null }))

import { db, redis } from '../config/database'
import * as ThreadModel from '../models/thread'
import * as PostModel from '../models/post'
import forumRoutes from '../routes/forums'
import { octoguardAdminPlugin } from '../routes/octoguard'

const ADMIN = '22222222-2222-4222-8222-222222222222'
const MEMBER = '55555555-5555-4555-8555-555555555555'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks()
  calls.length = 0
  re2.on = false
  undo.log = null; undo.alreadyUndone = false; undo.warnsCleared = 1
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }], rowCount: 1 }
    if (s.includes('community_grades cg ON cg.id = cm.grade_id AND')) {
      return { rows: [{ role: params[1] === ADMIN ? 'admin' : 'member', permissions: null }], rowCount: 1 }
    }
    if (s.startsWith('INSERT INTO octoguard_automod_rules')) return { rows: [{ id: 'r1', name: 'x' }], rowCount: 1 }
    if (s.startsWith('SELECT type, enabled FROM octoguard_automod_rules')) return { rows: [{ type: 'regex', enabled: false }], rowCount: 1 }
    if (s.startsWith('SELECT type, params FROM octoguard_automod_rules')) return { rows: [{ type: 'link_spam', params: { max_links: 3 } }], rowCount: 1 }
    if (s.startsWith('UPDATE octoguard_automod_rules')) return { rows: [{ id: 'r1', name: 'x' }], rowCount: 1 }
    if (s.startsWith('SELECT action, metadata, created_at FROM admin_audit_log')) return { rows: undo.log ? [undo.log] : [], rowCount: undo.log ? 1 : 0 }
    if (s.startsWith("SELECT 1 FROM admin_audit_log WHERE action = 'octoguard.action_undone'")) return { rows: undo.alreadyUndone ? [{}] : [], rowCount: 0 }
    if (s.startsWith('UPDATE octoguard_warns')) return { rows: Array.from({ length: undo.warnsCleared }, () => ({ id: 'w1' })), rowCount: undo.warnsCleared }
    return { rows: [], rowCount: 0 }
  }) as never)
  vi.mocked(ThreadModel.findById).mockResolvedValue({ id: THREAD, author_id: ADMIN, is_locked: false, category_id: 'cat' } as never)
  vi.mocked(PostModel.create).mockResolvedValue({ id: 'p-new' } as never)
})

describe('forum', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(forumRoutes, { prefix: '/f' })) })
  const reply = () => app.inject({ method: 'POST', url: '/f/posts', headers: { authorization: token(MEMBER) }, payload: { thread_id: THREAD, content: '<p>texte</p>' } })

  it('un message retenu par OctoGuard est refusé (422) et rien n’est enregistré', async () => {
    moderateMock.mockResolvedValue({ blocked: true, reason: 'règle "Liens"', i18n_key: 'octoguard.message.deleted' })
    const res = await reply()
    expect(res.statusCode).toBe(422)
    expect(res.json()).toMatchObject({ code: 'OCTOGUARD_BLOCKED', i18n_key: 'octoguard.message.deleted' })
    expect(PostModel.create).not.toHaveBeenCalled()
  })
  it('au cran « signaler », le message passe et un dossier s’ouvre sur CE message', async () => {
    moderateMock.mockResolvedValue({ blocked: false, report: { rule_name: 'Liens', excerpt: 'https://a' } })
    expect((await reply()).statusCode).toBe(201)
    expect(autoReportMock).toHaveBeenCalledWith({ targetType: 'post', targetId: 'p-new', ruleName: 'Liens', excerpt: 'https://a' })
  })
  it('le texte examiné est le texte brut, sans balises', async () => {
    moderateMock.mockResolvedValue({ blocked: false })
    await reply()
    expect(moderateMock).toHaveBeenCalledWith(MEMBER, 'forum', ['texte'])
  })
})

describe('API des règles', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/api/v1/admin/octoguard' })) })
  const create = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/admin/octoguard/rules', headers: { authorization: token(ADMIN) }, payload })

  it('sans re2, une règle à expression régulière ne s’active pas (409)', async () => {
    const res = await create({ name: 'r', type: 'regex', params: { pattern: 'abc' }, action: 'delete' })
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('RE2_REQUIRED')
  })
  it('elle peut être créée désactivée, et s’active avec re2', async () => {
    expect((await create({ name: 'r', type: 'regex', params: { pattern: 'abc' }, action: 'delete', enabled: false })).statusCode).toBe(201)
    re2.on = true
    expect((await create({ name: 'r', type: 'regex', params: { pattern: 'abc' }, action: 'delete' })).statusCode).toBe(201)
  })
  it('les endroits surveillés sont enregistrés', async () => {
    re2.on = true
    await create({ name: 'Liens', type: 'link_spam', params: { max_links: 2 }, action: 'report_only', scopes: ['chat', 'forum'] })
    expect(calls.find(c => c.sql.startsWith('INSERT INTO octoguard_automod_rules'))!.params.at(-2)).toEqual(['chat', 'forum'])
  })
  it('un endroit inconnu est refusé', async () => {
    expect((await create({ name: 'x', type: 'caps', params: {}, action: 'delete', scopes: ['partout'] })).statusCode).toBe(400)
  })
  it('modifier le fond d’une règle issue d’un modèle la marque « personnalisée »', async () => {
    re2.on = true
    await app.inject({ method: 'PUT', url: '/api/v1/admin/octoguard/rules/r1', headers: { authorization: token(ADMIN) }, payload: { params: { max_links: 5 } } })
    expect(calls.find(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))!.sql).toContain('customized = (preset_key IS NOT NULL)')
  })
  it('un réglage absurde est refusé à la création (400 INVALID_PARAMS), rien n’est écrit', async () => {
    const res = await create({ name: 'Inondation', type: 'flood', params: { max_repeats: 1 }, action: 'warn' })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'INVALID_PARAMS', field: 'max_repeats' })
    expect(calls.some(c => c.sql.startsWith('INSERT INTO octoguard_automod_rules'))).toBe(false)
  })
  it('un réglage absurde est refusé à la modification, contre le type réel de la règle', async () => {
    const put = (payload: Record<string, unknown>) =>
      app.inject({ method: 'PUT', url: '/api/v1/admin/octoguard/rules/r1', headers: { authorization: token(ADMIN) }, payload })
    const res = await put({ params: { max_links: -1 } })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ code: 'INVALID_PARAMS', field: 'max_links' })
    expect(calls.some(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))).toBe(false)
    expect((await put({ params: { max_links: 4 } })).statusCode).toBe(200)
  })
  it('un site avec chemin est accepté, un site mal formé refusé', async () => {
    expect((await create({ name: 'i', type: 'link_domain', params: { mode: 'blacklist', domains: ['discord.com/invite', '*.t.me'] }, action: 'report_only' })).statusCode).toBe(201)
    expect((await create({ name: 'i', type: 'link_domain', params: { mode: 'blacklist', domains: ['pas un site'] }, action: 'report_only' })).json().code).toBe('INVALID_PARAMS')
  })
  it('basculer l’interrupteur seul ne la marque pas', async () => {
    re2.on = true
    await app.inject({ method: 'PUT', url: '/api/v1/admin/octoguard/rules/r1', headers: { authorization: token(ADMIN) }, payload: { enabled: true } })
    expect(calls.find(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))!.sql).not.toContain('customized')
  })
})

describe('Annuler une action d’OctoGuard', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/api/v1/admin/octoguard' })) })
  const undoIt = () => app.inject({ method: 'POST', url: '/api/v1/admin/octoguard/logs/l1/undo', headers: { authorization: token(ADMIN) } })
  const WARN_LOG = { action: 'octoguard.warn_user', created_at: '2026-11-03T20:00:00Z',
    metadata: { undoable: true, rule_id: '33333333-3333-4333-8333-333333333333', undo_op: { type: 'clear_last_warn', user_id: MEMBER } } }

  it('un avertissement s’annule pour de vrai : UPDATE valide pour PostgreSQL, ciblé sur la règle et le moment', async () => {
    undo.log = WARN_LOG
    const res = await undoIt()
    expect(res.statusCode).toBe(200)
    const upd = calls.find(c => c.sql.startsWith('UPDATE octoguard_warns'))!
    // L'ancienne requête mettait ORDER BY / LIMIT au niveau de l'UPDATE : refusée par PostgreSQL.
    expect(upd.sql).toMatch(/^UPDATE octoguard_warns SET cleared_at = NOW\(\) WHERE id = \(SELECT id FROM octoguard_warns/)
    expect(upd.params).toEqual([MEMBER, WARN_LOG.metadata.rule_id, WARN_LOG.created_at])
    expect(calls.some(c => c.sql.startsWith('INSERT INTO admin_audit_log') && c.params.includes('octoguard.action_undone'))).toBe(true)
  })
  it('plus rien à annuler : 409 honnête, et rien n’est journalisé comme annulé', async () => {
    undo.log = WARN_LOG; undo.warnsCleared = 0
    const res = await undoIt()
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('NOTHING_TO_UNDO')
    expect(calls.some(c => c.params.includes('octoguard.action_undone'))).toBe(false)
  })
  it('une action ne s’annule qu’une fois (un double clic n’efface pas un 2e avertissement)', async () => {
    undo.log = WARN_LOG; undo.alreadyUndone = true
    const res = await undoIt()
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('ALREADY_UNDONE')
    expect(calls.some(c => c.sql.startsWith('UPDATE octoguard_warns'))).toBe(false)
  })
  it('une action non annulable est refusée', async () => {
    undo.log = { action: 'octoguard.delete_message', created_at: 'x', metadata: { undoable: false } }
    expect((await undoIt()).json().code).toBe('NOT_UNDOABLE')
  })
})
