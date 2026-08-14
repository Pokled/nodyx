import { describe, it, expect } from 'vitest'
import {
	extensionWidgetEntries, extensionIndex, extensionWidgetId, parseExtensionWidgetId,
	type PublicExtension,
} from './extensionCatalog'

const EXT: PublicExtension = {
	id: 'library', version: '1.0.0',
	label: 'Médiathèque', description: 'Des films choisis à la main.',
	icon: '/api/v1/extensions/library/1.0.0/assets/icon.svg', family: 'content',
	messages: { label: 'Médiathèque' },
	surfaces: [
		{ type: 'widget', id: 'tonight', entry: 'ui/tonight.js', label: 'Ce soir', defaultHeight: 320,
		  schema: [{ key: 'mood', type: 'select', label: 'Humeur', options: [{ value: 'a', label: 'A' }] }] },
		{ type: 'page', path: 'library', entry: 'ui/page.js', label: 'Médiathèque' },
	],
}

describe('identifiants de mise en page', () => {
	it('prefixe, pour qu une extension ne prenne jamais l identite d un natif', () => {
		expect(extensionWidgetId('library', 'tonight')).toBe('ext:library:tonight')
	})

	it('se decompose', () => {
		expect(parseExtensionWidgetId('ext:library:tonight')).toEqual({ extensionId: 'library', surfaceId: 'tonight' })
	})

	it.each(['hero-banner', 'ext:', 'ext:library', 'library:tonight', ''])(
		'refuse de decomposer %p', (raw) => {
			expect(parseExtensionWidgetId(raw)).toBeNull()
		})

	it('ne peut pas se confondre avec un identifiant natif', () => {
		// Les identifiants natifs n'ont pas de deux-points : la collision est
		// impossible par construction, pas par convention.
		expect(parseExtensionWidgetId('video-player')).toBeNull()
	})
})

describe('entrees du catalogue', () => {
	it('ne retient que les surfaces widget', () => {
		const entries = extensionWidgetEntries([EXT])
		expect(entries).toHaveLength(1)
		expect(entries[0].surfaceId).toBe('tonight')
	})

	it('porte tout ce qu il faut pour monter la surface', () => {
		const e = extensionWidgetEntries([EXT])[0]
		expect(e).toMatchObject({
			kind: 'extension', id: 'ext:library:tonight',
			extensionId: 'library', version: '1.0.0',
			entry: 'ui/tonight.js', label: 'Ce soir', defaultHeight: 320,
		})
		expect(e.messages.label).toBe('Médiathèque')
	})

	it('retombe sur le libelle de l extension quand la surface n en a pas', () => {
		const sans = { ...EXT, surfaces: [{ ...EXT.surfaces[0], label: '' }] }
		expect(extensionWidgetEntries([sans])[0].label).toBe('Médiathèque')
	})

	it('normalise le schema comme celui d un widget natif', () => {
		const e = extensionWidgetEntries([EXT])[0]
		expect(e.schema[0]).toMatchObject({ key: 'mood', type: 'select' })
		expect(e.schema[0].options?.[0].label).toBe('A')
	})

	it('accepte checkbox a la lecture, sans le legitimer au manifeste', () => {
		// Le validateur du coeur refuse checkbox a l'installation ; ici on
		// canonise ce qui viendrait d'ailleurs plutot que de casser le rendu.
		const ext = { ...EXT, surfaces: [{ ...EXT.surfaces[0], schema: [{ key: 'on', type: 'checkbox', label: 'On' }] }] }
		expect(extensionWidgetEntries([ext as PublicExtension])[0].schema[0].type).toBe('boolean')
	})

	it('rend une liste vide sans extension', () => {
		expect(extensionWidgetEntries()).toEqual([])
		expect(extensionWidgetEntries([{ ...EXT, surfaces: [] }])).toEqual([])
	})

	it('indexe par identifiant de mise en page', () => {
		expect(Object.keys(extensionIndex([EXT]))).toEqual(['ext:library:tonight'])
	})
})
