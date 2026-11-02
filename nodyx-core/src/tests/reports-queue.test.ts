import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// Signaler + file de modération (CDC SPECS/NODYX_MODERATION_CDC.md, E2).

const { U, POST_ID, MSG_ID } = vi.hoisted(() => ({
  U: {
    admin:    '22222222-2222-4222-8222-222222222222',
    mod:      '33333333-3333-4333-8333-333333333333',
    mod2:     '44444444-4444-4444-8444-444444444444',
    member:   '55555555-5555-4555-8555-555555555555',
    other:    '66666666-6666-4666-8666-666666666666',
    watcher:  '77777777-7777-4777-8777-777777777777', // modérateur de membres SANS moderate_content
  },
  POST_ID: '650e8400-e29b-41d4-a716-446655440000',
  MSG_ID:  '750e8400-e29b-41d4-a716-446655440000',
}))

type Member = { role: string; permissions: Record<string, boolean> | null }
const world: Record<string, Member> = {}
let reportRow: Record<string, unknown> | null = null
let inserted: unknown[] | null = null
let resolvedReporters: Array<{ id: string; reporter_id: string | null }> = []

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'),
    exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), set: vi.fn().mockResolvedValue('OK'),
  },
}))
vi.mock('../models/notification', () => ({ create: vi.fn().mockResolvedValue({}), getUnreadCount: vi.fn().mockResolvedValue(1) }))
vi.mock('../models/post', () => ({ getAuthorAndThread: vi.fn(), removeById: vi.fn() }))
vi.mock('../models/thread', () => ({ findById: vi.fn(), remove: vi.fn() }))
vi.mock('../models/reputation', () => ({ awardPoints: vi.fn(), REPUTATION: { THREAD: 10, REPLY: 2 } }))
vi.mock('../socket/io', () => ({ io: null }))
vi.mock('../services/octoguard', () => ({
  reloadRules: vi.fn(), assessPatternSafety: vi.fn(), applyMute: vi.fn(), removeMute: vi.fn(), isUserMuted: vi.fn(),
  getWebhookConfig: vi.fn(), setWebhookConfig: vi.fn(), invalidateWebhookConfig: vi.fn(), logOctoGuardAction: vi.fn(), hasRE2: vi.fn(),
}))

import { db, redis } from '../config/database'
import * as NotificationModel from '../models/notification'
import * as PostModel from '../models/post'
import { toPlainText } from '../services/reports'
import { octoguardAdminPlugin, reportsPublicPlugin } from '../routes/octoguard'

function routeDb() {
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ')
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }], rowCount: 1 }
    if (s.includes('FROM community_members cm') && s.includes('community_grades cg')) {
      const m = world[String(params[1])]
      return { rows: m ? [m] : [], rowCount: m ? 1 : 0 }
    }
    if (s.includes('FROM reports_settings')) return { rows: [{ rate_limit_per_hour: 5, cooldown_per_target_hours: 24, enabled: true }], rowCount: 1 }
    if (s.includes('FROM posts p JOIN threads t')) {
      return params[0] === POST_ID
        ? { rows: [{ author_id: U.member, content: '<p>Achetez <b>pas cher</b>&nbsp;!</p>', title: 'Un fil', thread_ref: 'un-fil', cat_ref: 'general', community_id: 'c1' }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (s.startsWith('INSERT INTO reports')) { inserted = params; return { rows: [{ id: 'r1', status: 'open', created_at: 'now' }], rowCount: 1 } }
    if (s.includes('SELECT id, target_type, target_id, target_author_id, status FROM reports')) return { rows: reportRow ? [reportRow] : [], rowCount: reportRow ? 1 : 0 }
    if (s.startsWith('UPDATE reports SET claimed_by')) return { rows: [{ id: 'r1' }, { id: 'r2' }], rowCount: 2 }
    if (s.startsWith('UPDATE reports SET status')) return { rows: resolvedReporters, rowCount: resolvedReporters.length }
    return { rows: [], rowCount: 0 }
  }) as never)
}

const token = (userId: string) => `Bearer ${jwt.sign({ userId, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(redis.get).mockResolvedValue(null)
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') || k.includes(':reports:cd:') ? 0 : 1)) as never)
  Object.assign(world, {
    [U.admin]:   { role: 'admin', permissions: null },
    [U.mod]:     { role: 'moderator', permissions: null },
    [U.mod2]:    { role: 'moderator', permissions: null },
    [U.member]:  { role: 'member', permissions: null },
    [U.other]:   { role: 'member', permissions: null },
    [U.watcher]: { role: 'member', permissions: { moderate_members: true } },
  })
  reportRow = { id: 'r1', target_type: 'post', target_id: POST_ID, target_author_id: U.member, status: 'open' }
  inserted = null
  resolvedReporters = [{ id: 'r1', reporter_id: U.other }, { id: 'r2', reporter_id: U.other }, { id: 'r3', reporter_id: U.admin }]
  routeDb()
})

describe('toPlainText : la photo du contenu', () => {
  it('retire le HTML et décode les entités', () => {
    expect(toPlainText('<p>Achetez <b>pas cher</b>&nbsp;!</p><p>&lt;3</p>')).toBe('Achetez pas cher !\n<3')
  })
  it('coupe à 1000 caractères', () => {
    expect(toPlainText('a'.repeat(5000))).toHaveLength(1000)
  })
})

describe('POST /reports : signaler', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(reportsPublicPlugin, { prefix: '/api/v1/reports' })) })
  const report = (who: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/reports', headers: { authorization: token(who) }, payload })

  it('garde la photo du contenu, son auteur et le lien', async () => {
    const res = await report(U.other, { target_type: 'post', target_id: POST_ID, category: 'spam' })
    expect(res.statusCode).toBe(201)
    expect(inserted).toEqual([U.other, 'post', POST_ID, '', 'spam', U.member, 'Achetez pas cher !', 'Un fil', `/forum/general/un-fil#post-${POST_ID}`])
  })
  it('le motif est obligatoire', async () => {
    expect((await report(U.other, { target_type: 'post', target_id: POST_ID })).statusCode).toBe(400)
  })
  it('refuse un contenu qui n’existe pas', async () => {
    const res = await report(U.other, { target_type: 'post', target_id: MSG_ID, category: 'spam' })
    expect(res.statusCode).toBe(404)
    expect(inserted).toBeNull()
  })
  it('on ne se signale pas soi-même', async () => {
    const res = await report(U.member, { target_type: 'post', target_id: POST_ID, category: 'spam' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('CANNOT_REPORT_SELF')
  })
  it('accepte un identifiant de démonstration (UUID non RFC, valide pour PostgreSQL)', async () => {
    const res = await report(U.other, { target_type: 'post', target_id: 'b1000004-0003-0000-0000-000000000004', category: 'spam' })
    // Passe la validation : la cible n'existe pas dans ce monde de test, d'où 404 et non 400
    expect(res.statusCode).toBe(404)
  })
  it('les messages privés (chiffrés) ne se signalent pas ici', async () => {
    const res = await report(U.other, { target_type: 'dm_message', target_id: POST_ID, category: 'harassment' })
    expect(res.statusCode).toBe(400)
    expect(res.json().code).toBe('UNSUPPORTED_TARGET')
  })
})

describe('PATCH /admin/octoguard/reports/:id : traiter un dossier', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/api/v1/admin/octoguard' })) })
  const patch = (who: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PATCH', url: '/api/v1/admin/octoguard/reports/0e7c2a3c-1b2d-4e5f-8a9b-0c1d2e3f4a5b', headers: { authorization: token(who) }, payload })

  it('un membre sans droit est refusé', async () => {
    expect((await patch(U.other, { status: 'dismissed' })).statusCode).toBe(403)
  })
  it('un modérateur prend le dossier en charge (tous les signalements du contenu)', async () => {
    const res = await patch(U.mod, { claim: true })
    expect(res.statusCode).toBe(200)
    expect(res.json().claimed).toBe(2)
  })
  it('clore notifie chaque signaleur UNE fois, sans détail (D6)', async () => {
    const res = await patch(U.mod, { status: 'dismissed' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ resolved: 3, notified: 2 })
    expect(NotificationModel.create).toHaveBeenCalledTimes(2)
    expect(NotificationModel.create).toHaveBeenCalledWith({ user_id: U.other, type: 'report_resolved' })
  })
  it('supprimer le contenu en même temps', async () => {
    vi.mocked(PostModel.getAuthorAndThread).mockResolvedValue({ author_id: U.member, thread_id: 't' } as never)
    const res = await patch(U.mod, { status: 'actioned', delete_content: true })
    expect(res.statusCode).toBe(200)
    expect(PostModel.removeById).toHaveBeenCalledWith(POST_ID)
  })
  it('supprimer exige moderate_content, même en traitant les signalements', async () => {
    const res = await patch(U.watcher, { status: 'actioned', delete_content: true })
    expect(res.statusCode).toBe(403)
    expect(PostModel.removeById).not.toHaveBeenCalled()
  })
  it('un modérateur ne juge pas le contenu d’un autre modérateur (rang)', async () => {
    reportRow = { ...reportRow!, target_author_id: U.mod2 }
    const res = await patch(U.mod, { status: 'dismissed' })
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('RANK_TOO_LOW')
  })
  it('un admin le peut', async () => {
    reportRow = { ...reportRow!, target_author_id: U.mod2 }
    expect((await patch(U.admin, { status: 'reviewed' })).statusCode).toBe(200)
  })
  it('ni claim ni statut : refusé', async () => {
    expect((await patch(U.mod, { resolution: 'x' })).statusCode).toBe(400)
  })
})
