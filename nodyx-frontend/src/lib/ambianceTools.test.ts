import { describe, it, expect } from 'vitest'
import {
	historyStart, historyPush, historyUndo, historyRedo,
	encodeAmbiance, decodeAmbiance, AMBIANCE_PRESETS, ORIGINEL, applyPreset, presetMatches, bannerPreset,
	setZoneStyle, clearZone, copyZoneToAll,
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

	it('un décor d’ambiance voyage (toute instance Nodyx l’a)', () => {
		const t = T({ backdrop: 'custom', backdrop_url: '/ambiances/cyberpunk.jpg' })
		expect(decodeAmbiance(encodeAmbiance(t))).toMatchObject({ backdrop: 'custom', backdrop_url: '/ambiances/cyberpunk.jpg' })
	})

	it('un code ne peut pas faire passer une autre adresse pour un décor d’ambiance', () => {
		const forged = 'NODYX-AMB-1:' + btoa(JSON.stringify({ a: '#ffffff', b: 'custom', u: '/uploads/../x.jpg', i: 50, m: 'dark' })).replace(/=+$/, '')
		expect(decodeAmbiance(forged)).toBeNull()
		const ext = 'NODYX-AMB-1:' + btoa(JSON.stringify({ a: '#ffffff', b: 'custom', u: 'https://evil.example/x.jpg', i: 50, m: 'dark' })).replace(/=+$/, '')
		expect(decodeAmbiance(ext)).toBeNull()
	})

	it('une image personnalisée (propre à son instance) devient la bannière de l’instance qui importe', () => {
		const code = encodeAmbiance(T({ backdrop: 'custom', backdrop_url: '/uploads/banners/x.jpg' }))
		expect(code).not.toContain('uploads')
		expect(decodeAmbiance(code)?.backdrop).toBe('banner')
	})

	it('un code d’avant le réglage des fonds reste valide (gris teintés)', () => {
		const ancien = 'NODYX-AMB-1:' + btoa(JSON.stringify({ a: '#ffb020', b: 'banner', i: 60, m: 'dark' })).replace(/=+$/, '')
		expect(decodeAmbiance(ancien)?.neutrals).toBe('tinted')
	})

	it('reste court, facile à copier', () => {
		expect(encodeAmbiance(T()).length).toBeLessThan(110)
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
		['fonds inconnus', forge({ a: '#ffffff', b: 'banner', i: 50, m: 'dark', n: 'rose' })],
		['code démesuré', 'NODYX-AMB-1:' + 'A'.repeat(500)],
	])('refuse un code invalide ou trafiqué : %s', (_l, code) => {
		expect(decodeAmbiance(code)).toBeNull()
	})
})

describe('ambiances prêtes', () => {
	const byId = (id: string) => AMBIANCE_PRESETS.find(p => p.id === id)!

	it('une ambiance « couleur » garde le décor et le mode choisis par l’admin', () => {
		const base = T({ backdrop: 'custom', backdrop_url: '/uploads/banners/x.jpg', default_mode: 'light' })
		const out = applyPreset(base, byId('forest'))
		expect(out.backdrop).toBe('custom')
		expect(out.backdrop_url).toBe('/uploads/banners/x.jpg')
		expect(out.default_mode).toBe('light')
	})

	it('une ambiance « univers » fixe tout, et apporte SON décor à la place de la bannière', () => {
		const out = applyPreset(T({ backdrop: 'custom', backdrop_url: '/uploads/banners/x.jpg' }), byId('matrix'))
		expect(out).toMatchObject({ accent: '#22e36b', backdrop: 'custom', backdrop_url: '/ambiances/matrix.jpg', default_mode: 'dark' })
		for (const id of ['matrix', 'cyberpunk', 'synthwave', 'sepia']) expect(byId(id).theme.backdrop_url).toMatch(/^\/ambiances\/[a-z]+\.jpg$/)
	})

	it('Cyberpunk et Synthwave en fonds graphite : un jaune ou un rose désaturés virent au brun', () => {
		expect(byId('cyberpunk').theme.neutrals).toBe('graphite')
		expect(byId('synthwave').theme.neutrals).toBe('graphite')
	})

	it('Coquin : noir profond, orange vif, aucun décor, et le texte posé sur l’orange est lisible', () => {
		const t = applyPreset(T(), byId('coquin'))
		expect(t).toMatchObject({ accent: '#ff9000', neutrals: 'black', backdrop: 'none', default_mode: 'dark' })
		const v = deriveShellVars(t, true)
		expect(contrast(v['--nx-on-accent'], v['--nx-header-accent'])).toBeGreaterThanOrEqual(4.5)
	})

	it('Gazette : aucun décor, le journal reste nu', () => {
		expect(applyPreset(T(), byId('gazette')).backdrop).toBe('none')
	})

	it('on peut toujours revenir à l’Originel, et à l’ambiance de sa bannière', () => {
		const matrix = applyPreset(T(), byId('matrix'))
		expect(applyPreset(matrix, ORIGINEL)).toMatchObject({ ...DEFAULT_SHELL_THEME })
		expect(presetMatches(applyPreset(matrix, ORIGINEL), ORIGINEL)).toBe(true)
		const b = applyPreset(matrix, bannerPreset('#e5a867'))
		expect(b).toMatchObject({ accent: '#e5a867', backdrop: 'banner' })
		expect(presetMatches(b, bannerPreset('#E5A867'))).toBe(true)
	})

	it('presetMatches : une retouche après le clic désélectionne la carte', () => {
		const t = applyPreset(T(), byId('ocean'))
		expect(presetMatches(t, byId('ocean'))).toBe(true)
		expect(presetMatches({ ...t, intensity: t.intensity + 1 }, byId('ocean'))).toBe(false)
	})

	it('chaque ambiance, Originel compris, reste lisible dans les deux modes', () => {
		for (const p of [ORIGINEL, ...AMBIANCE_PRESETS]) for (const dark of [false, true]) {
			const v = deriveShellVars(applyPreset(T(), p), dark)
			expect(contrast(v['--nx-header-accent'], v['--nx-surface'])).toBeGreaterThanOrEqual(4.5)
		}
	})

	// Teintes OKLCH MESURÉES des couleurs que le CDC contenant bannit comme
	// signature du « design généré » : cyan-300/500 (207-215) et
	// indigo-500/600 + violet-400/600 (277-294). Le bleu franc n'en fait pas
	// partie. Marge de ±12° autour de chaque famille.
	it('aucun preset dans les familles cyan ou indigo-violet bannies par le CDC', () => {
		for (const p of [ORIGINEL, ...AMBIANCE_PRESETS]) {
			const { h, c } = rgbToOklch(hexToRgb(p.theme.accent!))
			if (c <= 0.04) continue   // quasi-neutre : pas de teinte
			expect(h >= 195 && h <= 227, `${p.id} dans le cyan (${h.toFixed(0)})`).toBe(false)
			expect(h >= 265 && h <= 306, `${p.id} dans l'indigo-violet (${h.toFixed(0)})`).toBe(false)
		}
	})

	it('identifiants uniques, Originel et bannière compris (sinon {#each} casse toute la page)', () => {
		const ids = [ORIGINEL.id, bannerPreset('#000000').id, ...AMBIANCE_PRESETS.map(p => p.id)]
		expect(new Set(ids).size).toBe(ids.length)
	})
})

describe('palette de la grille qui suit l’ambiance', () => {
	it('chaque ambiance donne à la grille des textes lisibles sur ses cartes (fond sombre)', async () => {
		const { ambiancePalette } = await import('./shellTheme')
		for (const p of [ORIGINEL, ...AMBIANCE_PRESETS]) {
			const t = applyPreset(T(), p)
			const pal = ambiancePalette(t)
			const surface = deriveShellVars(t, true)['--nx-surface']
			expect(contrast(pal.text, surface), `${p.id} texte`).toBeGreaterThanOrEqual(7)
			expect(contrast(pal.muted, surface), `${p.id} atténué`).toBeGreaterThanOrEqual(4.5)
			expect(contrast(pal.accent, surface), `${p.id} accent`).toBeGreaterThanOrEqual(4.5)
		}
	})
})

describe('style propre à une zone', () => {
	const base: ShellTheme = { ...DEFAULT_SHELL_THEME }

	it('pose un réglage sur UNE zone, sans toucher aux autres', () => {
		const t = setZoneStyle(base, 'rail', { opacity: 40 })
		expect(t.zones).toEqual({ rail: { opacity: 40 } })
		expect(t.accent).toBe(base.accent)
	})

	it('un réglage remis à undefined revient à l’ambiance, et la zone vide disparaît', () => {
		const t = setZoneStyle(setZoneStyle(base, 'rail', { opacity: 40 }), 'rail', { opacity: undefined })
		expect(t).toEqual(base)
		expect('zones' in t).toBe(false)
	})

	it('revenir à l’ambiance ne vide que la zone visée', () => {
		const t = setZoneStyle(setZoneStyle(base, 'rail', { blur: 4 }), 'sheet', { radius: 6 })
		expect(clearZone(t, 'rail').zones).toEqual({ sheet: { radius: 6 } })
	})

	it('copier vers toutes les zones : des copies, pas le même objet partagé', () => {
		const t = copyZoneToAll(setZoneStyle(base, 'header', { image: { url: '/ambiances/matrix.jpg', x: 50, y: 50, zoom: 100, veil: 40 } }), 'header')
		expect(Object.keys(t.zones ?? {}).sort()).toEqual(['header', 'members', 'rail', 'sheet', 'sidebar'])
		expect(t.zones?.rail?.image).not.toBe(t.zones?.header?.image)
	})
})
