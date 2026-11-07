import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// OctoGuard 2, lot 3 (CDC E4h, D18) : le contexte d'un signalement est
// réservé à l'équipe, et l'historique des modifications n'est lu qu'ici.

const { calls, st } = vi.hoisted(() => ({
  calls: [] as Array<{ sql: string; params: unknown[] }>,
  st: { report: true, message: true },
}))
vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
}))
vi.mock('../services/octoguard', () => ({
  isUserMuted: vi.fn().mockResolvedValue({ muted: false }), hasRE2: () => false,
  reloadRules: vi.fn(), assessPatternSafety: vi.fn(() => ({ valid: true })),
  applyMute: vi.fn(), removeMute: vi.fn(), getWebhookConfig: vi.fn(), setWebhookConfig: vi.fn(), invalidateWebhookConfig: vi.fn(),
}))
vi.mock('../socket/io', () => ({ io: null }))

import { db, redis } from '../config/database'
import { octoguardAdminPlugin } from '../routes/octoguard'

const ADMIN = '22222222-2222-4222-8222-222222222222'
const MEMBER = '55555555-5555-4555-8555-555555555555'
const REPORT = '66666666-6666-4666-8666-666666666666'
const MSG = '77777777-7777-4777-8777-777777777777'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; st.report = true; st.message = true
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    calls.push({ sql: s, params })
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }] }
    if (s.includes('community_grades cg ON cg.id = cm.grade_id AND')) return { rows: [{ role: params[1] === ADMIN ? 'admin' : 'member', permissions: null }] }
    if (s.startsWith('SELECT target_type, target_id FROM reports')) return { rows: st.report ? [{ target_type: 'message', target_id: MSG }] : [] }
    if (s.startsWith('SELECT channel_id, author_id, created_at')) return { rows: st.message ? [{ channel_id: 'ch', author_id: MEMBER, created_at: '2026-11-07T10:00:00Z', content: 'après' }] : [] }
    if (s.includes('FROM message_edits')) return { rows: [{ old_content: 'avant', edited_at: '2026-11-07T10:02:00Z', editor_username: 'u', by_author: true }] }
    if (s.includes('FROM channel_messages m')) return { rows: [] }
    if (s.startsWith('SELECT u.id, u.username, u.created_at')) return { rows: [{ id: MEMBER, username: 'remi', created_at: '2026-03-01', warns_active: 1, muted: null, muted_until: null }] }
    return { rows: [] }
  }) as never)
})

describe('contexte d’un signalement', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/api/v1/admin/octoguard' })) })
  const get = (u: string, id = REPORT) => app.inject({ method: 'GET', url: `/api/v1/admin/octoguard/reports/${id}/context`, headers: { authorization: token(u) } })

  it('l’équipe lit la conversation, l’ancien texte et la fiche courte', async () => {
    const res = await get(ADMIN)
    expect(res.statusCode).toBe(200)
    const c = res.json().context
    expect(c.place).toBe('chat')
    expect(c.current).toBe('après')
    expect(c.edits[0].old_content).toBe('avant')
    expect(c.author).toMatchObject({ username: 'remi', warns_active: 1, muted: false })
  })
  it('D18 : un membre n’y a pas accès, et rien n’est lu', async () => {
    const res = await get(MEMBER)
    expect(res.statusCode).toBe(403)
    expect(calls.some(c => c.sql.includes('message_edits'))).toBe(false)
  })
  it('identifiant invalide : 400 sans requête', async () => {
    expect((await get(ADMIN, 'x;drop')).statusCode).toBe(400)
  })
  it('signalement inconnu : 404 ; contenu disparu : 404 CONTENT_GONE', async () => {
    st.report = false; expect((await get(ADMIN)).statusCode).toBe(404)
    st.report = true; st.message = false
    const res = await get(ADMIN)
    expect(res.statusCode).toBe(404); expect(res.json().code).toBe('CONTENT_GONE')
  })
})
