import { describe, it, expect, vi, beforeEach } from 'vitest'

// Lot 4a (08/11/2026) : une exclusion temporaire reste temporaire.
// Avant : la marque Redis `banned:<id>` n'avait pas d'échéance et la levée ne
// l'effaçait pas (exclusion devenue définitive), et le membre perdait son rôle
// et son grade au retour.

const { calls, redisCalls, st } = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  redisCalls: [] as Array<{ op: string; args: unknown[] }>,
  st: { member: null as null | Record<string, unknown>, upsert: true, lifted: [] as Array<Record<string, unknown>> },
}))
vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    set: vi.fn(async (...a: unknown[]) => { redisCalls.push({ op: 'set', args: a }); return 'OK' }),
    del: vi.fn(async (...a: unknown[]) => { redisCalls.push({ op: 'del', args: a }); return 1 }),
    incr: vi.fn().mockResolvedValue(1), get: vi.fn().mockResolvedValue(null),
  },
}))
vi.mock('../middleware/adminOnly', () => ({ getInstanceCommunityId: vi.fn(async () => 'c1') }))
vi.mock('../services/octoguard/webhook', () => ({ triggerWebhook: vi.fn(), buildWebhookPayload: vi.fn(() => ({})) }))

import { db } from '../config/database'
import { applyTempBan, purgeExpiredBans, setBanMark } from '../services/octoguard/bans'

const U = '55555555-5555-4555-8555-555555555555'
const GRADE = '77777777-7777-4777-8777-777777777777'

beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; redisCalls.length = 0
  st.member = { role: 'moderator', grade_id: GRADE, joined_at: '2025-03-01 10:00:00' }
  st.upsert = true; st.lifted = []
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.startsWith('SELECT role, grade_id, joined_at FROM community_members')) return { rows: st.member ? [st.member] : [] }
    if (s.startsWith('INSERT INTO community_bans')) return { rows: st.upsert ? [{ user_id: U, expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString() }] : [] }
    if (s.startsWith('DELETE FROM community_bans')) return { rows: st.lifted }
    return { rows: [] }
  }) as never)
})

describe('poser une exclusion temporaire', () => {
  it('la marque Redis porte l’échéance (7 jours), elle n’est jamais posée « pour toujours »', async () => {
    await applyTempBan({ userId: U, duration: { value: 7, unit: 'd' }, reason: 'test' })
    const set = redisCalls.find(c => c.op === 'set')!
    expect(set.args[0]).toBe(`banned:${U}`)
    expect(set.args[2]).toBe('EX')
    const ttl = set.args[3] as number
    expect(ttl).toBeGreaterThan(7 * 86_400 - 10)
    expect(ttl).toBeLessThan(7 * 86_400 + 60)
  })
  it('ce que le membre était (rôle, grade, arrivée) est gardé dans la ligne d’exclusion', async () => {
    await applyTempBan({ userId: U, duration: { value: 1, unit: 'h' }, reason: 'test' })
    const ins = calls.find(c => c.sql.startsWith('INSERT INTO community_bans'))!
    expect(ins.params.slice(4, 7)).toEqual(['moderator', GRADE, '2025-03-01 10:00:00'])
    expect(ins.params[7]).toBeNull()   // posée par OctoGuard : personne dans banned_by
    // une exclusion prolongée ne remplace pas ce qu'il était avant la première
    expect(ins.sql).toContain('prev_role = COALESCE(community_bans.prev_role, EXCLUDED.prev_role)')
  })
  it('déjà banni définitivement : rien ne change, ni la marque, ni la ligne de membre', async () => {
    st.upsert = false
    await applyTempBan({ userId: U, duration: { value: 1, unit: 'h' }, reason: 'test' })
    expect(redisCalls.some(c => c.op === 'set')).toBe(false)
    expect(calls.some(c => c.sql.startsWith('DELETE FROM community_members'))).toBe(false)
  })
})

describe('la levée à l’échéance', () => {
  it('efface la marque Redis et rend rôle, grade et date d’arrivée', async () => {
    st.lifted = [{ user_id: U, community_id: 'c1', prev_role: 'moderator', prev_grade_id: GRADE, prev_joined_at: '2025-03-01 10:00:00' }]
    expect(await purgeExpiredBans()).toBe(1)
    expect(redisCalls).toContainEqual({ op: 'del', args: [`banned:${U}`] })
    const back = calls.find(c => c.sql.startsWith('INSERT INTO community_members'))!
    expect(back.params).toEqual(['c1', U, 'moderator', GRADE, '2025-03-01 10:00:00'])
    expect(back.sql).toContain('(SELECT id FROM community_grades WHERE id = $4::uuid)')   // grade supprimé entre-temps : pas d'échec
    expect(back.sql).toContain('ON CONFLICT (community_id, user_id) DO NOTHING')
  })
  it('sans ligne de membre gardée (ancienne exclusion) : la marque s’efface quand même', async () => {
    st.lifted = [{ user_id: U, community_id: 'c1', prev_role: null, prev_grade_id: null, prev_joined_at: null }]
    await purgeExpiredBans()
    expect(redisCalls).toContainEqual({ op: 'del', args: [`banned:${U}`] })
    expect(calls.some(c => c.sql.startsWith('INSERT INTO community_members'))).toBe(false)
  })
})

describe('setBanMark', () => {
  it('définitif : sans échéance ; échéance passée mais pas encore levée : jusqu’à la prochaine levée', async () => {
    await setBanMark(U, null)
    expect(redisCalls.at(-1)!.args).toEqual([`banned:${U}`, '1'])
    await setBanMark(U, new Date(Date.now() - 1000))
    expect(redisCalls.at(-1)!.args).toEqual([`banned:${U}`, '1', 'EX', 60])
  })
})
