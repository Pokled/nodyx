/**
 * Emojis custom de l'instance (bibliothèque, asset_type='emoji').
 * Utilisables partout via :shortcode: (façon Discord/Twitch), le shortcode
 * étant dérivé du nom de l'asset. Chargés une fois, mis en cache.
 */
import { writable, get } from 'svelte/store'
import { apiFetch } from '$lib/api'

export type CustomEmoji = { name: string; shortcode: string; url: string }

export const customEmojisStore = writable<CustomEmoji[]>([])
let _loaded = false

export async function loadCustomEmojis(fetchFn: typeof fetch = fetch): Promise<void> {
	if (_loaded) return
	_loaded = true
	try {
		const res = await apiFetch(fetchFn, '/instance/emojis')
		if (res.ok) customEmojisStore.set((await res.json()).emojis ?? [])
	} catch {
		/* réseau : on garde une liste vide, l'app fonctionne quand même */
	}
}

const SEN = String.fromCharCode(0)   // sentinel improbable dans du HTML

/**
 * Remplace les :shortcode: connus par leur image. Ne touche qu'aux shortcodes
 * EXISTANTS (map.get), donc "15:30:45" ou une URL ne sont jamais altérés.
 * Le contenu des <code>/<pre> est protégé : dans du code, :rat: reste littéral.
 * S'applique au HTML déjà rendu (après linkify).
 */
export function renderCustomEmojis(html: string, list?: CustomEmoji[]): string {
	if (!html) return html
	list = list ?? get(customEmojisStore)
	if (list.length === 0) return html
	const map = new Map(list.map(e => [e.shortcode, e]))

	// Protège <code>…</code> et <pre>…</pre> (on n'y transforme PAS les shortcodes)
	const stash: string[] = []
	let out = html.replace(/<(code|pre)\b[^>]*>[\s\S]*?<\/\1>/gi, (m) => {
		stash.push(m)
		return SEN + (stash.length - 1) + SEN
	})

	out = out.replace(/:([a-z0-9_]{1,50}):/gi, (m, code) => {
		const e = map.get(String(code).toLowerCase())
		if (!e) return m
		return `<img class="nx-emoji" src="${e.url}" alt=":${e.shortcode}:" title=":${e.shortcode}:" draggable="false">`
	})

	return out.replace(new RegExp(SEN + '(\\d+)' + SEN, 'g'), (_, i) => stash[Number(i)])
}
