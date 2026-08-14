import { describe, it, expect } from 'vitest'
import { translator, negotiate, isLocale, LOCALES, DEFAULT_LOCALE } from './index'

describe('parite des dictionnaires', () => {
	it('le francais et l anglais portent exactement les memes cles', () => {
		// La regle maison, appliquee au magasin des le premier commit : pas de
		// cle francaise sans son equivalent anglais.
		const fr = Object.keys(LOCALES.fr).sort()
		const en = Object.keys(LOCALES.en).sort()
		expect(en).toEqual(fr)
		expect(fr.length).toBeGreaterThan(40)
	})

	it('aucune valeur vide', () => {
		for (const [locale, dict] of Object.entries(LOCALES)) {
			for (const [key, value] of Object.entries(dict as Record<string, string>)) {
				expect(value.trim(), `${locale}.${key}`).not.toBe('')
			}
		}
	})

	it('les variables d interpolation correspondent d une langue a l autre', () => {
		// Une traduction qui invente ou perd un {{...}} affiche un trou.
		const vars = (s: string) => (s.match(/\{\{\w+\}\}/g) ?? []).sort()
		for (const key of Object.keys(LOCALES.fr)) {
			expect(vars((LOCALES.en as Record<string, string>)[key]), key)
				.toEqual(vars((LOCALES.fr as Record<string, string>)[key]))
		}
	})
})

describe('traduction', () => {
	it('rend la chaine de la langue demandee', () => {
		expect(translator('en')('nav.publish')).toBe('Publish')
		expect(translator('fr')('nav.publish')).toBe('Publier')
	})

	it('interpole', () => {
		expect(translator('fr')('card.by', { author: 'Ada' })).toBe('par Ada')
	})

	it('laisse le motif quand la valeur manque', () => {
		expect(translator('fr')('card.by')).toContain('{{author}}')
	})

	it('rend la CLE quand elle n existe pas, pour que le trou se voie', () => {
		expect(translator('fr')('nexiste.pas')).toBe('nexiste.pas')
	})
})

describe('negociation de langue', () => {
	it.each([
		['fr-FR,fr;q=0.9,en;q=0.8', 'fr'],
		['en-US,en;q=0.9', 'en'],
		['de-DE,de;q=0.9,en;q=0.5', 'en'],
		['', DEFAULT_LOCALE],
		[null, DEFAULT_LOCALE],
	])('%p donne %p', (header, expected) => {
		expect(negotiate(header as string | null)).toBe(expected)
	})

	it('reconnait les langues livrees', () => {
		expect(isLocale('fr')).toBe(true)
		expect(isLocale('kl')).toBe(false)
		expect(isLocale(42)).toBe(false)
	})
})
