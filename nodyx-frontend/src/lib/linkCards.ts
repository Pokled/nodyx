// « Nodyx relié » : un lien vers un sujet, une réponse ou un événement de CETTE instance
// s'affiche en carte (SPECS/NODYX_EDITEUR_V2_CDC.md, E5 ; maquette validée le 13/11,
// https://nodyx.org/cartes-maquette.html, décisions D40-D44).
//
// - D40 : le lien reste écrit dans le message, la carte vient dessous ; si le message
//   n'est QUE ce lien, on ne montre que la carte (isSoleLink).
// - D41 : trois cartes au plus par message, les autres liens restent des liens simples.
// - D43 : l'auteur peut retirer la carte ; le lien porte alors data-card="off" (gardé
//   par le nettoyeur du cœur, seule valeur acceptée) et n'a plus de carte, pour personne.
//
// Chaque lecteur demande SA carte au cœur (/links/resolve vérifie ses droits) : jamais
// une carte calculée pour tous. Le cache ci-dessous vit dans la page, quelques secondes.

import { writable, type Readable } from 'svelte/store'
import { apiFetch } from '$lib/api'

export const MAX_CARDS = 3

const SLUG = '[a-z0-9][a-z0-9-]{0,299}'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const THREAD_RE = new RegExp(`^/forum/${SLUG}/(?:${UUID}|${SLUG})/?(?:#post-${UUID})?$`, 'i')
const EVENT_RE  = new RegExp(`^/calendar/${UUID}/?$`, 'i')

/**
 * Ramène une adresse à son chemin interne (« /forum/a/b#post-… », « /calendar/… »), ou
 * null si ce n'est pas un contenu de CETTE instance qui a une carte. Même liste que le
 * cœur (services/linkCards.ts parseInternalLink) ; le cœur reste juge en dernier.
 */
export function toInternalPath(href: string, origin: string | null): string | null {
	if (!href || href.length > 2048) return null
	let u: URL
	try {
		if (href.startsWith('/') && !href.startsWith('//')) u = new URL(href, 'http://instance.invalid')
		else u = new URL(href)
	} catch { return null }
	if (u.origin !== 'http://instance.invalid' && (!origin || u.origin !== origin)) return null
	if (u.username || u.password) return null
	const hash = /^#post-[0-9a-f-]{36}$/i.test(u.hash) ? u.hash.toLowerCase() : ''
	const path = u.pathname.replace(/\/$/, '')
	if (EVENT_RE.test(path)) return path.toLowerCase()
	if (THREAD_RE.test(path + hash)) return path + hash
	return null
}

const decode = (s: string) => s
	.replace(/&nbsp;/g, '\u00a0').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

const attr = (tag: string, name: string): string | null => {
	const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
	return m ? decode(m[2] ?? m[3] ?? m[4] ?? '') : null
}

const BARE_URL = /https?:\/\/[^\s<>"']+/gi

/**
 * Les liens internes d'un message, dans l'ordre, sans doublon, trois au plus (D41).
 * Lit les <a href> ET les adresses écrites en clair (le chat les transforme en liens à
 * l'affichage). Un lien marqué data-card="off" n'a pas de carte, et son adresse non plus
 * plus loin dans le même message (l'auteur a dit non à CETTE carte).
 * Pas de DOM : marche aussi au rendu serveur. Un seul passage, pas de retour arrière.
 */
export function findInternalLinks(html: string, origin: string | null): string[] {
	if (!html) return []
	const found: string[] = []
	const refused = new Set<string>()
	let inAnchor = false
	const re = /<a\b[^>]*>|<\/a\s*>|<[^>]*>|[^<]+/gi
	let m: RegExpExecArray | null
	while ((m = re.exec(html))) {
		const tok = m[0]
		if (/^<a\b/i.test(tok)) {
			inAnchor = true
			const p = toInternalPath(attr(tok, 'href') ?? '', origin)
			if (!p) continue
			if (attr(tok, 'data-card') === 'off') refused.add(p)
			else found.push(p)
		} else if (/^<\/a/i.test(tok)) {
			inAnchor = false
		} else if (tok[0] !== '<' && !inAnchor) {
			for (const u of decode(tok).match(BARE_URL) ?? []) {
				const p = toInternalPath(u.replace(/[.,;:!?)\]]+$/, ''), origin)
				if (p) found.push(p)
			}
		}
	}
	const out: string[] = []
	for (const p of found) {
		if (refused.has(p) || out.includes(p)) continue
		out.push(p)
		if (out.length === MAX_CARDS) break
	}
	return out
}

/**
 * D40 : le message n'est-il QUE ce lien ? (rien d'autre à lire que l'adresse ou le texte
 * du lien, pas d'image, pas de média). Alors la carte suffit, le lien en double est caché.
 */
export function isSoleLink(html: string, origin: string | null): boolean {
	// Un message qui n'est qu'un lien est court : au-delà, inutile de chercher (et pas de
	// travail sur un texte de 500 Ko).
	if (!html || html.length > 4000 || /<(img|iframe|video|audio|table|nodyx-)/i.test(html)) return false
	const links = findInternalLinks(html, origin)
	if (links.length !== 1) return false
	const anchors = html.match(/<a\b[^>]*>[\s\S]*?<\/a\s*>/gi) ?? []
	const outside = anchors.reduce((s, a) => s.replace(a, ' '), html)
	const rest = decode(outside.replace(/<[^>]*>/g, ' ')).replace(/ /g, ' ').trim()
	if (anchors.length === 1) return rest === '' && toInternalPath(attr(anchors[0], 'href') ?? '', origin) === links[0]
	if (anchors.length === 0) {
		const urls = rest.match(BARE_URL) ?? []
		return urls.length === 1 && rest === urls[0]
	}
	return false
}

/**
 * D43 « Retirer la carte » / « Remettre la carte » : marque (ou démarque) data-card="off"
 * tous les liens du message qui mènent à `path`. Une adresse écrite en clair devient un
 * lien marqué. Même découpage en un passage que findInternalLinks, sans DOM ; le reste du
 * message est recopié tel quel. Le cœur renettoie de toute façon à l'enregistrement.
 */
export function setCardOff(html: string, path: string, off: boolean, origin: string): string {
	const esc = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
	let out = ''
	let inAnchor = false
	const re = /<a\b[^>]*>|<\/a\s*>|<[^>]*>|[^<]+/gi
	let m: RegExpExecArray | null
	while ((m = re.exec(html))) {
		let tok = m[0]
		if (/^<a\b/i.test(tok)) {
			inAnchor = true
			if (toInternalPath(attr(tok, 'href') ?? '', origin) === path) {
				tok = tok.replace(/\sdata-card\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
				if (off) tok = tok.replace(/\s*(\/?)>$/, ' data-card="off"$1>')
			}
		} else if (/^<\/a/i.test(tok)) {
			inAnchor = false
		} else if (off && tok[0] !== '<' && !inAnchor) {
			tok = tok.replace(BARE_URL, raw => {
				const tail = raw.match(/[.,;:!?)\]]+$/)?.[0] ?? ''
				const url = raw.slice(0, raw.length - tail.length)
				if (toInternalPath(decode(url), origin) !== path) return raw
				return `<a href="${esc(decode(url))}" data-card="off">${url}</a>${tail}`
			})
		}
		out += tok
	}
	return out
}

/**
 * Messages privés (texte brut, pas de HTML) : les liens internes du texte, dans l'ordre,
 * sans doublon, trois au plus. Lu comme du TEXTE : un « < » dans une phrase ne casse rien.
 */
export function findInternalLinksInText(text: string, origin: string | null): string[] {
	const out: string[] = []
	for (const u of (text ?? '').match(BARE_URL) ?? []) {
		const p = toInternalPath(u.replace(/[.,;:!?)\]]+$/, ''), origin)
		if (p && !out.includes(p)) out.push(p)
		if (out.length === MAX_CARDS) break
	}
	return out
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])

/**
 * Wiki (D48) : découpe un article en blocs de PREMIER niveau ; un paragraphe qui n'est
 * qu'un lien Nodyx (sans « Lien simple ») porte son chemin, pour qu'une carte prenne sa
 * place. Les paragraphes dans une liste, une citation ou des colonnes ne sont jamais
 * détachés de leur conteneur (la structure de la page reste intacte). Recoller les
 * morceaux redonne exactement le HTML de départ. Un seul passage, sans retour arrière.
 */
export function splitSoleLinkBlocks(html: string, origin: string | null): { html: string; path: string | null }[] {
	const out: { html: string; path: string | null }[] = []
	if (!html) return out
	let depth = 0, start = 0, pStart = -1
	const re = /<\/?([a-z][a-z0-9-]*)\b[^>]*>/gi
	let m: RegExpExecArray | null
	const push = (h: string, path: string | null) => {
		if (!h) return
		const last = out[out.length - 1]
		if (!path && last && !last.path) last.html += h
		else out.push({ html: h, path })
	}
	while ((m = re.exec(html))) {
		const tag = m[1].toLowerCase()
		const closing = m[0][1] === '/'
		if (VOID.has(tag) || m[0].endsWith('/>')) continue
		if (!closing) {
			if (depth === 0 && tag === 'p') pStart = m.index
			depth++
		} else {
			depth = Math.max(0, depth - 1)
			if (depth === 0 && tag === 'p' && pStart >= 0) {
				const end = m.index + m[0].length
				const para = html.slice(pStart, end)
				const path = isSoleLink(para, origin) ? findInternalLinks(para, origin)[0] ?? null : null
				if (path) { push(html.slice(start, pStart), null); push(para, path); start = end }
				pStart = -1
			}
		}
	}
	push(html.slice(start), null)
	return out
}

// ── Les cartes, telles que le cœur les renvoie (services/linkCards.ts) ──────────────

export interface Person { username: string; avatar: string | null }
export type Card =
	| { type: 'thread'; url: string; title: string; category: string | null; author: Person
		replies: number; created_at: string; last_activity_at: string; is_locked: boolean; tags: string[] }
	| { type: 'post'; url: string; thread: { title: string; url: string }; author: Person; excerpt: string; created_at: string }
	| { type: 'event'; url: string; title: string; starts_at: string; ends_at: string | null; is_all_day: boolean
		location: string | null; cover_url: string | null; is_cancelled: boolean; going_count: number
		rsvp_enabled: boolean; my_rsvp: string | null; is_full: boolean; going_preview: Person[] }
	| { type: 'unavailable' }

/** loading → card (null = pas de carte : le lien reste un lien) ; error = échec réseau. */
export type CardState = { status: 'loading' } | { status: 'ready'; card: Card | null } | { status: 'error' }

const TTL = 30_000
const entries = new Map<string, { at: number; store: ReturnType<typeof writable<CardState>> }>()

/** La carte d'un chemin interne : une seule demande par lien et par page, gardée 30 s. */
export function cardFor(path: string, token: string | null): Readable<CardState> {
	const key = `${token ? 'u' : 'a'}:${path}`
	const hit = entries.get(key)
	if (hit && Date.now() - hit.at < TTL) return hit.store
	const store = hit?.store ?? writable<CardState>({ status: 'loading' })
	entries.set(key, { at: Date.now(), store })
	apiFetch(fetch, `/links/resolve?url=${encodeURIComponent(path)}`, {
		headers: token ? { Authorization: `Bearer ${token}` } : {},
	})
		.then(async r => {
			if (!r.ok) throw new Error(String(r.status))
			const { card } = await r.json()
			store.set({ status: 'ready', card: card ?? null })
		})
		.catch(() => { store.set({ status: 'error' }); entries.delete(key) })
	return store
}

/** Après « Je participe » : toutes les cartes de cet événement dans la page suivent. */
export function patchEvent(path: string, token: string | null, patch: (c: Extract<Card, { type: 'event' }>) => Card): void {
	const hit = entries.get(`${token ? 'u' : 'a'}:${path}`)
	hit?.store.update(s => s.status === 'ready' && s.card?.type === 'event' ? { status: 'ready', card: patch(s.card) } : s)
}

/** Pour les tests. */
export function _resetCardCache(): void { entries.clear() }
