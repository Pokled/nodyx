// ─── Le contournement du limiteur de débit par X-Forwarded-For ──────────────
//
// Le cœur tourne derrière Caddy avec Fastify `trustProxy: true`. Dans ce mode,
// `request.ip` n'est PAS l'adresse du socket : elle est dérivée de l'en-tête
// X-Forwarded-For, dont un attaquant contrôle la valeur la plus à gauche.
//
// L'ancien limiteur passait outre sur `request.ip === '127.0.0.1'`, en croyant
// tester le socket. Un attaquant externe envoyant `X-Forwarded-For: 127.0.0.1`
// désactivait donc TOUTE la limitation de débit : brute-force login sans borne,
// spam d'inscription, bombardement d'e-mails de réinitialisation.
//
// Le vrai discriminant du trafic interne (SSR SvelteKit → cœur) est : socket en
// loopback ET aucun en-tête de forwarding. Caddy ajoute toujours un en-tête de
// forwarding au trafic externe, que l'attaquant ne peut pas supprimer.
//
// Ces tests échouent sur le code d'avant le correctif. cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { incrMock, expireMock, ttlMock } = vi.hoisted(() => ({
  incrMock:   vi.fn(),
  expireMock: vi.fn().mockResolvedValue(1),
  ttlMock:    vi.fn().mockResolvedValue(60),
}))

vi.mock('../config/database', () => ({
  redis: { incr: incrMock, expire: expireMock, ttl: ttlMock },
}))

import { rateLimit } from '../middleware/rateLimit'

// Fabrique une requête Fastify minimale : le socket porte le VRAI pair TCP
// (toujours loopback derrière Caddy), les en-têtes portent ce que l'appelant
// a envoyé.
function makeReq(opts: { peer?: string; headers?: Record<string, string> }) {
  return {
    socket:  { remoteAddress: opts.peer ?? '127.0.0.1' },
    headers: opts.headers ?? {},
    // Piège : request.ip est dérivé de XFF sous trustProxy. On le renseigne
    // comme Fastify le ferait (valeur la plus à gauche), pour prouver que le
    // limiteur ne s'y fie PLUS.
    ip: (opts.headers?.['x-forwarded-for']?.split(',')[0].trim()) ?? opts.peer ?? '127.0.0.1',
  } as any
}

function makeReply() {
  const r: any = { code: vi.fn(() => r), send: vi.fn(() => r), header: vi.fn(() => r) }
  return r
}

describe('rateLimit — contournement par en-tête', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    incrMock.mockResolvedValue(1) // sous la limite par défaut
  })

  it('laisse passer le vrai trafic interne SSR (socket loopback, aucun en-tête)', async () => {
    const reply = makeReply()
    await rateLimit(makeReq({ peer: '127.0.0.1', headers: {} }), reply)
    // Aucun compteur touché = bypass legitime
    expect(incrMock).not.toHaveBeenCalled()
  })

  it("N'est PAS contourné par X-Forwarded-For: 127.0.0.1 (l'exploit)", async () => {
    const reply = makeReply()
    // Ce que le cœur reçoit d'un attaquant passé par Caddy : sa valeur usurpée
    // à gauche, le vrai IP ajouté par Caddy à droite.
    await rateLimit(makeReq({ peer: '127.0.0.1', headers: { 'x-forwarded-for': '127.0.0.1, 203.0.113.9' } }), reply)
    // Le limiteur DOIT s'appliquer : le compteur est incrémenté.
    expect(incrMock).toHaveBeenCalledTimes(1)
  })

  it("N'est PAS contourné par X-Forwarded-For: ::1", async () => {
    const reply = makeReply()
    await rateLimit(makeReq({ peer: '127.0.0.1', headers: { 'x-forwarded-for': '::1, 203.0.113.9' } }), reply)
    expect(incrMock).toHaveBeenCalledTimes(1)
  })

  it("N'est PAS contourné par X-Real-IP: 127.0.0.1", async () => {
    const reply = makeReply()
    await rateLimit(makeReq({ peer: '127.0.0.1', headers: { 'x-real-ip': '127.0.0.1' } }), reply)
    expect(incrMock).toHaveBeenCalledTimes(1)
  })

  it("N'est PAS contourné par CF-Connecting-IP: 127.0.0.1", async () => {
    const reply = makeReply()
    await rateLimit(makeReq({ peer: '127.0.0.1', headers: { 'cf-connecting-ip': '127.0.0.1' } }), reply)
    expect(incrMock).toHaveBeenCalledTimes(1)
  })

  it('applique bien la limite à un client externe normal', async () => {
    const reply = makeReply()
    incrMock.mockResolvedValue(101) // au-dessus de la limite
    await rateLimit(makeReq({ peer: '127.0.0.1', headers: { 'x-forwarded-for': '203.0.113.9' } }), reply)
    expect(reply.code).toHaveBeenCalledWith(429)
  })
})
