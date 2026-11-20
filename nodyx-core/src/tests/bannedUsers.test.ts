// « Bannir cache tout » : l'aide commune. Le parcours complet est prouvé au banc
// (19 vérifications, 11 tombent sur l'ancien code).
import { describe, it, expect, vi } from 'vitest'
const q = vi.fn(async () => ({ rows: [] as unknown[] }))
vi.mock('../config/database', () => ({ db: { query: (...a: unknown[]) => q(...(a as [])) } }))
vi.mock('../services/permissions', () => ({ getInstanceAccess: vi.fn(async (id: string) => {
  if (id === 'panne') throw new Error('base indisponible')
  return { permissions: id === 'modo' ? ['moderate_content'] : [] }
}) }))
import { ACTIVE_BAN, viewerIsTeam, activeBanOf } from '../services/bannedUsers'

describe('le bannissement actif', () => {
  it('sans fin, ou dont la fin n’est pas passée', () => {
    expect(ACTIVE_BAN('u.id')).toBe('EXISTS (SELECT 1 FROM community_bans cb WHERE cb.user_id = u.id AND (cb.expires_at IS NULL OR cb.expires_at > NOW()))')
  })
  it('activeBanOf lit le même critère, le plus récent d’abord', async () => {
    await activeBanOf('x')
    expect(String(q.mock.calls.at(-1)?.[0])).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)[\s\S]*ORDER BY banned_at DESC LIMIT 1/)
  })
})
describe('qui voit encore un banni', () => {
  it('l’équipe (au moins un droit), personne d’autre', async () => {
    expect(await viewerIsTeam('modo')).toBe(true)
    expect(await viewerIsTeam('membre')).toBe(false)
    expect(await viewerIsTeam(null)).toBe(false)
  })
  it('une panne de lecture ne montre rien de plus (on cache)', async () => {
    expect(await viewerIsTeam('panne')).toBe(false)
  })
})
