// Les blocs de la charte (lot 7b, SPECS/NODYX_OCTOGUARD_V2_CDC.md §E4j ; maquette v3
// validée le 19/11/2026). Ce sont les « pièces de Lego » de l'aide-mémoire : la
// palette « + Ajouter un bloc », la barre oblique, « Comment c'est fait ? » et le
// nettoyage du serveur (nodyx-core/src/utils/sanitize.ts, sanitizeCharter) parlent
// tous de CETTE liste. Un bloc ajouté ici doit l'être aussi là-bas.
//
// Module pur (testé sans navigateur) : pas de DOM, que des chaînes.

type T = (key: string, vars?: Record<string, string>) => string

export const CHARTER_COLORS = ['green', 'blue', 'violet', 'orange', 'red'] as const
export type CharterColor = typeof CHARTER_COLORS[number]
/** La couleur d'une pastille de titre ou d'un encadré, et celle du texte (mêmes teintes). */
export const COLOR_HEX: Record<CharterColor, string> = {
	green: '#22c55e', blue: '#3b82f6', violet: '#8b5cf6', orange: '#f59e0b', red: '#e5484d',
}

export type BlockKind = 'banner' | 'title' | 'text' | 'lead' | 'callout' | 'list' | 'line' | 'image' | 'link' | 'color' | 'var'
export const BLOCK_KINDS: readonly BlockKind[] = ['banner', 'title', 'text', 'lead', 'callout', 'list', 'line', 'image', 'link', 'color', 'var']
/** Ce que la palette propose d'ajouter, dans cet ordre (maquette). */
export const PALETTE: readonly BlockKind[] = ['banner', 'title', 'text', 'lead', 'callout', 'list', 'line', 'image']
/** L'aide-mémoire, rangé par usage (maquette v2 de l'aide-mémoire). */
export const GROUPS: ReadonlyArray<[string, readonly BlockKind[]]> = [
	['start', ['banner', 'lead']],
	['structure', ['title', 'text', 'list', 'line']],
	['eye', ['callout', 'color']],
	['link', ['link', 'image']],
	['magic', ['var']],
]
export const BLOCK_ICON: Record<BlockKind, string> = {
	banner: '▭', title: 'T', text: '¶', lead: '“', callout: '!', list: '•', line: '—', image: '◰', link: '↗', color: 'A', var: '{}',
}

/** Les photos livrées avec Nodyx (static/biomes), proposées partout où l'on choisit une image. */
export const BIOME_PHOTOS: readonly string[] = [
	'fr-1', 'fr-2', 'fr-3', 'de-1', 'de-2', 'de-3', 'en-1', 'en-2', 'en-3', 'es-1', 'es-2', 'es-3',
	'pt-BR-1', 'pt-BR-2', 'pt-PT-1', 'pt-PT-2', 'ru-1', 'ru-2', 'vi-1',
].map(n => `/biomes/${n}.webp`)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
/** Les attributs d'une balise, valeurs échappées. */
const attrs = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}="${esc(v)}"`).join(' ')
/** Une image (ou la photo d'une bannière) : adresse et description échappées. */
export const imgHtml = (src: string, alt: string) => `<img ${attrs({ src, alt })}>`
const bannerHtml = (src: string, alt: string, caption: string) =>
	`<figure class="nx-banner">${imgHtml(src, alt)}<figcaption>${esc(caption)}</figcaption></figure>`

/** Les deux variables, dans la langue de qui écrit ({communauté} / {community}). */
export function tokens(tFn: T) {
	return { community: `{${tFn('chb.token_community')}}`, user: `{${tFn('chb.token_user')}}` }
}

/** Le code d'exemple d'un bloc (inséré par la palette, montré par l'aide-mémoire). */
export function blockCode(kind: BlockKind, tFn: T): string {
	const tk = tokens(tFn)
	switch (kind) {
		case 'banner': return bannerHtml(BIOME_PHOTOS[0], tFn('chb.ex_banner_alt'), tFn('chb.ex_banner_caption'))
		case 'title': return `<h2 data-color="green">${esc(tFn('chb.ex_title'))}</h2>`
		case 'text': return `<p>${esc(tFn('chb.ex_text'))}</p>`
		case 'lead': return `<p class="lead">${esc(tFn('chb.ex_lead', { user: tk.user }))}</p>`
		case 'callout': return `<aside class="nx-callout" data-color="orange"><strong>${esc(tFn('chb.ex_callout_strong'))}</strong> ${esc(tFn('chb.ex_callout'))}</aside>`
		case 'list': return `<ul><li><p>${esc(tFn('chb.ex_list_1'))}</p></li><li><p>${esc(tFn('chb.ex_list_2'))}</p></li></ul>`
		case 'line': return '<hr>'
		case 'image': return imgHtml(BIOME_PHOTOS[9], tFn('chb.ex_image_alt'))
		case 'link': return `<p>${esc(tFn('chb.ex_link_before'))} <a href="/chat">${esc(tFn('chb.ex_link_label'))}</a>.</p>`
		case 'color': return `<p>${esc(tFn('chb.ex_color_before'))} <span style="color: ${COLOR_HEX.green}">${esc(tFn('chb.ex_color_word'))}</span>.</p>`
		case 'var': return `${esc(tk.community)} · ${esc(tk.user)}`
	}
}

// ── Le code source : un bloc par ligne, coloré (vue « Côte à côte » et « Code source ») ──

/** Coupe un HTML (déjà nettoyé, bien formé) en ses blocs de premier niveau. */
export function topLevelBlocks(html: string): string[] {
	const out: string[] = []
	const VOID = /^(hr|img|br)$/i
	let i = 0, depth = 0, start = -1
	while (i < html.length) {
		if (html[i] !== '<') { if (depth === 0 && start < 0 && html[i].trim()) start = i; i++; continue }
		const end = html.indexOf('>', i)
		if (end < 0) break
		const tag = html.slice(i, end + 1)
		const m = /^<\/?([a-zA-Z0-9]+)/.exec(tag)
		const name = m?.[1] ?? ''
		const closing = tag.startsWith('</'), selfClose = tag.endsWith('/>') || VOID.test(name)
		if (!closing) {
			if (depth === 0 && start < 0) start = i
			if (!selfClose) depth++
			else if (depth === 0) { out.push(html.slice(start, end + 1)); start = -1 }
		} else {
			depth = Math.max(0, depth - 1)
			if (depth === 0 && start >= 0) { out.push(html.slice(start, end + 1)); start = -1 }
		}
		i = end + 1
	}
	if (start >= 0 && html.slice(start).trim()) out.push(html.slice(start).trim())
	return out
}

/** Un bloc, lisible : une liste par élément, une bannière par morceau. */
export function prettyBlock(block: string): string {
	if (/^<(ul|ol)\b/i.test(block)) return block.replace(/<li>/g, '\n  <li>').replace(/<\/(ul|ol)>$/, '\n</$1>')
	if (/^<figure\b/i.test(block)) return block.replace(/<img/, '\n  <img').replace(/<figcaption>/, '\n  <figcaption>').replace(/<\/figure>$/, '\n</figure>')
	return block
}

/** Le code coloré d'un bloc (échappé : sûr à injecter). Balises, attributs, valeurs, variables. */
export function highlight(code: string): string {
	// Une variable, dans n'importe quelle langue : un mot entre accolades
	const vars = /(\{[\p{L}_]+\})/gu
	// Dans cet ordre, avec des repères qui ne peuvent pas apparaître dans du texte échappé :
	// les attributs d'abord (sinon on recolorerait nos propres « class »)
	return code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
		.replace(/ ([a-z-]+)=("[^"]*")/g, ' \u0001$1\u0002\u0003$2\u0004')
		.replace(/(&lt;\/?)([a-z0-9]+)/g, '$1\u0005$2\u0006')
		.replace(vars, '\u0007$1\u0008')
		.replace(/\u0001/g, '<span class="at">').replace(/\u0002/g, '</span>=').replace(/\u0003/g, '<span class="vl">').replace(/\u0004/g, '</span>')
		.replace(/\u0005/g, '<span class="tg">').replace(/\u0006/g, '</span>').replace(/\u0007/g, '<span class="vr">').replace(/\u0008/g, '</span>')
}

/** De quel bloc s'agit-il (nom d'un nœud de l'éditeur → bloc de l'aide-mémoire). */
export function kindOfNode(name: string): BlockKind {
	switch (name) {
		case 'charterBanner': return 'banner'
		case 'heading': return 'title'
		case 'charterLead': return 'lead'
		case 'charterCallout': return 'callout'
		case 'bulletList': case 'orderedList': return 'list'
		case 'horizontalRule': return 'line'
		case 'image': return 'image'
		default: return 'text'
	}
}

// ── Les modèles (« Partir d'un modèle ») ────────────────────────────────────

export type TemplateId = 'complete' | 'example' | 'youth' | 'gaming' | 'help'
// « complete » d'abord : la charte générique, prête à publier (membres comme équipe)
export const TEMPLATES: readonly TemplateId[] = ['complete', 'example', 'youth', 'gaming', 'help']

type Piece =
	| ['banner', string, string, string]      // photo, alt, légende
	| ['lead', string]
	| ['h2', CharterColor, string]
	| ['p', string]
	| ['pc', string, string, string, CharterColor]   // texte, mot en couleur et gras, suite
	| ['pl', string, string, string, string]         // texte, lien, adresse, suite
	| ['callout', CharterColor, string, string]
	| ['ul', string[]]
	| ['hr']
	| ['end', string]

function build(pieces: Piece[]): string {
	return pieces.map(p => {
		switch (p[0]) {
			case 'banner': return bannerHtml(p[1], p[2], p[3])
			case 'lead': return `<p class="lead">${esc(p[1])}</p>`
			case 'h2': return `<h2 data-color="${p[1]}">${esc(p[2])}</h2>`
			case 'p': return `<p>${esc(p[1])}</p>`
			case 'pc': return `<p>${esc(p[1])} <span style="color: ${COLOR_HEX[p[4]]}"><strong>${esc(p[2])}</strong></span>${esc(p[3])}</p>`
			case 'pl': return `<p>${esc(p[1])} <a ${attrs({ href: p[3] })}>${esc(p[2])}</a>${esc(p[4])}</p>`
			case 'callout': return `<aside class="nx-callout" data-color="${p[1]}"><strong>${esc(p[2])}</strong> ${esc(p[3])}</aside>`
			case 'ul': return `<ul>${p[1].map(li => `<li><p>${esc(li)}</p></li>`).join('')}</ul>`
			case 'hr': return '<hr>'
			case 'end': return `<p class="lead"><em>${esc(p[1])}</em></p>`
		}
	}).join('')
}

/** Un modèle, écrit dans la langue de qui l'insère. L'exemple commenté dépend de la charte (membres / équipe). */
export function templateHtml(id: TemplateId, audience: 'members' | 'team', tFn: T): string {
	const tk = tokens(tFn)
	const v = { community: tk.community, user: tk.user }
	const k = (key: string) => tFn(key, v)
	// La charte générique, complète et prête à publier (lot 7e, demandée par Jonathan le 20/11)
	if (id === 'complete' && audience === 'team') return build([
		['banner', '/biomes/de-1.webp', k('chtpl.team_banner_alt'), k('chtpl.full_team_banner')],
		['lead', k('chtpl.full_team_lead')],
		['h2', 'green', k('chtpl.full_team_h1')], ['p', k('chtpl.full_team_p1')],
		['h2', 'blue', k('chtpl.full_team_h2')], ['p', k('chtpl.full_team_p2')],
		['h2', 'orange', k('chtpl.full_team_h3')], ['callout', 'orange', k('chtpl.full_team_callout_strong'), k('chtpl.full_team_callout')],
		['h2', 'violet', k('chtpl.full_team_h4')], ['p', k('chtpl.full_team_p4')],
		['h2', 'red', k('chtpl.full_team_h5')], ['p', k('chtpl.full_team_p5')],
		['h2', 'blue', k('chtpl.full_team_h6')], ['p', k('chtpl.full_team_p6')],
		['h2', 'green', k('chtpl.full_team_h7')],
		['ul', [k('chtpl.full_team_li1'), k('chtpl.full_team_li2'), k('chtpl.full_team_li3')]],
		['hr'], ['end', k('chtpl.full_team_end')],
	])
	if (id === 'complete') return build([
		['banner', '/biomes/fr-1.webp', k('chtpl.ex_banner_alt'), k('chtpl.ex_banner')],
		['lead', k('chtpl.full_lead')],
		['h2', 'green', k('chtpl.full_h1')], ['p', k('chtpl.full_p1')],
		['h2', 'red', k('chtpl.full_h2')], ['p', k('chtpl.full_p2')],
		['h2', 'orange', k('chtpl.full_h3')],
		['callout', 'orange', k('chtpl.full_callout_strong'), k('chtpl.full_callout')], ['p', k('chtpl.full_p3')],
		['h2', 'blue', k('chtpl.full_h4')], ['p', k('chtpl.full_p4')],
		['h2', 'violet', k('chtpl.full_h5')], ['p', k('chtpl.full_p5')],
		['h2', 'green', k('chtpl.full_h6')], ['p', k('chtpl.full_p6')],
		['h2', 'blue', k('chtpl.full_h7')],
		['ul', [k('chtpl.full_li1'), k('chtpl.full_li2'), k('chtpl.full_li3')]],
		['h2', 'red', k('chtpl.full_h8')], ['p', k('chtpl.full_p8')],
		['hr'], ['end', k('chtpl.full_end')],
	])
	if (id === 'example' && audience === 'team') return build([
		['banner', '/biomes/de-1.webp', k('chtpl.team_banner_alt'), k('chtpl.team_banner')],
		['lead', k('chtpl.team_lead')],
		['h2', 'green', k('chtpl.team_h1')], ['p', k('chtpl.team_p1')],
		['h2', 'blue', k('chtpl.team_h2')], ['p', k('chtpl.team_p2')],
		['callout', 'violet', k('chtpl.team_callout_strong'), k('chtpl.team_callout')],
		['h2', 'red', k('chtpl.team_h3')], ['p', k('chtpl.team_p3')],
		['hr'], ['end', k('chtpl.team_end')],
	])
	if (id === 'example') return build([
		['banner', '/biomes/fr-1.webp', k('chtpl.ex_banner_alt'), k('chtpl.ex_banner')],
		['lead', k('chtpl.ex_lead')],
		['h2', 'green', k('chtpl.ex_h1')], ['pc', k('chtpl.ex_p1_before'), k('chtpl.ex_p1_strong'), k('chtpl.ex_p1_after'), 'green'],
		['h2', 'blue', k('chtpl.ex_h2')], ['pl', k('chtpl.ex_p2_before'), k('chtpl.ex_p2_link'), '/chat', k('chtpl.ex_p2_after')],
		['hr'],
		['h2', 'violet', k('chtpl.ex_h3')], ['p', k('chtpl.ex_p3')],
		['callout', 'orange', k('chtpl.ex_callout_strong'), k('chtpl.ex_callout')],
		['h2', 'red', k('chtpl.ex_h4')],
		['ul', [k('chtpl.ex_li1'), k('chtpl.ex_li2'), k('chtpl.ex_li3')]],
		['hr'], ['end', k('chtpl.ex_end')],
	])
	if (id === 'youth') return build([
		['banner', '/biomes/en-1.webp', k('chtpl.youth_banner_alt'), k('chtpl.youth_banner')],
		['lead', k('chtpl.youth_lead')],
		['h2', 'green', k('chtpl.youth_h1')], ['p', k('chtpl.youth_p1')],
		['h2', 'orange', k('chtpl.youth_h2')], ['callout', 'orange', k('chtpl.youth_callout_strong'), k('chtpl.youth_callout')],
		['h2', 'blue', k('chtpl.youth_h3')], ['p', k('chtpl.youth_p3')],
	])
	if (id === 'gaming') return build([
		['banner', '/biomes/es-3.webp', k('chtpl.gaming_banner_alt'), k('chtpl.gaming_banner')],
		['lead', k('chtpl.gaming_lead')],
		['h2', 'green', k('chtpl.gaming_h1')], ['p', k('chtpl.gaming_p1')],
		['h2', 'violet', k('chtpl.gaming_h2')], ['p', k('chtpl.gaming_p2')],
		['h2', 'blue', k('chtpl.gaming_h3')], ['p', k('chtpl.gaming_p3')],
	])
	return build([
		['banner', '/biomes/en-3.webp', k('chtpl.help_banner_alt'), k('chtpl.help_banner')],
		['lead', k('chtpl.help_lead')],
		['h2', 'blue', k('chtpl.help_h1')], ['p', k('chtpl.help_p1')],
		['h2', 'green', k('chtpl.help_h2')], ['p', k('chtpl.help_p2')],
		['h2', 'orange', k('chtpl.help_h3')], ['p', k('chtpl.help_p3')],
	])
}
