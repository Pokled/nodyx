/**
 * Mentions M3a (D54-D55) : celui qu'on mentionne garde la main. Ce qui compte : une
 * sourdine ne se dévoile jamais, l'équipe passe toujours, les heures calmes respectent
 * le fuseau de la personne et la nuit, et une mention en pause arrive SANS bruit.
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
const access = vi.hoisted(() => ({ team: new Set<string>() }))
vi.mock('../services/permissions', () => ({
  getAccess: vi.fn(async (_c: string, u: string) => access.team.has(u) ? { role: 'moderator', rank: 1, permissions: ['moderate_content'] } : { role: 'member', rank: 0, permissions: [] }),
}))
vi.mock('../routes/notifications', () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../models/notification', () => ({ create: vi.fn().mockResolvedValue({}), getUnreadCount: vi.fn().mockResolvedValue(1) }))

import { db, redis } from '../config/database'
import * as Notif from '../models/notification'
import { sendPushToUser } from '../routes/notifications'
import { isQuietNow, accepts, minutesNow, DEFAULT_PREFS } from '../services/mentionPrefs'
import { notifyMentions } from '../services/mentionNotify'
import mentionsRoutes from '../routes/mentions'

const ACTOR = '99999999-9999-4999-8999-999999999999', MOD = '88888888-8888-4888-8888-888888888888'
const KIM = '11111111-1111-4111-8111-111111111111', LEA = '22222222-2222-4222-8222-222222222222', LEO = '33333333-3333-4333-8333-333333333333'
const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })
const mark = (id: string) => `<span data-mention="u:${id}">@x</span>`
let prefs: Record<string, any> = {}, mutes: [string, string][] = [], follows: [string, string][] = [], showUntil = false

beforeEach(() => {
  vi.clearAllMocks(); emitted.length = 0; access.team = new Set([MOD]); prefs = {}; mutes = []; follows = []; showUntil = false
  process.env.NODYX_COMMUNITY_SLUG = 'banc'
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('FROM user_mention_prefs WHERE user_id = ANY')) return { rows: params[0].filter((id: string) => prefs[id]).map((id: string) => ({ user_id: id, ...prefs[id] })) } as any
    if (s.includes('FROM user_mention_prefs WHERE user_id = $1')) return { rows: prefs[params[0]] ? [prefs[params[0]]] : [] } as any
    if (s.includes('FROM user_mention_mutes WHERE user_id = ANY')) return { rows: mutes.filter(([u, m]) => params[0].includes(u) && m === params[1]).map(([u]) => ({ user_id: u })) } as any
    if (s.includes('FROM follows')) return { rows: follows.filter(([f, t]) => params[0].includes(f) && t === params[1]).map(([f]) => ({ follower_id: f })) } as any
    if (s.includes("mentions_show_quiet_until")) return { rows: showUntil ? [{ value: 'true' }] : [] } as any
    if (s.includes('FROM users u') && s.includes('u.id = ANY($3::uuid[])')) return { rows: [...params[2], ...params[0]].map((id: string) => ({ id })) } as any   // resolveMentions
    if (s.includes('cm.user_id = ANY($2::uuid[]) AND u.is_system = false')) return { rows: params[1].map((id: string) => ({ user_id: id })) } as any   // preview : tous membres
    if (s.includes('INSERT INTO user_mention_mutes')) return { rows: [], rowCount: 1 } as any
    if (s.includes('COUNT(*)::int AS n FROM user_mention_mutes')) return { rows: [{ n: 0 }] } as any
    return { rows: [], rowCount: 0 } as any
  })
})

describe('heures calmes', () => {
  const at = (iso: string) => new Date(iso)
  it('nuit qui traverse minuit (22:00 → 08:00), dans le fuseau de la personne', () => {
    const p = { ...DEFAULT_PREFS, quiet_start: 22 * 60, quiet_end: 8 * 60, quiet_tz: 'Europe/Paris' }
    expect(isQuietNow(p, at('2026-11-14T22:30:00Z'))).toBe(true)    // 23:30 à Paris
    expect(isQuietNow(p, at('2026-11-14T06:30:00Z'))).toBe(true)    // 07:30 à Paris
    expect(isQuietNow(p, at('2026-11-14T07:30:00Z'))).toBe(false)   // 08:30 à Paris
    expect(isQuietNow(p, at('2026-11-14T12:00:00Z'))).toBe(false)
  })
  it('plage de jour (13:00 → 14:00)', () => {
    const p = { ...DEFAULT_PREFS, quiet_start: 13 * 60, quiet_end: 14 * 60, quiet_tz: 'UTC' }
    expect(isQuietNow(p, at('2026-11-14T13:30:00Z'))).toBe(true)
    expect(isQuietNow(p, at('2026-11-14T14:00:00Z'))).toBe(false)
  })
  it('sans heures calmes ou fuseau farfelu : jamais en pause / UTC', () => {
    expect(isQuietNow(DEFAULT_PREFS)).toBe(false)
    expect(minutesNow('Pas/UnFuseau', at('2026-11-14T10:15:00Z'))).toBe(615)
  })
})

describe('qui peut me mentionner (D54)', () => {
  const r = (who: string, extra: Partial<{ muted: boolean; follows: boolean }> = {}) => ({ prefs: { ...DEFAULT_PREFS, who: who as any }, muted: false, follows: false, ...extra })
  it.each([
    ['all', {}, false, true], ['following', {}, false, false], ['following', { follows: true }, false, true],
    ['team', { follows: true }, false, false], ['team', {}, true, true], ['all', { muted: true }, false, false],
    ['all', { muted: true }, true, true],
  ])('%s %o, auteur équipe=%s → %s', (who, extra, team, ok) => expect(accepts(r(who, extra), team)).toBe(ok))
})

describe('à l’envoi', () => {
  const send = (html: string, actor = ACTOR) => notifyMentions({ html, communityId: 'c1', actorId: actor, actorName: 'x', where: { kind: 'chat', channelId: '44444444-4444-4444-8444-444444444444' } })
  it('sourdine : rien pour Léo ; « membres que je suis » : rien pour Kim ; Léa prévenue', async () => {
    mutes = [[LEO, ACTOR]]; prefs = { [KIM]: { ...DEFAULT_PREFS, who: 'following' } }
    await send(mark(LEO) + mark(KIM) + mark(LEA))
    expect(vi.mocked(Notif.create).mock.calls.map(c => c[0].user_id)).toEqual([LEA])
  })
  it('l’équipe passe toujours, sourdine comprise', async () => {
    mutes = [[LEO, MOD]]; prefs = { [KIM]: { ...DEFAULT_PREFS, who: 'team' } }
    await send(mark(LEO) + mark(KIM), MOD)
    expect(vi.mocked(Notif.create).mock.calls.map(c => c[0].user_id).sort()).toEqual([KIM, LEO].sort())
  })
  it('en pause : notification gardée (meta.quiet), SANS son ni téléphone', async () => {
    const m = new Date().getUTCHours() * 60 + new Date().getUTCMinutes()
    prefs = { [KIM]: { ...DEFAULT_PREFS, quiet_start: (m + 1439) % 1440, quiet_end: (m + 60) % 1440, quiet_tz: 'UTC' } }
    await send(mark(KIM))
    expect((vi.mocked(Notif.create).mock.calls[0][0].meta as any).quiet).toBe(true)
    expect(emitted).toContain(`user:${KIM} notification:new`)
    expect(emitted).not.toContain(`user:${KIM} chat:mention`)
    expect(sendPushToUser).not.toHaveBeenCalled()
  })
})

describe('routes', () => {
  const app = () => buildApp(a => mentionsRoutes(a))
  it('preview : une sourdine ne se dévoile JAMAIS ; « qui peut » → wont_be_notified ; pause sans heure par défaut', async () => {
    const m = new Date().getUTCHours() * 60 + new Date().getUTCMinutes()
    mutes = [[LEO, ACTOR]]; prefs = { [KIM]: { ...DEFAULT_PREFS, who: 'team' }, [LEA]: { ...DEFAULT_PREFS, quiet_start: (m + 1439) % 1440, quiet_end: (m + 60) % 1440, quiet_tz: 'UTC' } }
    const r = await (await app()).inject({ method: 'POST', url: '/preview', headers: { Authorization: `Bearer ${tokenOf(ACTOR)}` }, payload: { people: [LEO, KIM, LEA] } })
    expect(r.json().people).toEqual([{ id: LEO, state: 'ok' }, { id: KIM, state: 'wont_be_notified' }, { id: LEA, state: 'quiet' }])
    expect(r.body).not.toContain('mute')
  })
  it('preview : l’heure de fin seulement si l’instance l’autorise (Q2)', async () => {
    showUntil = true
    const m = new Date().getUTCHours() * 60 + new Date().getUTCMinutes()
    prefs = { [LEA]: { ...DEFAULT_PREFS, quiet_start: (m + 1439) % 1440, quiet_end: 600, quiet_tz: 'UTC' } }
    const r = await (await app()).inject({ method: 'POST', url: '/preview', headers: { Authorization: `Bearer ${tokenOf(ACTOR)}` }, payload: { people: [LEA] } })
    expect(r.json().people[0]).toEqual({ id: LEA, state: 'quiet', quiet_until: '10:00' })
  })
  it('PUT /prefs : valeurs vérifiées une par une', async () => {
    const put = async (b: unknown) => (await app()).inject({ method: 'PUT', url: '/prefs', headers: { Authorization: `Bearer ${tokenOf(KIM)}` }, payload: b as any })
    expect((await put({ who: 'everyone' })).json().code).toBe('MENTION_PREFS_INVALID')
    expect((await put({ who: 'all', quiet_start: 1440, quiet_end: 0, quiet_tz: 'UTC' })).statusCode).toBe(400)
    expect((await put({ who: 'all', quiet_start: 1320, quiet_end: 480, quiet_tz: 'Pas/UnFuseau' })).statusCode).toBe(400)
    const ok = await put({ who: 'following', quiet_start: 1320, quiet_end: 480, quiet_tz: 'Europe/Paris' })
    expect(ok.json().prefs).toEqual({ who: 'following', quiet_start: 1320, quiet_end: 480, quiet_tz: 'Europe/Paris' })
  })
  it('sourdine : jamais soi-même ; sans compte : 401', async () => {
    const r = await (await app()).inject({ method: 'PUT', url: `/mutes/${KIM}`, headers: { Authorization: `Bearer ${tokenOf(KIM)}` } })
    expect(r.json().code).toBe('MENTION_MUTE_INVALID')
    expect((await (await app()).inject({ method: 'PUT', url: `/mutes/${KIM}` })).statusCode).toBe(401)
    expect((await (await app()).inject({ method: 'PUT', url: `/mutes/${LEO}`, headers: { Authorization: `Bearer ${tokenOf(KIM)}` } })).json()).toEqual({ ok: true })
  })
})
