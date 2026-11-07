import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// OctoGuard 2, lot 10 (CDC E4h, D25) : « Faux positif » n'affaiblit JAMAIS une
// règle en silence ; « C'était normal » marque une observation. Une seule fois.

const { st, calls } = vi.hoisted(() => ({
  st: {
    entry: null as null | Record<string, unknown>,
    rule: null as null | Record<string, unknown>,
    claimed: new Set<string>(),
    undoable: true,
  },
  calls: [] as Array<{ sql: string; params: unknown[] }>,
}))

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
}))
const { reloadMock } = vi.hoisted(() => ({ reloadMock: vi.fn() }))
vi.mock('../services/octoguard', () => ({
  isUserMuted: vi.fn().mockResolvedValue({ muted: false }), hasRE2: () => false,
  reloadRules: reloadMock, assessPatternSafety: vi.fn(() => ({ valid: true })),
  applyMute: vi.fn(), removeMute: vi.fn().mockResolvedValue(true), getWebhookConfig: vi.fn(), setWebhookConfig: vi.fn(), invalidateWebhookConfig: vi.fn(),
}))
vi.mock('../socket/io', () => ({ io: null }))

import { db, redis } from '../config/database'
import { octoguardAdminPlugin } from '../routes/octoguard'
import { planLearning } from '../services/octoguard/falsePositive'
import { matchKeywords } from '../services/octoguard/matchers2'

const ADMIN = '22222222-2222-4222-8222-222222222222'
const MEMBER = '55555555-5555-4555-8555-555555555555'
const LOG = '66666666-6666-4666-8666-666666666666'
const RULE = '77777777-7777-4777-8777-777777777777'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`
const kw = (words: string[], exceptions: string[] = []) => ({ id: RULE, name: 'Mots interdits', type: 'keywords', params: { words, exceptions } })

describe('le moteur note le mot trouvé (sans lui, D25 est impossible)', () => {
  it('motif partiel : le mot réel du message et le motif', () => {
    const r = matchKeywords({ content: 'Merci pour le contenu !', userId: 'u' } as never, { words: ['*con*'] })
    expect(r?.found).toEqual({ token: 'contenu', pattern: '*con*', kind: 'contains' })
  })
  it('mot entier : le mot et son type', () => {
    const r = matchKeywords({ content: 'quel connard', userId: 'u' } as never, { words: ['connard'] })
    expect(r?.found).toMatchObject({ token: 'connard', kind: 'word' })
  })
  it('une exception empêche bien le déclenchement (c’est ce que « Faux positif » apprend)', () => {
    expect(matchKeywords({ content: 'Merci pour le contenu !', userId: 'u' } as never, { words: ['*con*'], exceptions: ['contenu'] })).toBeNull()
  })
})

describe('planLearning : le seul cas où l’on apprend, et tous ceux où l’on refuse', () => {
  const found = (token: string, pattern: string, kind: string) => ({ found: { token, pattern, kind } })
  it('« contenu » attrapé par « *con* » : on peut l’apprendre', () => {
    expect(planLearning(found('contenu', '*con*', 'contains'), kw(['*con*']))).toEqual({ learn: true, token: 'contenu', pattern: '*con*' })
  })
  it('« con » attrapé par « *con* » : c’est le mot interdit lui-même, on n’apprend rien', () => {
    expect(planLearning(found('con', '*con*', 'contains'), kw(['*con*']))).toEqual({ learn: false, reason: 'exact_word' })
  })
  it('un mot listé tel quel n’est jamais appris, même attrapé aussi par un motif', () => {
    expect(planLearning(found('connard', 'con*', 'prefix'), kw(['con*', 'connard']))).toEqual({ learn: false, reason: 'exact_word' })
    expect(planLearning(found('connard', 'connard', 'word'), kw(['connard']))).toEqual({ learn: false, reason: 'exact_word' })
  })
  it('déjà toléré : rien à apprendre', () => {
    expect(planLearning(found('contenu', '*con*', 'contains'), kw(['*con*'], ['Contenu']))).toEqual({ learn: false, reason: 'already_excepted' })
  })
  it('autres règles (liens, majuscules…) : on n’apprend jamais rien', () => {
    expect(planLearning(found('x', 'y', 'word'), { type: 'link_domain', params: {} })).toEqual({ learn: false, reason: 'not_keywords' })
  })
  it('entrée sans mot noté (ancienne, ou données inattendues) : rien', () => {
    expect(planLearning({}, kw(['*con*']))).toEqual({ learn: false, reason: 'no_token' })
    expect(planLearning({ found: { token: 42, pattern: '*con*', kind: 'contains' } }, kw(['*con*']))).toEqual({ learn: false, reason: 'no_token' })
    expect(planLearning(found('contenu', '*con*', 'contains'), null)).toEqual({ learn: false, reason: 'rule_gone' })
  })
})

describe('les routes', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => {
    vi.clearAllMocks(); calls.length = 0; st.claimed.clear(); st.undoable = true
    st.entry = { id: LOG, action: 'octoguard.warn_user', target_label: 'mot interdit : *con*', undone: false, false_positive: false, normal: false,
      metadata: { actor: 'octoguard:auto', rule_id: RULE, undoable: true, undo_op: { type: 'clear_last_warn', user_id: MEMBER }, found: { token: 'contenu', pattern: '*con*', kind: 'contains' } } }
    st.rule = kw(['*con*'])
    vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
    vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
      const s = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: s, params })
      if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }] }
      if (s.includes('community_grades cg ON cg.id = cm.grade_id AND')) return { rows: [{ role: params[1] === ADMIN ? 'admin' : 'member', permissions: null }] }
      if (s.startsWith('SELECT l.id, l.action, l.metadata')) return { rows: st.entry ? [st.entry] : [] }
      if (s.startsWith('SELECT id, name, type, params FROM octoguard_automod_rules')) return { rows: st.rule ? [st.rule] : [] }
      if (s.startsWith('SELECT action, metadata, created_at FROM admin_audit_log')) return { rows: st.entry ? [{ action: st.entry.action, metadata: st.entry.metadata, created_at: '2026-11-07T10:00:00Z' }] : [] }
      if (s.startsWith("SELECT 1 FROM admin_audit_log WHERE action = 'octoguard.action_undone'")) return { rows: [] }
      if (s.startsWith('UPDATE octoguard_warns')) return { rows: [{ id: 'w1' }] }
      if (s.startsWith('INSERT INTO admin_audit_log') && s.includes('ON CONFLICT DO NOTHING')) {
        // L'index unique de la migration 133 : une marque par entrée et par action
        const key = `${params[2]}:${params[1]}`
        if (st.claimed.has(key)) return { rows: [] }
        st.claimed.add(key); return { rows: [{ id: 'mark-' + st.claimed.size }] }
      }
      if (s.startsWith('UPDATE octoguard_automod_rules')) return { rows: [{ id: RULE }] }
      return { rows: [] }
    }) as never)
    app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/o' }))
  })
  const fp = (u: string, learn?: boolean, id = LOG) => app.inject({ method: 'POST', url: `/o/logs/${id}/false-positive`, headers: { authorization: token(u) }, payload: learn === undefined ? {} : { learn } })

  it('aperçu : ce qui va se passer, sans rien écrire', async () => {
    const res = await app.inject({ method: 'GET', url: `/o/logs/${LOG}/false-positive`, headers: { authorization: token(ADMIN) } })
    expect(res.json()).toMatchObject({ will_undo: true, plan: { learn: true, token: 'contenu' } })
    expect(calls.some(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql))).toBe(false)
  })
  it('sans « learn » : annule et compte, la règle n’est PAS touchée', async () => {
    const res = await fp(ADMIN)
    expect(res.json()).toEqual({ ok: true, undone: true, learned: null })
    expect(calls.some(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))).toBe(false)
  })
  it('avec « learn » dans le cas sûr : le mot rejoint les exceptions, sans doublon, plafonné, règles rechargées', async () => {
    const res = await fp(ADMIN, true)
    expect(res.json()).toMatchObject({ learned: 'contenu' })
    const u = calls.find(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))!
    expect(u.params).toEqual([RULE, 'contenu'])
    expect(u.sql).toContain("NOT (COALESCE(params->'exceptions', '[]'::jsonb) ? $2::text)")
    expect(u.sql).toContain('< 500')
    expect(reloadMock).toHaveBeenCalled()
  })
  it('« learn » demandé sur un mot lui-même interdit : refusé côté serveur, rien n’est appris', async () => {
    st.entry = { ...st.entry!, metadata: { ...(st.entry!.metadata as object), found: { token: 'con', pattern: '*con*', kind: 'contains' } } }
    const res = await fp(ADMIN, true)
    expect(res.json()).toMatchObject({ learned: null })
    expect(calls.some(c => c.sql.startsWith('UPDATE octoguard_automod_rules'))).toBe(false)
  })
  it('deux clics simultanés : une seule marque, une seule annulation', async () => {
    const [a, b] = await Promise.all([fp(ADMIN), fp(ADMIN)])
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409])
    expect(calls.filter(c => c.sql.startsWith('UPDATE octoguard_warns')).length).toBe(1)
  })
  it('une action de l’équipe (pas d’OctoGuard) ne se marque pas faux positif', async () => {
    st.entry = { ...st.entry!, metadata: { ...(st.entry!.metadata as object), actor: 'gardien' } }
    expect((await fp(ADMIN)).json().code).toBe('NOT_ENGINE_ACTION')
  })
  it('identifiant mal formé : 400 sans requête (y compris « Annuler », qui répondait 500)', async () => {
    expect((await fp(ADMIN, false, 'x;drop')).statusCode).toBe(400)
    const u = await app.inject({ method: 'POST', url: '/o/logs/x;drop/undo', headers: { authorization: token(ADMIN) } })
    expect(u.statusCode).toBe(400)
    expect(calls.some(c => c.sql.includes('admin_audit_log'))).toBe(false)
  })
  it('un membre n’a pas accès', async () => {
    expect((await fp(MEMBER)).statusCode).toBe(403)
  })
  it('« C’était normal » : seulement sur une observation, une seule fois', async () => {
    const normal = () => app.inject({ method: 'POST', url: `/o/logs/${LOG}/normal`, headers: { authorization: token(ADMIN) } })
    expect((await normal()).json().code).toBe('NOT_OBSERVATION')
    st.entry = { ...st.entry!, action: 'octoguard.would_warn_user' }
    expect((await normal()).statusCode).toBe(200)
    expect((await normal()).statusCode).toBe(409)
  })
})
