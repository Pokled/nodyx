import { describe, it, expect } from 'vitest'
import { rgbToOklch } from '$lib/shellTheme'
import { DEFAULT_THEME, GRID_THEME_PRESETS, type GridTheme } from '$lib/types/homepage'
import {
	parseColor, formatColor, invertColor, invertLightness, polarityOf, gridThemeForMode, invertGridTheme,
	adaptColorForMode, textContrast,
} from './gridPolarity'

// Palettes publiées des instances, relevées en base le 29/10/2026.
const REELLES: Record<string, GridTheme> = {
	'nodyx.org': { ...DEFAULT_THEME, bg: '#05050a', accent: '#06b6d4', primary: '#a78bfa', link_color: '#a78bfa', card_bg: 'rgba(255,255,255,.03)', border_color: 'rgba(255,255,255,.08)', text_primary: '#e2e8f0', text_secondary: '#6b7280', shadow: '0 4px 24px rgba(0,0,0,.4)' },
	sleemstudio:  { ...DEFAULT_THEME, bg: '#080d09', accent: '#2be634', primary: '#eafff0', card_bg: 'rgba(46,230,110,0.05)', border_color: 'rgba(46,230,110,0.20)', text_primary: '#eafff0', text_secondary: '#7aa98a', shadow: '0 4px 24px rgba(0,0,0,.4)' },
	vieuxlooters: { ...DEFAULT_THEME, bg: '#e6e6e6', accent: '#56663d', primary: '#22c55e', link_color: '#1a2d21', card_bg: 'rgba(166,166,166,0.05)', border_color: 'rgba(145,145,145,0.14)', text_primary: '#636363', text_secondary: '#6b9a7d', shadow: '0 4px 24px rgba(0,0,0,.45)' },
}
const TOUTES: [string, GridTheme][] = [
	...Object.entries(REELLES),
	...GRID_THEME_PRESETS.map(p => [`préréglage ${p.id}`, p.theme] as [string, GridTheme]),
]

const hue = (s: string) => { const c = parseColor(s)!; return rgbToOklch([c.r, c.g, c.b]) }

describe('parseColor / formatColor', () => {
	it('lit les formats des grilles et laisse le reste', () => {
		expect(parseColor('#fff')).toEqual({ r: 1, g: 1, b: 1, a: 1 })
		expect(parseColor('rgba(255,255,255,.03)')!.a).toBeCloseTo(0.03)
		expect(parseColor('rgb(46 230 110 / 0.2)')!.a).toBeCloseTo(0.2)
		expect(parseColor('#00000080')!.a).toBeCloseTo(0.5, 2)
		expect(parseColor('transparent')!.a).toBe(0)
		expect(parseColor('var(--nx-accent)')).toBeNull()
		expect(parseColor('linear-gradient(red, blue)')).toBeNull()
	})
	it('écrit opaque en hex, translucide en rgba', () => {
		expect(formatColor({ r: 1, g: 0, b: 0, a: 1 })).toBe('#ff0000')
		expect(formatColor({ r: 1, g: 1, b: 1, a: 0.08 })).toBe('rgba(255,255,255,0.08)')
	})
})

describe('invertColor', () => {
	it('échange les repères d’interface : un fond sombre devient un blanc cassé, et inversement', () => {
		expect(hue(invertColor('#05050a')).l).toBeGreaterThan(0.96)
		expect(hue(invertColor('#e6e6e6')).l).toBeGreaterThan(0.15)
		expect(hue(invertColor('#e6e6e6')).l).toBeLessThan(0.3)
	})
	it('la courbe de luminosité est une involution exacte', () => {
		for (let l = 0; l <= 1.0001; l += 0.05) expect(invertLightness(invertLightness(l))).toBeCloseTo(l, 9)
	})
	it('un voile clair devient un voile sombre de même opacité', () => {
		const v = parseColor(invertColor('rgba(255,255,255,.08)'))!
		expect(v.a).toBeCloseTo(0.08)
		expect(v.r + v.g + v.b).toBeLessThan(0.1)
	})
	it('aller-retour : retrouve les neutres de la grille à l’arrondi près (3/255 par canal)', () => {
		for (const c of ['#05050a', '#e2e8f0', '#6b7280', '#080d09', '#e6e6e6', '#636363', 'rgba(255,255,255,.08)']) {
			const a = parseColor(c)!, b = parseColor(invertColor(invertColor(c)))!
			expect(Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))).toBeLessThanOrEqual(3 / 255)
		}
	})
	// Limite connue : un vert très saturé n'existe pas en très sombre (gamut sRGB),
	// sa saturation est rognée à l'inversion et ne revient pas au retour. Sans effet
	// visible sur un voile à 5 % (card_bg de sleemstudio) ; documenté ici.
	it('ne touche pas à une valeur qu’il ne sait pas lire', () => {
		expect(invertColor('var(--nx-surface)')).toBe('var(--nx-surface)')
	})
})

describe('polarityOf', () => {
	it('reconnaît la polarité de conception des grilles réelles', () => {
		expect(polarityOf(REELLES['nodyx.org'])).toBe('dark')
		expect(polarityOf(REELLES.sleemstudio)).toBe('dark')
		expect(polarityOf(REELLES.vieuxlooters)).toBe('light')
	})
	it('fond transparent : lit le texte principal', () => {
		expect(polarityOf({ bg: 'transparent', text_primary: '#e2e8f0' })).toBe('dark')
		expect(polarityOf({ bg: 'transparent', text_primary: '#1c1a16' })).toBe('light')
	})
})

describe('gridThemeForMode : chaque grille, dans chaque thème', () => {
	for (const [nom, theme] of TOUTES) {
		for (const dark of [true, false]) {
			it(`${nom}, thème ${dark ? 'sombre' : 'clair'} : bonne polarité et contrastes garantis`, () => {
				const t = gridThemeForMode(theme, dark)
				if (parseColor(t.bg)!.a > 0) expect(polarityOf(t)).toBe(dark ? 'dark' : 'light')
				for (const on of ['bg', 'card'] as const) {
					expect(textContrast(t, 'text_primary', on)).toBeGreaterThanOrEqual(7 - 0.05)
					expect(textContrast(t, 'text_secondary', on)).toBeGreaterThanOrEqual(4.5 - 0.05)
					expect(textContrast(t, 'accent', on)).toBeGreaterThanOrEqual(4.5 - 0.05)
					expect(textContrast(t, 'link_color', on)).toBeGreaterThanOrEqual(4.5 - 0.05)
				}
			})
		}
	}
})

describe('les accents gardent leur teinte', () => {
	it('le cyan de nodyx.org reste cyan, le vert de sleemstudio reste vert, en thème clair', () => {
		for (const [nom, key] of [['nodyx.org', 'accent'], ['sleemstudio', 'accent']] as const) {
			const avant = hue(REELLES[nom][key]), apres = hue(gridThemeForMode(REELLES[nom], false)[key])
			expect(Math.abs(avant.h - apres.h)).toBeLessThan(6)
		}
	})
	it('le fond garde sa teinte : le vert très sombre de sleemstudio devient un vert très clair', () => {
		const clair = hue(gridThemeForMode(REELLES.sleemstudio, false).bg)
		expect(clair.l).toBeCloseTo(invertLightness(hue('#080d09').l), 2)
		expect(Math.abs(clair.h - hue('#080d09').h)).toBeLessThan(10)
	})
})

describe('ne change rien quand ce n’est pas nécessaire', () => {
	it('une grille lisible dans sa propre polarité reste identique', () => {
		const t = gridThemeForMode(REELLES['nodyx.org'], true)
		expect(t.bg).toBe('#05050a')
		expect(t.text_primary).toBe('#e2e8f0')
		expect(t.accent).toBe('#06b6d4')
	})
	it('adapt_to_mode: false coupe l’inversion (garde-fous conservés)', () => {
		const t = gridThemeForMode({ ...REELLES['nodyx.org'], adapt_to_mode: false }, false)
		expect(t.bg).toBe('#05050a')
	})
	it('la police, les arrondis et le reste du thème ne bougent pas', () => {
		const t = invertGridTheme(REELLES.sleemstudio)
		expect(t.font_family).toBe('Space Grotesk')
		expect(t.border_radius).toBe(REELLES.sleemstudio.border_radius)
	})
	it('l’ombre s’adoucit en clair, et retrouve sa force au retour', () => {
		const clair = invertGridTheme(REELLES['nodyx.org'])
		expect(clair.shadow).toBe('0 4px 24px rgba(0,0,0,0.2)')
		expect(invertGridTheme(clair).shadow).toBe('0 4px 24px rgba(0,0,0,0.4)')
	})
})

describe('adaptColorForMode (fonds de rangée, couleurs de widget)', () => {
	it('inverse seulement quand le mode du visiteur diffère de la conception', () => {
		expect(adaptColorForMode('#05050a', 'dark', true)).toBe('#05050a')
		expect(adaptColorForMode('#05050a', 'dark', false)).not.toBe('#05050a')
		expect(adaptColorForMode('var(--x)', 'dark', false)).toBe('var(--x)')
	})
})
