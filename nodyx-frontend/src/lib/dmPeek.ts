// D46 (« Nodyx relié », messages privés chiffrés) : « Toujours afficher les aperçus dans
// cette conversation ». Décoché par défaut, gardé SUR CET APPAREIL seulement (rien sur le
// serveur), par conversation, effacé à la déconnexion (editorDrafts.clearAllDrafts).
// Stockage indisponible (navigation privée) : on reste simplement sur « non ».
import { writable } from 'svelte/store'

export const PEEK_PREFIX = 'nodyx_peek:'

function read(convId: string): boolean {
	try { return localStorage.getItem(PEEK_PREFIX + convId) === '1' } catch { return false }
}

/** Conversation → aperçus automatiques ? Partagé par tous les messages de la page. */
export const peekAlways = writable<Record<string, boolean>>({})

export function loadPeekAlways(convId: string): void {
	const on = read(convId)
	peekAlways.update(m => (m[convId] === on ? m : { ...m, [convId]: on }))
}

export function setPeekAlways(convId: string, on: boolean): void {
	try {
		if (on) localStorage.setItem(PEEK_PREFIX + convId, '1')
		else localStorage.removeItem(PEEK_PREFIX + convId)
	} catch { /* pas de stockage : le choix vaut pour cette visite */ }
	peekAlways.update(m => ({ ...m, [convId]: on }))
}
