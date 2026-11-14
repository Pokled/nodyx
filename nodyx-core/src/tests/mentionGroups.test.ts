/**
 * Mentions de groupe (M2, D51-D52) : développées AU SERVEUR, avec les vrais droits.
 * Ce qui compte : @tous refusé hors de l'équipe, plafond, jamais l'auteur, le push en
 * texte brut, et une prévisualisation qui ne dévoile rien.
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
vi.mock('../socket/io', () => ({ io: { in: () => ({ fetchSockets: async () => [] }), to: () => ({ emit: vi.fn() }) } }))
vi.mock('../models/community', () => ({ findBySlug: vi.fn().mockResolvedValue({ id: 'c1' }) }))
const access = vi.hoisted(() => ({ team: new Set<string>() }))
vi.mock('../services/permissions', () => ({
  getAccess: vi.fn(async (_c: string, u: string) => access.team.has(u) ? { role: 'moderator', rank: 1, permissions: ['moderate_content'] } : { role: 'member', rank: 0, permissions: [] }),
}))
vi.mock('../routes/notifications', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../models/notification', () => ({ create: vi.fn().mockResolvedValue({}), getUnreadCount: vi.fn().mockResolvedValue(1) }))

import { db, redis } from '../config/database'
import * as Notif from '../models/notification'
import { sendPushToUser } from '../routes/notifications'
import { groupKeysIn, describeGroups, groupRecipients, MAX_GROUP_RECIPIENTS } from '../services/mentionGroups'
import { notifyMentions, plainText } from '../services/mentionNotify'
import mentionsRoutes from '../routes/mentions'

const ME = '99999999-9999-4999-8999-999999999999', MOD = '88888888-8888-4888-8888-888888888888'
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222'
const G = '33333333-3333-4333-8333-333333333333'
const ids = (n: number) => Array.from({ length: n }, (_, i) => ({ user_id: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000` }))
let members: Record<string, { user_id: string }[]> = {}
let threshold: string | null = null

beforeEach(() => {
  vi.clearAllMocks(); access.team = new Set([MOD]); threshold = null
  members = { all: [{ user_id: ME }, { user_id: A }, { user_id: B }, { user_id: MOD }], team: [{ user_id: MOD }], grade: [{ user_id: A }] }
  process.env.NODYX_COMMUNITY_SLUG = 'banc'
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes("key = 'mentions_group_confirm'")) return { rows: threshold ? [{ value: threshold }] : [] } as any
    if (s.includes('FROM community_grades WHERE community_id = $1 AND id = ANY')) return { rows: [{ id: G, name: 'Organisation' }] } as any
    if (s.includes('cm.grade_id = $2')) return { rows: members.grade } as any
    if (s.includes("e.value = 'true'::jsonb")) return { rows: members.team } as any
    if (s.includes("moderate_members' = 'true'")) return { rows: members.team } as any
    if (s.includes('AND cm.user_id = ANY($2::uuid[]) AND u.is_system = false')) return { rows: [] } as any   // preview : personne n'est membre
    if (s.includes('FROM community_members cm JOIN users u')) return { rows: members.all } as any
    if (s.includes('FROM users u') && s.includes('community_members')) return { rows: [] } as any
    return { rows: [] } as any
  })
})

const mark = (k: string) => `<span data-mention="g:${k}">@${k}</span>`

describe('lire les groupes d’un contenu', () => {
  it('groupes connus seulement, sans doublon, cinq au plus', () => {
    expect(groupKeysIn(`${mark('ici')} ${mark('ici')} ${mark('equipe')} <span data-mention="g:everyone">x</span>`)).toEqual(['ici', 'equipe'])
    expect(groupKeysIn(Array.from({ length: 8 }, () => [mark('ici'), mark('tous'), mark('equipe'), mark('moderation'), mark(`grade:${G}`), mark(`grade:${A}`)].join('')).join(''))).toHaveLength(5)
  })
})

describe('D52 : qui peut utiliser quel groupe', () => {
  it('@tous : interdit à un membre, permis à l’équipe', async () => {
    expect((await describeGroups('c1', ME, ['tous']))[0]).toMatchObject({ key: 'tous', forbidden: true, count: 0 })
    expect((await describeGroups('c1', MOD, ['tous']))[0]).toMatchObject({ key: 'tous', forbidden: false, count: 3 })
  })
  it('@tous d’un membre : personne n’est prévenu, même si l’interface a été contournée', async () => {
    expect((await groupRecipients(mark('tous'), 'c1', ME)).size).toBe(0)
  })
  it('@équipe et un grade : tous les membres peuvent, l’auteur est exclu du compte', async () => {
    const [team, grade] = await describeGroups('c1', MOD, ['equipe', `grade:${G}`])
    expect(team).toMatchObject({ forbidden: false, count: 0 })   // MOD est seul dans l'équipe : lui-même ne compte pas
    expect(grade).toMatchObject({ forbidden: false, count: 1, label: 'Organisation' })
  })
})

describe('D51 : confirmation au-delà du seuil', () => {
  it('seuil par défaut 10 : 11 personnes → confirmation', async () => {
    members.all = ids(12)
    expect((await describeGroups('c1', MOD, ['tous']))[0]).toMatchObject({ count: 12, needs_confirm: true })
  })
  it('seuil réglé par l’admin (20) : 12 personnes → pas de confirmation', async () => {
    threshold = '20'; members.all = ids(12)
    expect((await describeGroups('c1', MOD, ['tous']))[0].needs_confirm).toBe(false)
  })
  it('réglage farfelu ignoré (retour à 10)', async () => {
    threshold = 'abc'; members.all = ids(12)
    expect((await describeGroups('c1', MOD, ['tous']))[0].needs_confirm).toBe(true)
  })
})

describe('plafond', () => {
  it(`jamais plus de ${MAX_GROUP_RECIPIENTS} destinataires, et la requête est bornée`, async () => {
    members.all = ids(MAX_GROUP_RECIPIENTS + 1)
    expect((await groupRecipients(mark('tous'), 'c1', MOD)).size).toBe(MAX_GROUP_RECIPIENTS)
    expect(vi.mocked(db.query).mock.calls.some(c => String(c[0]).includes(`LIMIT ${MAX_GROUP_RECIPIENTS + 1}`))).toBe(true)
  })
})

describe('prévenir (service unique chat + forum)', () => {
  it('le push est en TEXTE brut, jamais en HTML ; l’auteur n’est jamais prévenu ; le groupe est noté', async () => {
    await notifyMentions({ html: `<p>Réunion <b>ce soir</b> ${mark('tous')} &amp; merci</p>`, communityId: 'c1', actorId: MOD, actorName: 'mod', where: { kind: 'chat', channelId: G } })
    const created = vi.mocked(Notif.create).mock.calls.map(c => c[0])
    expect(created.map(n => n.user_id).sort()).toEqual([A, B, ME].sort())
    expect(created.every(n => (n.meta as any)?.group === 'tous' && (n.meta as any)?.channel_id === G)).toBe(true)
    const push = vi.mocked(sendPushToUser).mock.calls[0][1] as any
    expect(push.body).toBe('Réunion ce soir @tous & merci')
    expect(push.body).not.toMatch(/[<>]/)
  })
  it('plainText coupe proprement', () => {
    const t = plainText('<p>' + 'mot '.repeat(50) + '</p>', 20)
    expect(t.length).toBeLessThanOrEqual(20); expect(t.endsWith('…')).toBe(true)
  })
})

describe('POST /mentions/preview', () => {
  const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
  const preview = async (user: string, body: unknown) => (await buildApp(a => mentionsRoutes(a))).inject({ method: 'POST', url: '/preview', headers: { Authorization: `Bearer ${tokenOf(user)}` }, payload: body as any })
  it('sans compte : 401', async () => {
    expect((await (await buildApp(a => mentionsRoutes(a))).inject({ method: 'POST', url: '/preview', payload: {} })).statusCode).toBe(401)
  })
  it('personne hors de la communauté : « not_member » ; groupes décrits ; seuil renvoyé', async () => {
    const r = await preview(ME, { people: [A, 'pas-un-id'], groups: ['tous', 'ici', 'n-importe'] })
    expect(r.statusCode).toBe(200)
    const j = r.json()
    expect(j.people).toEqual([{ id: A, state: 'not_member' }])
    expect(j.groups.map((g: any) => [g.key, g.forbidden])).toEqual([['tous', true], ['ici', false]])
    expect(j.threshold).toBe(10)
  })
})
