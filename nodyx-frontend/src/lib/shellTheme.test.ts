import { describe, it, expect } from 'vitest'
import {
	hexToRgb, rgbToHex, rgbToOklch, oklchToHex, contrast, ensureContrast, onColor,
	deriveShellVars, shellThemeCss, backdropSource, DEFAULT_SHELL_THEME, legacyAccentVars, type ShellTheme,
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
				// Jamais sous AA ; 7:1 quand le fond le permet (pas sur un gris moyen).
				expect(contrast(v['--nx-text'], surface)).toBeGreaterThanOrEqual(4.5)
				const best = Math.max(contrast('#ffffff', surface), contrast('#000000', surface))
				if (best >= 8) expect(contrast(v['--nx-text'], surface)).toBeGreaterThanOrEqual(7)
				expect(contrast(v['--nx-text-muted'], surface)).toBeGreaterThanOrEqual(4.5)
				expect(contrast(v['--nx-text-faint'], surface)).toBeGreaterThanOrEqual(3)
				expect(contrast(v['--nx-on-accent'], v['--nx-header-accent'])).toBeGreaterThanOrEqual(4.5)
			})
		}
	}

	// L'Originel : les propriétés de confort mesurées chez Discord (29/09),
	// verrouillées ici pour qu'une retouche future ne les perde pas en silence.
	it('Originel sombre : pas de noir, texte blanc cassé vers 10:1 (pas 21), atténué au-dessus de AA', () => {
		const v = deriveShellVars(DEFAULT_SHELL_THEME, true)
		const s = v['--nx-surface']
		expect(rgbToOklch(hexToRgb(v['--nx-bg'])).l).toBeGreaterThan(0.18)          // jamais de noir
		expect(rgbToOklch(hexToRgb(s)).c).toBeLessThan(0.015)                        // un gris, pas une couleur
		expect(contrast(v['--nx-text'], s)).toBeGreaterThanOrEqual(9.5)
		expect(contrast(v['--nx-text'], s)).toBeLessThanOrEqual(11)                   // pas d'éblouissement
		expect(contrast(v['--nx-text-muted'], s)).toBeGreaterThanOrEqual(4.5)
		expect(rgbToOklch(hexToRgb(v['--nx-text'])).l).toBeLessThan(0.95)            // pas de blanc pur
	})

	it('Originel clair : pas de noir pour le texte (vers 12,5:1), fonds à peine froids', () => {
		const v = deriveShellVars(DEFAULT_SHELL_THEME, false)
		const c = contrast(v['--nx-text'], v['--nx-surface'])
		expect(c).toBeGreaterThanOrEqual(11.5)
		expect(c).toBeLessThanOrEqual(13.5)
		expect(v['--nx-text']).not.toBe('#000000')
	})

	it('Originel : un ambre ADOUCI, moins saturé que l’ambre d’origine qui vibrait sur fond sombre', () => {
		expect(rgbToOklch(hexToRgb(DEFAULT_SHELL_THEME.accent)).c).toBeLessThan(rgbToOklch(hexToRgb('#ffb020')).c)
	})

	it('les gris Graphite ne dépendent pas de l’accent ; les gris teintés, si', () => {
		const g = (accent: string) => deriveShellVars(theme({ accent, neutrals: 'graphite' }), true)['--nx-surface']
		const t = (accent: string) => deriveShellVars(theme({ accent, neutrals: 'tinted' }), true)['--nx-surface']
		expect(g('#ff0000')).toBe(g('#00ff00'))
		expect(t('#ff0000')).not.toBe(t('#00ff00'))
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

describe('anciennes variables de marque des pages (legacyAccentVars)', () => {
	const PAGE_DARK = '#0b0c0f'
	for (const accent of ACCENTS) {
		it(`${accent} : texte lisible sur fond sombre, fond de bouton lisible sous du blanc`, () => {
			const v = legacyAccentVars(theme({ accent }))
			for (const k of ['--nx-accent-soft', '--nx-accent-2-soft', '--nx-cyan']) expect(contrast(v[k], PAGE_DARK), k).toBeGreaterThanOrEqual(4.5)
			for (const k of ['--nx-accent', '--nx-accent-2-strong']) {
				expect(contrast('#ffffff', v[k]), `${k} sous du blanc`).toBeGreaterThanOrEqual(4.5)
				expect(contrast(v[k], PAGE_DARK), `${k} visible sur sombre`).toBeGreaterThanOrEqual(3)
			}
		})
	}

	it('plus de violet ni de cyan : tout vient de la teinte de l’ambiance', () => {
		const v = legacyAccentVars(theme({ accent: '#22e36b' }))
		for (const k of ['--nx-accent', '--nx-accent-2-soft', '--nx-cyan']) expect(Math.abs(rgbToOklch(hexToRgb(v[k])).h - rgbToOklch(hexToRgb('#22e36b')).h)).toBeLessThan(15)
	})

	it('émises seulement quand on le demande (ambiance publiée), jamais sur le défaut', () => {
		expect(shellThemeCss(theme())).not.toContain('--nx-accent-2-soft')
		expect(shellThemeCss(theme(), { legacy: true })).toContain('--nx-accent-2-soft')
	})
})

describe('fonds Noir (OLED)', () => {
	it('vrai noir neutre en sombre, texte lisible sans éblouir, mêmes fonds que Graphite en clair', () => {
		const v = deriveShellVars(theme({ neutrals: 'black' }), true)
		expect(rgbToOklch(hexToRgb(v['--nx-bg'])).l).toBeLessThan(0.15)
		expect(rgbToOklch(hexToRgb(v['--nx-surface'])).c).toBeLessThan(0.002)
		const c = contrast(v['--nx-text'], v['--nx-surface'])
		expect(c).toBeGreaterThanOrEqual(10)
		expect(c).toBeLessThan(18)
		expect(contrast(v['--nx-text-muted'], v['--nx-surface'])).toBeGreaterThanOrEqual(4.5)
		expect(deriveShellVars(theme({ neutrals: 'black' }), false)['--nx-bg']).toBe(deriveShellVars(theme({ neutrals: 'graphite' }), false)['--nx-bg'])
	})
})

describe('styles par zone (partie 3)', () => {
	it('une zone sans style n’émet rien : elle suit l’ambiance', async () => {
		const { deriveZoneVars } = await import('./shellTheme')
		expect(deriveZoneVars(theme(), 'sidebar', true)).toEqual({})
	})

	for (const surface of ['#000000', '#ffffff', '#fcee0a', '#0b1f5c', '#808080', '#ff3fa4']) {
		it(`panneau ${surface} : textes et accent recalculés, toujours lisibles`, async () => {
			const { deriveZoneVars } = await import('./shellTheme')
			for (const dark of [true, false]) {
				const v = deriveZoneVars(theme({ zones: { sidebar: { surface, accent: '#3fae6a' } } }), 'sidebar', dark)
				// Jamais sous AA ; 7:1 quand le fond le permet (pas sur un gris moyen).
				expect(contrast(v['--nx-text'], surface)).toBeGreaterThanOrEqual(4.5)
				const best = Math.max(contrast('#ffffff', surface), contrast('#000000', surface))
				if (best >= 8) expect(contrast(v['--nx-text'], surface)).toBeGreaterThanOrEqual(7)
				expect(contrast(v['--nx-text-muted'], surface)).toBeGreaterThanOrEqual(4.5)
				expect(contrast(v['--nx-text-faint'], surface)).toBeGreaterThanOrEqual(3)
				expect(contrast(v['--nx-header-accent'], surface)).toBeGreaterThanOrEqual(4.5)
				expect(contrast(v['--nx-on-accent'], v['--nx-header-accent'])).toBeGreaterThanOrEqual(4.5)
			}
		})
	}

	it('accent seul : lisible sur le fond HÉRITÉ de l’ambiance, sans toucher aux textes', async () => {
		const { deriveZoneVars } = await import('./shellTheme')
		const v = deriveZoneVars(theme({ zones: { rail: { accent: '#fff27a' } } }), 'rail', false)
		expect(contrast(v['--nx-header-accent'], deriveShellVars(theme(), false)['--nx-surface'])).toBeGreaterThanOrEqual(4.5)
		expect(v['--nx-text']).toBeUndefined()
	})

	it('forme, police, bordure, ombre, flou : seulement ce qui est réglé', async () => {
		const { deriveZoneVars } = await import('./shellTheme')
		const v = deriveZoneVars(theme({ zones: { header: { radius: 0, blur: 4, border_width: 2, border_color: '#FF0000', font: 'mono', shadow: 0 } } }), 'header', true)
		expect(v).toMatchObject({ '--shell-radius': '0px', '--zone-blur': '4px', '--zone-bw': '2px', '--zone-bc': '#ff0000' })
		expect(v['--font-shell']).toContain('monospace')
		expect(v['--zone-font']).toBe(v['--font-shell'])
		expect(v['--nx-glass-shadow']).toContain('/ 0)')
		expect(v['--nx-header-accent']).toBeUndefined()
	})

	it('la feuille de contenu change de FOND (pas de verre)', async () => {
		const { deriveZoneVars } = await import('./shellTheme')
		const v = deriveZoneVars(theme({ zones: { sheet: { surface: '#1a1033' } } }), 'sheet', true)
		expect(v['--nx-sheet-bg']).toBe('rgb(26 16 51 / 1)')
	})

	it('une image dont l’adresse contient des caractères piégés ne sort pas de url()', async () => {
		const { deriveZoneVars } = await import('./shellTheme')
		const v = deriveZoneVars(theme({ zones: { members: { image: { url: '/uploads/a") ;x:y("b.png', x: 50, y: 50, zoom: 100, veil: 0 } } } }), 'members', true)
		expect(v['--zone-img']).toMatch(/^url\("[^"()]*"\)$/)
	})

	it('la feuille n’applique un style qu’au sélecteur de SA zone, dans les deux modes', () => {
		const css = shellThemeCss(theme({ zones: { sidebar: { accent: '#ff3fa4' } } }))
		expect(css).toContain(':root:root [data-nx-zone="sidebar"]{')
		expect(css).toContain(':root:root:not([data-theme="light"]) [data-nx-zone="sidebar"]{')
		expect(css).toContain(':root:root[data-theme="dark"] [data-nx-zone="sidebar"]{')
		expect(css).not.toContain('[data-nx-zone="rail"]')
		expect(css).not.toMatch(/<|<\/style/i)
	})
})
