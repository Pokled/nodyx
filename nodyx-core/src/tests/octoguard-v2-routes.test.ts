import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// OctoGuard 2 côté routes : le forum refuse ce qu'OctoGuard retient et ouvre
// un dossier au cran « signaler » ; l'API des règles connaît les endroits
// surveillés et refuse une expression régulière sans re2.

const { moderateMock, autoReportMock, re2, calls, THREAD } = vi.hoisted(() => ({
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
vi.mock('../services/octoguard/moderate', () => ({
  moderateText: moderateMock,
  blockedBody: (v: { reason: string; i18n_key: string }) => ({ error: v.reason, code: 'OCTOGUARD_BLOCKED', i18n_key: v.i18n_key }),
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
    if (s.startsWith('UPDATE octoguard_automod_rules')) return { rows: [{ id: 'r1', name: 'x' }], rowCount: 1 }
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
  it('basculer l’interrupteur seul ne la marque pas', async () => {
    re2.on = true
    await app.inject({ method: 'PUT', url: '/api/v1/admin/octoguard/rules/r1', headers: { authorization: token(ADMIN) }, payload: { enabled: true } })
    expect(calls.find(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))!.sql).not.toContain('customized')
  })
})
