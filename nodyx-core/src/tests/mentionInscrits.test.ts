// @inscrits d'un événement (SPECS/NODYX_MENTIONS_CDC.md §10, D60-D63).
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../config/database', () => ({ db: { query: vi.fn() }, redis: {} }))
vi.mock('../socket/io', () => ({ io: null }))
vi.mock('../services/permissions', () => ({ getAccess: vi.fn(async (_c: string, u: string) => ({ rank: u === 'modo' ? 1 : 0, permissions: [] })) }))

import { db } from '../config/database'
import { isGroupKey, eventKey, groupKeysIn, describeGroups, membersOf, groupCards, groupRecipients } from '../services/mentionGroups'
import { MENTION_VALUE, sanitize } from '../utils/sanitize'
import { tallyMentions } from '../services/octoguard/mentionTally'
import { mentionWeight } from '../services/octoguard/mentionWeight'

const EV = '11111111-1111-4111-8111-111111111111'
const C = 'c1'
let ev: any
let rsvps: { user_id: string; status: string }[]

beforeEach(() => {
  vi.clearAllMocks()
  ev = { id: EV, title: 'Raid Veloren', starts_at: '2026-11-21T19:00:00Z', is_public: true, is_cancelled: false, author_id: 'lea', community_id: C, open: true }
  rsvps = [{ user_id: 'max', status: 'going' }, { user_id: 'rem', status: 'going' }, { user_id: 'kim2', status: 'maybe' }, { user_id: 'no', status: 'not_going' }]
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('FROM events WHERE id = $1 AND community_id = $2')) return { rows: params[0] === EV && params[1] === C ? [ev] : [] } as any
    if (s.includes("FROM event_rsvps WHERE event_id = $1 AND user_id = $2")) return { rows: rsvps.some(r => r.user_id === params[1] && ['going', 'maybe'].includes(r.status)) ? [{}] : [] } as any
    if (s.includes('COUNT(*) FILTER')) return { rows: [{ going: rsvps.filter(r => r.status === 'going').length, maybe: rsvps.filter(r => r.status === 'maybe').length }] } as any
    if (s.includes('FROM event_rsvps r') && s.includes('r.status = ANY')) return { rows: rsvps.filter(r => params[2].includes(r.status)).map(r => ({ user_id: r.user_id })) } as any
    if (s.includes('FROM community_members WHERE community_id = $1 AND user_id = $2')) return { rows: params[1] === 'anon' ? [] : [{}] } as any
    if (s.includes("key = 'mentions_group_confirm'")) return { rows: [{ value: '2' }] } as any
    if (s.includes('SELECT u.username')) return { rows: [{ username: 'max', display_name: null }] } as any
    return { rows: [] } as any
  })
})

describe('la marque', () => {
  it('g:event:<uuid> et g:event-going:<uuid> sont des groupes, rien d’approchant', () => {
    expect(isGroupKey(`event:${EV}`)).toBe(true)
    expect(isGroupKey(`event-going:${EV}`)).toBe(true)
    expect(isGroupKey('event:abc')).toBe(false)
    expect(eventKey(`event-going:${EV}`)).toEqual({ id: EV, goingOnly: true })
    expect(MENTION_VALUE.test(`g:event:${EV}`)).toBe(true)
    expect(MENTION_VALUE.test(`g:event:${EV}x`)).toBe(false)
  })
  it('le nettoyeur garde la marque d’un événement et la retrouve', () => {
    const html = sanitize(`<p><span data-mention="g:event:${EV}">@inscrits · Raid</span> on décale</p>`)
    expect(html).toContain(`data-mention="g:event:${EV}"`)
    expect(groupKeysIn(html)).toEqual([`event:${EV}`])
  })
})

describe('qui est prévenu (D60)', () => {
  it('« J’y vais » + « Peut-être », jamais « Je ne viens pas »', async () => {
    expect(await membersOf(C, `event:${EV}`)).toEqual(['max', 'rem', 'kim2'])
  })
  it('« Seulement ceux qui viennent »', async () => {
    expect(await membersOf(C, `event-going:${EV}`)).toEqual(['max', 'rem'])
  })
})

describe('qui peut prévenir (D61, D62)', () => {
  it('l’organisatrice : oui, avec le détail viennent / peut-être et la confirmation au-delà du seuil', async () => {
    const [g] = await describeGroups(C, 'lea', [`event:${EV}`])
    expect(g).toMatchObject({ forbidden: false, count: 3, label: 'Raid Veloren', needs_confirm: true, event: { going: 2, maybe: 1 } })
  })
  it('un inscrit : oui ; il n’est pas compté lui-même', async () => {
    const [g] = await describeGroups(C, 'max', [`event:${EV}`])
    expect(g).toMatchObject({ forbidden: false, count: 2 })
  })
  it('l’équipe : oui', async () => {
    expect((await describeGroups(C, 'modo', [`event:${EV}`]))[0].forbidden).toBe(false)
  })
  it('un membre non inscrit : non, et personne n’est prévenu', async () => {
    expect((await describeGroups(C, 'kim', [`event:${EV}`]))[0]).toMatchObject({ forbidden: true, count: 0 })
    const r = await groupRecipients(`<span data-mention="g:event:${EV}">@x</span>`, C, 'kim')
    expect(r.size).toBe(0)
  })
  it('« Je ne viens pas » ne donne pas le droit', async () => {
    expect((await describeGroups(C, 'no', [`event:${EV}`]))[0].forbidden).toBe(true)
  })
  it('fini depuis plus de 24 h : plus personne ne peut prévenir, même l’organisatrice', async () => {
    ev.open = false
    expect((await describeGroups(C, 'lea', [`event:${EV}`]))[0].forbidden).toBe(true)
  })
  it('un événement d’une autre communauté : refusé', async () => {
    expect((await describeGroups('autre', 'lea', [`event:${EV}`]))[0].forbidden).toBe(true)
  })
  it('l’organisatrice prévient vraiment les 3 inscrits', async () => {
    const r = await groupRecipients(`<span data-mention="g:event:${EV}">@x</span>`, C, 'lea')
    expect([...r.keys()].sort()).toEqual(['kim2', 'max', 'rem'])
  })
})

describe('la puce, selon qui lit (D63)', () => {
  it('événement privé, visiteur sans compte : ni titre, ni nombre, ni noms', async () => {
    ev.is_public = false
    const [g] = await groupCards(C, [`event:${EV}`], null)
    expect(g).toEqual({ key: `event:${EV}`, label: null, color: null, count: 0, sample: [], private: true })
  })
  it('événement privé, membre : le titre et les noms', async () => {
    ev.is_public = false
    const [g] = await groupCards(C, [`event:${EV}`], 'max')
    expect(g).toMatchObject({ label: 'Raid Veloren', count: 3, sample: [{ username: 'max' }] })
  })
  it('événement public, visiteur : le titre et le nombre, pas les noms', async () => {
    const [g] = await groupCards(C, [`event:${EV}`], null)
    expect(g).toMatchObject({ label: 'Raid Veloren', count: 3, sample: [] })
  })
})

describe('OctoGuard : le poids d’une mention @inscrits', () => {
  const html = `<p><span data-mention="g:event:${EV}">@inscrits · Raid</span> on décale</p>`
  it('la marque est vue comme un groupe', () => {
    expect(tallyMentions(html).groups.length).toBe(1)
  })
  it('l’organisatrice : elle pèse les 3 inscrits', async () => {
    expect(await mentionWeight(html, C, 'lea')).toBe(3)
  })
  it('un non-inscrit : elle ne prévient personne, elle pèse 1', async () => {
    expect(await mentionWeight(html, C, 'kim')).toBe(1)
  })
})
