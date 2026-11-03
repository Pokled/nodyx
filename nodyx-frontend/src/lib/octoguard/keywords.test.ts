import { describe, it, expect } from 'vitest'
import { matchKeywords, scan, splitWords, joinWords, overreach, compile, usable } from './keywords'

// Les cas du moteur (nodyx-core) : le navigateur doit rendre le même verdict.
describe('matchKeywords, même verdict que le moteur', () => {
	const words = ['connard', 'crétin*', '*arnaque*']

	it('déjoue la casse, les accents et les chiffres', () => {
		expect(matchKeywords('T es un CONNARD', words)?.raw).toBe('connard')
		expect(matchKeywords('t es un c0nn4rd', words)?.raw).toBe('connard')
		expect(matchKeywords('CRÉTINS va', words)?.raw).toBe('crétin*')
	})

	it('recolle les mots épelés, avec points ou espaces', () => {
		expect(matchKeywords('c.o.n.n.a.r.d', words)?.raw).toBe('connard')
		expect(matchKeywords('c o n n a r d', words)?.raw).toBe('connard')
	})

	it('ne recolle jamais deux vrais mots', () => {
		expect(matchKeywords('bacon nard', words)).toBeNull()
	})

	it('mot entier : ne prend pas un mot plus long', () => {
		expect(matchKeywords('un concert', ['con'])).toBeNull()
		expect(matchKeywords('quel con', ['con'])?.raw).toBe('con')
	})

	it('n\'importe où : le trait d\'union coupe le mot, comme dans le moteur', () => {
		expect(matchKeywords('anti-arnaque', words)?.raw).toBe('*arnaque*')
		expect(matchKeywords('des arnaques', words)?.raw).toBe('*arnaque*')
	})

	it('les exceptions protègent un mot légitime', () => {
		expect(matchKeywords('le crétinisme', words, ['crétinisme'])).toBeNull()
		expect(matchKeywords('le crétinisme', words)?.raw).toBe('crétin*')
	})

	it('un mot de moins de 2 lettres est ignoré', () => {
		expect(compile('a')).toBeNull()
		expect(usable('x')).toBe(false)
		expect(usable('ok')).toBe(true)
	})
})

describe('les trois cases', () => {
	it('range la syntaxe stockée et la reconstruit à l\'identique', () => {
		const stored = ['connard', 'crétin*', '*arnaque*', 'abruti']
		const l = splitWords(stored)
		expect(l).toEqual({ exact: ['connard', 'abruti'], prefix: ['crétin'], contains: ['arnaque'] })
		expect(splitWords(joinWords(l))).toEqual(l)
	})

	it('« *mot » sans étoile finale reste un mot entier, comme le moteur', () => {
		expect(splitWords(['*con']).exact).toEqual(['con'])
	})
})

describe('scan : surligner le texte tel que tapé', () => {
	const words = ['connard', 'crétin*', '*arnaque*']

	it('garde le déguisement visible', () => {
		const s = scan('Le calcul, c.o.n.n.a.r.d et crétinisme', words, ['crétinisme'])
		expect(s.filter((x) => x.state === 'hit').map((x) => x.text)).toEqual(['c.o.n.n.a.r.d'])
		expect(s.filter((x) => x.state === 'allowed').map((x) => x.text)).toEqual(['crétinisme'])
		expect(s.map((x) => x.text).join('')).toBe('Le calcul, c.o.n.n.a.r.d et crétinisme')
	})

	it('surligne les mêmes mots que le verdict du moteur', () => {
		const text = "T'es qu'un c0nn4rd, ton concert de crétins c'est une arnaque"
		expect(scan(text, words).filter((x) => x.state === 'hit').map((x) => x.text)).toEqual(['c0nn4rd', 'crétins', 'arnaque'])
		expect(matchKeywords(text, words)).not.toBeNull()
	})
})

describe('overreach : prévenir quand un mot ratisse trop large', () => {
	const sample = ['calcul', 'particulier', 'concert', 'débilitant']
	it('signale les mots innocents pris par un début de mot ou un n\'importe où', () => {
		const r = overreach({ exact: [], prefix: ['débil'], contains: ['cul'] }, [], sample)
		expect(r).toEqual([
			{ kind: 'prefix', word: 'débil', caught: ['débilitant'] },
			{ kind: 'contains', word: 'cul', caught: ['calcul', 'particulier'] },
		])
	})
	it('se tait quand le mot innocent est autorisé', () => {
		expect(overreach({ exact: [], prefix: ['débil'], contains: [] }, ['débilitant'], sample)).toEqual([])
	})
})
