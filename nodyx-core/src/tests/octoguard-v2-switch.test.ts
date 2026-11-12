import { describe, it, expect, vi, beforeEach } from 'vitest'
import jwt from 'jsonwebtoken'
import { buildApp } from './helpers/buildApp'

// Lot 9 (D24) : l'interrupteur dans l'écran, et le verrou du serveur.
const { setSettingsMock, reloadMock } = vi.hoisted(() => ({
  setSettingsMock: vi.fn(async (u: Record<string, string>) => { for (const [k, v] of Object.entries(u)) process.env[k] = v; return { ok: true, errors: {}, applied: Object.keys(u), restartRequired: false } }),
  reloadMock: vi.fn(),
}))
vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: { get: vi.fn().mockResolvedValue(null), setex: vi.fn().mockResolvedValue('OK'), exists: vi.fn(), incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1) },
}))
vi.mock('../config/settings', () => ({ setSettings: setSettingsMock }))
vi.mock('../services/octoguard/cache', async (orig) => ({ ...(await orig() as object), reloadRules: reloadMock }))
vi.mock('../socket/io', () => ({ io: null }))

import { db, redis } from '../config/database'
import { octoguardAdminPlugin } from '../routes/octoguard'
import { isOctoGuardEnabled } from '../services/octoguard'

const ADMIN = '22222222-2222-4222-8222-222222222222'
const MEMBER = '55555555-5555-4555-8555-555555555555'
const token = (u: string) => `Bearer ${jwt.sign({ userId: u, username: 'u' }, process.env.JWT_SECRET!, { expiresIn: '1h' })}`

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.OCTOGUARD_FORCE_OFF
  process.env.OCTOGUARD_ENABLED = 'false'
  delete process.env.OCTOGUARD_NUDGE
  vi.mocked(redis.exists).mockImplementation((async (k: string) => (k.startsWith('banned:') ? 0 : 1)) as never)
  vi.mocked(db.query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    const s = String(sql).replace(/\s+/g, ' ')
    if (s.includes('FROM communities')) return { rows: [{ id: 'c1' }] }
    if (s.includes('community_grades cg ON cg.id = cm.grade_id AND')) return { rows: [{ role: params[1] === ADMIN ? 'admin' : 'member', permissions: null }] }
    return { rows: [{ username: 'u' }] }
  }) as never)
})

describe('l’interrupteur général', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/o' })) })
  const put = (u: string, enabled: boolean) => app.inject({ method: 'PUT', url: '/o/settings', headers: { authorization: token(u) }, payload: { enabled } })

  it('allumer depuis l’écran : effet immédiat, règles rechargées', async () => {
    const res = await put(ADMIN, true)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ enabled: true, nudge: false })
    expect(isOctoGuardEnabled()).toBe(true)
    expect(reloadMock).toHaveBeenCalled()
  })
  it('D24 : verrou du serveur, l’écran ne peut pas allumer', async () => {
    process.env.OCTOGUARD_FORCE_OFF = 'true'
    const res = await put(ADMIN, true)
    expect(res.statusCode).toBe(409)
    expect(res.json().code).toBe('OCTOGUARD_LOCKED_OFF')
    expect(setSettingsMock).not.toHaveBeenCalled()
  })
  it('D24 : même allumé en base, le verrou éteint le moteur', () => {
    process.env.OCTOGUARD_ENABLED = 'true'
    process.env.OCTOGUARD_FORCE_OFF = 'true'
    expect(isOctoGuardEnabled()).toBe(false)
  })
  it('éteindre reste toujours possible, même verrouillé', async () => {
    process.env.OCTOGUARD_FORCE_OFF = 'true'
    expect((await put(ADMIN, false)).statusCode).toBe(200)
  })
  it('un membre ne touche pas à l’interrupteur', async () => {
    expect((await put(MEMBER, true)).statusCode).toBe(403)
    expect(setSettingsMock).not.toHaveBeenCalled()
  })
})

// Lot 5 : « Tu es sûr ? » se règle au même endroit, sans toucher à l'interrupteur.
describe('« Tu es sûr ? »', () => {
  let app: Awaited<ReturnType<typeof buildApp>>
  beforeEach(async () => { app = await buildApp(a => a.register(octoguardAdminPlugin, { prefix: '/o' })) })
  const put = (u: string, payload: unknown) => app.inject({ method: 'PUT', url: '/o/settings', headers: { authorization: token(u) }, payload: payload as object })
  const audited = () => vi.mocked(db.query).mock.calls.flatMap(c => (c[1] as unknown[] | undefined) ?? []).filter(v => typeof v === 'string' && v.startsWith('octoguard.'))

  it('l’allumer ne touche ni à l’interrupteur ni aux règles, et s’inscrit au journal', async () => {
    const res = await put(ADMIN, { nudge: true })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ enabled: false, nudge: true })
    expect(setSettingsMock).toHaveBeenCalledWith({ OCTOGUARD_NUDGE: 'true' }, ADMIN)
    expect(reloadMock).not.toHaveBeenCalled()
    expect(audited()).toEqual(['octoguard.nudge_enabled'])
  })
  it('l’éteindre', async () => {
    process.env.OCTOGUARD_NUDGE = 'true'
    const res = await put(ADMIN, { nudge: false })
    expect(res.json()).toEqual({ enabled: false, nudge: false })
    expect(audited()).toEqual(['octoguard.nudge_disabled'])
  })
  it('lu par GET /settings', async () => {
    process.env.OCTOGUARD_NUDGE = 'true'
    const res = await app.inject({ method: 'GET', url: '/o/settings', headers: { authorization: token(ADMIN) } })
    expect(res.json().nudge).toBe(true)
  })
  it('un corps vide est refusé', async () => {
    expect((await put(ADMIN, {})).statusCode).toBe(400)
    expect(setSettingsMock).not.toHaveBeenCalled()
  })
  it('un membre n’y touche pas', async () => {
    expect((await put(MEMBER, { nudge: true })).statusCode).toBe(403)
    expect(setSettingsMock).not.toHaveBeenCalled()
  })
})
