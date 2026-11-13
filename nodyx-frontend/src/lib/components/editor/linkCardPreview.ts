// « Nodyx relié » dans l'éditeur (maquette validée https://nodyx.org/cartes-maquette.html,
// section 3) : un lien vers un sujet, une réponse ou un événement de l'instance montre
// l'APERÇU de sa carte sous sa ligne, et la bulle « Carte | Lien simple | Texte brut »
// laisse l'auteur choisir. « Lien simple » = data-card="off" sur le lien, la même marque
// que « Retirer la carte » dans le chat : le lien garde son texte, n'a plus de carte.
//
// L'aperçu n'est qu'un aperçu : pas cliquable, pas de « Je participe » pendant qu'on
// écrit, jamais enregistré (une décoration ProseMirror n'est pas dans le HTML).

import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Mark, MarkType, Node as PMNode } from '@tiptap/pm/model'
import { getMarkRange } from '@tiptap/core'
import { mount, unmount } from 'svelte'
import LinkCard from '$lib/components/LinkCard.svelte'
import { toInternalPath, MAX_CARDS } from '$lib/linkCards'

export interface LinkHit { from: number; to: number; href: string; path: string; off: boolean; mark: Mark }

/**
 * Le lien Nodyx que touche le curseur (juste avant ou juste après lui), ou null.
 * Seulement sur un curseur simple : une sélection garde sa barre habituelle.
 */
export function internalLinkAt(state: EditorState, origin: string | null): LinkHit | null {
	const sel = state.selection
	const linkType = state.schema.marks.link
	if (!sel.empty || !linkType || !origin) return null
	const $p = sel.$from
	const candidates: [PMNode | null | undefined, number][] = [
		[$p.nodeBefore, $p.pos - 1],
		[$p.nodeAfter, $p.pos],
	]
	for (const [node, at] of candidates) {
		if (!node?.isText || at < 0) continue
		const mark = node.marks.find(m => m.type === linkType)
		if (!mark) continue
		const path = toInternalPath(String(mark.attrs.href ?? ''), origin)
		if (!path) continue
		const range = getMarkRange(state.doc.resolve(at), linkType, mark.attrs)
		if (!range) continue
		return { from: range.from, to: range.to, href: String(mark.attrs.href), path, off: mark.attrs.card === 'off', mark }
	}
	return null
}

/** Les blocs qui portent des cartes : fin du bloc + chemins (trois au plus en tout, D41). */
export function previewTargets(doc: PMNode, linkType: MarkType | undefined, origin: string | null): { pos: number; paths: string[] }[] {
	if (!linkType || !origin) return []
	const out: { pos: number; paths: string[] }[] = []
	const seen = new Set<string>()
	doc.descendants((node, pos) => {
		if (seen.size >= MAX_CARDS) return false
		if (!node.isTextblock) return true
		const paths: string[] = []
		node.forEach(child => {
			const m = child.marks.find(mm => mm.type === linkType)
			if (!m || m.attrs.card === 'off' || seen.size >= MAX_CARDS) return
			const p = toInternalPath(String(m.attrs.href ?? ''), origin)
			if (!p || seen.has(p)) return
			seen.add(p); paths.push(p)
		})
		if (paths.length) out.push({ pos: pos + node.nodeSize - 1, paths })
		return false
	})
	return out
}

export const linkCardPreviewKey = new PluginKey('nxLinkCardPreview')

/** Le greffon d'aperçu. `token` : celui du lecteur, pour que l'aperçu respecte SES droits. */
export function linkCardPreviewPlugin(opts: { origin: () => string | null; token: () => string | null }): Plugin {
	return new Plugin({
		key: linkCardPreviewKey,
		props: {
			decorations(state) {
				const origin = opts.origin()
				const targets = previewTargets(state.doc, state.schema.marks.link, origin)
				if (!targets.length) return null
				const active = internalLinkAt(state, origin)
				const decos = targets.map(({ pos, paths }) => {
					const on = active && !active.off && paths.includes(active.path) ? active.path : ''
					return Decoration.widget(pos, () => {
						const wrap = document.createElement('div')
						wrap.className = 'nx-ed-cards'
						wrap.contentEditable = 'false'
						wrap.setAttribute('aria-hidden', 'true')
						const apps = paths.map(p => {
							const box = document.createElement('div')
							box.className = 'nx-ed-card' + (p === on ? ' active' : '')
							wrap.appendChild(box)
							return mount(LinkCard, { target: box, props: { path: p, token: opts.token() } })
						})
						;(wrap as any).__nxUnmount = () => apps.forEach(a => { try { unmount(a) } catch { /* déjà parti */ } })
						return wrap
					}, {
						side: 1,
						ignoreSelection: true,
						key: `nxlc:${paths.join('|')}:${on}`,
						destroy: (dom: Node) => (dom as any).__nxUnmount?.(),
					})
				})
				return DecorationSet.create(state.doc, decos)
			},
		},
	})
}
