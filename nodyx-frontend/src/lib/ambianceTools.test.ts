import { describe, it, expect } from 'vitest'
import {
	historyStart, historyPush, historyUndo, historyRedo,
	encodeAmbiance, decodeAmbiance, AMBIANCE_PRESETS, applyPreset,
} from './ambianceTools'
import { DEFAULT_SHELL_THEME, deriveShellVars, contrast, rgbToOklch, hexToRgb, type ShellTheme } from './shellTheme'

const T = (over: Partial<ShellTheme> = {}): ShellTheme => ({ ...DEFAULT_SHELL_THEME, ...over })

describe('historique Annuler / Rétablir', () => {
	it('annule puis rétablit dans l’ordre', () => {
		let h = historyStart(1)
		h = historyPush(h, 2); h = historyPush(h, 3)
		h = historyUndo(h); expect(h.present).toBe(2)
		h = historyUndo(h); expect(h.present).toBe(1)
		h = historyUndo(h); expect(h.present).toBe(1)      // rien avant le début
		h = historyRedo(h); expect(h.present).toBe(2)
		h = historyRedo(h); h = historyRedo(h); expect(h.present).toBe(3)
	})

	it('un nouveau geste après une annulation efface ce qu’on pouvait rétablir', () => {
		let h = historyPush(historyPush(historyStart(1), 2), 3)
		h = historyUndo(h); h = historyPush(h, 9)
		expect(h.future).toEqual([])
		expect(historyRedo(h).present).toBe(9)
	})

	it('glisser un curseur (merge) s’annule d’un seul coup', () => {
		let h = historyPush(historyStart(0), 10)
		for (const v of [11, 12, 13, 14]) h = historyPush(h, v, true)
		expect(h.present).toBe(14)
		expect(historyUndo(h).present).toBe(0)
	})

	it('ignore un geste qui ne change rien', () => {
		const h = historyPush(historyStart({ a: 1 }), { a: 1 })
		expect(h.past).toEqual([])
	})

	it('garde au plus 50 étapes', () => {
		let h = historyStart(0)
		for (let i = 1; i <= 80; i++) h = historyPush(h, i)
		expect(h.past.length).toBe(50)
	})
})

describe('code d’ambiance', () => {
	it('aller-retour fidèle', () => {
		const t = T({ accent: '#2D8CF0', intensity: 37, default_mode: 'light', backdrop: 'none' })
		expect(decodeAmbiance(encodeAmbiance(t))).toEqual({ ...t, accent: '#2d8cf0', backdrop_url: null })
	})

	it('une image personnalisée (propre à son instance) devient la bannière de l’instance qui importe', () => {
		const code = encodeAmbiance(T({ backdrop: 'custom', backdrop_url: '/uploads/banners/x.jpg' }))
		expect(code).not.toContain('uploads')
		expect(decodeAmbiance(code)?.backdrop).toBe('banner')
	})

	it('reste court, facile à copier', () => {
		expect(encodeAmbiance(T()).length).toBeLessThan(90)
	})

	const forge = (o: unknown) => 'NODYX-AMB-1:' + btoa(JSON.stringify(o)).replace(/=+$/, '')
	it.each([
		['vide', ''],
		['sans préfixe', 'eyJhIjoiI2ZmZmZmZiJ9'],
		['charabia', 'NODYX-AMB-1:@@@'],
		['accent avec CSS', forge({ a: '#fff;x:url(y)', b: 'banner', i: 50, m: 'dark' })],
		['décor personnalisé (URL étrangère)', forge({ a: '#ffffff', b: 'custom', i: 50, m: 'dark' })],
		['intensité hors bornes', forge({ a: '#ffffff', b: 'banner', i: 500, m: 'dark' })],
		['mode inconnu', forge({ a: '#ffffff', b: 'banner', i: 50, m: 'sepia' })],
		['code démesuré', 'NODYX-AMB-1:' + 'A'.repeat(500)],
	])('refuse un code invalide ou trafiqué : %s', (_l, code) => {
		expect(decodeAmbiance(code)).toBeNull()
	})
})

describe('ambiances prêtes', () => {
	it('un preset ne touche qu’à l’accent et à l’intensité', () => {
		const base = T({ backdrop: 'none', default_mode: 'light' })
		const out = applyPreset(base, AMBIANCE_PRESETS[0])
		expect(out.backdrop).toBe('none')
		expect(out.default_mode).toBe('light')
	})

	it('chaque preset reste lisible dans les deux modes', () => {
		for (const p of AMBIANCE_PRESETS) for (const dark of [false, true]) {
			const v = deriveShellVars(applyPreset(T(), p), dark)
			expect(contrast(v['--nx-header-accent'], v['--nx-surface'])).toBeGreaterThanOrEqual(4.5)
		}
	})

	// Teintes OKLCH MESURÉES des couleurs que le CDC contenant bannit comme
	// signature du « design généré » : cyan-300/500 (207-215) et
	// indigo-500/600 + violet-400/600 (277-294). Le bleu franc n'en fait pas
	// partie. Marge de ±12° autour de chaque famille.
	it('aucun preset dans les familles cyan ou indigo-violet bannies par le CDC', () => {
		for (const p of AMBIANCE_PRESETS) {
			const { h, c } = rgbToOklch(hexToRgb(p.accent))
			if (c <= 0.04) continue   // quasi-neutre : pas de teinte
			expect(h >= 195 && h <= 227, `${p.id} dans le cyan (${h.toFixed(0)})`).toBe(false)
			expect(h >= 265 && h <= 306, `${p.id} dans l'indigo-violet (${h.toFixed(0)})`).toBe(false)
		}
	})

	it('identifiants uniques (sinon {#each} casse toute la page)', () => {
		expect(new Set(AMBIANCE_PRESETS.map(p => p.id)).size).toBe(AMBIANCE_PRESETS.length)
	})
})
