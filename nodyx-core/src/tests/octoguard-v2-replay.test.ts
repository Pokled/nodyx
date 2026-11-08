import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// OctoGuard 2, lot 11 (CDC E4h, D26) : rejouer une règle sur 30 jours, sans
// rien toucher, borné, et sans jamais polluer la mémoire du moteur en direct.

const { st, calls } = vi.hoisted(() => ({
  st: { chat: [] as Array<Record<string, unknown>>, forum: [] as Array<Record<string, unknown>>, rule: null as null | Record<string, unknown>, warned: [] as string[], setNx: 'OK' as string | null },
  calls: [] as Array<{ sql: string; params: unknown[] }>,
}))
vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), set: vi.fn(async () => st.setNx), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), keyPrefix: 'nodyx:' },
}))
vi.mock('../socket/io', () => ({ io: null }))
vi.mock('../services/octoguard/webhook', () => ({ triggerWebhook: vi.fn(), buildWebhookPayload: vi.fn(() => ({})), getWebhookConfig: vi.fn(), setWebhookConfig: vi.fn(), invalidateWebhookConfig: vi.fn() }))

import { db, redis } from '../config/database'
import { replayRule, REPLAY_MAX_MESSAGES } from '../services/octoguard/replay'
import { matchFlood, recordActivity } from '../services/octoguard/matchers2'
import { octoguardAdminPlugin } from '../routes/octoguard'
import type { AutomodRuleRow } from '../services/octoguard/types'

const ADMIN = '22222222-2222-4222-8222-222222222222'
const MEMBER = '55555555-5555-4555-8555-555555555555'
const RULE = '77777777-7777-4777-8777-777777777777'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
const T0 = Date.parse('2026-11-01T10:00:00Z')
let n = 0
const msg = (author: string, content: string, sec: number, extra: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, author_id: author, role: 'member', grade_id: null, author: author.slice(0, 4),
  author_created: '2025-01-01T00:00:00Z', place: 'jeux', content, at: new Date(T0 + sec * 1000).toISOString(), ...extra,
})
function rule(extra: Partial<AutomodRuleRow> = {}): AutomodRuleRow {
  return { id: RULE, name: 'Inondation', type: 'flood', params: { max_repeats: 4, repeat_window_s: 60, max_messages: 8, burst_window_s: 10 }, action: 'warn',
    action_duration: null, escalation: null, immunized_role_types: [], immunized_grade_ids: [], dry_run: true, enabled: false,
    scopes: ['chat'], preset_key: null, customized: false, conditions: {}, created_at: '', updated_at: '', ...extra } as AutomodRuleRow
}

beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; n = 0
  st.chat = []; st.forum = []; st.warned = []; st.setNx = 'OK'
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }] }
    if (s.includes('community_grades cg ON cg.id = cm.grade_id AND')) return { rows: [{ role: params[1] === ADMIN ? 'admin' : 'member', permissions: null }] }
    if (s.includes('FROM channel_messages m') || s.includes('FROM posts p')) {
      const src = s.includes('FROM channel_messages m') ? st.chat : st.forum
      const after = params[3] ? src.findIndex(r => r.id === params[4]) + 1 : 0
      return { rows: src.slice(after, after + (params[5] as number)) }
    }
    if (s.startsWith('SELECT DISTINCT user_id FROM octoguard_warns')) return { rows: st.warned.map(user_id => ({ user_id })) }
    if (s.includes('FROM octoguard_automod_rules WHERE id = $1')) return { rows: st.rule ? [st.rule] : [] }
    return { rows: [] }
  }) as never)
})

describe('le rejeu', () => {
  it('l’inondation est rejouée avec le temps des messages : la rafale de Tom est vue, la conversation normale non', async () => {
    const tom = 'aaaaaaaa-0000-4000-8000-000000000001', lea = 'bbbbbbbb-0000-4000-8000-000000000002'
    for (let i = 0; i < 5; i++) st.chat.push(msg(tom, 'GG GG GG', i * 8))              // 5 fois le même en 40 s
    for (let i = 0; i < 6; i++) st.chat.push(msg(lea, `phrase ${i}`, 100 + i * 30))    // rythme normal
    const r = await replayRule(rule())
    expect(r.scanned).toBe(11)
    expect(r.matched).toBe(2)          // le 4e et le 5e « GG » franchissent le seuil (4 répétitions)
    expect(r.members).toBe(1)
    expect(r.examples.every(e => e.author === 'aaaa')).toBe(true)
  })
  it('rejouer ne touche JAMAIS la mémoire du moteur en direct (un spammeur en pleine rafale reste suivi)', async () => {
    // Un spammeur réel, EN CE MOMENT : 4 fois le même message, le 5e doit déclencher
    const live = '99999999-0000-4000-8000-000000000099'
    for (let i = 0; i < 4; i++) recordActivity(live, 'achète ici')
    // Le rejeu passe sur plus d'auteurs que la mémoire du moteur n'en garde (10 000)
    for (let i = 0; i < 10_050; i++) st.chat.push(msg(`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`, 'bonjour', i))
    await replayRule(rule())
    recordActivity(live, 'achète ici')
    expect(matchFlood({ content: 'achète ici', userId: live } as never, { max_repeats: 4, repeat_window_s: 60 })).not.toBeNull()
  })
  it('les immunités et les conditions d’âge s’appliquent comme en direct', async () => {
    const mod = 'cccccccc-0000-4000-8000-000000000003'
    for (let i = 0; i < 6; i++) st.chat.push(msg(mod, 'GG', i, { role: 'moderator' }))
    const r = await replayRule(rule({ immunized_role_types: ['moderator'] }))
    expect(r.matched).toBe(0)
    const kw = await replayRule(rule({ type: 'keywords', params: { words: ['gg'] }, conditions: { account_max_age_days: 2 } }))
    expect(kw.matched).toBe(0)       // le compte a plus d'un an au moment des messages
  })
  it('« faux positif probable » : un mot attrapé par un motif partiel, ou un membre ancien jamais averti', async () => {
    const old = 'dddddddd-0000-4000-8000-000000000004'
    st.chat.push(msg(old, 'merci pour le contenu', 1), msg(old, 'quel con', 2))
    // Membre ancien, JAMAIS averti : pour des mots interdits, ça ne compte pas
    // (une insulte reste une insulte) ; seul le motif partiel en fait un indice
    const r = await replayRule(rule({ type: 'keywords', params: { words: ['*con*'] } }))
    expect(r.matched).toBe(2)
    expect(r.probable_fp).toBe(1)
    expect(r.examples.find(e => e.text.includes('contenu'))?.probable_fp).toBe(true)
    expect(r.examples.find(e => e.text.includes('quel con'))?.probable_fp).toBe(false)
  })
  it('règles de comportement : un membre ancien jamais averti est un indice de faux positif (Kim pendant un direct)', async () => {
    const kim = 'abababab-0000-4000-8000-000000000010', fresh = 'cdcdcdcd-0000-4000-8000-000000000011'
    for (let i = 0; i < 10; i++) st.chat.push(msg(kim, `msg ${i}`, i))                                                // compte d'un an
    for (let i = 0; i < 10; i++) st.chat.push(msg(fresh, `msg ${i}`, 100 + i, { author_created: '2026-10-31T10:00:00Z' })) // compte d'un jour
    const r = await replayRule(rule())
    expect(r.examples.filter(e => e.author === 'abab').every(e => e.probable_fp)).toBe(true)
    expect(r.examples.filter(e => e.author === 'cdcd').every(e => !e.probable_fp)).toBe(true)
  })
  it('5 exemples au plus, les plus récents d’abord, texte coupé à 200 caractères (D26)', async () => {
    const a = 'eeeeeeee-0000-4000-8000-000000000005'
    for (let i = 0; i < 12; i++) st.chat.push(msg(a, `interdit n°${i} ` + 'x'.repeat(400), i * 100))
    const r = await replayRule(rule({ type: 'keywords', params: { words: ['interdit'] } }))
    expect(r.matched).toBe(12)
    expect(r.examples).toHaveLength(5)
    expect(r.examples[0].text.startsWith('interdit n°11')).toBe(true)
    expect(r.examples.every(e => e.text.length <= 201)).toBe(true)
  })
  it('borné : au-delà de 20 000 messages, le rejeu s’arrête et le dit', async () => {
    const a = 'ffffffff-0000-4000-8000-000000000006'
    for (let i = 0; i < REPLAY_MAX_MESSAGES + 300; i++) st.chat.push(msg(a, 'bonjour', i))
    const r = await replayRule(rule({ type: 'keywords', params: { words: ['interdit'] } }))
    expect(r.scanned).toBe(REPLAY_MAX_MESSAGES)
    expect(r.truncated).toBe('too_many')
  })
  it('rien n’est écrit : aucune requête d’écriture pendant tout le rejeu', async () => {
    st.chat.push(msg('aaaaaaaa-0000-4000-8000-000000000001', 'interdit', 1))
    await replayRule(rule({ type: 'keywords', params: { words: ['interdit'] } }))
    expect(calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql))).toBe(false)
  })
})

describe('la route', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => {
    st.rule = { ...rule({ type: 'keywords', params: { words: ['interdit'] } }) }
    app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/o' }))
  })
  const go = (u: string, id = RULE) => app.inject({ method: 'POST', url: `/o/rules/${id}/replay`, headers: { authorization: token(u) } })
  it('l’admin rejoue une règle, même éteinte', async () => {
    const res = await go(ADMIN)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ rule: { id: RULE }, days: 30, scanned: 0 })
  })
  it('un membre n’y a pas accès', async () => { expect((await go(MEMBER)).statusCode).toBe(403) })
  it('identifiant mal formé : 400 ; règle inconnue : 404', async () => {
    expect((await go(ADMIN, 'x;drop')).statusCode).toBe(400)
    st.rule = null
    expect((await go(ADMIN)).statusCode).toBe(404)
  })
  it('un délai par admin : un second rejeu dans les 10 s est refusé', async () => {
    st.setNx = null
    const res = await go(ADMIN)
    expect(res.statusCode).toBe(429)
    expect(res.json().code).toBe('REPLAY_COOLDOWN')
  })
})
