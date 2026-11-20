// La page « La charte » (lot 7d-3, maquette v4 validée le 20/11/2026) : les règles pures.

export type OutlineItem = { id: string; text: string; color: string | null }

const COLORS = new Set(['green', 'blue', 'violet', 'orange', 'red'])
const decode = (s: string) => s
	.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
	.replace(/&amp;/g, '&')

/**
 * Le sommaire se fait TOUT SEUL depuis les titres que l'admin écrit (bloc « Titre » = h2) :
 * rien à remplir. Chaque titre reçoit une ancre (`regle-1`, `regle-2`…) et devient
 * focalisable (tabindex="-1"), pour qu'un clic dans le sommaire y emmène aussi le clavier.
 * Le HTML vient du serveur, déjà nettoyé : on n'ajoute que nos deux attributs.
 */
export function outline(html: string): { html: string; items: OutlineItem[] } {
	const items: OutlineItem[] = []
	const out = html.replace(/<h2(\s[^>]*)?>([\s\S]*?)<\/h2>/gi, (_m, attrs: string | undefined, inner: string) => {
		const id = `regle-${items.length + 1}`
		const text = decode(inner.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()
		const c = /\bdata-color="([a-z]+)"/.exec(attrs ?? '')?.[1] ?? null
		items.push({ id, text, color: c && COLORS.has(c) ? c : null })
		return `<h2 id="${id}" tabindex="-1"${attrs ?? ''}>${inner}</h2>`
	})
	return { html: out, items: items.filter(i => i.text) }
}

/** Le sommaire n'aide qu'à partir de trois titres. */
export const OUTLINE_MIN = 3
