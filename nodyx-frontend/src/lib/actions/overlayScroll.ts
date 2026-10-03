/**
 * Barre de défilement flottante, à poser sur n'importe quelle zone qui défile :
 *
 *   <div class="liste" use:overlayScroll>…</div>
 *
 * ─── Pourquoi ────────────────────────────────────────────────────────────────
 * Le contenant flottant (SPECS/NODYX_CONTENANT_DESIGN_CDC.md) pose ses zones
 * dans des plaques aux coins arrondis. La barre native est un rectangle collé
 * au bord : elle ignore ces arrondis et reste affichée en permanence. Celle-ci
 * suit la logique macOS/iOS : invisible au repos, elle apparaît au défilement
 * ou quand la souris approche du bord, s'arrête avant les arrondis, s'efface.
 * Demandée par Jonathan le 29/09 (« qu'elle épouse mieux les arrondis, et
 * n'apparaisse que quand on l'utilise »).
 *
 * ─── Ce qui ne change PAS ────────────────────────────────────────────────────
 * Seul le DESSIN est remplacé. Molette, pavé tactile, clavier et lecteurs
 * d'écran agissent toujours sur le défilement natif de la zone ; le pouce est
 * aria-hidden, mais saisissable à la souris (glisser, clic dans le rail).
 *
 * ─── Où vit la barre ─────────────────────────────────────────────────────────
 * En `position: absolute` dans l'offsetParent de la zone (son ancêtre
 * positionné le plus proche), JAMAIS en `fixed` : les sidebars portent un
 * `transform` / `will-change` qui piégerait un élément fixe (cf. portal.ts).
 *
 * Active à partir de 1024px : en dessous, la barre native du système (souvent
 * déjà flottante sur mobile) reste la bonne réponse.
 */

export interface OverlayScrollOptions {
	/** Marge haut/bas : la barre s'arrête avant les arrondis. */
	inset?: number
	/** Hauteur minimale du pouce, pour rester saisissable. */
	minThumb?: number
}

/**
 * Géométrie pure du pouce (testée dans overlayScroll.test.ts).
 * Renvoie null quand il n'y a rien à faire défiler.
 */
export function thumbGeometry(
	clientHeight: number,
	scrollHeight: number,
	scrollTop: number,
	inset = 14,
	minThumb = 36,
): { railHeight: number; thumbHeight: number; thumbY: number } | null {
	const max = scrollHeight - clientHeight
	if (max <= 2) return null
	const railHeight = Math.max(0, clientHeight - inset * 2)
	const thumbHeight = Math.min(railHeight, Math.max(minThumb, (clientHeight / scrollHeight) * railHeight))
	const ratio = Math.min(1, Math.max(0, scrollTop / max))
	return { railHeight, thumbHeight, thumbY: ratio * (railHeight - thumbHeight) }
}

const IDLE_MS = 900
const RAIL_W = 12

export function overlayScroll(node: HTMLElement, opts: OverlayScrollOptions = {}) {
	const inset = opts.inset ?? 14
	const minThumb = opts.minThumb ?? 36
	const mq = window.matchMedia('(min-width: 1024px)')

	const rail = document.createElement('div')
	rail.className = 'nx-oscroll'
	rail.setAttribute('aria-hidden', 'true')
	const thumb = document.createElement('div')
	thumb.className = 'nx-oscroll-thumb'
	rail.appendChild(thumb)

	let active = false
	let hovering = false
	let dragging = false
	let idle: ReturnType<typeof setTimeout> | undefined
	let raf = 0
	let geo: ReturnType<typeof thumbGeometry> = null

	function measure() {
		geo = thumbGeometry(node.clientHeight, node.scrollHeight, node.scrollTop, inset, minThumb)
		if (!geo) { rail.style.display = 'none'; return }
		rail.style.display = ''
		rail.style.top = `${node.offsetTop + inset}px`
		rail.style.left = `${node.offsetLeft + node.offsetWidth - RAIL_W}px`
		rail.style.height = `${geo.railHeight}px`
		thumb.style.height = `${geo.thumbHeight}px`
		thumb.style.transform = `translateY(${geo.thumbY}px)`
	}
	const schedule = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure) }

	function wake() {
		rail.classList.add('visible')
		clearTimeout(idle)
		idle = setTimeout(() => { if (!hovering && !dragging) rail.classList.remove('visible') }, IDLE_MS)
	}
	const onScroll = () => { schedule(); wake() }
	// Approcher la souris du bord droit révèle la barre : on la trouve quand
	// on la cherche, jamais avant.
	const onMove = (e: PointerEvent) => {
		if (!geo) return
		const r = node.getBoundingClientRect()
		if (e.clientX > r.right - 28 && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) wake()
	}

	// ── Saisie ────────────────────────────────────────────────────────────────
	let startY = 0
	let startScroll = 0
	const onThumbDown = (e: PointerEvent) => {
		if (e.button !== 0) return
		e.preventDefault(); e.stopPropagation()
		dragging = true; rail.classList.add('hot'); thumb.classList.add('dragging')
		startY = e.clientY; startScroll = node.scrollTop
		thumb.setPointerCapture(e.pointerId)
	}
	const onThumbMove = (e: PointerEvent) => {
		if (!dragging || !geo) return
		const room = geo.railHeight - geo.thumbHeight
		if (room <= 0) return
		node.scrollTop = startScroll + (e.clientY - startY) * ((node.scrollHeight - node.clientHeight) / room)
	}
	const onThumbUp = () => {
		dragging = false; thumb.classList.remove('dragging')
		if (!hovering) rail.classList.remove('hot')
		wake()
	}
	// Clic dans le rail hors du pouce : saut d'une page vers le clic.
	const onRailDown = (e: PointerEvent) => {
		if (e.button !== 0 || !geo) return
		const y = e.clientY - rail.getBoundingClientRect().top
		node.scrollBy({ top: (y < geo.thumbY ? -1 : 1) * node.clientHeight * 0.9, behavior: 'smooth' })
	}
	const onEnter = () => { hovering = true; rail.classList.add('hot'); wake() }
	const onLeave = () => { hovering = false; if (!dragging) rail.classList.remove('hot'); wake() }

	// Taille de la zone (panneau replié) ET de son contenu (page qui charge,
	// salon vocal qui se déplie) : on observe la zone et ses enfants directs,
	// bien moins coûteux qu'observer tout le DOM (le chat mute sans arrêt).
	const ro = new ResizeObserver(schedule)
	const watch = () => { ro.disconnect(); ro.observe(node); for (const c of Array.from(node.children)) ro.observe(c) }
	const mo = new MutationObserver(watch)

	function enable() {
		if (active) return
		const host = (node.offsetParent as HTMLElement | null) ?? document.body
		host.appendChild(rail)
		node.classList.add('nx-overlay-scroll')
		node.addEventListener('scroll', onScroll, { passive: true })
		node.addEventListener('pointermove', onMove, { passive: true })
		thumb.addEventListener('pointerdown', onThumbDown)
		thumb.addEventListener('pointermove', onThumbMove)
		thumb.addEventListener('pointerup', onThumbUp)
		thumb.addEventListener('pointercancel', onThumbUp)
		rail.addEventListener('pointerdown', onRailDown)
		rail.addEventListener('pointerenter', onEnter)
		rail.addEventListener('pointerleave', onLeave)
		watch()
		mo.observe(node, { childList: true })
		active = true
		measure()
	}
	function disable() {
		if (!active) return
		rail.remove()
		node.classList.remove('nx-overlay-scroll')
		node.removeEventListener('scroll', onScroll)
		node.removeEventListener('pointermove', onMove)
		rail.removeEventListener('pointerdown', onRailDown)
		rail.removeEventListener('pointerenter', onEnter)
		rail.removeEventListener('pointerleave', onLeave)
		ro.disconnect(); mo.disconnect()
		clearTimeout(idle); cancelAnimationFrame(raf)
		active = false
	}
	const sync = () => (mq.matches ? enable() : disable())
	// offsetParent n'est connu qu'une fois le nœud dans la page mise en forme.
	requestAnimationFrame(sync)
	mq.addEventListener('change', sync)

	return {
		destroy() {
			mq.removeEventListener('change', sync)
			disable()
		},
	}
}
