// Mentions, vague 1 (SPECS/NODYX_MENTIONS_CDC.md ; maquette https://nodyx.org/mentions-maquette.html).
// D49 : une mention est liée à la PERSONNE (son identifiant), son nom est relu à
// l'affichage. D50 : les propositions viennent du cœur (/mentions/suggest), dans l'ordre
// utile, avec leur raison.

import { apiFetch } from '$lib/api'

export interface MentionSuggestion {
	id: string; username: string; display_name: string | null; avatar: string | null
	reason: 'here' | 'frequent' | 'member' | 'group'; last_at?: string; count?: number
	/** Groupe (reason = 'group') : « ici », « equipe », « moderation », « tous », « grade:<id> » */
	key?: string
	/** Couleur d'un grade */
	color?: string | null
}

/** Clés de traduction du nom affiché des groupes intégrés (relu dans la langue du lecteur). */
export const GROUP_LABEL_KEYS: Record<string, string> = {
	ici: 'mention.g_ici', equipe: 'mention.g_equipe', moderation: 'mention.g_moderation', tous: 'mention.g_tous',
}

/** La référence d'une proposition : une personne « u:<id> » ou un groupe « g:<clé> ». */
export const refOf = (s: MentionSuggestion) => s.reason === 'group' && s.key ? 'g:' + s.key : 'u:' + s.id
export interface MentionPerson {
	id: string; username?: string; display_name?: string | null; avatar?: string | null
	grade?: { name: string; color: string | null } | null; gone?: true
}

/** Minuscules sans accents (même règle que le cœur). */
export function fold(s: string): string {
	return (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

export const labelOf = (p: { username?: string; display_name?: string | null }) => p.display_name || p.username || ''

/** Le nom à insérer : pour un groupe intégré, traduit dans la langue de celui qui écrit. */
export function insertLabel(s: MentionSuggestion, tFn: (k: string) => string): string {
	if (s.reason === 'group' && s.key && GROUP_LABEL_KEYS[s.key]) return tFn(GROUP_LABEL_KEYS[s.key])
	return labelOf(s)
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** La marque enregistrée : liée à la personne ou au groupe, le texte n'est qu'un repli lisible. */
export function mentionHtml(ref: string, label: string): string {
	const r = ref.startsWith('u:') || ref.startsWith('g:') ? ref : 'u:' + ref
	return `<span data-mention="${esc(r)}">@${esc(label)}</span>`
}

/** Les références mentionnées dans un contenu HTML (marques), sans doublon. */
export function refsIn(html: string): string[] {
	const out: string[] = []
	for (const m of (html ?? '').matchAll(/data-mention="([ug]:[^"]{1,80})"/g)) if (!out.includes(m[1])) out.push(m[1])
	return out.slice(0, 25)
}

export interface MentionPreview {
	people: { id: string; state: 'ok' | 'not_member' | 'wont_be_notified' | 'quiet'; quiet_until?: string }[]
	groups: { key: string; count: number; label: string | null; forbidden: boolean; needs_confirm: boolean }[]
	threshold: number
}

/** D51 : ce que les mentions vont faire, AVANT l'envoi (le cœur refait ses contrôles à l'envoi). */
export async function previewMentions(refs: string[], token: string | null): Promise<MentionPreview | null> {
	const people = refs.filter(r => r.startsWith('u:')).map(r => r.slice(2))
	const groups = refs.filter(r => r.startsWith('g:')).map(r => r.slice(2))
	if (!people.length && !groups.length) return null
	try {
		const r = await apiFetch(fetch, '/mentions/preview', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify({ people, groups }) })
		return r.ok ? await r.json() : null
	} catch { return null }
}

/** Le mot « @… » juste avant le curseur, s'il y en a un (début de ligne ou après un espace). */
export const MENTION_TRIGGER = /(?:^|[\s(])@([\p{L}\p{N}_.\-]{0,30})$/u

/**
 * Zone de saisie simple du chat : les mentions CHOISIES dans la liste deviennent des
 * marques liées à la personne à l'envoi. Une mention effacée ou retapée à la main reste
 * du texte (le cœur la comprend encore comme « @pseudo »). Un passage par mention.
 */
export function applyPickedMentions(text: string, picked: { ref: string; label: string }[]): string {
	let out = text
	for (const p of picked) {
		const needle = '@' + p.label
		const i = out.indexOf(needle)
		if (i < 0) continue
		const after = out[i + needle.length]
		if (after && /[\p{L}\p{N}_]/u.test(after)) continue   // « @Léa » dans « @Léanne » : pas elle
		out = out.slice(0, i) + mentionHtml(p.ref, p.label) + out.slice(i + needle.length)
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

// ── Les groupes des puces : nom et couleur à jour, nombre, quelques noms ─────────────
export interface MentionGroupCard { key: string; label: string | null; color: string | null; count: number; sample: { username: string; display_name: string | null }[] }
const groupCache = new Map<string, { at: number; p: Promise<MentionGroupCard | null> }>()
let groupPending: { keys: Set<string>; res: Map<string, (g: MentionGroupCard | null) => void> } | null = null

export function groupFor(key: string, token: string | null): Promise<MentionGroupCard | null> {
	const hit = groupCache.get(key)
	if (hit && Date.now() - hit.at < TTL) return hit.p
	if (!groupPending) {
		groupPending = { keys: new Set(), res: new Map() }
		setTimeout(() => {
			const b = groupPending!; groupPending = null
			const keys = [...b.keys].slice(0, 10)
			apiFetch(fetch, `/mentions/groups?keys=${encodeURIComponent(keys.join(','))}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
				.then(r => r.ok ? r.json() : { groups: [] })
				.then(({ groups }: { groups: MentionGroupCard[] }) => keys.forEach(k => b.res.get(k)?.(groups.find(g => g.key === k) ?? null)))
				.catch(() => keys.forEach(k => { groupCache.delete(k); b.res.get(k)?.(null) }))
		}, 20)
	}
	const batch = groupPending
	const p = new Promise<MentionGroupCard | null>(res => { batch.keys.add(key); batch.res.set(key, res) })
	groupCache.set(key, { at: Date.now(), p })
	return p
}

/** Pour les tests. */
export function _resetMentionCache(): void { cache.clear(); pending = null; groupCache.clear(); groupPending = null }
