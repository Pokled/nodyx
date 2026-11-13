// Mentions, vague 1 (SPECS/NODYX_MENTIONS_CDC.md ; maquette https://nodyx.org/mentions-maquette.html).
// D49 : une mention est liée à la PERSONNE (son identifiant), son nom est relu à
// l'affichage. D50 : les propositions viennent du cœur (/mentions/suggest), dans l'ordre
// utile, avec leur raison.

import { apiFetch } from '$lib/api'

export interface MentionSuggestion {
	id: string; username: string; display_name: string | null; avatar: string | null
	reason: 'here' | 'frequent' | 'member'; last_at?: string; count?: number
}
export interface MentionPerson {
	id: string; username?: string; display_name?: string | null; avatar?: string | null
	grade?: { name: string; color: string | null } | null; gone?: true
}

/** Minuscules sans accents (même règle que le cœur). */
export function fold(s: string): string {
	return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export const labelOf = (p: { username?: string; display_name?: string | null }) => p.display_name || p.username || ''

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** La marque enregistrée : liée à l'identifiant, le texte n'est qu'un repli lisible. */
export function mentionHtml(id: string, label: string): string {
	return `<span data-mention="u:${esc(id)}">@${esc(label)}</span>`
}

/** Le mot « @… » juste avant le curseur, s'il y en a un (début de ligne ou après un espace). */
export const MENTION_TRIGGER = /(?:^|[\s(])@([\p{L}\p{N}_.\-]{0,30})$/u

/**
 * Zone de saisie simple du chat : les mentions CHOISIES dans la liste deviennent des
 * marques liées à la personne à l'envoi. Une mention effacée ou retapée à la main reste
 * du texte (le cœur la comprend encore comme « @pseudo »). Un passage par mention.
 */
export function applyPickedMentions(text: string, picked: { id: string; label: string }[]): string {
	let out = text
	for (const p of picked) {
		const needle = '@' + p.label
		const i = out.indexOf(needle)
		if (i < 0) continue
		const after = out[i + needle.length]
		if (after && /[\p{L}\p{N}_]/u.test(after)) continue   // « @Léa » dans « @Léanne » : pas elle
		out = out.slice(0, i) + mentionHtml(p.id, p.label) + out.slice(i + needle.length)
	}
	return out
}

// ── Les personnes des puces : une demande regroupée, gardée une minute ───────────────
const TTL = 60_000
const cache = new Map<string, { at: number; p: Promise<MentionPerson> }>()
let pending: { ids: Set<string>; resolvers: Map<string, (p: MentionPerson) => void>; timer: ReturnType<typeof setTimeout> } | null = null

function flush(token: string | null) {
	const batch = pending!; pending = null
	const ids = [...batch.ids]
	for (let i = 0; i < ids.length; i += 50) {
		const part = ids.slice(i, i + 50)
		apiFetch(fetch, `/mentions/people?ids=${part.join(',')}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
			.then(r => r.ok ? r.json() : { people: [] })
			.then(({ people }: { people: MentionPerson[] }) => {
				const byId = new Map(people.map(p => [p.id, p]))
				part.forEach(id => batch.resolvers.get(id)?.(byId.get(id) ?? { id, gone: true }))
			})
			.catch(() => part.forEach(id => { cache.delete(id); batch.resolvers.get(id)?.({ id }) }))
	}
}

/** La personne derrière une puce (nom et avatar à jour). Les demandes d'une même page sont regroupées. */
export function personFor(id: string, token: string | null): Promise<MentionPerson> {
	const hit = cache.get(id)
	if (hit && Date.now() - hit.at < TTL) return hit.p
	if (!pending) pending = { ids: new Set(), resolvers: new Map(), timer: setTimeout(() => flush(token), 20) }
	const batch = pending
	const p = new Promise<MentionPerson>(res => { batch.ids.add(id); batch.resolvers.set(id, res) })
	cache.set(id, { at: Date.now(), p })
	return p
}

/** Propositions pendant la frappe, avec le contexte (salon ou sujet) pour « ici ». */
export async function suggestMentions(q: string, token: string | null, ctx: { channelId?: string; threadId?: string } = {}): Promise<MentionSuggestion[]> {
	const params = new URLSearchParams({ q })
	if (ctx.channelId) params.set('channel_id', ctx.channelId)
	if (ctx.threadId) params.set('thread_id', ctx.threadId)
	try {
		const r = await apiFetch(fetch, `/mentions/suggest?${params}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
		return r.ok ? (await r.json()).people ?? [] : []
	} catch { return [] }
}

/** Pour les tests. */
export function _resetMentionCache(): void { cache.clear(); pending = null }
