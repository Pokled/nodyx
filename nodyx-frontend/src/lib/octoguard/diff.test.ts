import { describe, it, expect } from 'vitest'
import { wordDiff, DIFF_MAX_WORDS } from './diff'

describe('wordDiff : ce que l’auteur a modifié', () => {
	it('le cas de la maquette : « va crever » devient « quitte le serveur »', () => {
		const d = wordDiff('sérieux max tu sers à rien, va crever', 'sérieux max tu sers à rien, quitte le serveur')!
		expect(d.filter((p) => p.kind === 'del')).toEqual([{ kind: 'del', text: 'va crever' }])
		expect(d.filter((p) => p.kind === 'ins')).toEqual([{ kind: 'ins', text: 'quitte le serveur' }])
		expect(d.filter((p) => p.kind === 'ins').map((p) => p.text.trim()).join(' ')).toBe('quitte le serveur')
		expect(d.filter((p) => p.kind === 'same').map((p) => p.text).join('')).toContain('sérieux max tu sers à rien,')
	})
	it('recomposer les parties redonne les deux textes', () => {
		const a = 'un deux trois quatre', b = 'un trois cinq quatre six'
		const d = wordDiff(a, b)!
		expect(d.filter((p) => p.kind !== 'ins').map((p) => p.text).join('')).toBe(a)
		expect(d.filter((p) => p.kind !== 'del').map((p) => p.text).join('')).toBe(b)
	})
	it('trop long : pas de calcul (coût quadratique), l’écran montre les deux versions', () => {
		expect(wordDiff('a '.repeat(DIFF_MAX_WORDS + 1), 'b')).toBeNull()
	})
})
