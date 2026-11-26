// Adresses saisies dans le builder pour la vitrine : seules passent une page de l'instance
// ou une adresse https. Rien d'autre n'arrive dans un href ou un src (javascript:, data:,
// adresses « //autre-site », retours de dossier).

const LOCAL = /^\/(?![/\\])[A-Za-z0-9\-._~%/?=&+,#!$'()*;@]*$/

/** Un lien : une page de l'instance (« /forum ») ou une adresse https. Sinon, chaîne vide. */
export function safeHref(v: unknown): string {
	if (typeof v !== 'string') return ''
	const s = v.trim()
	if (!s || s.length > 500) return ''
	if (s.startsWith('/')) return LOCAL.test(s) && !s.includes('..') ? s : ''
	try {
		const u = new URL(s)
		return u.protocol === 'https:' ? u.href : ''
	} catch {
		return ''
	}
}

/** Une image : un fichier de l'instance (/uploads/…, fichier statique) ou une adresse https. */
export function safeImg(v: unknown): string {
	return safeHref(v)
}
