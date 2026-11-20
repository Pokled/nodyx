import { describe, it, expect, vi, beforeEach } from 'vitest'

// Le fil dans le dossier d'un contenu retenu (maquette validée le 20/11/2026) :
// 5 messages avant, 3 après par défaut, « Afficher plus » quand il en reste (30 au plus),
// et les autres contenus retenus du même endroit, surlignés « retenu aussi ».

const { calls, st } = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  st: { before: 0, after: 0, held: { id: 'h1', kind: 'chat', author_id: 'a1', channel_id: 'c1', thread_id: null, post_id: null, created_at: '2026-11-20T18:10:00Z' } as Record<string, unknown> },
}))

vi.mock('../config/database', () => ({
  db: {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const s = String(sql).replace(/\s+/g, ' ').trim()
      calls.push({ sql: s, params })
      if (s.startsWith('SELECT id, kind, author_id')) return { rows: [st.held] }
      if (s.includes('FROM users u WHERE u.id')) return { rows: [{ id: 'a1', username: 'kev', created_at: '2024-01-01', warns_active: 0, muted: false, muted_until: null }] }
      const row = (n: number, sign: number) => ({ id: `m${sign}${n}`, author_id: 'x', author_username: 'x', content: `msg ${sign}${n}`, created_at: new Date(Date.parse('2026-11-20T18:10:00Z') + sign * (n + 1) * 60_000).toISOString(), edited: false })
      if (s.includes('created_at < $2') ) return { rows: Array.from({ length: Math.min(st.before, Number(params[3])) }, (_, n) => row(n, -1)) }
      if (s.includes('created_at > $2')) return { rows: Array.from({ length: Math.min(st.after, Number(params[3])) }, (_, n) => row(n, 1)) }
      if (s.includes('FROM octoguard_held h LEFT JOIN users')) return { rows: [{ id: 'h2', author_id: 'b2', author_username: 'sam', content: 'retenu aussi', created_at: '2026-11-20T18:11:00Z' }] }
      return { rows: [] }
    }),
  },
  redis: { get: vi.fn(), set: vi.fn(), keyPrefix: 'nodyx:' },
}))

import { heldContext, HELD_WINDOW } from '../services/octoguard/context'

const limits = () => ({
  before: calls.find(c => c.sql.includes('created_at < $2'))?.params[3],
  after: calls.find(c => c.sql.includes('created_at > $2'))?.params[3],
})

beforeEach(() => { calls.length = 0; st.before = 0; st.after = 0; st.held = { ...st.held, kind: 'chat', channel_id: 'c1', thread_id: null } })

describe('la fenêtre du fil', () => {
  it('par défaut : 5 messages avant, 3 après (on en lit un de plus pour savoir s’il en reste)', async () => {
    expect(HELD_WINDOW).toEqual({ before: 5, after: 3, max: 30 })
    await heldContext('h1')
    expect(limits()).toEqual({ before: 6, after: 4 })
  })
  it('il en reste avant et après : more_before et more_after, et seulement 5 + 3 affichés', async () => {
    st.before = 20; st.after = 20
    const c = await heldContext('h1')
    expect(c!.around).toHaveLength(8)
    expect(c!.more_before).toBe(true); expect(c!.more_after).toBe(true)
    // dans l'ordre du fil : du plus ancien au plus récent
    const t = c!.around.map(m => Date.parse(m.created_at))
    expect([...t].sort((a, b) => a - b)).toEqual(t)
  })
  it('rien au-delà : pas de « afficher plus »', async () => {
    st.before = 2; st.after = 1
    const c = await heldContext('h1')
    expect(c!.around).toHaveLength(3)
    expect(c!.more_before).toBe(false); expect(c!.more_after).toBe(false)
  })
  it('« Afficher plus anciens » : la fenêtre demandée est respectée', async () => {
    await heldContext('h1', { before: 15, after: 3 })
    expect(limits()).toEqual({ before: 16, after: 4 })
  })
  it('jamais plus de 30 de chaque côté, jamais négatif', async () => {
    await heldContext('h1', { before: 999, after: -4 })
    expect(limits()).toEqual({ before: 31, after: 1 })
  })
})

describe('les autres contenus retenus du même endroit', () => {
  it('ils sont renvoyés (« retenu aussi »), sans le contenu lui-même', async () => {
    const c = await heldContext('h1')
    expect(c!.held_nearby).toEqual([expect.objectContaining({ id: 'h2', author_username: 'sam' })])
    const q = calls.find(x => x.sql.includes('FROM octoguard_held h LEFT JOIN users'))!
    expect(q.params[0]).toBe('h1')                  // h.id <> $1 : pas le dossier lui-même
    expect(q.params[1]).toBe('c1')                  // même salon
  })
  it('fenêtre ouverte s’il n’y a rien au-delà, bornée par ses messages extrêmes sinon', async () => {
    await heldContext('h1')
    let q = calls.find(x => x.sql.includes('FROM octoguard_held h LEFT JOIN users'))!
    expect([q.params[2], q.params[3]]).toEqual([null, null])
    calls.length = 0; st.before = 20; st.after = 20
    const c = await heldContext('h1')
    q = calls.find(x => x.sql.includes('FROM octoguard_held h LEFT JOIN users'))!
    expect([q.params[2], q.params[3]]).toEqual([c!.around[0].created_at, c!.around[c!.around.length - 1].created_at])
  })
  it('au forum : même sujet', async () => {
    st.held = { ...st.held, kind: 'post', channel_id: null, thread_id: 't9' }
    await heldContext('h1')
    const q = calls.find(x => x.sql.includes('FROM octoguard_held h LEFT JOIN users'))!
    expect(q.sql).toContain(`h.kind = 'post' AND h.thread_id = $2`)
    expect(q.params[1]).toBe('t9')
  })
})
