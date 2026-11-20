// Lot 7e : la porte de l'équipe côté serveur. Tant que la charte de l'équipe n'est pas
// signée, les outils de l'équipe répondent CHARTER_TEAM_UNSIGNED ; « qui suis-je » et la
// charte elle-même restent ouverts (sinon on ne pourrait jamais la signer).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import Fastify from 'fastify'

const state = { blocks: false, role: 'moderator' as string }
vi.mock('../middleware/adminOnly', async (orig) => ({
  ...(await orig<typeof import('../middleware/adminOnly')>()),
  verifyStaffSession: vi.fn(async () => ({ userId: '11111111-1111-4111-8111-111111111111', username: 'max' })),
}))
vi.mock('../services/permissions', async (orig) => ({
  ...(await orig<typeof import('../services/permissions')>()),
  getInstanceAccess: vi.fn(async () => ({ role: state.role, permissions: ['moderate_content', 'moderate_members'], rank: 2 })),
}))
vi.mock('../services/charter', () => ({
  teamCharterBlocks: vi.fn(async () => state.blocks),
  TEAM_UNSIGNED: { error: 'Sign the team charter to use the team tools', code: 'CHARTER_TEAM_UNSIGNED' },
}))
vi.mock('../config/database', () => ({ db: { query: vi.fn() }, redis: { setex: vi.fn(async () => 'OK'), exists: vi.fn(async () => 1) } }))

import { requireStaff, requirePermission, requireAnyPermission, TEAM_CHARTER_FREE } from '../middleware/permissions'

async function app() {
  const a = Fastify()
  const ok = async () => ({ ok: true })
  a.get('/api/v1/admin/stats', { preHandler: requireStaff }, ok)
  a.get('/api/v1/admin/me', { preHandler: requireStaff }, ok)
  a.get('/api/v1/admin/charter/team', { preHandler: requireAnyPermission('moderate_members') }, ok)
  a.put('/api/v1/admin/charter/team/settings', { preHandler: requirePermission('moderate_members') }, ok)
  a.post('/api/v1/admin/octoguard/reports/1/resolve', { preHandler: requirePermission('moderate_content') }, ok)
  a.get('/api/v1/admin/charterx', { preHandler: requireStaff }, ok)
  await a.ready()
  return a
}

beforeEach(() => { state.blocks = false; state.role = 'moderator' })

describe('la porte de l’équipe sur les gardes', () => {
  it('charte de l’équipe non signée : les outils refusent avec CHARTER_TEAM_UNSIGNED', async () => {
    state.blocks = true
    const a = await app()
    for (const [method, url] of [['GET', '/api/v1/admin/stats'], ['POST', '/api/v1/admin/octoguard/reports/1/resolve']] as const) {
      const r = await a.inject({ method, url })
      expect([url, r.statusCode, r.json().code]).toEqual([url, 403, 'CHARTER_TEAM_UNSIGNED'])
    }
  })
  it('« qui suis-je » et la charte restent ouverts, sinon on ne pourrait jamais signer', async () => {
    state.blocks = true
    const a = await app()
    for (const [method, url] of [['GET', '/api/v1/admin/me'], ['GET', '/api/v1/admin/charter/team'], ['PUT', '/api/v1/admin/charter/team/settings']] as const) {
      expect([url, (await a.inject({ method, url })).statusCode]).toEqual([url, 200])
    }
  })
  it('l’exception est exacte : /admin/charterx n’est pas la charte', async () => {
    state.blocks = true
    expect((await (await app()).inject({ method: 'GET', url: '/api/v1/admin/charterx' })).statusCode).toBe(403)
    expect(TEAM_CHARTER_FREE.test('/api/v1/admin/me?x=1')).toBe(true)
    expect(TEAM_CHARTER_FREE.test('/api/v1/admin/members')).toBe(false)
  })
  it('signée (ou charte éteinte, ou propriétaire) : tout passe, comme avant', async () => {
    const a = await app()
    expect((await a.inject({ method: 'GET', url: '/api/v1/admin/stats' })).statusCode).toBe(200)
  })
  it('sans le droit, c’est toujours FORBIDDEN (la charte ne donne aucun droit)', async () => {
    state.blocks = true
    const a = Fastify()
    a.get('/api/v1/admin/x', { preHandler: requirePermission('manage_octoguard') }, async () => ({ ok: true }))
    await a.ready()
    expect((await a.inject({ method: 'GET', url: '/api/v1/admin/x' })).json().code).toBe('FORBIDDEN')
  })
})
