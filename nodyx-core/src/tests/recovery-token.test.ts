// ─── Le lien produit par nodyx-recover est-il accepté par le vrai endpoint ? ─
//
// L'outil de récupération ne réimplémente pas la réinitialisation : il génère un
// jeton et le range dans password_resets, puis c'est le flux web habituel
// (POST /auth/reset-password/:token) qui le consomme. Ce test prouve la
// COMPATIBILITÉ de bout en bout : on génère un jeton comme l'outil, on simule
// son stockage, on l'envoie à l'endpoint réel, et le mot de passe change.
//
// Si le format du jeton ou du hash divergeait un jour, ce test casse.
// cf feedback_test_first_critical.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { buildApp } from './helpers/buildApp'
import { generateResetToken, hashResetToken } from '../scripts/recoveryToken'

const { dbQueryMock } = vi.hoisted(() => ({ dbQueryMock: vi.fn() }))

vi.mock('../config/database', () => ({
	db:    { query: dbQueryMock },
	redis: {
		del: vi.fn(), get: vi.fn().mockResolvedValue(null), set: vi.fn(),
		smembers: vi.fn().mockResolvedValue([]), keys: vi.fn().mockResolvedValue([]), scan: vi.fn().mockResolvedValue(['0', []]),
		// le preHandler rateLimit s'exécute sous inject (socket non-loopback) : il faut ses méthodes
		incr: vi.fn().mockResolvedValue(1), expire: vi.fn().mockResolvedValue(1), ttl: vi.fn().mockResolvedValue(60),
	},
}))

import { db } from '../config/database'
import authRoutes from '../routes/auth'

const USER_ID = '11111111-1111-1111-1111-111111111111'

describe('nodyx-recover : le jeton généré est consommable par /auth/reset-password', () => {
	// clearAllMocks (pas reset) : on efface l'historique d'appels mais on GARDE
	// les mockResolvedValue du mock Redis, sinon smembers renverrait undefined et
	// invalidateUserSessions planterait (500) sans rapport avec ce qu'on teste.
	beforeEach(() => vi.clearAllMocks())

	it('génère un jeton 256 bits (64 hex) et son hash SHA-256', () => {
		const t = generateResetToken(1800)
		expect(t.rawToken).toMatch(/^[0-9a-f]{64}$/)
		expect(t.tokenHash).toBe(hashResetToken(t.rawToken))
		expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/)
		expect(t.expiresAt.getTime()).toBeGreaterThan(Date.now())
	})

	it('le lien mène à une réinitialisation qui aboutit (cycle complet)', async () => {
		// 1. L'outil génère le jeton (ce que fait mintResetLink).
		const { rawToken, tokenHash } = generateResetToken(1800)

		// 2. On simule la base : l'endpoint fait un UPDATE ... RETURNING user_id
		//    sur la ligne dont token_hash correspond. On ne rend l'utilisateur QUE
		//    si le hash reçu == celui que l'outil a rangé. C'est la preuve de compat.
		let passwordUpdated = false
		dbQueryMock.mockImplementation((sql: string, params?: unknown[]) => {
			if (sql.includes('UPDATE password_resets') && sql.includes('RETURNING user_id')) {
				return Promise.resolve({ rows: params?.[0] === tokenHash ? [{ user_id: USER_ID }] : [] })
			}
			if (sql.includes('UPDATE users SET password')) {
				passwordUpdated = true
				return Promise.resolve({ rows: [] })
			}
			return Promise.resolve({ rows: [] }) // invalidateUserSessions, etc.
		})

		const app = await buildApp(async (a) => { await a.register(authRoutes, { prefix: '/api/v1/auth' }) })
		const res = await app.inject({
			method:  'POST',
			url:     `/api/v1/auth/reset-password/${rawToken}`,
			payload: { password: 'un-nouveau-mot-de-passe-solide' },
		})
		await app.close()

		expect(res.statusCode).toBe(200)
		expect(passwordUpdated).toBe(true)
	})

	it('un jeton FORGÉ (non émis par l\'outil) est refusé', async () => {
		dbQueryMock.mockImplementation((sql: string) => {
			if (sql.includes('UPDATE password_resets') && sql.includes('RETURNING user_id')) {
				return Promise.resolve({ rows: [] }) // aucun hash ne correspond
			}
			return Promise.resolve({ rows: [] })
		})

		const app = await buildApp(async (a) => { await a.register(authRoutes, { prefix: '/api/v1/auth' }) })
		const res = await app.inject({
			method:  'POST',
			url:     '/api/v1/auth/reset-password/' + 'f'.repeat(64),
			payload: { password: 'peu-importe-le-mot-de-passe' },
		})
		await app.close()

		expect(res.statusCode).toBe(400)
	})
})
