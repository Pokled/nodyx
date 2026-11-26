import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fr from '$lib/locales/fr.json'
import en from '$lib/locales/en.json'
import { safeHref } from './widgets/vitrineUrls'
import { K, VITRINE_SCHEMA } from './plugins/vitrineSchema'

describe('bloc Vitrine', () => {
	it('son identifiant est réservé côté cœur : aucune extension ne peut le prendre', () => {
		const coeur = readFileSync(resolve(__dirname, '../../../../../nodyx-core/src/extensions/reserved.ts'), 'utf-8')
		expect(coeur).toContain("'vitrine',")
	})

	it('chaque libellé est une clé traduite en français ET en anglais, jamais du texte en dur', () => {
		const textes = [`${K}label`, `${K}desc`, ...VITRINE_SCHEMA.flatMap(f => [f.label, f.hint, f.placeholder])]
			.filter((s): s is string => !!s && !s.startsWith('/'))
		expect(textes.length).toBeGreaterThan(20)
		for (const k of textes) {
			expect(k.startsWith('hpw.vitrine.')).toBe(true)
			expect((fr as Record<string, string>)[k], k).toBeTruthy()
			expect((en as Record<string, string>)[k], k).toBeTruthy()
		}
	})

	it.each([
		['javascript:alert(1)', ''], ['data:text/html,x', ''], ['//evil.example', ''], ['/\\evil.example', ''],
		['http://exemple.org', ''], ['/../admin', ''], ['  /forum  ', '/forum'], ['/forum?tag=jeux#haut', '/forum?tag=jeux#haut'],
		['https://exemple.org/a b', 'https://exemple.org/a%20b'], [42, ''],
	] as const)('lien %s → « %s »', (entree, attendu) => {
		expect(safeHref(entree)).toBe(attendu)
	})
})
