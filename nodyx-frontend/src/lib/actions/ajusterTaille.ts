// Réduire la police d'un titre juste assez pour qu'aucun mot ne soit rogné.
//
// Un titre limité à N lignes se coupe entre les mots, jamais dans un mot : un
// mot plus large que la colonne est rogné sur le côté. Cas réel (11/10/2026) :
// « Nodyx - Hub Communautaire » en tête de barre latérale, chez un admin dont
// l'icône d'administration réduit la colonne à 121 px, « Communautaire » en
// faisant 148 : « Communauta ». Un nom court garde sa taille.

/**
 * La plus grande taille, de `max` à `min` par pas de `pas`, pour laquelle
 * `deborde(taille)` est faux. `min` si rien ne tient.
 */
export function taillePourTenir(deborde: (taille: number) => boolean, max: number, min: number, pas = 0.5): number {
	for (let t = max; t > min; t -= pas) if (!deborde(t)) return t
	return min
}

/** use:ajusterTaille={texte} : recalcule quand le texte ou la largeur change. */
export function ajusterTaille(node: HTMLElement, _texte?: unknown) {
	const max = parseFloat(getComputedStyle(node).fontSize) || 17
	const ajuster = () => {
		const t = taillePourTenir(taille => {
			node.style.fontSize = `${taille}px`
			return node.scrollWidth > node.clientWidth + 1
		}, max, 12)
		node.style.fontSize = t === max ? '' : `${t}px`
	}
	ajuster()
	// On observe le parent : observer le titre lui-même relancerait le calcul
	// à chaque changement de taille qu'il provoque.
	const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(ajuster) : null
	if (node.parentElement) ro?.observe(node.parentElement)
	document.fonts?.ready.then(ajuster).catch(() => {})
	return {
		update: ajuster,
		destroy: () => ro?.disconnect(),
	}
}
