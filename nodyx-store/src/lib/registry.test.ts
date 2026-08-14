import { describe, it, expect } from 'vitest'
import {
	validateEntry, latestVersion, capabilityDiff, categoriesOf, defaultOrder,
	filterEntries, buildIndex, compareVersions, INDEX_VERSION,
	type RegistryEntry,
} from './registry'

function entry(over: Partial<RegistryEntry> = {}): RegistryEntry {
	return {
		id: 'next-event',
		label: 'Prochain événement',
		description: 'Un compte à rebours vers le prochain rendez-vous.',
		author: { name: 'Nodyx', url: 'https://nodyx.org' },
		source: 'https://github.com/Pokled/nodyx',
		license: 'AGPL-3.0-or-later',
		family: 'community',
		surfaces: ['widget'],
		locales: ['en', 'fr'],
		official: true,
		versions: [{
			version: '1.0.0',
			sha256: 'a'.repeat(64),
			url: 'https://extensions.nodyx.org/p/next-event-1.0.0.nyx',
			permissions: [],
			sensitive: [],
			publishedAt: '2026-08-14T10:00:00.000Z',
		}],
		...over,
	}
}

describe('ce que le registre officiel exige', () => {
	it('accepte une entree complete', () => {
		expect(validateEntry(entry())).toEqual([])
	})

	it('exige un lien vers les sources', () => {
		// Sans lui, personne ne peut verifier ce qu'il installe, et l'ecran de
		// permissions devient la seule barriere.
		const issues = validateEntry(entry({ source: '' }))
		expect(issues.map(i => i.path)).toContain('source')
		expect(issues.find(i => i.path === 'source')!.message).toContain('lire')
	})

	it('exige une licence', () => {
		expect(validateEntry(entry({ license: '' })).map(i => i.path)).toContain('license')
	})

	it('exige un auteur, une surface, une langue, une version', () => {
		const issues = validateEntry({ ...entry(), author: {}, surfaces: [], locales: [], versions: [] })
		const paths = issues.map(i => i.path)
		expect(paths).toEqual(expect.arrayContaining(['author.name', 'surfaces', 'locales', 'versions']))
	})

	it.each(['MAJ', 'ab', '1abc', ''])('refuse l identifiant %p', (id) => {
		expect(validateEntry(entry({ id })).map(i => i.path)).toContain('id')
	})

	it('refuse une entree qui n est pas un objet', () => {
		for (const raw of [null, 42, 'texte', []]) expect(validateEntry(raw)).toHaveLength(1)
	})
})

describe('une version publiee est immuable', () => {
	it('refuse deux fois le meme numero', () => {
		const e = entry()
		const issues = validateEntry({ ...e, versions: [e.versions[0], { ...e.versions[0] }] })
		expect(issues.some(i => i.message.includes('immuable'))).toBe(true)
	})

	it('exige une empreinte sha256 et une URL', () => {
		const e = entry()
		const issues = validateEntry({ ...e, versions: [{ ...e.versions[0], sha256: 'court', url: 'nope' }] })
		const paths = issues.map(i => i.path)
		expect(paths).toContain('versions[0].sha256')
		expect(paths).toContain('versions[0].url')
	})

	it('exige la liste des permissions, meme vide', () => {
		const e = entry()
		const v = { ...e.versions[0] } as Record<string, unknown>
		delete v.permissions
		expect(validateEntry({ ...e, versions: [v] }).map(i => i.path)).toContain('versions[0].permissions')
	})
})

describe('versions', () => {
	it('compare correctement', () => {
		expect(compareVersions('1.2.0', '1.10.0')).toBeLessThan(0)
		expect(compareVersions('2.0.0', '1.9.9')).toBeGreaterThan(0)
		expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
	})

	it('met en avant la plus recente, pas la derniere ecrite', () => {
		const e = entry({ versions: [
			{ ...entry().versions[0], version: '1.0.0' },
			{ ...entry().versions[0], version: '1.10.0' },
			{ ...entry().versions[0], version: '1.2.0' },
		] })
		expect(latestVersion(e)!.version).toBe('1.10.0')
	})
})

describe('diff de capacites, le moment ou une extension peut devenir hostile', () => {
	const v = (permissions: string[]) => ({ ...entry().versions[0], permissions })

	it('met en avant ce qui s AJOUTE', () => {
		const d = capabilityDiff(v(['identity']), v(['identity', 'net:evil.example', 'storage.instance.write']))
		expect(d.added).toEqual(['net:evil.example', 'storage.instance.write'])
		expect(d.removed).toEqual([])
	})

	it('signale aussi ce qui disparait', () => {
		expect(capabilityDiff(v(['identity', 'storage.user']), v(['identity'])).removed).toEqual(['storage.user'])
	})

	it('ne rend rien quand rien ne bouge', () => {
		expect(capabilityDiff(v(['a']), v(['a']))).toEqual({ added: [], removed: [] })
	})
})

describe('rangement par surface, sans taxonomie artificielle', () => {
	it('un widget va dans Widgets', () => {
		expect(categoriesOf(entry({ surfaces: ['widget'] }))).toEqual(['widgets'])
	})

	it('une page va dans Modules', () => {
		expect(categoriesOf(entry({ surfaces: ['page'] }))).toEqual(['modules'])
	})

	it('une extension mixte apparait dans LES DEUX', () => {
		// C'est voulu : il n'y a pas de type global, donc pas de choix arbitraire
		// a faire pour une extension qui expose une page et deux widgets.
		expect(categoriesOf(entry({ surfaces: ['widget', 'page'] }))).toEqual(['widgets', 'modules'])
	})
})

describe('classement editorial, jamais une note deguisee', () => {
	it('les officielles d abord', () => {
		const tiers = entry({ id: 'tiers', official: false })
		const ordered = defaultOrder([tiers, entry()])
		expect(ordered[0].id).toBe('next-event')
	})

	it('puis les plus recemment mises a jour', () => {
		const vieux = entry({ id: 'vieux', versions: [{ ...entry().versions[0], publishedAt: '2020-01-01T00:00:00.000Z' }] })
		expect(defaultOrder([vieux, entry()])[0].id).toBe('next-event')
	})

	it('a egalite, ordre alphabetique et non aleatoire', () => {
		const b = entry({ id: 'bravo', label: 'Bravo' })
		const a = entry({ id: 'alpha', label: 'Alpha' })
		expect(defaultOrder([b, a]).map(e => e.id)).toEqual(['alpha', 'bravo'])
	})
})

describe('recherche et filtres', () => {
	const set = [
		entry(),
		entry({
			id: 'library', label: 'Médiathèque', surfaces: ['page'], official: false, locales: ['fr'],
			// Description PROPRE : sans elle, l'entree heritait de celle de
			// next-event et matchait ses mots, ce qui rendait le test faux.
			description: 'Des films choisis à la main, une phrase par film.',
		}),
	]

	it('filtre par categorie', () => {
		expect(filterEntries(set, { category: 'modules' }).map(e => e.id)).toEqual(['library'])
	})

	it('filtre par langue livree', () => {
		expect(filterEntries(set, { locale: 'en' }).map(e => e.id)).toEqual(['next-event'])
	})

	it('filtre les officielles', () => {
		expect(filterEntries(set, { official: false }).map(e => e.id)).toEqual(['library'])
	})

	it('cherche dans le nom, la description et l auteur', () => {
		expect(filterEntries(set, { q: 'médiath' }).map(e => e.id)).toEqual(['library'])
		expect(filterEntries(set, { q: 'rebours' }).map(e => e.id)).toEqual(['next-event'])
		expect(filterEntries(set, { q: 'NODYX' }).length).toBe(2)
	})

	it('rend tout sans filtre, dans l ordre par defaut', () => {
		expect(filterEntries(set).map(e => e.id)).toEqual(['next-event', 'library'])
	})
})

describe('index servi aux instances', () => {
	it('porte la meme donnee et le meme ordre que le site', () => {
		// Une divergence entre ce qu'un humain lit et ce qu'une machine
		// telecharge serait le pire defaut possible pour un magasin.
		const idx = buildIndex([entry({ id: 'library', official: false }), entry()], '2026-08-14T12:00:00.000Z')
		expect(idx.index).toBe(INDEX_VERSION)
		expect(idx.generatedAt).toBe('2026-08-14T12:00:00.000Z')
		expect(idx.extensions.map(e => e.id)).toEqual(defaultOrder(idx.extensions).map(e => e.id))
		expect(idx.extensions[0].id).toBe('next-event')
	})
})
