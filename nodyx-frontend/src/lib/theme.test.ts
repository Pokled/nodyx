import { describe, it, expect } from 'vitest'
import { contrastSafeColor } from './theme'

describe('contrastSafeColor', () => {
	// Le cas exact signalé par Jonathan avant même que le bouton de bascule
	// n'existe : un canal en blanc (pensé pour le fond sombre historique)
	// devient invisible si on peut basculer en thème clair.
	it('un blanc choisi pour le sombre retombe sur le fallback en thème clair', () => {
		expect(contrastSafeColor('#ffffff', '#333333', false)).toBe('#333333')
	})

	it('un noir choisi pour le clair retombe sur le fallback en thème sombre', () => {
		expect(contrastSafeColor('#000000', '#cccccc', true)).toBe('#cccccc')
	})

	it('un blanc reste blanc sur fond sombre (cas normal, historique)', () => {
		expect(contrastSafeColor('#ffffff', '#333333', true)).toBe('#ffffff')
	})

	it('un noir reste noir sur fond clair (cas normal)', () => {
		expect(contrastSafeColor('#000000', '#cccccc', false)).toBe('#000000')
	})

	it('une couleur moyennement saturee passe sur les deux themes', () => {
		// Un violet/bleu vif reste lisible dans les deux sens — seuls les cas
		// francs (blanc sur clair, noir sur sombre) doivent être corrigés.
		expect(contrastSafeColor('#6366f1', '#333333', true)).toBe('#6366f1')
		expect(contrastSafeColor('#6366f1', '#333333', false)).toBe('#6366f1')
	})

	it('ignore les formats non-hex (rgb(), mots-cles CSS...) sans les casser', () => {
		expect(contrastSafeColor('rgb(255,255,255)', '#333333', false)).toBe('rgb(255,255,255)')
		expect(contrastSafeColor('white', '#333333', false)).toBe('white')
	})

	it('une couleur absente retombe directement sur le fallback', () => {
		expect(contrastSafeColor(null, '#333333', true)).toBe('#333333')
		expect(contrastSafeColor(undefined, '#333333', false)).toBe('#333333')
	})

	// Couleurs réelles de pseudos relevées sur nodyx.org le 29/10/2026.
	it('un gris sombre (#444546, 1,9:1 sur fond sombre) retombe sur le fallback', () => {
		expect(contrastSafeColor('#444546', '#cccccc', true)).toBe('#cccccc')
	})

	it('un vert fluo garde sa teinte en thème clair, assombri jusqu’à être lisible', () => {
		const c = contrastSafeColor('#5fff28', '#333333', false)
		expect(c).not.toBe('#5fff28')
		expect(c).not.toBe('#333333')
		expect(contrastRatio(c, LIGHT_REF)).toBeGreaterThanOrEqual(3)
		expect(isGreenish(c)).toBe(true)
	})

	it('un magenta foncé garde sa teinte en thème sombre, éclairci jusqu’à être lisible', () => {
		const c = contrastSafeColor('#8f0070', '#cccccc', true)
		expect(c).not.toBe('#cccccc')
		expect(contrastRatio(c, DARK_REF)).toBeGreaterThanOrEqual(3)
		const [r, g, b] = rgb(c)
		expect(r > g && b > g).toBe(true)
	})

	it('le rouge, l’orange foncé et le vert moyen restent intacts dans les deux thèmes', () => {
		for (const c of ['#ff0000', '#e11d48', '#008000']) {
			expect(contrastSafeColor(c, '#333333', true)).toBe(c)
			expect(contrastSafeColor(c, '#333333', false)).toBe(c)
		}
	})

	it('chaque couleur de pseudo réelle atteint 3:1 dans les deux thèmes', () => {
		for (const c of ['#444546', '#8f0070', '#5fff28', '#7fc417', '#ff8800', '#c4b5fd', '#0000ff', '#ffff00']) {
			expect(contrastRatio(contrastSafeColor(c, '#888888', true), DARK_REF)).toBeGreaterThanOrEqual(3)
			expect(contrastRatio(contrastSafeColor(c, '#555555', false), LIGHT_REF)).toBeGreaterThanOrEqual(3)
		}
	})
})

const DARK_REF = '#17140f'
const LIGHT_REF = '#ffffff'

function rgb(hex: string): [number, number, number] {
	return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}
function lum(hex: string): number {
	const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
	const [r, g, b] = rgb(hex)
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrastRatio(a: string, b: string): number {
	const x = lum(a), y = lum(b)
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
function isGreenish(hex: string): boolean {
	const [r, g, b] = rgb(hex)
	return g > r && g > b
}
