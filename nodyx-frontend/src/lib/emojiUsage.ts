/**
 * Suivi d'usage des emojis PAR UTILISATEUR (localStorage).
 * Sert à afficher "Fréquents" et à peupler la barre de réaction rapide avec les
 * emojis que CE membre utilise le plus. Personnel, auto, zéro backend, scale à
 * 100+ emojis custom sans curation ni vote.
 * Clé = un emoji unicode ('🔥') OU un shortcode custom (':rat:').
 */
import { writable } from 'svelte/store'
import { browser } from '$app/environment'

const KEY = 'nodyx:emojiUsage'

function load(): Record<string, number> {
	if (!browser) return {}
	try { return JSON.parse(localStorage.getItem(KEY) || '{}') } catch { return {} }
}

export const emojiUsageStore = writable<Record<string, number>>(load())

export function bumpEmoji(emoji: string): void {
	if (!browser || !emoji) return
	emojiUsageStore.update(u => {
		const next = { ...u, [emoji]: (u[emoji] || 0) + 1 }
		try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* quota */ }
		return next
	})
}

/** Emojis les plus utilisés (clé), du plus au moins fréquent, limité à n. */
export function topEmojis(usage: Record<string, number>, n: number): string[] {
	return Object.entries(usage)
		.sort((a, b) => b[1] - a[1])
		.slice(0, n)
		.map(([e]) => e)
}
