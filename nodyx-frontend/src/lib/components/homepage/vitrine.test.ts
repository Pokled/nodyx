import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import fr from '$lib/locales/fr.json'
import en from '$lib/locales/en.json'
import { safeHref } from './widgets/vitrineUrls'
import { K, VITRINE_SCHEMA, MAX_TILES, normalizeVitrine, vitrineAnatomy } from './plugins/vitrineSchema'

describe('bloc Vitrine', () => {
	it('son identifiant est réservé côté cœur : aucune extension ne peut le prendre', () => {
		const coeur = readFileSync(resolve(__dirname, '../../../../../nodyx-core/src/extensions/reserved.ts'), 'utf-8')
		expect(coeur).toContain("'vitrine',")
	})

	it('chaque libellé, aide et exemple (affiches comprises) est une clé traduite en français ET en anglais', () => {
		const tous = (fs: typeof VITRINE_SCHEMA): string[] => fs.flatMap(f => [f.label, f.hint, f.placeholder, f.example, ...tous(f.fields ?? [])].filter((x): x is string => !!x))
		const textes = [`${K}label`, `${K}desc`, ...tous(VITRINE_SCHEMA), ...vitrineAnatomy().flatMap(l => [l.labelKey, l.textKey])]
		expect(textes.length).toBeGreaterThan(20)
		for (const k of textes) {
			expect(k.startsWith('hpw.vitrine.'), k).toBe(true)
			expect((fr as Record<string, string>)[k], k).toBeTruthy()
			expect((en as Record<string, string>)[k], k).toBeTruthy()
		}
	})

	it('les images se choisissent dans la médiathèque et les liens parmi les pages (plus aucune adresse tapée)', () => {
		const types = (fs: typeof VITRINE_SCHEMA): string[] => fs.flatMap(f => [f.type, ...types(f.fields ?? [])])
		expect(types(VITRINE_SCHEMA)).not.toContain('url')
		expect(types(VITRINE_SCHEMA)).not.toContain('image')
		expect(VITRINE_SCHEMA.find(f => f.key === 'tiles')?.maxItems).toBe(MAX_TILES)
	})

	it.each([
		['javascript:alert(1)', ''], ['data:text/html,x', ''], ['//evil.example', ''], ['/\\evil.example', ''],
		['http://exemple.org', ''], ['/../admin', ''], ['  /forum  ', '/forum'], ['/forum?tag=jeux#haut', '/forum?tag=jeux#haut'],
		['https://exemple.org/a b', 'https://exemple.org/a%20b'], [42, ''],
	] as const)('lien %s → « %s »', (entree, attendu) => {
		expect(safeHref(entree)).toBe(attendu)
	})

	// La vitrine publiée de Polygone, relevée le 27/11 (format à plat d'avant le lot L1c)
	const PUBLIEE = {
		img1: 'https://polygone.nodyx.org/uploads/assets/a.webp', img2: 'https://polygone.nodyx.org/uploads/assets/b.webp', img3: 'https://polygone.nodyx.org/uploads/assets/c.webp',
		text: 'Jeux, modèles 3D…', title: 'Montre ce que tu crées.', cta_url: '/forum/presente-ton-projet', cta2_url: '/forum',
		cta_text: 'Présenter mon projet', cta2_text: 'Explorer le forum', img1_link: '', img2_link: '', img3_link: '',
		img1_badge: 'Création de la semaine', img1_title: 'Cartouche', img2_title: 'Orbe', img3_title: 'Pastel',
		img1_kicker: 'Atelier Rémanence', img2_kicker: 'Shader Godot', img3_kicker: 'Pack 3D libre',
	}

	it('une vitrine à l’ancien format se lit comme une liste d’affiches, sans rien perdre', () => {
		const n = normalizeVitrine(PUBLIEE)
		expect(n.tiles).toEqual([
			{ img: PUBLIEE.img1, kicker: 'Atelier Rémanence', title: 'Cartouche', link: '' },
			{ img: PUBLIEE.img2, kicker: 'Shader Godot', title: 'Orbe', link: '' },
			{ img: PUBLIEE.img3, kicker: 'Pack 3D libre', title: 'Pastel', link: '' },
		])
		expect(n.badge).toBe('Création de la semaine')
		expect(n.title).toBe('Montre ce que tu crées.')
		expect(n.cta_url).toBe('/forum/presente-ton-projet')
		expect(Object.keys(n).filter(k => /^img\d/.test(k))).toEqual([])          // plus de clés à plat
	})

	it('déjà sous forme de liste : rendue telle quelle, et deux passages donnent le même résultat', () => {
		const n = normalizeVitrine(PUBLIEE)
		expect(normalizeVitrine(n)).toBe(n)
		expect(normalizeVitrine({ title: 'x' })).toEqual({ title: 'x', tiles: [], badge: '' })
	})

	it('une image à plat vide ne devient pas une affiche', () => {
		expect((normalizeVitrine({ img1: '', img1_title: 'Rien', img2: '/uploads/b.webp' }).tiles as unknown[]).length).toBe(1)
	})
})
