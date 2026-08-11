// ─── Annuaire fédéré : qui a le droit d'être affiché ────────────────────────
//
// Deux défauts corrigés ensemble, tous deux constatés en production :
//
// 1. `last_seen IS NULL` était un passe-droit ILLIMITÉ. Une instance qui
//    s'enregistrait puis n'était jamais allumée échappait à la règle des 15
//    minutes (qui ne s'applique qu'à celles ayant déjà pingé) et restait donc
//    affichée À VIE. Cas réel : « GameDev Fr », inscrite en mars, jamais un
//    seul ping, toujours listée cinq mois plus tard.
//
// 2. `archived_at` (migration 083) n'était lu NULLE PART. La migration avait
//    pourtant créé la colonne ET un index partiel `WHERE archived_at IS NULL`,
//    en documentant l'intention : « exclue de la carte et de la liste
//    principale ». La fonctionnalité était livrée à moitié : archiver une
//    instance n'avait aucun effet visible.
//
// Ces tests échouent sur le code d'avant. cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  },
}))

import { db } from '../config/database'
import directoryRoutes from '../routes/directory'

/** Le SQL réellement envoyé à Postgres par la liste publique. */
async function listSql(): Promise<string> {
  vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)
  const app = await buildApp(async (a) => { await a.register(directoryRoutes, { prefix: '/api' }) })
  const res = await app.inject({ method: 'GET', url: '/api/directory' })
  await app.close()
  expect(res.statusCode).toBe(200)

  const call = vi.mocked(db.query).mock.calls.find(
    ([sql]) => typeof sql === 'string' && sql.includes('FROM directory_instances'),
  )
  if (!call) throw new Error('aucun SELECT directory_instances exécuté')
  return call[0] as string
}

/** Sans les commentaires SQL, pour ne tester que la clause réellement exécutée. */
function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '')
}

describe('GET /api/directory — règles de visibilité', () => {
  beforeEach(() => { vi.resetAllMocks() })

  it('exclut les instances archivées', async () => {
    const sql = withoutComments(await listSql())
    expect(sql).toMatch(/archived_at\s+IS\s+NULL/i)
  })

  it("n'accorde plus de visibilité illimitée à une instance qui n'a jamais pingé", async () => {
    const sql = withoutComments(await listSql())

    // Le passe-droit doit être BORNÉ : s'il reste un `last_seen IS NULL`, il
    // doit être accompagné d'une contrainte sur registered_at.
    const hasNullClause = /last_seen\s+IS\s+NULL/i.test(sql)
    if (hasNullClause) {
      expect(sql).toMatch(/registered_at\s*>\s*NOW\(\)\s*-\s*INTERVAL/i)
    }
  })

  it('garde la règle des 15 minutes pour les instances qui ont déjà pingé', async () => {
    const sql = withoutComments(await listSql())
    expect(sql).toMatch(/last_seen\s*>\s*NOW\(\)\s*-\s*INTERVAL\s*'15 minutes'/i)
  })

  it("ne liste que les instances au statut 'active'", async () => {
    const sql = withoutComments(await listSql())
    expect(sql).toMatch(/status\s*=\s*'active'/i)
  })
})
