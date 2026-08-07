// ─── Service des fichiers uploadés (@fastify/static) ────────────────────────
//
// `@fastify/static` est enregistré une seule fois, dans index.ts, pour servir
// `uploads/` sous le préfixe `/uploads/`. Rien ne le testait : une montée de
// version majeure pouvait donc casser silencieusement TOUS les avatars, images
// et pièces jointes de l'instance, et seuls les visiteurs s'en seraient rendu
// compte.
//
// Écrit lors du passage de la version 9 à la 10, motivé par un avis de sécurité
// (contournement d'autorisation par URL non canonique). Le test reproduit
// exactement la configuration de production, options comprises.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'

let app: FastifyInstance
let root: string

const CONTENU = 'nodyx-avatar-bytes'

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), 'nodyx-uploads-'))
	mkdirSync(join(root, 'avatars'), { recursive: true })
	writeFileSync(join(root, 'avatars', 'moi.png'), CONTENU)

	// Un fichier HORS du dossier servi : c'est lui qu'une traversée de chemin
	// chercherait à atteindre.
	writeFileSync(join(root, '..', 'nodyx-secret-hors-racine.txt'), 'JAMAIS SERVI')

	app = Fastify({ logger: false })
	// Configuration identique à celle d'index.ts.
	await app.register(fastifyStatic, {
		root,
		prefix: '/uploads/',
		decorateReply: false,
	})
	await app.ready()
})

afterAll(async () => {
	await app?.close()
	rmSync(root, { recursive: true, force: true })
	rmSync(join(root, '..', 'nodyx-secret-hors-racine.txt'), { force: true })
})

describe('/uploads/ sert bien les fichiers', () => {
	it('renvoie un fichier existant avec son contenu', async () => {
		const res = await app.inject({ method: 'GET', url: '/uploads/avatars/moi.png' })
		expect(res.statusCode).toBe(200)
		expect(res.body).toBe(CONTENU)
	})

	it('renvoie 404 sur un fichier absent', async () => {
		const res = await app.inject({ method: 'GET', url: '/uploads/avatars/inexistant.png' })
		expect(res.statusCode).toBe(404)
	})

	it("ne sert rien en dehors du préfixe", async () => {
		const res = await app.inject({ method: 'GET', url: '/avatars/moi.png' })
		expect(res.statusCode).toBe(404)
	})
})

describe('/uploads/ ne laisse pas sortir de sa racine', () => {
	// Les formes d'échappement classiques, dont celles qui exploitent un
	// décodage non canonique : c'est la famille visée par l'avis de sécurité
	// qui a motivé le passage en version 10.
	const evasions = [
		'/uploads/../nodyx-secret-hors-racine.txt',
		'/uploads/..%2Fnodyx-secret-hors-racine.txt',
		'/uploads/%2e%2e/nodyx-secret-hors-racine.txt',
		'/uploads/%2e%2e%2fnodyx-secret-hors-racine.txt',
		'/uploads/..%252Fnodyx-secret-hors-racine.txt',
		'/uploads/....//nodyx-secret-hors-racine.txt',
		'/uploads/.%2e/nodyx-secret-hors-racine.txt',
	]

	for (const url of evasions) {
		it(`refuse ${url}`, async () => {
			const res = await app.inject({ method: 'GET', url })
			expect(res.statusCode).not.toBe(200)
			expect(res.body).not.toContain('JAMAIS SERVI')
		})
	}
})
