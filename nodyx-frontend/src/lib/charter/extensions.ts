// Les nouveaux blocs de l'éditeur de charte, pour TipTap (lot 7b). Chargé dynamiquement
// par CharterEditor (jamais côté serveur). Le HTML produit est EXACTEMENT celui que le
// nettoyage du serveur garde (sanitizeCharter) : un bloc rendu ici et retiré là-bas
// disparaîtrait à l'enregistrement sans prévenir.
import { Node, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { CHARTER_COLORS, kindOfNode, type BlockKind, type CharterColor } from './blocks'

/**
 * Entrée dans le titre d'une bannière : une ligne de texte s'ouvre SOUS la bannière.
 * Sans ce raccourci, la bannière (isolée) refuse d'être coupée et Entrée ne fait rien,
 * ce qui ressemble à un éditeur bloqué (vérifié au banc, 19/11/2026). À la fin d'une
 * accroche ou d'un encadré, l'éditeur sort déjà tout seul vers un paragraphe.
 */
function bannerEnter() {
	return ({ editor }: { editor: any }) => {
		const at = editor.state.selection.$from
		if (at.parent.type.name !== 'charterBanner' || at.depth !== 1) return false
		const after = at.after(1)
		return editor.chain().insertContentAt(after, { type: 'paragraph' }).setTextSelection(after + 1).scrollIntoView().run()
	}
}

const isColor = (c: unknown): c is CharterColor => typeof c === 'string' && (CHARTER_COLORS as readonly string[]).includes(c)
const FALLBACK_PHOTO = '/biomes/fr-1.webp'

/** <figure class="nx-banner"><img><figcaption>…</figcaption></figure> : la légende s'écrit, la photo se choisit d'un clic. */
export const CharterBanner = Node.create<{ onPickPhoto: (pos: number) => void }>({
	name: 'charterBanner',
	group: 'block',
	content: 'text*',
	marks: '',
	defining: true,
	isolating: true,
	addOptions() { return { onPickPhoto: () => {} } },
	addKeyboardShortcuts() { return { Enter: bannerEnter() } },
	addAttributes() {
		return { src: { default: FALLBACK_PHOTO }, alt: { default: '' } }
	},
	parseHTML() {
		return [{
			tag: 'figure.nx-banner',
			contentElement: 'figcaption',
			getAttrs: (el) => {
				const img = (el as HTMLElement).querySelector('img')
				return { src: img?.getAttribute('src') || FALLBACK_PHOTO, alt: img?.getAttribute('alt') ?? '' }
			},
		}]
	},
	renderHTML({ node }) {
		return ['figure', { class: 'nx-banner' }, ['img', { src: node.attrs.src, alt: node.attrs.alt }], ['figcaption', 0]]
	},
	addNodeView() {
		return ({ node, getPos }) => {
			const dom = document.createElement('figure')
			dom.className = 'nx-banner'
			const img = document.createElement('img')
			img.src = node.attrs.src; img.alt = node.attrs.alt
			img.contentEditable = 'false'
			img.className = 'nx-banner-pick'
			img.addEventListener('mousedown', (e) => {
				e.preventDefault()
				const pos = typeof getPos === 'function' ? getPos() : null
				if (typeof pos === 'number') this.options.onPickPhoto(pos)
			})
			const cap = document.createElement('figcaption')
			dom.append(img, cap)
			return {
				dom, contentDOM: cap,
				update: (n) => {
					if (n.type.name !== 'charterBanner') return false
					if (img.getAttribute('src') !== n.attrs.src) img.src = n.attrs.src
					img.alt = n.attrs.alt
					return true
				},
			}
		}
	},
})

/** <p class="lead"> : le texte d'accroche, centré. */
export const CharterLead = Node.create({
	name: 'charterLead',
	group: 'block',
	content: 'inline*',
	// PAS de priorité d'extension : la première sorte de bloc du schéma devient celle
	// qu'Entrée crée après un titre. Avec une priorité au-dessus du paragraphe, chaque
	// nouvelle ligne devenait une accroche (trouvé au banc). C'est la règle de lecture
	// ci-dessous, plus prioritaire que celle du paragraphe, qui reconnaît <p class="lead">.
	parseHTML() { return [{ tag: 'p.lead', priority: 100 }] },
	renderHTML() { return ['p', { class: 'lead' }, 0] },
})

/** <aside class="nx-callout" data-color="…"> : l'encadré coloré (cinq couleurs). */
export const CharterCallout = Node.create({
	name: 'charterCallout',
	group: 'block',
	content: 'inline*',
	defining: true,
	addAttributes() {
		return {
			color: {
				default: 'orange',
				parseHTML: (el) => { const c = el.getAttribute('data-color'); return isColor(c) ? c : 'orange' },
				renderHTML: (a) => ({ 'data-color': isColor(a.color) ? a.color : 'orange' }),
			},
		}
	},
	parseHTML() { return [{ tag: 'aside.nx-callout' }] },
	renderHTML({ HTMLAttributes }) { return ['aside', { class: 'nx-callout', ...HTMLAttributes }, 0] },
})

/** La pastille de couleur d'un titre : <h2 data-color="…">. */
export const HeadingColor = Extension.create({
	name: 'charterHeadingColor',
	addGlobalAttributes() {
		return [{
			types: ['heading'],
			attributes: {
				color: {
					default: null,
					parseHTML: (el) => { const c = el.getAttribute('data-color'); return isColor(c) ? c : null },
					renderHTML: (a) => (isColor(a.color) ? { 'data-color': a.color } : {}),
				},
			},
		}]
	},
})

/**
 * « Comment c'est fait ? » : chaque bloc de premier niveau porte son nom (data-label,
 * affiché par le CSS) ; celui qu'on a cliqué est marqué. Rien n'est écrit dans le HTML
 * enregistré : ce sont des décorations, pas des attributs.
 */
export const explainKey = new PluginKey<{ on: boolean; picked: number }>('charterExplain')
export const CharterExplain = Extension.create<{ label: (k: BlockKind) => string }>({
	name: 'charterExplain',
	addOptions() { return { label: (k: BlockKind) => k } },
	addProseMirrorPlugins() {
		const label = this.options.label
		return [new Plugin<{ on: boolean; picked: number }>({
			key: explainKey,
			state: {
				init: () => ({ on: false, picked: -1 }),
				apply: (tr, prev) => {
					const meta = tr.getMeta(explainKey) as Partial<{ on: boolean; picked: number }> | undefined
					return meta ? { ...prev, ...meta } : prev
				},
			},
			props: {
				decorations: (state) => {
					const s = explainKey.getState(state)
					if (!s?.on) return DecorationSet.empty
					const decos: Decoration[] = []
					let i = 0
					state.doc.forEach((node, offset) => {
						decos.push(Decoration.node(offset, offset + node.nodeSize, {
							'data-label': label(kindOfNode(node.type.name)),
							class: i === s.picked ? 'picked' : '',
						}))
						i++
					})
					return DecorationSet.create(state.doc, decos)
				},
			},
		})]
	},
})
