// ─── Le rate-limit exempte-t-il les appels internes du frontend, et EUX SEULS ? ─
//
// Contexte : le SSR du frontend rend une page en tirant ~8 requêtes core, en
// injectant le X-Forwarded-For du visiteur (pour bans/inscriptions). Sans
// exemption, ces requêtes sont comptées au nom du visiteur : ~12 pages épuisent
// son quota -> 429 -> pages vides en cascade (incident cyclique du 2026-08-08).
//
// La frontière est un secret partagé (INTERNAL_API_SECRET) que seul le frontend
// connaît. Ce test prouve les quatre propriétés qui rendent le correctif sûr :
//   1. bon secret            -> exempté (redis jamais touché)
//   2. secret forgé          -> rate-limité comme n'importe quel externe
//   3. aucun secret configuré-> l'en-tête est ignoré (fail-closed)
//   4. longueur invalide     -> pas de crash timingSafeEqual, pas de bypass
// cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { incrMock, expireMock, ttlMock } = vi.hoisted(() => ({
	incrMock:   vi.fn(),
	expireMock: vi.fn(),
	ttlMock:    vi.fn(),
}))

vi.mock('../config/database', () => ({
	redis: { incr: incrMock, expire: expireMock, ttl: ttlMock },
	db:    { query: vi.fn() },
}))

import { rateLimit } from '../middleware/rateLimit'

const SECRET = 'a'.repeat(64)

// Stubs minimalistes de FastifyRequest / FastifyReply : le middleware ne lit que
// headers, socket.remoteAddress, ip côté requête, et pose code/header/send côté
// réponse. Pas besoin d'un serveur Fastify complet pour un test d'unité.
function makeReq(headers: Record<string, string>, socketPeer = '127.0.0.1', ip?: string) {
	return {
		headers,
		socket: { remoteAddress: socketPeer },
		ip: ip ?? socketPeer,
	} as any
}

function makeReply() {
	const r: any = {
		statusCode: 200,
		sentHeaders: {} as Record<string, string>,
		header(k: string, v: string) { this.sentHeaders[k] = v; return this },
		code(c: number) { this.statusCode = c; return this },
		send(payload: any) { this.payload = payload; return this },
	}
	return r
}

describe('rateLimit — exemption des appels internes SSR (secret partagé)', () => {
	beforeEach(() => {
		vi.clearAllMocks()
		incrMock.mockResolvedValue(1)
		expireMock.mockResolvedValue(1)
		ttlMock.mockResolvedValue(60)
	})
	afterEach(() => { delete process.env.INTERNAL_API_SECRET })

	it('bon secret interne -> exempté, redis jamais touché', async () => {
		process.env.INTERNAL_API_SECRET = SECRET
		const req = makeReq({ 'x-nodyx-internal': SECRET, 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1', '203.0.113.9')
		const reply = makeReply()
		await rateLimit(req, reply)
		expect(incrMock).not.toHaveBeenCalled()
		expect(reply.statusCode).toBe(200)
	})

	it('bon secret : même compteur déjà au plafond, jamais de 429', async () => {
		process.env.INTERNAL_API_SECRET = SECRET
		incrMock.mockResolvedValue(999_999) // le plafond serait largement dépassé...
		const req = makeReq({ 'x-nodyx-internal': SECRET, 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1', '203.0.113.9')
		const reply = makeReply()
		await rateLimit(req, reply)
		expect(reply.statusCode).toBe(200)   // ...mais on a court-circuité avant l'incr
		expect(incrMock).not.toHaveBeenCalled()
	})

	it('secret interne FORGÉ -> pas de bypass, rate-limité comme un externe', async () => {
		process.env.INTERNAL_API_SECRET = SECRET
		incrMock.mockResolvedValue(101) // au-dessus du plafond (100)
		const req = makeReq({ 'x-nodyx-internal': 'b'.repeat(64), 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1', '203.0.113.9')
		const reply = makeReply()
		await rateLimit(req, reply)
		expect(incrMock).toHaveBeenCalled()
		expect(reply.statusCode).toBe(429)
	})

	it('aucun secret configuré -> en-tête interne ignoré (fail-closed) + XFF présent => compté', async () => {
		delete process.env.INTERNAL_API_SECRET
		incrMock.mockResolvedValue(101)
		const req = makeReq({ 'x-nodyx-internal': SECRET, 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1', '203.0.113.9')
		const reply = makeReply()
		await rateLimit(req, reply)
		expect(reply.statusCode).toBe(429)
	})

	it('en-tête de longueur invalide -> pas de crash timingSafeEqual, pas de bypass', async () => {
		process.env.INTERNAL_API_SECRET = SECRET
		incrMock.mockResolvedValue(101)
		const req = makeReq({ 'x-nodyx-internal': 'court', 'x-forwarded-for': '203.0.113.9' }, '127.0.0.1', '203.0.113.9')
		const reply = makeReply()
		await rateLimit(req, reply)
		expect(reply.statusCode).toBe(429)
	})

	it('appel loopback pur (aucun en-tête) -> bypass loopback conservé (dégradation gracieuse)', async () => {
		const req = makeReq({}, '127.0.0.1', '127.0.0.1')
		const reply = makeReply()
		await rateLimit(req, reply)
		expect(incrMock).not.toHaveBeenCalled()
		expect(reply.statusCode).toBe(200)
	})
})
