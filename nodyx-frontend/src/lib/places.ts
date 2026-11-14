// « # » : montrer un endroit de la communauté (lot C4, maquette
// https://nodyx.org/commandes-maquette.html section 2, D59). Côté serveur :
// nodyx-core/src/services/places.ts (mêmes règles de lecture que les pages).
//
// Dans le chat, on tape « #soi », on choisit « Soirée jeux » : à l'envoi, le texte
// « #Soirée jeux » devient une marque liée à l'endroit :
//   <a href="/calendar/<id>" data-place="event:<id>">#Soirée jeux</a>
// À l'affichage, le nom est relu POUR CHAQUE LECTEUR (placeFor) : un endroit renommé
// suit, un endroit interdit ou disparu devient « endroit privé ». Le nom d'un événement
// PRIVÉ n'est jamais écrit dans le message (un forum est public) : la marque porte un
// mot neutre, le vrai nom n'apparaît qu'à ceux qui peuvent le voir.
import { PUBLIC_API_URL } from '$app/env/public'

export type PlaceKind = 'channel' | 'event' | 'thread' | 'wiki' | 'poll' | 'board'
export interface Place {
	ref: string
	kind: PlaceKind
	title: string
	url: string
	hint: { starts_at?: string; is_all_day?: boolean; going?: number; category?: string | null; replies?: number; votes?: number; closed?: boolean; cards?: number; description?: string | null }
	private: boolean
}
export type Resolved = { ref: string; ok: true; kind: PlaceKind; title: string; url: string } | { ref: string; ok: false }

/** « # » en tête ou après une espace, puis jusqu'à 3 mots (« #soirée jeux »). */
export const PLACE_TRIGGER = /(?:^|[\s(])#((?:[\p{L}\p{N}_.'’-]+ ?){0,3})$/u

/** Une marque valide : sorte connue + uuid (même règle que le cœur, utils/sanitize). */
export const PLACE_VALUE = /^(channel|event|thread|wiki|poll|board):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const KIND_LABEL_KEYS: Record<PlaceKind, string> = {
	channel: 'place.group_channel', event: 'place.group_event', thread: 'place.group_thread',
	wiki: 'place.group_wiki', poll: 'place.group_poll', board: 'place.group_board',
}

const api = (path: string) => `${PUBLIC_API_URL}/api/v1${path}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function suggestPlaces(q: string, token: string | null): Promise<Place[]> {
	if (!token) return []
	try {
		const r = await fetch(api(`/links/places?q=${encodeURIComponent(q.trim())}`), { headers: { Authorization: `Bearer ${token}` } })
		if (!r.ok) return []
		return (await r.json()).places ?? []
	} catch { return [] }
}

/** La marque enregistrée. `label` : le nom, ou un mot neutre pour un événement privé. */
export function placeHtml(ref: string, url: string, label: string): string {
	return `<a href="${esc(url)}" data-place="${esc(ref)}">#${esc(label)}</a>`
}

/**
 * À l'envoi : chaque endroit CHOISI dans la liste devient une marque. Un « #mot » tapé
 * à la main reste du texte. `neutral(kind)` : le mot écrit à la place du nom d'un
 * endroit privé (« événement privé »).
 */
export function applyPickedPlaces(text: string, picked: { ref: string; url: string; label: string; private: boolean; kind: PlaceKind }[], neutral: (kind: PlaceKind) => string): string {
	let out = text
	for (const p of picked) {
		const needle = '#' + p.label
		const i = out.indexOf(needle)
		if (i < 0) continue
		const after = out[i + needle.length]
		if (after && /[\p{L}\p{N}_]/u.test(after)) continue   // « #Soirée » dans « #Soirées » : pas lui
		out = out.slice(0, i) + placeHtml(p.ref, p.url, p.private ? neutral(p.kind) : p.label) + out.slice(i + needle.length)
	}
	return out
}

/**
 * Un visiteur ANONYME peut-il lire cet endroit ? Un sujet du forum, un événement
 * public, le sondage d'un sujet. Un salon, un tableau, une page du wiki, le sondage
 * d'un salon ou un événement privé : réservés aux membres.
 */
export function isPublicPlace(p: Pick<Place, 'kind' | 'private' | 'url'>): boolean {
	if (p.private) return false
	return p.kind === 'thread' || p.kind === 'event' || (p.kind === 'poll' && p.url.startsWith('/forum/'))
}

/**
 * Ce qu'on ÉCRIT dans un texte qui peut être lu de tous (forum, wiki, fil, événement) :
 * le vrai nom seulement si l'endroit est lisible de tous, sinon un mot neutre
 * (« #salon »), et jamais une adresse qui porte un nom (le wiki range ses pages par
 * titre). Chaque lecteur autorisé voit ensuite le vrai nom grâce aux puces (placeChips) :
 * une page publique, un moteur de recherche ou un aperçu de lien n'en voient rien.
 */
export function publicMark(p: Pick<Place, 'kind' | 'private' | 'url' | 'title'>, neutral: (kind: PlaceKind) => string): { label: string; url: string } {
	if (isPublicPlace(p)) return { label: p.title, url: p.url }
	return { label: neutral(p.kind), url: p.kind === 'wiki' ? '/wiki' : p.url }
}

/**
 * Un endroit COLLÉ (copié depuis le chat ou depuis une page lue par un membre) :
 * son texte peut être le vrai nom affiché par la puce, même pour un endroit réservé
 * aux membres. On ne sait pas ici s'il est public : seul un sujet du forum l'est
 * toujours, il garde son nom ; tous les autres prennent le mot neutre de leur sorte.
 */
export function pastedMark(kind: PlaceKind, text: string, url: string, neutral: (kind: PlaceKind | 'event_any') => string): { label: string; url: string } {
	if (kind === 'thread') return { label: text.replace(/^#/, ''), url }
	return { label: neutral(kind === 'event' ? 'event_any' : kind), url: kind === 'wiki' ? '/wiki' : url }
}

// ── Les noms des puces : une demande regroupée, gardée une minute ─────────────────
const TTL = 60_000
const cache = new Map<string, { at: number; p: Promise<Resolved> }>()
let pending: { refs: Set<string>; resolvers: Map<string, (r: Resolved) => void> } | null = null

function flush(token: string | null) {
	const batch = pending!; pending = null
	const refs = [...batch.refs]
	for (let i = 0; i < refs.length; i += 50) {
		const part = refs.slice(i, i + 50)
		fetch(api('/links/places/resolve'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
			body: JSON.stringify({ refs: part }),
		})
			.then(r => (r.ok ? r.json() : { places: [] }))
			.then((j: { places?: Resolved[] }) => {
				const got = new Map((j.places ?? []).map(p => [p.ref, p]))
				for (const ref of part) batch.resolvers.get(ref)?.(got.get(ref) ?? { ref, ok: false })
			})
			.catch(() => { for (const ref of part) batch.resolvers.get(ref)?.({ ref, ok: false }) })
	}
}

/** Le nom à jour d'un endroit marqué, pour ce lecteur (demandes regroupées). */
export function placeFor(ref: string, token: string | null): Promise<Resolved> {
	const hit = cache.get(ref)
	if (hit && Date.now() - hit.at < TTL) return hit.p
	if (!pending) { pending = { refs: new Set(), resolvers: new Map() }; queueMicrotask(() => flush(token)) }
	const batch = pending
	batch.refs.add(ref)
	const p = new Promise<Resolved>(res => batch.resolvers.set(ref, res))
	cache.set(ref, { at: Date.now(), p })
	return p
}

/** Les puces d'endroit déjà rendues ne sont plus à jour (un endroit vient d'être renommé). */
export function forgetPlaces(): void { cache.clear() }
