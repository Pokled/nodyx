// La puce d'endroit (« # », lot C4) sur un contenu rendu en {@html} : chaque
// <a data-place="<sorte>:<id>"> reçoit le nom À JOUR et l'icône de sa sorte, pour CE
// lecteur. Interdit ou disparu : « endroit privé », sans lien qui révèle quoi que ce
// soit de plus. Le nom est posé en TEXTE (textContent), jamais en HTML.
import { get } from 'svelte/store'
import { t } from '$lib/i18n'
import { placeFor, type PlaceKind } from '$lib/places'

interface Opts { html?: string; token: string | null }

const ICON: Record<PlaceKind, string> = {
	channel: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
	event: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
	thread: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
	wiki: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
	poll: 'M18 20V10M12 20V4M6 20v-6',
	board: 'M3 3h18v18H3zM9 3v18M15 3v18',
}
const LOCK = 'M5 11h14v10H5zM7 11V7a5 5 0 0 1 10 0v4'

export function placeIconSvg(kind: PlaceKind | 'lock'): SVGSVGElement {
	const ns = 'http://www.w3.org/2000/svg'
	const svg = document.createElementNS(ns, 'svg')
	svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'nx-place-i')
	const path = document.createElementNS(ns, 'path')
	path.setAttribute('d', kind === 'lock' ? LOCK : ICON[kind])
	svg.appendChild(path)
	return svg
}

export function placeChips(node: HTMLElement, initial: Opts) {
	let opts = initial
	let alive = true
	function run() {
		node.querySelectorAll<HTMLAnchorElement>('a[data-place]:not([data-chip])').forEach(el => {
			el.dataset.chip = '1'
			el.classList.add('nx-place')
			const ref = el.dataset.place ?? ''
			placeFor(ref, opts.token).then(r => {
				if (!alive || !el.isConnected) return
				const tFn = get(t)
				el.textContent = ''
				if (!r.ok) {
					// Interdit ou disparu : même apparence, aucun nom, aucune adresse
					el.classList.add('nx-place-private')
					el.removeAttribute('href')
					el.setAttribute('role', 'note')
					el.title = tFn('place.private_title')
					el.append(placeIconSvg('lock'), document.createTextNode(tFn('place.private')))
					return
				}
				el.setAttribute('href', r.url)
				el.setAttribute('aria-label', tFn('place.chip_aria', { kind: tFn(`place.kind_${r.kind}`), name: r.title }))
				el.append(placeIconSvg(r.kind), document.createTextNode(r.title))
			})
		})
	}
	queueMicrotask(run)
	return {
		update(next: Opts) { opts = next; queueMicrotask(run) },
		destroy() { alive = false },
	}
}
