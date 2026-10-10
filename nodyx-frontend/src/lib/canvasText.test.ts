import { describe, it, expect } from 'vitest'
import { noteLines } from './canvasText'

// Un caractère = 1 unité de largeur : les coupures se lisent à l'oeil.
const mesure = (t: string) => t.length

describe('noteLines : le texte d\'une note du canvas', () => {
	it('coupe sur les espaces quand la ligne est trop large', () => {
		expect(noteLines(mesure, 'un deux trois quatre', 9, 1, 100)).toEqual(['un deux', 'trois', 'quatre'])
	})

	it('respecte les retours à la ligne tapés par l\'utilisateur', () => {
		expect(noteLines(mesure, 'Forum\nDes discussions', 100, 1, 100)).toEqual(['Forum', 'Des discussions'])
	})

	it('garde les lignes vides voulues', () => {
		expect(noteLines(mesure, 'a\n\nb', 100, 1, 100)).toEqual(['a', '', 'b'])
	})

	it('ne dessine aucune ligne sous le bas de la note', () => {
		// Hauteur utile 2 avec des lignes de 1 : lignes en 0, 1, 2, pas au-delà.
		expect(noteLines(mesure, 'aa bb cc dd ee ff', 2, 1, 2)).toEqual(['aa', 'bb', 'cc'])
	})
})
