import { browser } from '$app/environment'

export interface AnchoredPopoverOptions {
	/** Élément de référence. Par défaut : le parent du nœud AVANT le portal. */
	anchor?: HTMLElement | null
	/** Écart en px entre l'ancre et le panneau. */
	gap?: number
	/** Marge minimale conservée avec les bords de l'écran. */
	margin?: number
	/** 'bottom' ouvre sous l'ancre et bascule au-dessus si ça déborde ; 'top' l'inverse. */
	placement?: 'bottom' | 'top'
	/** Aligne le panneau sur le bord droit de l'ancre plutôt que sur le gauche. */
	align?: 'start' | 'end'
}

/**
 * Panneau ancré à un bouton : portalé dans `<body>`, positionné en `fixed`
 * depuis le rectangle de son ancre, borné à l'écran DES DEUX CÔTÉS, et bascule
 * de l'autre côté quand il n'y a plus la place.
 *
 * Extrait de `editor/NodyxEditor.svelte` (action `autoFlip`), où ce calcul est
 * en production depuis longtemps : c'est le seul endroit du dépôt qui traitait
 * correctement le problème. Il est promu ici en primitive partagée plutôt que
 * recopié une nième fois, parce que six stratégies de positionnement
 * différentes coexistaient et que seule celle-ci résistait aux ancêtres
 * transformés (cf `portal.ts` pour le détail du piège).
 *
 * Le suivi du scroll est en phase de CAPTURE : un `position: fixed` ne suit pas
 * le défilement d'un conteneur interne, il faut le repositionner à la main.
 */
export function anchoredPopover(node: HTMLElement, options: AnchoredPopoverOptions = {}) {
	if (!browser) return

	const gap       = options.gap ?? 4
	const margin    = options.margin ?? 8
	const placement = options.placement ?? 'bottom'
	const align     = options.align ?? 'start'

	// L'ancre doit être lue AVANT de déplacer le nœud : après le portal, son
	// parent est <body> et l'information est perdue.
	let anchor: HTMLElement | null = options.anchor ?? node.parentElement

	document.body.appendChild(node)

	function place() {
		if (!anchor || !anchor.isConnected) return

		// Réinitialisé avant mesure : sinon on mesure le panneau contraint par sa
		// position précédente, et il rétrécit un peu plus à chaque repositionnement.
		node.style.left   = '0px'
		node.style.top    = '0px'
		node.style.right  = 'auto'
		node.style.bottom = 'auto'

		const pw = node.offsetWidth
		const ph = node.offsetHeight
		const a  = anchor.getBoundingClientRect()
		const vw = window.innerWidth
		const vh = window.innerHeight

		const wanted = align === 'end' ? a.right - pw : a.left
		const left   = Math.max(margin, Math.min(wanted, vw - pw - margin))

		let top: number
		if (placement === 'bottom') {
			top = a.bottom + gap
			if (top + ph > vh - margin && a.top - ph - gap >= margin) top = a.top - ph - gap
		} else {
			top = a.top - ph - gap
			if (top < margin && a.bottom + gap + ph <= vh - margin) top = a.bottom + gap
		}
		top = Math.max(margin, Math.min(top, vh - ph - margin))

		node.style.left = `${Math.round(left)}px`
		node.style.top  = `${Math.round(top)}px`
	}

	place()

	// Le panneau peut grandir après coup (contenu asynchrone, police chargée) :
	// on le repositionne alors, sinon il déborde sans que rien ne le rattrape.
	const ro = new ResizeObserver(place)
	ro.observe(node)
	window.addEventListener('resize', place)
	window.addEventListener('scroll', place, true)

	return {
		update(next: AnchoredPopoverOptions = {}) {
			if (next.anchor !== undefined) anchor = next.anchor
			place()
		},
		destroy() {
			ro.disconnect()
			window.removeEventListener('resize', place)
			window.removeEventListener('scroll', place, true)
			node.remove()
		},
	}
}
