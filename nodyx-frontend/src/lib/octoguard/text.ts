// Le texte d'un contenu HTML (déjà nettoyé par le cœur), pour le relire tel
// quel : liens en clair, sauts de ligne gardés, aucune balise interprétée.
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }

export function htmlToText(html: string): string {
	return html
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
		.replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>(.*?)<\/a>/gi, (_m, href: string, label: string) => (label.replace(/<[^>]+>/g, '').trim() === href ? href : `${label} (${href})`))
		.replace(/<[^>]+>/g, '')
		.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITIES[e])
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}
