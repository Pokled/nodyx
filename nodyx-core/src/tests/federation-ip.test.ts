// ─── Le blocage federe ne doit pas casser les instances des autres ───────────
//
// CONTEXTE. La migration 113 pose une contrainte CHECK refusant les adresses
// privees dans `reported_ips` : il y en avait 102 sur 118, du bruit distribue a
// tout le reseau.
//
// MAIS l'insertion n'etait pas protegee. Une instance TIERCE signalant du
// `127.0.0.1` recevait donc une erreur 500. Et le cas est reel : toute instance
// tournant une version anterieure au correctif d'identification du 2026-08-17
// enregistre `127.0.0.1` pour ses visiteurs. Au moins sept instances existent
// dans l'annuaire, dont une active le jour meme.
//
// Casser l'instance de quelqu'un d'autre avec une contrainte posee chez soi est
// exactement ce qu'un projet federe ne doit pas faire.

import { describe, it, expect, vi, beforeEach } from 'vitest'

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

import { estPubliquementRoutable } from '../utils/clientIp'
import { db } from '../config/database'
import directoryRoutes from '../routes/directory'
import { buildApp } from './helpers/buildApp'

describe('signalement federe : quelles adresses sont acceptables', () => {
  it('refuse ce qu une instance mal configuree enverrait', () => {
    // Ce sont les valeurs REELLEMENT observees avant correctif.
    for (const ip of ['127.0.0.1', '::1', '10.0.0.5', '192.168.1.9', '172.16.4.2', 'fe80::1']) {
      expect(estPubliquementRoutable(ip), ip).toBe(false)
    }
  })

  it('refuse une adresse Cloudflare : notre propre infrastructure', () => {
    // Vue telle quelle dans les donnees du 17/08, remontee comme un client.
    expect(estPubliquementRoutable('2a06:98c0:3600::103')).toBe(false)
    expect(estPubliquementRoutable('162.158.1.1')).toBe(false)
  })

  it('refuse les plages de documentation, qui n appartiennent a personne', () => {
    expect(estPubliquementRoutable('203.0.113.9')).toBe(false)
    expect(estPubliquementRoutable('198.51.100.4')).toBe(false)
  })

  it('accepte une vraie adresse d attaquant', () => {
    // Observees dans le pot de miel le 17/08.
    for (const ip of ['103.78.255.128', '62.60.130.128', '91.92.241.196', '2a01:4f8:1c19:a30c::1']) {
      expect(estPubliquementRoutable(ip), ip).toBe(true)
    }
  })
})

// ── La regression elle-meme, vue par la route ───────────────────────────────
//
// Les controles ci-dessus portent sur une fonction qui existait DEJA : ils
// passeraient tels quels sur le code d'avant, donc ils ne prouvent rien de la
// correction. Ceux qui suivent interrogent la route.
//
// La base moquee reproduit la contrainte CHECK de la migration 113 : toute
// insertion d'une adresse non publique leve. C'est la 500 constatee. Le
// correctif se mesure donc a une chose simple, l'insertion n'est JAMAIS
// atteinte. cf feedback_test_first_critical.

const TOKEN = 'tok_instance_secret'

/** Le SELECT de jeton repond, l'INSERT se comporte comme PostgreSQL avec la contrainte. */
function baseAvecContrainte() {
  vi.mocked(db.query).mockImplementation(async (sql: unknown, params?: unknown) => {
    const texte = String(sql)
    if (texte.includes('INSERT INTO reported_ips')) {
      const ip = (params as unknown[])?.[0]
      if (!estPubliquementRoutable(String(ip))) {
        throw new Error(
          'new row for relation "reported_ips" violates check constraint "reported_ips_ip_publique"',
        )
      }
      return { rows: [], rowCount: 1 } as never
    }
    return { rows: [{ slug: 'instance-tierce' }] } as never
  })
}

/** Combien de fois l'INSERT a reellement ete tente. */
function insertionsTentees(): number {
  return vi.mocked(db.query).mock.calls.filter(
    ([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO reported_ips'),
  ).length
}

async function signaler(ip: string) {
  const app = await buildApp(async (a) => {
    await a.register(directoryRoutes, { prefix: '/api' })
  })
  const res = await app.inject({
    method: 'POST',
    url: '/api/directory/report-ip',
    payload: { token: TOKEN, ip, reason: 'honeypot', path: '/wp-login.php' },
  })
  await app.close()
  return res
}

describe('POST /api/directory/report-ip : ne pas renvoyer une panne a une instance tierce', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    baseAvecContrainte()
  })

  it('repond 400 et non 500 quand une instance signale du loopback', async () => {
    const res = await signaler('127.0.0.1')

    // Sur le code d'avant : l'INSERT partait, la contrainte levait, Fastify
    // renvoyait 500. C'est precisement ce que ce controle interdit.
    expect(res.statusCode).toBe(400)
    expect(res.statusCode).not.toBe(500)
  })

  it("porte un code stable, pour que l'instance emettrice sache quoi corriger", async () => {
    const res = await signaler('127.0.0.1')
    expect(res.json()).toMatchObject({ code: 'IP_NOT_ROUTABLE' })
  })

  it("n'atteint JAMAIS l'insertion : c'est la mesure du correctif", async () => {
    for (const ip of ['127.0.0.1', '192.168.1.9', '10.0.0.5', '::1']) {
      vi.resetAllMocks()
      baseAvecContrainte()

      const res = await signaler(ip)
      expect(res.statusCode, ip).toBe(400)
      expect(insertionsTentees(), `l'INSERT a ete tente pour ${ip}`).toBe(0)
    }
  })

  it("laisse evidemment passer un vrai attaquant : on ne casse pas la federation", async () => {
    const res = await signaler('62.60.130.128')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true })
    expect(insertionsTentees()).toBe(1)
  })
})
