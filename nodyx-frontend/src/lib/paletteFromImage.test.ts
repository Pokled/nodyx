import { describe, it, expect } from 'vitest'
import { extractPalette } from './paletteFromImage'
import { rgbToOklch, hexToRgb } from './shellTheme'

/** Image synthétique : liste de [couleur, nombre de pixels]. */
function image(parts: Array<[[number, number, number, number?], number]>): number[] {
	const out: number[] = []
	for (const [[r, g, b, a = 255], n] of parts) for (let i = 0; i < n; i++) out.push(r, g, b, a)
	return out
}
const hue = (hex: string) => rgbToOklch(hexToRgb(hex)).h

describe('extractPalette', () => {
	it('ignore noirs, blancs, gris et pixels transparents : ce ne sont pas des accents', () => {
		const px = image([[[0, 0, 0], 500], [[255, 255, 255], 500], [[128, 128, 128], 500], [[255, 0, 0, 0], 500]])
		expect(extractPalette(px)).toEqual([])
	})

	it('trouve la couleur marquante d’une bannière majoritairement sombre', () => {
		// Le cas des Vieux Looters : beaucoup de nuit, une lueur ambrée.
		const px = image([[[12, 10, 8], 3000], [[40, 38, 36], 1500], [[255, 170, 40], 300]])
		const [first] = extractPalette(px)
		expect(first).toBeDefined()
		expect(hue(first)).toBeGreaterThan(50)
		expect(hue(first)).toBeLessThan(90)
	})

	it('classe par présence × saturation : la teinte vive et étendue d’abord', () => {
		const px = image([[[230, 40, 40], 800], [[40, 90, 230], 200]])
		const [first, second] = extractPalette(px)
		expect(hue(first)).toBeLessThan(40)     // rouge
		expect(hue(second)).toBeGreaterThan(230) // bleu
	})

	it('propose des couleurs distinctes, jamais deux nuances quasi identiques', () => {
		const px = image([[[230, 40, 40], 800], [[232, 42, 41], 790], [[40, 90, 230], 200]])
		expect(extractPalette(px)).toHaveLength(2)
	})

	it('ne dépasse jamais le nombre demandé', () => {
		const parts: Array<[[number, number, number], number]> = []
		for (let h = 0; h < 12; h++) {
			const a = h * Math.PI / 6
			parts.push([[Math.round(128 + 120 * Math.cos(a)), Math.round(128 + 120 * Math.cos(a - 2.1)), Math.round(128 + 120 * Math.cos(a + 2.1))], 100])
		}
		expect(extractPalette(image(parts), 5).length).toBeLessThanOrEqual(5)
		expect(extractPalette(image(parts), 5).length).toBeGreaterThanOrEqual(3)
	})

	it('une teinte vive et peu étendue passe devant un grand aplat terne', () => {
		// Le cas réel de la bannière des Vieux Looters : beaucoup de brun, un peu d'or vif.
		const px = image([[[137, 99, 76], 900], [[229, 168, 103], 400]])
		expect(extractPalette(px)[0]).toBe('#e5a867')
	})

	it('renvoie des #rrggbb valides, prêts pour l’ambiance', () => {
		const px = image([[[20, 200, 120], 400]])
		for (const c of extractPalette(px)) expect(c).toMatch(/^#[0-9a-f]{6}$/)
	})
})
