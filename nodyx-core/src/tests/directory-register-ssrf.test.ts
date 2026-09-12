// ─── POST /directory/register résiste au DNS rebinding ──────────────────────
//
// Trouvé en audit de stabilité (F-055, 2026-09-11) : la validation anti-SSRF
// de cette route (et de /directory/gossip/receive) jugeait la CHAÎNE du
// hostname, jamais l'adresse réellement résolue. Un domaine au nom innocent
// qui pointe vers une IP privée passait la validation. Ce test tombe sur
// l'ancien code : sans résolution DNS, aucune raison de rejeter un hostname
// qui NE CONTIENT aucun motif d'IP privée dans son nom. cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('dns/promises', () => ({
  default: { lookup: vi.fn() },
}))

vi.mock('../config/database', () => ({
  db: { query: vi.fn() },
  redis: {
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(60),
  },
}))

import dns from 'dns/promises'
import { db } from '../config/database'
import { buildApp } from './helpers/buildApp'
import directoryRoutes from '../routes/directory'

async function register(url: string) {
  const app = await buildApp(async (a) => { await a.register(directoryRoutes, { prefix: '/api' }) })
  const res = await app.inject({
    method: 'POST',
    url: '/api/directory/register',
    payload: { name: 'Test', slug: 'test-instance', url },
  })
  await app.close()
  return res
}

describe('POST /api/directory/register — anti rebinding DNS', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    // Par défaut : pas de slug existant. Les tests qui passent la garde SSRF
    // et continuent plus loin dans la route (Cloudflare, activation) ne sont
    // pas notre objet ici — seule la garde anti-rebinding est sous test.
    vi.mocked(db.query).mockResolvedValue({ rows: [{ id: 'fake-instance-id' }] } as never)
  })

  it("rejette un hostname au nom innocent qui résout vers une IP privée (rebinding)", async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: '169.254.169.254', family: 4 } as never)

    const res = await register('https://metadonnees-legitimes.example.com')

    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/private|reserved/i)
    expect(dns.lookup).toHaveBeenCalledWith('metadonnees-legitimes.example.com')
  })

  it('rejette toujours une IP privée littérale, sans même consulter le DNS', async () => {
    const res = await register('https://127.0.0.1')

    expect(res.statusCode).toBe(400)
    expect(dns.lookup).not.toHaveBeenCalled()
  })

  it('accepte un hostname qui résout vers une vraie adresse publique', async () => {
    vi.mocked(dns.lookup).mockResolvedValueOnce({ address: '203.0.113.42', family: 4 } as never)

    const res = await register('https://une-vraie-instance-federee.org')

    // Passe la garde SSRF : la résolution DNS a eu lieu, et le rejet
    // spécifique « private/reserved » (celui que testent les 2 cas ci-dessus)
    // n'est pas ce qui a produit la réponse.
    expect(dns.lookup).toHaveBeenCalledWith('une-vraie-instance-federee.org')
    const body = JSON.parse(res.body)
    if (body?.error) expect(body.error).not.toMatch(/private|reserved/i)
  })
})
