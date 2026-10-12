import { describe, it, expect } from 'vitest'
import { taillePourTenir } from './ajusterTaille'

// Un mot de 13 lettres, 0,65 em par lettre en moyenne, dans 121 px :
// il tient à partir de 14 px (13 × 0,65 × 14 = 118,3).
const mot = (taille: number) => 13 * 0.65 * taille > 121

describe('taillePourTenir', () => {
	it('un titre qui tient garde sa taille', () => {
		expect(taillePourTenir(() => false, 17, 12)).toBe(17)
	})
	it('un mot trop large : la plus grande taille qui tient, par demi-pixel', () => {
		expect(taillePourTenir(mot, 17, 12)).toBe(14)
	})
	it('rien ne tient : on s\'arrête au minimum lisible', () => {
		expect(taillePourTenir(() => true, 17, 12)).toBe(12)
	})
})
