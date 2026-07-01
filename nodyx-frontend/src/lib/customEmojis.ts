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

/**
 * Remplace les :shortcode: connus par leur image. Ne touche qu'aux shortcodes
 * EXISTANTS (map.get), donc "15:30:45" ou une URL ne sont jamais altérés.
 * S'applique au HTML déjà rendu (après linkify).
 */
export function renderCustomEmojis(html: string, list?: CustomEmoji[]): string {
	if (!html) return html
	list = list ?? get(customEmojisStore)
	if (list.length === 0) return html
	const map = new Map(list.map(e => [e.shortcode, e]))
	return html.replace(/:([a-z0-9_]{1,50}):/gi, (m, code) => {
		const e = map.get(String(code).toLowerCase())
		if (!e) return m
		return `<img class="nx-emoji" src="${e.url}" alt=":${e.shortcode}:" title=":${e.shortcode}:" draggable="false">`
	})
}
