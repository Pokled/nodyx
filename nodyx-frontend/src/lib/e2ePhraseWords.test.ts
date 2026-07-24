import { describe, it, expect } from 'vitest'
import { E2E_PHRASE_WORDS, generateRecoveryPhrase } from './e2ePhraseWords'

describe('e2ePhraseWords — wordlist', () => {
	it('contient des mots non vides, en minuscules, sans tiret ni espace', () => {
		expect(E2E_PHRASE_WORDS.length).toBeGreaterThanOrEqual(50)
		for (const w of E2E_PHRASE_WORDS) {
			expect(w.length).toBeGreaterThan(0)
			expect(w).toBe(w.toLowerCase())
			expect(w).not.toMatch(/[-\s]/) // le tiret est le séparateur : jamais dans un mot
		}
	})
})

describe('e2ePhraseWords — generateRecoveryPhrase', () => {
	it('produit 5 mots par défaut, tous issus du wordlist, joints par des tirets', () => {
		const phrase = generateRecoveryPhrase()
		const parts = phrase.split('-')
		expect(parts).toHaveLength(5)
		for (const p of parts) {
			expect(E2E_PHRASE_WORDS).toContain(p)
		}
	})

	it('respecte le nombre de mots demandé', () => {
		expect(generateRecoveryPhrase(4).split('-')).toHaveLength(4)
		expect(generateRecoveryPhrase(8).split('-')).toHaveLength(8)
	})

	it('ne réutilise pas la même phrase (aléa cryptographique)', () => {
		const seen = new Set<string>()
		for (let i = 0; i < 200; i++) seen.add(generateRecoveryPhrase())
		// 200 tirages dans un espace de 60^5 : une collision serait un défaut d'aléa.
		expect(seen.size).toBe(200)
	})

	it('couvre tout le wordlist sur un grand nombre de tirages (pas de mot mort)', () => {
		const used = new Set<string>()
		for (let i = 0; i < 5000; i++) {
			for (const p of generateRecoveryPhrase().split('-')) used.add(p)
		}
		expect(used.size).toBe(E2E_PHRASE_WORDS.length)
	})

	it('accepte un wordlist custom et rejette les cas dégénérés', () => {
		expect(generateRecoveryPhrase(3, ['a', 'b', 'c']).split('-')).toHaveLength(3)
		expect(() => generateRecoveryPhrase(0)).toThrow()
		expect(() => generateRecoveryPhrase(5, [])).toThrow()
	})
})
