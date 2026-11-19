import { describe, it, expect } from 'vitest'
import { fillVars, readingMinutes, strokeStats, samePhrase, refusalKey, type Point } from './door'

describe('les variables de la charte', () => {
	it('dans les deux langues, et un « é » en deux caractères', () => {
		const tokFr = '{communaut' + 'é' + '}'   // e + accent combinant
		expect(fillVars('<p>Chez {communauté}, salut {pseudo} !</p>', 'Vieux Looters', 'Léa')).toBe('<p>Chez Vieux Looters, salut Léa !</p>')
		expect(fillVars('<p>{community} / {username}</p>', 'Old Looters', 'Lea')).toBe('<p>Old Looters / Lea</p>')
		expect(fillVars(`<p>${tokFr}</p>`, 'VL', 'x')).toBe('<p>VL</p>')
	})
	it('un pseudo piégé reste du texte, même dans un attribut', () => {
		const out = fillVars('<img src="/biomes/fr-1.webp" alt="Salut {pseudo}"><p>{pseudo}</p>', 'C', '"><img src=x onerror=alert(1)>')
		expect(out).not.toMatch(/<img src=x/)
		expect(out).toContain('alt="Salut &quot;&gt;&lt;img src=x onerror=alert(1)&gt;"')
	})
})

describe('la signature à la main', () => {
	const wave = (n: number): Point[] => Array.from({ length: n }, (_, i) => ({ x: 10 + i * 6, y: 50 + (i % 4 < 2 ? -12 : 12) }))
	it('une vraie signature (des allers-retours, assez large) passe', () => {
		expect(strokeStats([wave(40)]).ok).toBe(true)
	})
	it('un trait droit, un point, un petit gribouillis : non', () => {
		expect(strokeStats([Array.from({ length: 40 }, (_, i) => ({ x: i * 6, y: 50 }))]).ok).toBe(false)
		expect(strokeStats([[{ x: 5, y: 5 }]]).ok).toBe(false)
		expect(strokeStats([wave(6)]).ok).toBe(false)
		expect(strokeStats([]).ok).toBe(false)
	})
})

describe('la phrase et les refus', () => {
	it('ni la casse, ni la ponctuation, ni les espaces ne comptent', () => {
		expect(samePhrase('chez vieux looters on se parle avec respect', 'Chez Vieux Looters, on se parle avec respect.')).toBe(true)
		expect(samePhrase('chez vieux looters', 'Chez Vieux Looters, on se parle avec respect.')).toBe(false)
		expect(samePhrase('', '')).toBe(false)
	})
	it('un robot reçoit le même refus que tout le monde', () => {
		expect(refusalKey('CHARTER_REFUSED')).toBe('charter.err_refused')
		expect(refusalKey('N_IMPORTE_QUOI')).toBe('charter.err_refused')
		expect(refusalKey('CHARTER_TYPE_IT')).toBe('charter.err_type_it')
		expect(readingMinutes('mot '.repeat(400))).toBe(2)
		expect(readingMinutes('')).toBe(1)
	})
})
