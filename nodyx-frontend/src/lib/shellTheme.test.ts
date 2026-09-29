import { describe, it, expect } from 'vitest'
import {
	hexToRgb, rgbToHex, rgbToOklch, oklchToHex, contrast, ensureContrast, onColor,
	deriveShellVars, shellThemeCss, backdropSource, DEFAULT_SHELL_THEME, type ShellTheme,
} from './shellTheme'

const theme = (over: Partial<ShellTheme> = {}): ShellTheme => ({ ...DEFAULT_SHELL_THEME, ...over })

// Accents volontairement difficiles : un jaune très pâle (illisible en clair),
// un bleu nuit (illisible en sombre), un gris, les extrêmes, des couleurs vives.
const ACCENTS = ['#ffb020', '#fff7b0', '#0b1f5c', '#808080', '#000000', '#ffffff', '#ff0000', '#00ffcc', '#7c3aed', '#16a34a']

describe('conversions de couleur', () => {
	it('hex ↔ rgb aller-retour exact', () => {
		for (const hex of ACCENTS) expect(rgbToHex(hexToRgb(hex))).toBe(hex)
	})

	it('rgb → OKLCH → hex aller-retour fidèle (à 1 unité près par canal)', () => {
		for (const hex of ACCENTS) {
			const back = hexToRgb(oklchToHex(rgbToOklch(hexToRgb(hex))))
			hexToRgb(hex).forEach((v, i) => expect(Math.abs(v - back[i]) * 255).toBeLessThanOrEqual(1))
		}
	})

	it('contraste WCAG : noir sur blanc = 21, une couleur sur elle-même = 1', () => {
		expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5)
		expect(contrast('#ffb020', '#ffb020')).toBeCloseTo(1, 5)
	})

	it('refuse une couleur mal formée', () => {
		expect(() => hexToRgb('rouge')).toThrow()
	})
})

describe('ensureContrast', () => {
	it('ne touche pas une couleur déjà lisible', () => {
		expect(ensureContrast('#0b1f5c', '#ffffff', 4.5)).toBe('#0b1f5c')
	})

	it('assombrit un jaune pâle juste assez sur fond blanc, en gardant sa teinte', () => {
		const out = ensureContrast('#fff7b0', '#ffffff', 4.5)
		expect(contrast(out, '#ffffff')).toBeGreaterThanOrEqual(4.5)
		expect(contrast(out, '#ffffff')).toBeLessThan(5.2)   // « juste assez », pas du noir
		expect(Math.abs(rgbToOklch(hexToRgb(out)).h - rgbToOklch(hexToRgb('#fff7b0')).h)).toBeLessThan(12)
	})

	it('éclaircit un bleu nuit sur fond sombre', () => {
		const out = ensureContrast('#0b1f5c', '#1a1612', 4.5)
		expect(contrast(out, '#1a1612')).toBeGreaterThanOrEqual(4.5)
	})
})

describe('onColor', () => {
	it('texte blanc sur une couleur sombre, sombre sur une couleur claire', () => {
		expect(onColor('#0b1f5c')).toBe('#ffffff')
		expect(onColor('#fff7b0')).not.toBe('#ffffff')
	})
})

describe('deriveShellVars : aucun réglage ne rend l’instance illisible', () => {
	for (const accent of ACCENTS) {
		for (const dark of [false, true]) {
			it(`${accent} en mode ${dark ? 'sombre' : 'clair'}`, () => {
				const v = deriveShellVars(theme({ accent }), dark)
				const surface = v['--nx-surface']
				expect(contrast(v['--nx-header-accent'], surface)).toBeGreaterThanOrEqual(4.5)
				expect(contrast(v['--nx-text'], surface)).toBeGreaterThanOrEqual(7)
				expect(contrast(v['--nx-text-muted'], surface)).toBeGreaterThanOrEqual(4.5)
				expect(contrast(v['--nx-text-faint'], surface)).toBeGreaterThanOrEqual(3)
				expect(contrast(v['--nx-on-accent'], v['--nx-header-accent'])).toBeGreaterThanOrEqual(4.5)
			})
		}
	}

	it('l’ambiance par défaut reproduit le contenant d’origine (ambre, fonds quasi noirs)', () => {
		const v = deriveShellVars(DEFAULT_SHELL_THEME, true)
		expect(v['--nx-header-accent']).toBe('#ffb020')
		expect(contrast(v['--nx-bg'], '#100e0b')).toBeLessThan(1.1)
		expect(contrast(v['--nx-text'], '#f5f2ec')).toBeLessThan(1.1)
	})

	it('intensité : Sobre floute et voile plus, et rend le verre plus opaque, qu’Immersif', () => {
		const alpha = (s: string) => Number(/\/ ([\d.]+)\)$/.exec(s)![1])
		const blur = (s: string) => Number(/blur\((\d+)px\)/.exec(s)![1])
		const sobre = deriveShellVars(theme({ intensity: 0 }), true)
		const immersif = deriveShellVars(theme({ intensity: 100 }), true)
		expect(blur(sobre['--nx-wallpaper-filter'])).toBeGreaterThan(blur(immersif['--nx-wallpaper-filter']))
		expect(alpha(sobre['--nx-wallpaper-veil'])).toBeGreaterThan(alpha(immersif['--nx-wallpaper-veil']))
		expect(alpha(sobre['--nx-glass'])).toBeGreaterThan(alpha(immersif['--nx-glass']))
	})

	it('intensité hors bornes ramenée entre 0 et 100', () => {
		expect(deriveShellVars(theme({ intensity: 900 }), true)).toEqual(deriveShellVars(theme({ intensity: 100 }), true))
	})
})

describe('shellThemeCss', () => {
	const css = shellThemeCss(theme({ accent: '#7c3aed' }))

	it('clair par défaut, sombre par préférence système ou forcé, comme app.css', () => {
		expect(css).toMatch(/^:root:root\{/)
		expect(css).toContain('@media (prefers-color-scheme: dark){:root:root:not([data-theme="light"]){')
		expect(css).toContain(':root:root[data-theme="dark"]{')
	})

	it('chaque règle porte une priorité supérieure à app.css (:root:root), quel que soit l’ordre de chargement', () => {
		for (const rule of css.split('\n')) expect(rule).toContain(':root:root')
	})

	it('garde la règle « moins de transparence » APRÈS ses propres valeurs de verre', () => {
		expect(css.lastIndexOf('prefers-reduced-transparency')).toBeGreaterThan(css.lastIndexOf('--nx-glass:rgb'))
	})

	it('ne contient ni balise ni rien qui puisse fermer la feuille de style', () => {
		expect(css).not.toMatch(/[<>]|<\/style/i)
	})
})

describe('backdropSource', () => {
	it('bannière par défaut, image perso, ou aucun décor', () => {
		expect(backdropSource(null, '/uploads/b.jpg')).toBe('/uploads/b.jpg')
		expect(backdropSource(theme({ backdrop: 'banner' }), '/uploads/b.jpg')).toBe('/uploads/b.jpg')
		expect(backdropSource(theme({ backdrop: 'custom', backdrop_url: '/uploads/c.jpg' }), '/uploads/b.jpg')).toBe('/uploads/c.jpg')
		expect(backdropSource(theme({ backdrop: 'none' }), '/uploads/b.jpg')).toBeNull()
	})
})
