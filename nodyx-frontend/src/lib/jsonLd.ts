// Données structurées schema.org, injectées en <script type="application/ld+json">.
// Un texte de membre contenant « </script> » romprait le bloc et ferait exécuter la
// suite comme du HTML : on échappe <, > et & en séquences unicode, seule façon sûre
// d'embarquer du JSON dans une balise script (le JSON reste identique une fois lu).
export function jsonLdScript(data: unknown): string {
	const json = JSON.stringify(data)
		.replace(/</g, '\\u003c')
		.replace(/>/g, '\\u003e')
		.replace(/&/g, '\\u0026')
	return `<script type="application/ld+json">${json}<\/script>`
}

/** Une adresse complète : les aperçus de liens ne résolvent pas un chemin relatif. */
export function absoluteUrl(origin: string, u: string | null | undefined): string | undefined {
	if (!u) return undefined
	if (/^https?:\/\//.test(u)) return u
	return origin + (u.startsWith('/') ? u : '/' + u)
}

/** Texte brut d'un contenu HTML, borné (description, résumé). */
export function plainText(html: string | null | undefined, max = 300): string {
	const t = String(html ?? '').replace(/<[^<>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
	return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}
