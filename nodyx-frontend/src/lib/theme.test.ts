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
})
