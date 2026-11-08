import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// Relecture du 08/11 : lever une sourdine suit le MÊME garde-fou de rang que la
// poser, et les deux suppressions sont limitées en débit et vérifient l'id.

const { st, removeMock } = vi.hoisted(() => ({
  st: { muteTarget: null as null | string, roles: {} as Record<string, string> },
  removeMock: vi.fn(async () => true),
}))
vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
}))
vi.mock('../services/octoguard', () => ({
  isUserMuted: vi.fn().mockResolvedValue({ muted: false }), hasRE2: () => false,
  reloadRules: vi.fn(), assessPatternSafety: vi.fn(() => ({ valid: true })),
  applyMute: vi.fn(), removeMute: removeMock, getWebhookConfig: vi.fn(), setWebhookConfig: vi.fn(), invalidateWebhookConfig: vi.fn(),
}))
vi.mock('../socket/io', () => ({ io: null }))

import { db, redis } from '../config/database'
import { octoguardAdminPlugin } from '../routes/octoguard'

const ADMIN = '22222222-2222-4222-8222-222222222222'
const MOD = '33333333-3333-4333-8333-333333333333'
const MOD2 = '44444444-4444-4444-8444-444444444444'
const MEMBER = '55555555-5555-4555-8555-555555555555'
const MUTE = '66666666-6666-4666-8666-666666666666'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks()
  st.roles = { [ADMIN]: 'admin', [MOD]: 'moderator', [MOD2]: 'moderator', [MEMBER]: 'member' }
  st.muteTarget = MEMBER
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ').trim()
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }] }
    if (s.includes('community_grades cg ON cg.id = cm.grade_id AND')) return { rows: [{ role: st.roles[params[1] as string] ?? 'member', permissions: null }] }
    if (s.startsWith('SELECT user_id FROM chat_mutes')) return { rows: st.muteTarget ? [{ user_id: st.muteTarget }] : [] }
    if (s.startsWith('DELETE FROM octoguard_commands')) return { rows: [] }
    return { rows: [] }
  }) as never)
})

describe('lever une sourdine', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/api/v1/admin/octoguard' })) })
  const lift = (u: string, id = MUTE) => app.inject({ method: 'DELETE', url: `/api/v1/admin/octoguard/mutes/${id}`, headers: { authorization: token(u) } })

  it('un modérateur lève la sourdine d’un membre', async () => {
    expect((await lift(MOD)).statusCode).toBe(200)
    expect(removeMock).toHaveBeenCalledWith(MUTE, MOD)
  })
  it('un modérateur ne lève PAS la sourdine d’un autre modérateur (posée par un admin)', async () => {
    st.muteTarget = MOD2
    const res = await lift(MOD)
    expect(res.statusCode).toBe(403)
    expect(res.json().code).toBe('RANK_TOO_LOW')
    expect(removeMock).not.toHaveBeenCalled()
  })
  it('un admin lève n’importe quelle sourdine', async () => {
    st.muteTarget = MOD2
    expect((await lift(ADMIN)).statusCode).toBe(200)
  })
  it('identifiant mal formé : 400 sans rien toucher ; sourdine inconnue : 404 avec un code', async () => {
    expect((await lift(MOD, 'x;drop')).statusCode).toBe(400)
    st.muteTarget = null
    const r = await lift(MOD)
    expect(r.statusCode).toBe(404)
    expect(r.json().code).toBe('NOT_FOUND')
    expect(removeMock).not.toHaveBeenCalled()
  })
  it('un membre n’a pas accès', async () => {
    expect((await lift(MEMBER)).statusCode).toBe(403)
  })
})

describe('supprimer une commande', () => {
  it('identifiant mal formé : 400 ; inconnue : 404 avec un code', async () => {
    const app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/api/v1/admin/octoguard' }))
    const del = (id: string) => app.inject({ method: 'DELETE', url: `/api/v1/admin/octoguard/commands/${id}`, headers: { authorization: token(ADMIN) } })
    expect((await del('x;drop')).statusCode).toBe(400)
    const r = await del(MUTE)
    expect(r.statusCode).toBe(404)
    expect(r.json().code).toBe('NOT_FOUND')
  })
})
