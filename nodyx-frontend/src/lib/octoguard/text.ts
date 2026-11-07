// Le texte d'un contenu HTML (déjà nettoyé par le cœur), pour le relire tel
// quel : liens en clair, sauts de ligne gardés, aucune balise interprétée.
// Ce texte vient d'un auteur peut-être malveillant et s'affiche chez un
// modérateur : tout est lu en un passage, sans expression régulière qui
// revient en arrière (une version à regex se bloquait sur des ancres jamais
// fermées, mesuré le 07/11 côté cœur).
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' }
const BLOCK_END = /^<\/(p|div|li|h[1-6]|blockquote)>$|^<br\s?\/?>$/i

/** Retire les balises en un passage (« < » sans « > » : le reste est du texte). */
function stripTags(s: string): string {
	let out = ''
	let i = 0
	while (i < s.length) {
		const lt = s.indexOf('<', i)
		if (lt === -1) { out += s.slice(i); break }
		const gt = s.indexOf('>', lt)
		if (gt === -1) { out += s.slice(i); break }
		out += s.slice(i, lt)
		i = gt + 1
	}
	return out
}

export function htmlToText(html: string): string {
	const lower = html.toLowerCase()
	let out = ''
	let i = 0
	let close = -1
	let noMoreClose = false
	while (i < html.length) {
		const lt = html.indexOf('<', i)
		if (lt === -1) { out += html.slice(i); break }
		const gt = html.indexOf('>', lt)
		if (gt === -1) { out += html.slice(i); break }
		out += html.slice(i, lt)
		const tag = html.slice(lt, gt + 1)
		const isAnchor = /^<a[\s>]/i.test(tag)
		if (isAnchor && tag.length <= 4096) {
			const m = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag)
			const href = m ? (m[1] ?? m[2] ?? '') : ''
			if (!noMoreClose && close < gt) { close = lower.indexOf('</a>', gt); if (close === -1) noMoreClose = true }
			if (!noMoreClose) {
				const label = stripTags(html.slice(gt + 1, close)).trim()
				out += href && label !== href ? (label ? `${label} (${href})` : href) : label
				i = close + 4
				continue
			}
			if (href) out += `${href} `
		} else if (BLOCK_END.test(tag)) out += '\n'
		i = gt + 1
	}
	return out
		.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_m, e: string) => ENTITIES[e])
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}
