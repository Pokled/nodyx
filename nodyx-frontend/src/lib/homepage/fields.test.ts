import { describe, it, expect } from 'vitest'
import type { FieldSchema } from '$lib/components/homepage/plugins/_types'
import { defaultOf, defaultsFor, visibleFields, showExample, listAdd, listRemove, listMove, checkLink } from './fields'

const f = (key: string, type: FieldSchema['type'], more: Partial<FieldSchema> = {}): FieldSchema => ({ key, type, label: key, ...more })

describe('valeurs de départ', () => {
	it('le `default` gagne, sinon une valeur neutre du type', () => {
		expect(defaultOf(f('a', 'text', { default: 'Bonjour' }))).toBe('Bonjour')
		expect(defaultOf(f('a', 'boolean'))).toBe(false)
		expect(defaultOf(f('a', 'slider', { min: 2, max: 6 }))).toBe(2)
		expect(defaultOf(f('a', 'list'))).toEqual([])
		expect(defaultOf(f('a', 'categories'))).toEqual([])
		expect(defaultOf(f('a', 'choice-visual', { options: [{ value: 'grande', label: 'g' }, { value: 'egales', label: 'e' }] }))).toBe('grande')
		expect(defaultOf(f('a', 'media'))).toBe('')
	})

	it('une valeur par défaut est copiée, jamais partagée entre deux blocs', () => {
		const champ = f('items', 'list', { default: [{ nom: 'Dev' }] })
		const un = defaultOf(champ) as { nom: string }[]
		un[0].nom = 'changé'
		expect((defaultOf(champ) as { nom: string }[])[0].nom).toBe('Dev')
	})

	it('defaultsFor couvre aussi les réglages repliés', () => {
		expect(defaultsFor([f('titre', 'text', { default: 'À venir' })], [f('coin', 'boolean', { default: true })])).toEqual({ titre: 'À venir', coin: true })
	})
})

describe('champs conditionnels et exemples', () => {
	const schema = [f('source', 'select'), f('affiches', 'list', { showIf: { source: 'main' } }), f('cat', 'category', { showIf: { source: 'epingles' } })]

	it('un champ n’apparaît que si toutes ses conditions sont vraies', () => {
		expect(visibleFields(schema, { source: 'main' }).map(x => x.key)).toEqual(['source', 'affiches'])
		expect(visibleFields(schema, { source: 'epingles' }).map(x => x.key)).toEqual(['source', 'cat'])
	})

	it('l’exemple ne se montre que sur un champ vide (R8)', () => {
		const c = f('titre', 'text', { example: 'Montre ce que tu crées.' })
		expect(showExample(c, '')).toBe(true)
		expect(showExample(c, undefined)).toBe(true)
		expect(showExample(c, 'Mon titre')).toBe(false)
		expect(showExample(f('x', 'text'), '')).toBe(false)
	})
})

describe('listes', () => {
	it('ajouter respecte le maximum et copie l’élément neuf', () => {
		const neuf = { nom: 'Nouveau' }
		const l = listAdd([{ nom: 'a' }], neuf, 3)
		expect(l).toEqual([{ nom: 'a' }, { nom: 'Nouveau' }])
		l[1].nom = 'x'; expect(neuf.nom).toBe('Nouveau')
		const plein = [{ nom: 'a' }, { nom: 'b' }]
		expect(listAdd(plein, neuf, 2)).toBe(plein)
	})

	it('retirer et déplacer, sans toucher à la liste d’origine', () => {
		const l = ['a', 'b', 'c', 'd']
		expect(listRemove(l, 1)).toEqual(['a', 'c', 'd'])
		expect(listMove(l, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
		expect(listMove(l, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
		expect(l).toEqual(['a', 'b', 'c', 'd'])
	})

	it('un indice hors liste ne change rien', () => {
		const l = ['a', 'b']
		expect(listRemove(l, 5)).toBe(l)
		expect(listMove(l, 0, 9)).toBe(l)
		expect(listMove(l, -1, 0)).toBe(l)
		expect(listMove(l, 1, 1)).toBe(l)
	})
})

describe('liens (R9 : aucun lien cassé ni piégé)', () => {
	it('accepte les pages de l’instance et les adresses https publiques', () => {
		expect(checkLink('/forum')).toEqual({ ok: true, kind: 'internal' })
		expect(checkLink('/forum/moteurs?tri=recent')).toEqual({ ok: true, kind: 'internal' })
		expect(checkLink('https://store.steampowered.com/app/123')).toEqual({ ok: true, kind: 'external' })
		expect(checkLink('https://remanence.itch.io/cartouche')).toEqual({ ok: true, kind: 'external' })
	})

	it('refuse le reste', () => {
		for (const l of ['', 'http://site.fr', 'javascript:alert(1)', '//site-pirate.example', '/\\site-pirate.example',
			'https://localhost/x', 'https://127.0.0.1/', 'https://10.0.0.2/', 'https://[::1]/', 'https://nas.local/',
			'https://user:mdp@site.fr/', 'https://intranet/', 'ftp://site.fr', 42, null])
			expect(checkLink(l)).toEqual({ ok: false })
	})
})
