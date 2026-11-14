/**
 * Mentions M3b : le fantôme démasqué (D53), les rafales (D55), les réglages de l'instance
 * (seuil, Q1, Q2). Ce qui compte : seul l'AUTEUR efface un fantôme, dans les 10 minutes ;
 * le texte n'est gardé que si l'admin l'a choisi ; seule une personne mentionnée peut le
 * signaler ; une rafale ne crée qu'UNE notification.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import jwt from 'jsonwebtoken'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn(), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(),
    incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60), set: vi.fn().mockResolvedValue('OK'), del: vi.fn().mockResolvedValue(1),
  },
}))
const emitted = vi.hoisted(() => [] as string[])
vi.mock('../socket/io', () => ({ io: { in: () => ({ fetchSockets: async () => [] }), to: (room: string) => ({ emit: (ev: string) => emitted.push(`${room} ${ev}`) }) } }))
vi.mock('../models/community', () => ({ findBySlug: vi.fn().mockResolvedValue({ id: 'c1' }) }))
vi.mock('../services/permissions', () => ({ getAccess: vi.fn(async () => ({ role: 'member', rank: 0, permissions: [] })) }))
vi.mock('../routes/notifications', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../models/notification', () => ({ create: vi.fn().mockResolvedValue({}), getUnreadCount: vi.fn().mockResolvedValue(1) }))
vi.mock('../utils/mentions', () => ({ resolveMentions: vi.fn(async (html: string) => [...html.matchAll(/u:([0-9a-f-]{36})/g)].map(m => m[1])) }))
const admin = vi.hoisted(() => ({ ok: true }))
vi.mock('../middleware/adminOnly', () => ({
  adminOnly: vi.fn(async (_r: any, reply: any) => admin.ok ? undefined : reply.code(403).send({ error: 'no' })),
  getInstanceCommunityId: vi.fn().mockResolvedValue('c1'),
}))

import { db, redis } from '../config/database'
import * as Notif from '../models/notification'
import { sendPushToUser } from '../routes/notifications'
import { recordGhost, purgeGhosts, ghostFor } from '../services/mentionGhosts'
import { notifyMentions } from '../services/mentionNotify'
import { resolveReportTarget } from '../services/reports'
import mentionsRoutes from '../routes/mentions'

const AUTHOR = '99999999-9999-4999-8999-999999999999', KIM = '11111111-1111-4111-8111-111111111111', LEO = '22222222-2222-4222-8222-222222222222'
const MSG = '33333333-3333-4333-8333-333333333333', CH = '44444444-4444-4444-8444-444444444444'
const mark = (id: string) => `<span data-mention="u:${id}">@x</span>`
let settings: Record<string, string> = {}, ghostRow: any = null, prevBurst: string | null = null
const calls = () => vi.mocked(db.query).mock.calls.map(c => [String(c[0]), c[1]] as [string, any])

beforeEach(() => {
  vi.clearAllMocks(); emitted.length = 0; settings = {}; ghostRow = null; prevBurst = null; admin.ok = true
  process.env.NODYX_COMMUNITY_SLUG = 'banc'
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('FROM instance_settings WHERE key = $1')) return { rows: settings[params[0]] !== undefined ? [{ value: settings[params[0]] }] : [] } as any
    if (s.includes("FROM instance_settings WHERE key = 'mentions_show_quiet_until'")) return { rows: settings.mentions_show_quiet_until ? [{ value: settings.mentions_show_quiet_until }] : [] } as any
    if (s.includes("key = 'mentions_group_confirm'")) return { rows: settings.mentions_group_confirm ? [{ value: settings.mentions_group_confirm }] : [] } as any
    if (s.includes('UPDATE notifications SET') && s.includes('RETURNING user_id')) return { rows: [{ user_id: KIM }] } as any
    if (s.includes('FROM mention_ghosts WHERE message_id = $1 AND $2 = ANY(mentioned)')) return { rows: ghostRow && ghostRow.mentioned.includes(params[1]) ? [ghostRow] : [] } as any
    if (s.includes('FROM channel_messages m JOIN channels ch')) return { rows: [{ author_id: AUTHOR, content: '', is_deleted: true, channel_id: CH, name: 'général', community_id: 'c1' }] } as any
    if (s.includes('SELECT name, community_id FROM channels')) return { rows: [{ name: 'général', community_id: 'c1' }] } as any
    if (s.includes("type = 'mention' AND is_read = false")) return { rows: prevBurst ? [{ id: prevBurst }] : [] } as any
    return { rows: [], rowCount: 1 } as any
  })
})

const ghost = (age_s: number, html = mark(KIM)) => recordGhost({ source: 'chat', messageId: MSG, authorId: AUTHOR, communityId: 'c1', html, createdAt: new Date(Date.now() - age_s * 1000), channelId: CH })

describe('le fantôme (D53)', () => {
  it('effacé dans les 10 minutes : noté, notifications marquées, la cloche prévenue', async () => {
    expect(await ghost(8)).toBe(true)
    const ins = calls().find(([s]) => s.includes('INSERT INTO mention_ghosts'))!
    expect(ins[1][6]).toEqual([KIM])
    const upd = calls().find(([s]) => s.includes('UPDATE notifications SET meta'))!
    expect(JSON.parse(upd[1][1])).toEqual({ ghost: true, deleted_after_s: 8 })
    expect(emitted).toContain(`user:${KIM} notification:new`)
  })
  it('par défaut (Q1 = 0) le TEXTE n’est pas gardé ; gardé si l’admin l’a choisi', async () => {
    await ghost(5)
    expect(calls().find(([s]) => s.includes('INSERT INTO mention_ghosts'))![1][5]).toBeNull()
    vi.mocked(db.query).mockClear(); settings.mentions_ghost_retention_days = '30'
    await ghost(5, `<p>méchant ${mark(KIM)}</p>`)
    expect(calls().find(([s]) => s.includes('INSERT INTO mention_ghosts'))![1][5]).toBe('méchant @x')
  })
  it('une RAFALE n’est jamais marquée fantôme en bloc (seule une mention isolée l’est)', async () => {
    await ghost(5)
    const upd = calls().find(([s]) => s.includes('UPDATE notifications SET meta'))!
    expect(upd[0]).toContain("COALESCE((meta->>'count')::int, 1) = 1")
  })
  it('mention comptée dans une rafale : un fantôme À PART, seulement si la personne a été prévenue', async () => {
    vi.mocked(db.query).mockImplementation(async (sql: any) => {
      const s = String(sql)
      if (s.includes('UPDATE notifications SET meta')) return { rows: [] } as any            // pas de mention isolée
      if (s.includes("COALESCE((meta->>'count')::int, 1) > 1")) return { rows: [{ user_id: KIM }] } as any   // Kim a une rafale
      return { rows: [], rowCount: 1 } as any
    })
    await ghost(5, mark(KIM) + mark(LEO))
    const created = vi.mocked(Notif.create).mock.calls.map(c => c[0])
    expect(created.map(n => n.user_id)).toEqual([KIM])        // Léo n'avait pas été prévenu : rien
    expect(created[0].meta).toMatchObject({ ghost: true, message_id: MSG, channel_id: CH })
  })
  it('plus de 10 minutes, ou aucune mention : pas un fantôme', async () => {
    expect(await ghost(11 * 60)).toBe(false)
    expect(await ghost(5, '<p>rien</p>')).toBe(false)
    expect(calls().some(([s]) => s.includes('INSERT INTO mention_ghosts'))).toBe(false)
  })
  it('l’auteur qui se mentionne lui-même : pas un fantôme', async () => {
    expect(await ghost(5, mark(AUTHOR))).toBe(false)
  })
  it('forum : la réponse est DÉTACHÉE de ses notifications avant d’être effacée', async () => {
    await recordGhost({ source: 'forum', messageId: MSG, authorId: AUTHOR, communityId: 'c1', html: mark(KIM), createdAt: new Date(), threadId: CH })
    const upd = calls().find(([s]) => s.includes('UPDATE notifications SET post_id = NULL'))!
    expect(upd[0]).toContain("jsonb_build_object('post_id'")
  })
  it('purge : texte effacé après la durée choisie, fait après six mois', async () => {
    settings.mentions_ghost_retention_days = '7'
    await purgeGhosts()
    const c = calls()
    expect(c.find(([s]) => s.includes('SET content = NULL'))![1]).toEqual([7])
    expect(c.find(([s]) => s.includes('DELETE FROM mention_ghosts'))![1]).toEqual([180])
  })
  it('durée farfelue en base : traitée comme « ne pas garder »', async () => {
    settings.mentions_ghost_retention_days = '365'
    await purgeGhosts()
    expect(calls().find(([s]) => s.includes('SET content = NULL'))![1]).toEqual([0])
  })
})

describe('signaler un message fantôme', () => {
  it('une personne mentionnée peut le signaler ; l’équipe reçoit le texte s’il est gardé', async () => {
    ghostRow = { author_id: AUTHOR, content: 'méchant', channel_id: CH, thread_id: null, source: 'chat', mentioned: [KIM] }
    const t = await resolveReportTarget('message', MSG, { reporterId: KIM })
    expect(t).toMatchObject({ authorId: AUTHOR, snapshot: 'méchant', label: '#général' })
  })
  it('texte non gardé : le fait seul (snapshot vide)', async () => {
    ghostRow = { author_id: AUTHOR, content: null, channel_id: CH, thread_id: null, source: 'chat', mentioned: [KIM] }
    expect((await resolveReportTarget('message', MSG, { reporterId: KIM }))?.snapshot).toBe('')
  })
  it('quelqu’un qui n’était PAS mentionné : rien (introuvable)', async () => {
    ghostRow = { author_id: AUTHOR, content: 'méchant', channel_id: CH, thread_id: null, source: 'chat', mentioned: [KIM] }
    expect(await resolveReportTarget('message', MSG, { reporterId: LEO })).toBeNull()
    expect(await ghostFor(MSG, LEO)).toBeNull()
  })
})

describe('rafales (D55)', () => {
  const send = () => notifyMentions({ html: mark(KIM), communityId: 'c1', actorId: AUTHOR, actorName: 'x', where: { kind: 'chat', channelId: CH, messageId: MSG } })
  it('une mention non lue du même auteur, ici, il y a moins de 10 min : COMPTÉE, sans son ni téléphone', async () => {
    prevBurst = '55555555-5555-4555-8555-555555555555'
    await send()
    expect(Notif.create).not.toHaveBeenCalled()
    expect(calls().find(([s]) => s.includes("'count'"))![1][0]).toBe(prevBurst)
    expect(emitted).not.toContain(`user:${KIM} chat:mention`)
    expect(sendPushToUser).not.toHaveBeenCalled()
  })
  it('pas de rafale en cours : une notification normale', async () => {
    await send()
    expect(Notif.create).toHaveBeenCalledTimes(1)
    expect(emitted).toContain(`user:${KIM} chat:mention`)
  })
})

describe('réglages de l’instance (admins)', () => {
  const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  const put = async (b: unknown) => (await buildApp(a => mentionsRoutes(a))).inject({ method: 'PUT', url: '/admin/settings', headers: { Authorization: `Bearer ${tokenOf(AUTHOR)}` }, payload: b as any })
  it('valeurs vérifiées une par une', async () => {
    for (const b of [{ group_confirm: 1, ghost_retention_days: 0, show_quiet_until: false }, { group_confirm: 10, ghost_retention_days: 365, show_quiet_until: false }, { group_confirm: 10, ghost_retention_days: 0, show_quiet_until: 'oui' }]) {
      expect((await put(b)).json().code).toBe('MENTION_SETTINGS_INVALID')
    }
  })
  it('enregistre les trois clés et purge aussitôt', async () => {
    const r = await put({ group_confirm: 15, ghost_retention_days: 30, show_quiet_until: true })
    expect(r.statusCode).toBe(200)
    const keys = calls().filter(([s]) => s.includes('INSERT INTO instance_settings')).map(([, p]) => p)
    expect(keys).toEqual([['mentions_group_confirm', '15'], ['mentions_ghost_retention_days', '30'], ['mentions_show_quiet_until', 'true']])
    expect(calls().some(([s]) => s.includes('SET content = NULL'))).toBe(true)
  })
  it('pas admin : refusé', async () => {
    admin.ok = false
    expect((await put({ group_confirm: 15, ghost_retention_days: 30, show_quiet_until: true })).statusCode).toBe(403)
  })
})
