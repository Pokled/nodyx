import { describe, it, expect } from 'vitest'
import { reportKey, reportKeyLabel } from './reportLabel'

const tFn = (k: string) => ({ 'report.cat_other': 'Autre chose', 'report.cat_spam': 'Spam' } as Record<string, string>)[k] ?? k

describe('le motif d’un signalement dans la file', () => {
	it('OctoGuard : le nom de la règle, pas « Autre chose »', () => {
		const k = reportKey({ source: 'octoguard', category: 'other', reason: 'OctoGuard · Majuscules' })
		expect([k, reportKeyLabel(k, tFn)]).toEqual(['og:Majuscules', 'Majuscules'])
	})
	it('deux règles différentes ne se mélangent pas', () => {
		expect(reportKey({ source: 'octoguard', category: 'other', reason: 'OctoGuard · Texte corrompu' })).toBe('og:Texte corrompu')
	})
	it('un membre : sa catégorie, comme avant', () => {
		const k = reportKey({ source: 'member', category: 'spam', reason: 'il spamme' })
		expect([k, reportKeyLabel(k, tFn)]).toEqual(['spam', 'Spam'])
	})
	it('un ancien signalement d’OctoGuard sans nom de règle : « Autre chose », comme avant', () => {
		const k = reportKey({ source: 'octoguard', category: null, reason: 'texte libre' })
		expect([k, reportKeyLabel(k, tFn)]).toEqual(['other', 'Autre chose'])
	})
	it('un membre qui écrit « OctoGuard · … » dans son motif ne se fait pas passer pour OctoGuard', () => {
		expect(reportKey({ source: 'member', category: 'harassment', reason: 'OctoGuard · Majuscules' })).toBe('harassment')
	})
})
