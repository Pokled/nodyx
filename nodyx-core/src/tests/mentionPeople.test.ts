/**
 * Mentions, vague 1 : propositions (D50) et puces (D49). Ce qui compte : l'ordre utile,
 * les accents et une faute pardonnés, et que seuls des champs publics sortent.
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
vi.mock('../models/community', () => ({ findBySlug: vi.fn().mockResolvedValue({ id: 'c1' }) }))

import { db, redis } from '../config/database'
import mentionsRoutes from '../routes/mentions'
import { fold, withinOneEdit } from '../services/mentionPeople'

const ME = '99999999-9999-4999-8999-999999999999'
const LEA = '11111111-1111-4111-8111-111111111111', LEO = '22222222-2222-4222-8222-222222222222', LENA = '33333333-3333-4333-8333-333333333333'
const CH = '44444444-4444-4444-8444-444444444444'
const tokenOf = (id: string) => jwt.sign({ userId: id, username: id }, process.env.JWT_SECRET!, { expiresIn: '1h' })

const MEMBERS: Record<string, any> = {
  [LEA]:  { id: LEA,  username: 'lea',    display_name: 'Léa',     avatar: null, email: 'lea@x.example' },
  [LEO]:  { id: LEO,  username: 'leo',    display_name: null,      avatar: '/a.webp', email: 'leo@x.example' },
  [LENA]: { id: LENA, username: 'lenaig', display_name: 'Lenaïg',  avatar: null, email: 'l@x.example' },
}
beforeEach(() => {
  vi.clearAllMocks()
  process.env.NODYX_COMMUNITY_SLUG = 'banc'
  vi.mocked(redis.exists).mockImplementation((k: string) => Promise.resolve(k.startsWith('banned:') ? 0 : 1) as any)
  vi.mocked(db.query).mockImplementation(async (sql: any, params?: any) => {
    const s = String(sql)
    if (s.includes('FROM channel_messages')) return { rows: [{ author_id: LEO, last_at: '2026-11-13T14:00:00Z' }] } as any
    if (s.includes('FROM notifications')) return { rows: [{ user_id: LENA, n: 5 }] } as any
    if (s.includes('u.id = ANY($3::uuid[])')) return { rows: params[2].map((id: string) => MEMBERS[id]).filter(Boolean) } as any
    if (s.includes('LIKE $3')) return { rows: Object.values(MEMBERS) } as any
    if (s.includes('community_grades')) return { rows: params[0].filter((id: string) => MEMBERS[id]).map((id: string) => ({ ...MEMBERS[id], grade_name: id === LEA ? 'Organisation' : null, grade_color: '#c67c00' })) } as any
    return { rows: [] } as any
  })
})

const suggest = async (q: string, extra = '') => (await buildApp(a => mentionsRoutes(a))).inject({ method: 'GET', url: `/suggest?q=${encodeURIComponent(q)}${extra}`, headers: { Authorization: `Bearer ${tokenOf(ME)}` } })

describe('accents et fautes', () => {
  it('fold : Léa = lea, Lenaïg = lenaig', () => { expect(fold('Léa')).toBe('lea'); expect(fold('Lenaïg')).toBe('lenaig') })
  it.each([['lenaig', 'lenaig', true], ['lenaig', 'lneaig', true], ['lenaig', 'lenaigg', true], ['lenaig', 'lenig', true], ['lenaig', 'lxxaig', false]])('%s ~ %s → %s', (a, b, r) => expect(withinOneEdit(a, b)).toBe(r))
})

describe('GET /mentions/suggest', () => {
  it('sans compte : 401', async () => {
    const r = await (await buildApp(a => mentionsRoutes(a))).inject({ method: 'GET', url: '/suggest?q=le' })
    expect(r.statusCode).toBe(401)
  })
  it('D50 : d’abord ceux qui parlent ICI, puis ceux que je mentionne souvent, puis les autres', async () => {
    const r = await suggest('le', `&channel_id=${CH}`)
    expect(r.json().people.map((p: any) => [p.username, p.reason])).toEqual([['leo', 'here'], ['lenaig', 'frequent'], ['lea', 'member']])
  })
  it('accents ignorés : « lé » trouve Léa', async () => {
    expect((await suggest('lé')).json().people.map((p: any) => p.username)).toContain('lea')
  })
  it('une faute pardonnée au-delà de 3 lettres : « lneaig » trouve Lenaïg', async () => {
    expect((await suggest('lneaig')).json().people.map((p: any) => p.username)).toEqual(['lenaig'])
  })
  it('aucun champ privé ne sort (pas d’e-mail)', async () => {
    const body = (await suggest('le')).body
    expect(body).not.toContain('@x.example')
    expect(body).not.toContain('email')
  })
  it('jamais soi-même, ni un compte système : exclus par la requête', async () => {
    await suggest('le')
    const sqls = vi.mocked(db.query).mock.calls.map(c => String(c[0])).filter(s => s.includes('community_members cm'))
    expect(sqls.length).toBeGreaterThan(0)
    for (const s of sqls) { expect(s).toContain('u.is_system = false'); expect(s).toContain('u.id <> $2') }
  })
  it('les jokers % et _ sont des lettres, pas des jokers', async () => {
    await suggest('a%_')
    const like = vi.mocked(db.query).mock.calls.find(c => String(c[0]).includes('LIKE $3'))![1] as string[]
    expect(like[2]).toBe('a\\%\\_%')
  })
  it('recherche trop longue : 400 avec un code', async () => {
    const r = await suggest('x'.repeat(61))
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('MENTION_QUERY_TOO_LONG')
  })
  it('huit propositions au plus', async () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => { const id = `${String(i).padStart(8, '5')}-5555-4555-8555-555555555555`; return [id, { id, username: 'lx' + i, display_name: null, avatar: null }] }))
    vi.mocked(db.query).mockImplementation(async (sql: any) => String(sql).includes('LIKE $3') ? { rows: Object.values(many) } as any : { rows: [] } as any)
    expect((await suggest('lx')).json().people).toHaveLength(8)
  })
})

describe('GET /mentions/people', () => {
  const people = async (ids: string, auth = true) => (await buildApp(a => mentionsRoutes(a))).inject({ method: 'GET', url: `/people?ids=${ids}`, headers: auth ? { Authorization: `Bearer ${tokenOf(ME)}` } : {} })
  it('nom et avatar à jour, grade, et « gone » pour une personne partie', async () => {
    const GONE = '77777777-7777-4777-8777-777777777777'
    const r = await people(`${LEA},${GONE}`, false)
    expect(r.statusCode).toBe(200)
    expect(r.json().people).toEqual([
      { id: LEA, username: 'lea', display_name: 'Léa', avatar: null, grade: { name: 'Organisation', color: '#c67c00' } },
      { id: GONE, gone: true },
    ])
    expect(r.body).not.toContain('@x.example')
  })
  it('identifiants invalides ignorés ; plus de 50 refusés', async () => {
    expect((await people('pas-un-id')).json().people).toEqual([])
    const r = await people(Array.from({ length: 51 }, () => LEA).join(','))
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('MENTION_IDS_TOO_MANY')
  })
})
