import { describe, it, expect, vi } from 'vitest'
vi.mock('$lib/components/LinkCard.svelte', () => ({ default: {} }))
vi.mock('$lib/api', () => ({ apiFetch: vi.fn() }))
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { internalLinkAt, previewTargets } from './linkCardPreview'

const O = 'https://communaute.example'
const E = '33333333-3333-4333-8333-333333333333'
const schema = new Schema({
	nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'text*' }, text: {} },
	marks: { link: { attrs: { href: {}, card: { default: null } }, inclusive: false }, bold: {} },
})
const link = (href: string, card: string | null = null) => schema.marks.link.create({ href, card })
const p = (...parts: any[]) => schema.node('paragraph', null, parts)
const t = (s: string, ...marks: any[]) => schema.text(s, marks)
const stateAt = (doc: any, pos: number, to = pos) => EditorState.create({ doc, selection: TextSelection.create(doc, pos, to) })

describe('le lien Nodyx au curseur (bulle Carte | Lien simple | Texte brut)', () => {
	// « Voir » (5) + lien « la soirée » en deux morceaux (gras au milieu) + « ! »
	const doc = schema.node('doc', null, [p(t('Voir '), t('la ', link(`/calendar/${E}`)), t('soirée', link(`/calendar/${E}`), schema.marks.bold.create()), t(' !'))])
	const start = 1 + 5, end = start + 'la soirée'.length

	it('curseur juste après le lien : trouvé, plage ENTIÈRE malgré le gras au milieu', () => {
		const hit = internalLinkAt(stateAt(doc, end), O)!
		expect([hit.from, hit.to, hit.path, hit.off]).toEqual([start, end, `/calendar/${E}`, false])
	})
	it('curseur juste avant le lien : trouvé aussi', () => {
		expect(internalLinkAt(stateAt(doc, start), O)?.path).toBe(`/calendar/${E}`)
	})
	it('curseur dans du texte ordinaire : rien', () => {
		expect(internalLinkAt(stateAt(doc, 2), O)).toBeNull()
	})
	it('une sélection garde sa barre habituelle : rien', () => {
		expect(internalLinkAt(stateAt(doc, start, end), O)).toBeNull()
	})
	it('lien externe : pas de bulle', () => {
		const d = schema.node('doc', null, [p(t('x', link('https://autre.example/calendar/' + E)))])
		expect(internalLinkAt(stateAt(d, 2), O)).toBeNull()
	})
	it('« Lien simple » (data-card="off") : trouvé, marqué off', () => {
		const d = schema.node('doc', null, [p(t('x', link(`/calendar/${E}`, 'off')))])
		expect(internalLinkAt(stateAt(d, 2), O)?.off).toBe(true)
	})
})

describe('les cartes à montrer en aperçu', () => {
	it('par bloc, sans doublon, sans lien « off » ni externe, trois au plus en tout (D41)', () => {
		const doc = schema.node('doc', null, [
			p(t('a', link('/forum/jeux/a-1')), t(' '), t('b', link('/forum/jeux/a-1')), t(' '), t('c', link(`/calendar/${E}`, 'off'))),
			p(t('ext', link('https://autre.example/forum/jeux/z'))),
			p(t('d', link('/forum/jeux/d-2')), t('e', link('/forum/jeux/e-3')), t('f', link('/forum/jeux/f-4'))),
		])
		const out = previewTargets(doc, schema.marks.link, O)
		expect(out.map(o => o.paths)).toEqual([['/forum/jeux/a-1'], ['/forum/jeux/d-2', '/forum/jeux/e-3']])
		// l'aperçu se pose à la FIN de son bloc
		expect(out[0].pos).toBe(doc.child(0).nodeSize - 1)
	})
	it('aucun lien Nodyx : rien', () => {
		expect(previewTargets(schema.node('doc', null, [p(t('bonjour'))]), schema.marks.link, O)).toEqual([])
	})
})
