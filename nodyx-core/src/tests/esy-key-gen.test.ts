// ─── Génération automatique de instance.esy au démarrage ────────────────────
//
// Jusqu'au 23/09, `instance.esy` n'était créé QUE par `npm run generate-esy`,
// une commande manuelle jamais appelée par un installeur ni documentée nulle
// part. Résultat en prod : nodyx.org avait sa clé (générée à la main en mars),
// mais vieuxlooters/sleemstudio/demo tournaient sans — DM chiffrés cassés en
// silence sur les 3 (issue #752). `ensureEsyKeyExists()` corrige ça en
// générant la clé au boot si absente ; ces tests échoueraient sur l'ancien
// script (qui n'exposait aucune fonction appelable, seulement un `main()` lancé
// en side-effect au require du module).

import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

describe('ensureEsyKeyExists', () => {
	let tmpDir: string | null = null

	afterEach(() => {
		delete process.env.ESY_KEY_PATH
		if (tmpDir) { fs.rmSync(tmpDir, { recursive: true, force: true }); tmpDir = null }
	})

	function freshEsyPath(): string {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nodyx-esy-test-'))
		const esyPath = path.join(tmpDir, 'instance.esy')
		process.env.ESY_KEY_PATH = esyPath
		return esyPath
	}

	it('genere un fichier valide quand il n\'existe pas encore', async () => {
		const esyPath = freshEsyPath()
		const { ensureEsyKeyExists } = await import('../utils/esyKeyGen')

		expect(fs.existsSync(esyPath)).toBe(false)
		const result = ensureEsyKeyExists()

		expect(result.created).toBe(true)
		expect(fs.existsSync(esyPath)).toBe(true)

		const key = JSON.parse(fs.readFileSync(esyPath, 'utf8'))
		expect(key.permutation).toHaveLength(256)
		expect(key.inverse_permutation).toHaveLength(256)
		expect(key.glyphs).toHaveLength(64)
		expect(key.rounds).toBeGreaterThan(0)
		expect(typeof key.noise_seed).toBe('number')
		expect(key.fingerprint).toMatch(/^[0-9a-f]{16}$/)

		// La permutation doit être une vraie bijection : inv[perm[i]] === i.
		for (let i = 0; i < 256; i++) {
			expect(key.inverse_permutation[key.permutation[i]]).toBe(i)
		}
	})

	it('est idempotente : ne touche jamais une clé existante', async () => {
		const esyPath = freshEsyPath()
		const { ensureEsyKeyExists } = await import('../utils/esyKeyGen')

		const first = ensureEsyKeyExists()
		expect(first.created).toBe(true)
		const contentAfterFirst = fs.readFileSync(esyPath, 'utf8')

		const second = ensureEsyKeyExists()
		expect(second.created).toBe(false)
		const contentAfterSecond = fs.readFileSync(esyPath, 'utf8')

		// Une régénération changerait le brouillage et rendrait l'historique DM
		// chiffré existant illisible — le contenu doit être BIT POUR BIT identique.
		expect(contentAfterSecond).toBe(contentAfterFirst)
	})

	it('pose les permissions 0600 (lecture seule par le owner)', async () => {
		const esyPath = freshEsyPath()
		const { ensureEsyKeyExists } = await import('../utils/esyKeyGen')
		ensureEsyKeyExists()
		const mode = fs.statSync(esyPath).mode & 0o777
		expect(mode).toBe(0o600)
	})
})
