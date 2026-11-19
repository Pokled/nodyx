// Les animations DÉCORATIVES en boucle (reflet Twitch, bandeau défilant, radar des
// visiteurs, pastilles qui pulsent) ne tournent que si on les voit. Hors de l'écran,
// ou onglet caché, elles se mettent en pause : une animation qui tourne quelque part
// oblige le navigateur à repeindre, et à recalculer les effets de verre posés au-dessus
// (mesuré le 19/11/2026 : c'était une des sources de saccades de nodyx.org).
// Qui demande « moins d'animations » à son système ne les voit pas du tout (app.css).
export function pauseOffscreen(node: HTMLElement) {
	node.setAttribute('data-nx-deco', '')
	let visible = true
	const apply = () => {
		if (!visible || document.hidden) node.setAttribute('data-nx-paused', '')
		else node.removeAttribute('data-nx-paused')
	}
	const io = typeof IntersectionObserver !== 'undefined'
		? new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); apply() }, { rootMargin: '100px' })
		: null
	io?.observe(node)
	document.addEventListener('visibilitychange', apply)
	return {
		destroy() {
			io?.disconnect()
			document.removeEventListener('visibilitychange', apply)
		},
	}
}
