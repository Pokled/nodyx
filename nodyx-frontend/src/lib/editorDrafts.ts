// Brouillons de l'éditeur (SPECS/NODYX_EDITEUR_V2_CDC.md, E9) : on ne perd jamais un
// texte en fermant l'onglet. Gardés DANS LE NAVIGATEUR seulement (localStorage), jamais
// envoyés au serveur avant l'envoi. Un brouillon est PROPOSÉ au retour (« Reprendre |
// Effacer »), jamais imposé. Effacé à l'envoi du formulaire, à la déconnexion (un autre
// membre peut utiliser ce navigateur ensuite) et au bout de 7 jours.
//
// Le stockage peut être indisponible (navigation privée, réglages) : chaque accès est
// protégé, l'éditeur marche alors simplement sans brouillon.

const PREFIX  = 'nodyx_draft:'
const MAX_AGE = 7 * 24 * 3600 * 1000

export interface Draft { html: string; at: number }

export function draftKey(pathname: string, name: string): string {
	return `${PREFIX}${pathname}:${name}`
}

/** Un brouillon vaut la peine d'être gardé : du texte, ou un média, un tableau. */
export function hasContent(html: string): boolean {
	if (!html) return false
	if (/<(img|iframe|table|nodyx-)/i.test(html)) return true
	return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim().length > 0
}

export function readDraft(key: string, now = Date.now()): Draft | null {
	try {
		const raw = localStorage.getItem(key)
		if (!raw) return null
		const d = JSON.parse(raw) as Draft
		if (typeof d?.html !== 'string' || typeof d?.at !== 'number') { localStorage.removeItem(key); return null }
		if (now - d.at > MAX_AGE) { localStorage.removeItem(key); return null }
		return d
	} catch { return null }
}

export function writeDraft(key: string, html: string, now = Date.now()): void {
	try {
		if (!hasContent(html)) localStorage.removeItem(key)
		else localStorage.setItem(key, JSON.stringify({ html, at: now }))
	} catch { /* stockage plein ou interdit : pas de brouillon, pas d'erreur */ }
}

export function removeDraft(key: string): void {
	try { localStorage.removeItem(key) } catch { /* rien */ }
}

/** À la déconnexion : aucun brouillon ne reste pour la personne suivante. */
export function clearAllDrafts(): void {
	try {
		const keys: string[] = []
		for (let i = 0; i < localStorage.length; i++) {
			const k = localStorage.key(i)
			if (k?.startsWith(PREFIX)) keys.push(k)
		}
		keys.forEach(k => localStorage.removeItem(k))
	} catch { /* rien */ }
}
