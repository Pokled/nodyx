// Découpage du texte du canvas en lignes, sans dépendre d'un vrai <canvas>
// (la largeur d'un texte est mesurée par la fonction reçue).

export type Mesure = (texte: string) => number

/** Coupe sur les retours à la ligne, puis sur les espaces quand une ligne dépasse maxW. */
export function buildTextLines(mesure: Mesure, text: string, maxW: number): string[] {
	const result: string[] = []
	for (const para of text.split('\n')) {
		const words = para.split(' ')
		let line = ''
		for (const word of words) {
			const test = line ? `${line} ${word}` : word
			if (mesure(test) > maxW && line) {
				result.push(line); line = word
			} else { line = test }
		}
		result.push(line)
	}
	return result
}

/**
 * Lignes à dessiner dans une note : les mêmes coupures qu'un bloc de texte
 * (retours à la ligne compris, ignorés avant le 10/10/2026), arrêtées au bas
 * de la note. Une ligne d'indice i est posée à i * lineH sous la première.
 */
export function noteLines(mesure: Mesure, text: string, maxW: number, lineH: number, maxH: number): string[] {
	return buildTextLines(mesure, text, maxW).filter((_, i) => i * lineH <= maxH)
}
