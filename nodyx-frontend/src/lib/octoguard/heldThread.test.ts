import { describe, it, expect } from 'vitest'
import { dayKey, startsDay, dayLabel, noTextKind } from './heldThread'

const tFn = (k: string) => ({ 'og2.rv_today': "Aujourd'hui", 'og2.rv_yesterday': 'Hier' } as Record<string, string>)[k] ?? k
const now = new Date(2026, 10, 20, 21, 44)   // 20 novembre 2026, 21:44, heure locale
const at = (y: number, mo: number, d: number, h = 12, mi = 0) => new Date(y, mo, d, h, mi).toISOString()

describe('le fil dit le jour, pas seulement l’heure', () => {
	it('un séparateur au premier message, puis à chaque nouveau jour, jamais entre deux messages du même jour', () => {
		const ats = [at(2026, 8, 19, 22, 56), at(2026, 8, 19, 22, 58), at(2026, 10, 20, 13, 30), at(2026, 10, 20, 21, 44)]
		expect(ats.map((_, i) => startsDay(ats, i))).toEqual([true, false, true, false])
	})
	it('minuit sépare deux jours, même à une minute d’écart', () => {
		const ats = [at(2026, 10, 19, 23, 59), at(2026, 10, 20, 0, 0)]
		expect(startsDay(ats, 1)).toBe(true)
		expect(dayKey(ats[0])).not.toBe(dayKey(ats[1]))
	})
	it('« Aujourd’hui », « Hier », sinon le jour en toutes lettres', () => {
		expect(dayLabel(at(2026, 10, 20, 8), now, 'fr-FR', tFn)).toBe("Aujourd'hui")
		expect(dayLabel(at(2026, 10, 19, 23), now, 'fr-FR', tFn)).toBe('Hier')
		expect(dayLabel(at(2026, 8, 19, 22, 56), now, 'fr-FR', tFn)).toBe('Samedi 19 septembre')
	})
	it('l’année seulement si ce n’est pas celle d’aujourd’hui', () => {
		expect(dayLabel(at(2025, 11, 31), now, 'fr-FR', tFn)).toBe('Mercredi 31 décembre 2025')
	})
})

describe('un message sans texte dit ce qu’il est', () => {
	it('un sondage (vu sur nodyx.org le 20/11 : il s’affichait vide)', () => {
		expect(noTextKind('', '', { poll: true })).toBe('poll')
	})
	it('un jeu', () => { expect(noTextKind('', '', { game: true })).toBe('game') })
	it('une image seule', () => { expect(noTextKind('', '<p><img src="/uploads/a.webp" alt=""></p>')).toBe('image') })
	it('rien du tout', () => { expect(noTextKind('  ', '<p></p>')).toBe('empty') })
	it('un message avec du texte reste un message', () => { expect(noTextKind('bonjour', '<p>bonjour</p>', { poll: true })).toBeNull() })
	it('un message supprimé n’est pas confondu (null : géré à part)', () => { expect(noTextKind(null, null)).toBe('empty') })
})
