// ─── Annuaire fédéré : le heartbeat doit rafraîchir la version ───────────────
//
// Avant le fix, `POST /api/directory/ping` mettait à jour last_seen, members,
// online, les visuels et l'IP, mais JAMAIS `version`. La colonne n'était écrite
// qu'à l'enregistrement initial, donc une instance affichait à vie la version
// qu'elle avait le jour de son inscription. Constaté en prod : sleemstudio
// annonçait 2.11.0 par son API alors que l'annuaire de nodyx.org la donnait
// encore en 2.10.0, et rien ne l'aurait jamais corrigé.
//
// Ces tests échoueraient sur le code d'avant : le paramètre `version` n'existait
// pas dans la requête. cf feedback_test_first_critical.

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

const TOKEN = 'tok_instance_secret'

/** Le SQL et les paramètres réellement envoyés à Postgres par le ping. */
function pingCall() {
  const call = vi.mocked(db.query).mock.calls.find(
    ([sql]) => typeof sql === 'string' && sql.includes('UPDATE directory_instances'),
  )
  if (!call) throw new Error('aucun UPDATE directory_instances exécuté')
  return { sql: call[0] as string, params: call[1] as unknown[] }
}

async function ping(body: Record<string, unknown>) {
  const app = await buildApp(async (a) => { await a.register(directoryRoutes, { prefix: '/api' }) })
  const res = await app.inject({ method: 'POST', url: '/api/directory/ping', payload: body })
  await app.close()
  return res
}

describe('POST /api/directory/ping — fraîcheur de la version', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(db.query).mockResolvedValue({ rows: [{ slug: 'sleemstudio', status: 'active' }] } as never)
  })

  it("écrit la version envoyée par l'instance", async () => {
    const res = await ping({ token: TOKEN, members: 2, online: 0, version: '2.11.0' })
    expect(res.statusCode).toBe(200)

    const { sql, params } = pingCall()
    expect(sql).toMatch(/version\s*=/)
    expect(params).toContain('2.11.0')
  })

  it("ne touche PAS à la version quand le ping n'en envoie pas (instance plus ancienne)", async () => {
    await ping({ token: TOKEN, members: 2, online: 0 })

    const { sql, params } = pingCall()
    // La garde est double : COALESCE côté SQL, et null côté paramètre.
    expect(sql).toMatch(/version\s*=\s*COALESCE\(/)
    expect(params[params.length - 1]).toBeNull()
  })

  it("n'écrase pas une version connue par une chaîne vide", async () => {
    await ping({ token: TOKEN, version: '' })

    const { sql } = pingCall()
    // NULLIF transforme '' en NULL, que COALESCE renvoie ensuite sur l'existant.
    expect(sql).toMatch(/COALESCE\(NULLIF\(\$\d+,\s*''\),\s*version\)/)
  })

  it('continue de rafraîchir last_seen, membres et présence', async () => {
    await ping({ token: TOKEN, members: 7, online: 3, version: '2.11.0' })

    const { sql, params } = pingCall()
    expect(sql).toMatch(/last_seen\s*=\s*NOW\(\)/)
    expect(params).toContain(7)
    expect(params).toContain(3)
  })

  it('refuse un ping sans token', async () => {
    const res = await ping({ version: '2.11.0' })
    expect(res.statusCode).toBe(400)
    expect(vi.mocked(db.query)).not.toHaveBeenCalled()
  })

  it('répond 404 sur un token inconnu, sans rien prétendre mettre à jour', async () => {
    vi.mocked(db.query).mockResolvedValue({ rows: [] } as never)
    const res = await ping({ token: 'tok_inconnu', version: '2.11.0' })
    expect(res.statusCode).toBe(404)
  })
})
