import { describe, it, expect } from 'vitest'
import { thumbGeometry } from './overlayScroll'

describe('thumbGeometry', () => {
	it('ne dessine rien quand il n’y a rien à faire défiler', () => {
		expect(thumbGeometry(800, 800, 0)).toBeNull()
		expect(thumbGeometry(800, 802, 0)).toBeNull()
	})

	it('laisse la marge haut et bas : le rail s’arrête avant les arrondis', () => {
		const g = thumbGeometry(800, 1600, 0, 14)!
		expect(g.railHeight).toBe(800 - 28)
	})

	it('pouce proportionnel à la part visible du contenu', () => {
		const g = thumbGeometry(800, 1600, 0, 14)!
		expect(g.thumbHeight).toBeCloseTo((800 - 28) / 2)
	})

	it('pouce jamais plus petit que le minimum saisissable', () => {
		const g = thumbGeometry(800, 100_000, 0, 14, 36)!
		expect(g.thumbHeight).toBe(36)
	})

	it('en haut au départ, collé au bas du rail en fin de course', () => {
		const top = thumbGeometry(800, 2000, 0)!
		expect(top.thumbY).toBe(0)
		const end = thumbGeometry(800, 2000, 1200)!
		expect(end.thumbY + end.thumbHeight).toBeCloseTo(end.railHeight)
	})

	it('ne sort jamais du rail, même quand le défilement élastique dépasse', () => {
		const over = thumbGeometry(800, 2000, 1500)!
		expect(over.thumbY + over.thumbHeight).toBeLessThanOrEqual(over.railHeight + 1e-9)
		const under = thumbGeometry(800, 2000, -80)!
		expect(under.thumbY).toBe(0)
	})

	it('zone minuscule : le pouce ne dépasse pas le rail', () => {
		const g = thumbGeometry(60, 400, 0, 14, 36)!
		expect(g.thumbHeight).toBeLessThanOrEqual(g.railHeight)
	})
})
