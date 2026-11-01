import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import path from 'path'

// Une seule définition du nombre de membres (models/memberCount.ts).
// Ces tests verrouillent la définition elle-même ET le fait qu'aucun appelant
// ne recompte les membres de son côté : c'est exactement comme ça que l'instance
// avait fini avec cinq chiffres différents (158 / 155 / 106 / 105 / 104).

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {},
}))

import { db } from '../config/database'
import { countActiveMembers, ACTIVE_MEMBERS_FROM } from '../models/memberCount'

const sqlOf = () => String(vi.mocked(db.query).mock.calls[0][0]).replace(/\s+/g, ' ')

describe('countActiveMembers', () => {
  beforeEach(() => { vi.mocked(db.query).mockReset() })

  it('renvoie le total et les nouveaux de la semaine', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ total: 104, new_this_week: 3 }] } as never)
    expect(await countActiveMembers()).toEqual({ total: 104, new_this_week: 3 })
  })

  it('renvoie 0 sur une base vide plutôt que undefined', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [] } as never)
    expect(await countActiveMembers()).toEqual({ total: 0, new_this_week: 0 })
  })

  it('compte les membres de la communauté, pas les lignes de users', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ total: 0, new_this_week: 0 }] } as never)
    await countActiveMembers()
    const sql = sqlOf()
    expect(sql).toContain('FROM community_members cm JOIN users u ON u.id = cm.user_id')
    expect(sql).toContain('COUNT(DISTINCT cm.user_id)')
  })

  it('exclut les bots (is_system) et les bannis de la communauté', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ total: 0, new_this_week: 0 }] } as never)
    await countActiveMembers()
    const sql = sqlOf()
    expect(sql).toContain('u.is_system = false')
    expect(sql).toMatch(/NOT EXISTS \( SELECT 1 FROM community_bans cb WHERE cb.community_id = cm.community_id AND cb.user_id = cm.user_id \)/)
  })

  it('mesure les nouveaux à l’entrée dans la communauté (joined_at), pas à la création du compte', async () => {
    vi.mocked(db.query).mockResolvedValueOnce({ rows: [{ total: 0, new_this_week: 0 }] } as never)
    await countActiveMembers()
    const sql = sqlOf()
    expect(sql).toContain("FILTER (WHERE cm.joined_at > NOW() - INTERVAL '7 days')")
    expect(sql).not.toContain('created_at')
  })

  it('expose le même FROM aux listes qui doivent montrer les mêmes membres', () => {
    expect(ACTIVE_MEMBERS_FROM).toContain('u.is_system = false')
    expect(ACTIVE_MEMBERS_FROM).toContain('community_bans')
  })
})

// Garde-fou de source : chaque endroit qui annonce un nombre de membres passe
// par countActiveMembers(), et aucun ne recompte directement dans users.
describe('aucun appelant ne recompte les membres de son côté', () => {
  const src = (f: string) => readFileSync(path.join(__dirname, '..', f), 'utf8')

  const CALLERS = [
    'routes/admin.ts',     // tableau de bord
    'routes/instance.ts',  // page publique de l'instance (member_count)
    'routes/auth.ts',      // limite d'inscriptions NODYX_MAX_MEMBERS
    'routes/members.ts',   // page Membres (counts.total)
    'scheduler.ts',        // ping de l'annuaire
  ]

  for (const f of CALLERS) {
    it(`${f} utilise countActiveMembers()`, () => {
      expect(src(f)).toMatch(/countActiveMembers\(\)/)
    })
  }

  for (const f of ['routes/instance.ts', 'routes/auth.ts', 'routes/members.ts', 'scheduler.ts']) {
    it(`${f} ne compte plus de membres dans users`, () => {
      expect(src(f)).not.toMatch(/COUNT\(\*\)[^`']*FROM users(?! WHERE twitch)/)
    })
  }
})
