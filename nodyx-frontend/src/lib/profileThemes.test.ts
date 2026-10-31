// Un profil suit le thème du site tant que son membre ne s'est pas donné un thème
// à lui. Échantillons réels de nodyx.org (31/10/2026) : 7 « Défaut » enregistrés
// tels quels, dont certains avec l'ancien gris secondaire, et 8 vrais thèmes perso.
import { describe, it, expect } from 'vitest'
import { isPersonalTheme, siteThemeStyle, DEFAULT_THEME } from './profileThemes'

describe('isPersonalTheme', () => {
	it('rien d enregistré : suit le site', () => {
		expect(isPersonalTheme(null)).toBe(false)
		expect(isPersonalTheme(undefined)).toBe(false)
		expect(isPersonalTheme({})).toBe(false)
	})
	it('« Défaut » enregistré tel quel, même avec l ancien gris secondaire : suit le site', () => {
		expect(isPersonalTheme({ ...DEFAULT_THEME })).toBe(false)
		expect(isPersonalTheme({ ...DEFAULT_THEME, textMuted: '#6b7280' })).toBe(false)
	})
	it('un vrai thème perso est respecté', () => {
		// Rose (préréglage choisi par un membre)
		expect(isPersonalTheme({ bg: '#1a0010', text: '#fdf2f8', accent: '#ec4899', cardBg: 'rgba(36,4,28,0.85)', bgImage: '', textMuted: '#f9a8d4', cardBorder: '#9d174d' })).toBe(true)
		// couleurs libres, rouge sur noir : c est son choix
		expect(isPersonalTheme({ bg: '#000000', text: '#7d0d10', accent: '#008000' })).toBe(true)
	})
	it('une seule couleur changée suffit, une image de fond aussi', () => {
		expect(isPersonalTheme({ ...DEFAULT_THEME, accent: '#22c55e' })).toBe(true)
		expect(isPersonalTheme({ ...DEFAULT_THEME, bgImage: 'https://example.org/fond.jpg' })).toBe(true)
	})
})

describe('siteThemeStyle', () => {
	it('branche les --p-* sur le thème et ne peint aucun fond', () => {
		const s = siteThemeStyle()
		expect(s).toContain('--p-text:var(--nx-text)')
		expect(s).toContain('--p-card-bg:var(--nx-surface)')
		expect(s).not.toMatch(/(^|;)background:/)
	})
})
