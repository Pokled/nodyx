import { describe, it, expect } from 'vitest'
import { palette, action, neutres, etat, etiquette, contrast, toOklch, oklch, hexToRgb, ETATS, ETIQUETTES, AA, COULEUR_NODYX, type Mode } from './palette'
import { STYLES, styleDe, styleVars, ESPACE, ARRONDIS } from './style'

const MODES: Mode[] = ['clair', 'sombre']
// Les couleurs proposées à l'admin, plus des couleurs volontairement hostiles
const COULEURS = ['#1f56c9', '#0f7b6c', '#7a3fa0', '#c2410c', '#b8860b', '#d6336c', '#2b2f36', '#ffe680', '#c8c8c8', '#000000', '#ffffff', '#00ff00', '#ff00ff', '#3b82f6', '#7c3aed']

describe('une couleur donne tous ses usages, toujours lisibles', () => {
	for (const c of COULEURS) for (const m of MODES) {
		it(`${c} en ${m}`, () => {
			const p = palette(c, m)
			expect(contrast(p.surAction, p.action)).toBeGreaterThanOrEqual(AA)     // le texte du bouton
			expect(contrast(p.lien, p.panneau)).toBeGreaterThanOrEqual(AA)         // un lien sur un panneau
			expect(contrast(p.texte, p.choisi)).toBeGreaterThanOrEqual(AA)         // le texte d'une ligne choisie
			expect(contrast(p.texte, p.panneau)).toBeGreaterThanOrEqual(7)         // le texte principal
			expect(contrast(p.texte2, p.panneau)).toBeGreaterThanOrEqual(AA)       // le texte secondaire
		})
	}

	it('le Cobalt de Nodyx est lisible tel quel en clair', () => {
		const a = action(COULEUR_NODYX, 'clair', '#ffffff')
		expect(a.ajustee).toBe(false)
		expect(a.action).toBe('#1f56c9')
	})

	it('une couleur trop pâle est ajustée, et on le sait', () => {
		expect(action('#ffe680', 'clair', '#ffffff').ajustee).toBe(true)
	})

	it('en sombre, la couleur n’est pas inversée : même teinte, plus claire, plus calme', () => {
		const clair = toOklch(palette(COULEUR_NODYX, 'clair').action), sombre = toOklch(palette(COULEUR_NODYX, 'sombre').action)
		expect(Math.abs(clair.h - sombre.h)).toBeLessThan(12)
		expect(sombre.l).toBeGreaterThan(clair.l)
		expect(sombre.c).toBeLessThanOrEqual(0.131)
	})

	it('le survol et l’appui s’éloignent du fond, dans le bon sens', () => {
		const cl = palette(COULEUR_NODYX, 'clair'), so = palette(COULEUR_NODYX, 'sombre')
		expect(toOklch(cl.survol).l).toBeLessThan(toOklch(cl.action).l)
		expect(toOklch(cl.appui).l).toBeLessThan(toOklch(cl.survol).l)
		expect(toOklch(so.survol).l).toBeGreaterThan(toOklch(so.action).l)
	})
})

describe('les gris', () => {
	it('jamais de blanc pur pour le fond, jamais de noir pur nulle part', () => {
		for (const m of MODES) {
			const n = neutres(m)
			expect(n.fond).not.toBe('#ffffff')
			for (const v of Object.values(n)) expect(v).not.toBe('#000000')
		}
	})

	it('en sombre, plus un plan est haut, plus il est clair (les ombres ne se voient pas)', () => {
		const n = neutres('sombre')
		const L = (h: string) => toOklch(h).l
		expect(L(n.fond)).toBeLessThan(L(n.panneau))
		expect(L(n.panneau)).toBeLessThan(L(n.retrait))
		expect(L(n.retrait)).toBeLessThan(L(n.flotte))
	})

	it('les gris teintés prennent la teinte de la couleur, les neutres non', () => {
		const t = palette('#c2410c', 'clair', true), n = palette('#c2410c', 'clair', false)
		expect(t.fond).not.toBe(n.fond)
		expect(Math.abs(toOklch(t.fond).h - toOklch('#c2410c').h)).toBeLessThan(20)
	})
})

describe('les états et les étiquettes ont un sens fixe', () => {
	it('chaque état est lisible sur son fond, en clair et en sombre', () => {
		for (const e of Object.keys(ETATS) as (keyof typeof ETATS)[]) for (const m of MODES) {
			const x = etat(e, m)
			expect(contrast(x.texte, x.fond)).toBeGreaterThanOrEqual(AA)
		}
	})

	it('les états ne dépendent pas de la couleur de l’instance', () => {
		expect(palette('#c2410c', 'clair').etats).toEqual(palette('#1f56c9', 'clair').etats)
	})

	it('chaque étiquette est lisible, en clair et en sombre', () => {
		for (const e of Object.keys(ETIQUETTES) as (keyof typeof ETIQUETTES)[]) for (const m of MODES) {
			const x = etiquette(e, m)
			expect(contrast(x.texte, x.fond)).toBeGreaterThanOrEqual(AA)
		}
	})
})

describe('les conversions', () => {
	it('une couleur fait l’aller-retour OKLCH sans dériver', () => {
		for (const c of ['#1f56c9', '#0f7b6c', '#c2410c', '#7a3fa0', '#808080']) {
			const o = toOklch(c)
			expect(oklch(o.l, o.c, o.h)).toBe(c)
		}
	})

	it('une couleur hors de l’écran est ramenée dedans', () => {
		expect(oklch(0.7, 0.5, 145)).toMatch(/^#[0-9a-f]{6}$/)
	})

	it('accepte #rgb, refuse le reste', () => {
		expect(hexToRgb('#fff')).toEqual([1, 1, 1])
		expect(() => hexToRgb('rouge')).toThrow()
		expect(() => hexToRgb('#12345')).toThrow()
		expect(() => hexToRgb('url(x)')).toThrow()
	})
})

describe('formes et espace', () => {
	it('l’espace est toujours un multiple de 4', () => {
		for (const e of ESPACE) expect(e % 4).toBe(0)
	})

	it('les arrondis grandissent avec la taille', () => {
		for (const a of Object.values(ARRONDIS)) {
			expect(a.etiquette).toBeLessThanOrEqual(a.controle)
			expect(a.controle).toBeLessThanOrEqual(a.panneau)
			expect(a.panneau).toBeLessThanOrEqual(a.fenetre)
		}
	})

	it('un style de départ se reconnaît ; un réglage affiné devient « perso »', () => {
		expect(styleDe(STYLES.coupe)).toBe('coupe')
		expect(styleDe({ ...STYLES.arrondi, coins: 'quatre' })).toBe('perso')
	})

	it('les variables CSS ne contiennent que des valeurs calculées, même avec une entrée inconnue', () => {
		const v = styleVars({ arrondi: 'n’importe' as never, bord: '1px;}body{display:none' as never, ombre: 'aucune', coins: 'un' })
		for (const x of Object.values(v)) expect(x).toMatch(/^\d+(px)?$/)
		expect(v['--nx-r-panneau']).toBe('10px')
		expect(v['--nx-bord']).toBe('1px')
	})
})
