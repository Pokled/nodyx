// ─── request.ip résiste-t-il à un X-Forwarded-For usurpé ? ──────────────────
//
// Le cœur dérive request.ip de X-Forwarded-For, que le visiteur peut
// pré-remplir de fausses lignes. La sécurité repose entièrement sur la liste de
// proxys de confiance passée à `Fastify({ trustProxy })`.
//
// Avec l'ancien `trustProxy: true`, request.ip = la valeur la plus à gauche =
// contrôlée par l'attaquant (usurpation de 127.0.0.1, désactivation du limiteur,
// pollution de tous les logs d'IP). Avec la liste loopback + privé + Cloudflare,
// request.ip = la vraie adresse du visiteur dans TOUTES les topologies.
//
// Ces tests montent une vraie instance Fastify avec la config de production et
// vérifient request.ip pour chaque chaîne X-Forwarded-For que le cœur peut
// recevoir. Ils échouent sous `trustProxy: true`. cf feedback_test_first_critical.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { getTrustProxy } from '../config/trustedProxies'

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ trustProxy: getTrustProxy() })
  app.get('/ip', (req, reply) => reply.send({ ip: req.ip }))
  await app.ready()
})

afterAll(async () => { await app?.close() })

// socket = loopback (Caddy → cœur), comme en production. On ne fait varier que
// X-Forwarded-For, ce que l'attaquant et les proxys écrivent.
async function ipFor(xff?: string): Promise<string> {
  const headers = xff !== undefined ? { 'x-forwarded-for': xff } : {}
  const res = await app.inject({ method: 'GET', url: '/ip', headers })
  return JSON.parse(res.body).ip
}

describe('request.ip via trustProxy (loopback + privé + Cloudflare)', () => {
  it('trafic interne SSR (aucun X-Forwarded-For) = loopback', async () => {
    expect(await ipFor(undefined)).toMatch(/^(127\.0\.0\.1|::1|::ffff:127\.0\.0\.1)$/)
  })

  it('visiteur self-host (Caddy direct) = sa vraie adresse', async () => {
    // Caddy a ajouté la vraie IP à droite.
    expect(await ipFor('203.0.113.50')).toBe('203.0.113.50')
  })

  it('visiteur nodyx.org (Cloudflare + Caddy) = sa vraie adresse', async () => {
    // Cloudflare ajoute la vraie IP, Caddy ajoute l'edge Cloudflare à droite.
    expect(await ipFor('203.0.113.50, 173.245.48.10')).toBe('203.0.113.50')
  })

  it("ATTAQUANT self-host, préfixe 127.0.0.1 usurpé = ignoré", async () => {
    expect(await ipFor('127.0.0.1, 203.0.113.99')).toBe('203.0.113.99')
  })

  it("ATTAQUANT nodyx.org, préfixe 127.0.0.1 usurpé = ignoré", async () => {
    expect(await ipFor('127.0.0.1, 203.0.113.99, 173.245.48.10')).toBe('203.0.113.99')
  })

  it("ATTAQUANT, préfixe IP publique arbitraire (8.8.8.8) = ignoré", async () => {
    expect(await ipFor('8.8.8.8, 203.0.113.99, 173.245.48.10')).toBe('203.0.113.99')
  })

  it("ne se laisse JAMAIS réduire à loopback par un en-tête (le cœur de l'exploit)", async () => {
    for (const xff of ['127.0.0.1, 203.0.113.99', '::1, 203.0.113.99', '127.0.0.1, 203.0.113.99, 173.245.48.10']) {
      expect(await ipFor(xff)).not.toMatch(/^(127\.0\.0\.1|::1)$/)
    }
  })
})

describe('getTrustProxy — réglages d\'échappatoire', () => {
  it('TRUST_PROXY=true rétablit le comportement historique (override explicite)', () => {
    process.env.TRUST_PROXY = 'true'
    expect(getTrustProxy()).toBe(true)
    delete process.env.TRUST_PROXY
  })

  it('TRUST_PROXY=2 est interprété comme un nombre de hops', () => {
    process.env.TRUST_PROXY = '2'
    expect(getTrustProxy()).toBe(2)
    delete process.env.TRUST_PROXY
  })

  it('TRUSTED_PROXIES_EXTRA ajoute des plages à la liste par défaut', () => {
    process.env.TRUSTED_PROXIES_EXTRA = '10.8.0.0/24'
    const v = getTrustProxy() as string[]
    expect(Array.isArray(v)).toBe(true)
    expect(v).toContain('10.8.0.0/24')
    expect(v).toContain('loopback')
    delete process.env.TRUSTED_PROXIES_EXTRA
  })

  it('par défaut : liste incluant loopback et les plages Cloudflare', () => {
    const v = getTrustProxy() as string[]
    expect(v).toContain('loopback')
    expect(v).toContain('173.245.48.0/20')
  })
})
