// La puce vivante (SPECS/NODYX_MENTIONS_CDC.md, D49) sur un contenu rendu en {@html} :
// chaque <span data-mention="u:<id>"> reçoit le nom et l'avatar À JOUR, une carte au
// survol et au focus clavier, et le message qui te mentionne est surligné (l'élément
// ancêtre [data-mention-scope]). Une personne partie devient « ancien membre ».
//
// Le nom est posé en TEXTE (textContent), jamais en HTML. Aucune donnée n'est lue
// hors des marques validées par le nettoyeur du cœur.
import { get } from 'svelte/store'
import { mount, unmount } from 'svelte'
import { t } from '$lib/i18n'
import { personFor, labelOf, GROUP_LABEL_KEYS, type MentionPerson } from '$lib/mentions'
import MentionCard from '$lib/components/MentionCard.svelte'

interface Opts { html?: string; token: string | null; me?: string | null }

const COLORS = ['#7c3aed', '#0f766e', '#b45309', '#be185d', '#334155', '#1d4ed8', '#15803d']
const colorOf = (n: string) => COLORS[[...n].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length]

// Une seule carte ouverte à la fois, pour toute la page
let card: { app: Record<string, any>; target: HTMLElement; anchor: HTMLElement } | null = null
let hideTimer: ReturnType<typeof setTimeout> | null = null

function hideCard() {
	if (hideTimer) { clearTimeout(hideTimer); hideTimer = null }
	if (!card) return
	try { unmount(card.app) } catch { /* déjà parti */ }
	card.target.remove(); card = null
}
const scheduleHide = () => { if (hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(hideCard, 160) }
const keepCard = () => { if (hideTimer) { clearTimeout(hideTimer); hideTimer = null } }

function showCard(anchor: HTMLElement, person: MentionPerson, opts: Opts) {
	keepCard()
	if (card?.anchor === anchor) return
	hideCard()
	const r = anchor.getBoundingClientRect()
	const x = Math.max(8, Math.min(r.left, window.innerWidth - 268))
	const below = r.bottom + 190 < window.innerHeight
	const y = below ? r.bottom + 6 : Math.max(8, r.top - 6 - 150)
	const target = document.createElement('div')
	document.body.appendChild(target)
	const app = mount(MentionCard, { target, props: { person, x, y, token: opts.token, me: opts.me ?? null, onenter: keepCard, onleave: scheduleHide } })
	card = { app, target, anchor }
}

function decorate(el: HTMLElement, p: MentionPerson, opts: Opts) {
	const tFn = get(t)
	if (p.gone || !p.username) {
		el.textContent = '@' + tFn('mention.former_member')
		el.classList.add('nx-mention-gone')
		return
	}
	const label = labelOf(p)
	el.textContent = ''
	const av = document.createElement('span')
	av.className = 'nx-mention-av'
	av.setAttribute('aria-hidden', 'true')
	if (p.avatar) { const img = document.createElement('img'); img.src = p.avatar; img.alt = ''; img.loading = 'lazy'; av.appendChild(img) }
	else { av.textContent = label.slice(0, 1).toUpperCase(); av.style.background = colorOf(p.username) }
	el.append(av, document.createTextNode('@' + label))
	el.tabIndex = 0
	el.setAttribute('role', 'button')
	el.setAttribute('aria-label', tFn('mention.chip_aria', { name: label }))
	el.addEventListener('mouseenter', () => showCard(el, p, opts))
	el.addEventListener('mouseleave', scheduleHide)
	el.addEventListener('focus', () => showCard(el, p, opts))
	el.addEventListener('blur', scheduleHide)
	el.addEventListener('keydown', e => { if (e.key === 'Escape') hideCard() })
	el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); showCard(el, p, opts) })
}

export function mentionChips(node: HTMLElement, initial: Opts) {
	let opts = initial
	let alive = true
	function run() {
		// Groupes (lot M2) : une puce sans carte, nom traduit dans la langue du lecteur
		node.querySelectorAll<HTMLElement>('span[data-mention^="g:"]:not([data-chip])').forEach(el => {
			el.dataset.chip = '1'
			const key = (el.dataset.mention ?? '').slice(2)
			const tFn = get(t)
			const label = GROUP_LABEL_KEYS[key] ? tFn(GROUP_LABEL_KEYS[key]) : (el.textContent ?? '').replace(/^@/, '')
			el.classList.add('nx-mention', 'nx-mention-group')
			el.textContent = '@' + label
			el.setAttribute('aria-label', tFn('mention.group_chip_aria', { name: label }))
		})
		const spans = node.querySelectorAll<HTMLElement>('span[data-mention^="u:"]:not([data-chip])')
		spans.forEach(el => {
			el.dataset.chip = '1'
			el.classList.add('nx-mention')
			const id = (el.dataset.mention ?? '').slice(2)
			if (opts.me && id === opts.me) {
				el.classList.add('nx-mention-me')
				el.closest('[data-mention-scope]')?.classList.add('nx-mentioned')
			}
			personFor(id, opts.token).then(p => { if (alive && el.isConnected) decorate(el, p, opts) })
		})
	}
	queueMicrotask(run)
	return {
		update(next: Opts) { opts = next; queueMicrotask(run) },
		destroy() { alive = false; if (card && node.contains(card.anchor)) hideCard() },
	}
}
