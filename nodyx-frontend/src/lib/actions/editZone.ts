/**
 * Zone éditable du mode « au stylo » : `<aside use:editZone={{ zone, label }}>`.
 *
 * En mode édition, un liseré discret au survol et un bouton stylo dans le coin
 * haut-droit de la zone ; le stylo ouvre le panneau de la zone. Un clic
 * ailleurs dans la zone garde son comportement normal (on édite en continuant
 * d'utiliser le site). Hors mode édition : rien, aucun élément ajouté.
 *
 * Le stylo vit dans <body> en `position: fixed`, recalé sur le rectangle de la
 * zone (défilement en phase de capture, redimensionnement) : jamais DANS la
 * zone, où il défilerait avec son contenu ou serait piégé par un ancêtre
 * transformé (cf. portal.ts). Accessible au clavier : c'est un vrai bouton,
 * visible dès qu'il a le focus.
 */
import { get } from 'svelte/store'
import { editMode, editPanel, type EditZone } from '../editMode'

export interface EditZoneOptions { zone: EditZone | null; label: string }

const PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'

export function editZone(node: HTMLElement, opts: EditZoneOptions) {
	let options = opts
	let btn: HTMLButtonElement | null = null
	let hideTimer: ReturnType<typeof setTimeout> | undefined
	let ro: ResizeObserver | null = null

	function place() {
		if (!btn) return
		const r = node.getBoundingClientRect()
		// En « badge », à cheval sur le coin haut-droit de la plaque : jamais
		// par-dessus les boutons de la zone (il masquait la croix de la sidebar).
		btn.style.top = `${Math.round(Math.max(2, r.top - 12))}px`
		btn.style.left = `${Math.round(Math.min(r.right - 20, window.innerWidth - 36))}px`   // jamais hors de l'écran
		btn.style.display = r.width > 0 && r.height > 0 ? '' : 'none'
	}
	const show = () => { clearTimeout(hideTimer); btn?.classList.add('shown'); node.classList.add('nx-edit-hover') }
	const hide = () => {
		clearTimeout(hideTimer)
		hideTimer = setTimeout(() => {
			const open = get(editPanel)
			if (btn && open?.anchor === btn) return          // panneau ouvert : le stylo reste
			if (btn && document.activeElement === btn) return
			btn?.classList.remove('shown'); node.classList.remove('nx-edit-hover')
		}, 180)
	}
	const onClick = (e: MouseEvent) => {
		e.stopPropagation()
		if (!btn || !options.zone) return
		const open = get(editPanel)
		editPanel.set(open?.anchor === btn ? null : { zone: options.zone, anchor: btn })
	}

	function enable() {
		if (btn || !options.zone) return
		btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'nx-edit-pen'
		btn.setAttribute('aria-label', options.label)
		btn.title = options.label
		btn.innerHTML = PEN
		btn.addEventListener('click', onClick)
		btn.addEventListener('pointerenter', show)
		btn.addEventListener('pointerleave', hide)
		btn.addEventListener('focus', show)
		btn.addEventListener('blur', hide)
		document.body.appendChild(btn)
		node.classList.add('nx-edit-zone')
		node.addEventListener('pointerenter', show)
		node.addEventListener('pointerleave', hide)
		window.addEventListener('scroll', place, true)
		window.addEventListener('resize', place)
		ro = new ResizeObserver(place); ro.observe(node)
		place()
	}
	function disable() {
		if (!btn) return
		clearTimeout(hideTimer)
		btn.remove(); btn = null
		node.classList.remove('nx-edit-zone', 'nx-edit-hover')
		node.removeEventListener('pointerenter', show)
		node.removeEventListener('pointerleave', hide)
		window.removeEventListener('scroll', place, true)
		window.removeEventListener('resize', place)
		ro?.disconnect(); ro = null
	}

	const unsubMode = editMode.subscribe(on => (on && options.zone ? enable() : disable()))
	// Panneau fermé ailleurs (Échap, autre zone) : le stylo se cache s'il n'est plus survolé.
	const unsubPanel = editPanel.subscribe(p => {
		if (!btn) return
		btn.classList.toggle('active', p?.anchor === btn)
		if (p?.anchor !== btn) hide()
	})

	return {
		update(next: EditZoneOptions) {
			options = next
			if (btn) btn.setAttribute('aria-label', next.label)
			if (get(editMode) && next.zone) enable(); else disable()
		},
		destroy() { unsubMode(); unsubPanel(); disable() },
	}
}
