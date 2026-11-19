import { describe, it, expect } from 'vitest'
import fr from '$lib/locales/fr.json'
import en from '$lib/locales/en.json'
import { topLevelBlocks, prettyBlock, highlight, blockCode, templateHtml, tokens, BLOCK_KINDS, TEMPLATES, PALETTE, GROUPS, kindOfNode } from './blocks'

// Un tFn minimal, comme celui de l'application ({{x}} remplacés)
const tr = (dict: Record<string, string>) => (key: string, vars: Record<string, string> = {}) =>
	(dict[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '')
const tFr = tr(fr as Record<string, string>)
const tEn = tr(en as Record<string, string>)

describe('le code source, un bloc par ligne', () => {
	it('coupe un document en ses blocs de premier niveau', () => {
		const html = '<figure class="nx-banner"><img src="/biomes/fr-1.webp" alt="x"><figcaption>Salut</figcaption></figure><h2 data-color="green">A</h2><p>b <strong>c</strong></p><hr><ul><li><p>1</p></li></ul><img src="/biomes/es-1.webp" alt="y">'
		expect(topLevelBlocks(html)).toEqual([
			'<figure class="nx-banner"><img src="/biomes/fr-1.webp" alt="x"><figcaption>Salut</figcaption></figure>',
			'<h2 data-color="green">A</h2>', '<p>b <strong>c</strong></p>', '<hr>', '<ul><li><p>1</p></li></ul>', '<img src="/biomes/es-1.webp" alt="y">',
		])
	})
	it('une liste et une bannière se lisent ligne par ligne', () => {
		expect(prettyBlock('<ul><li>a</li><li>b</li></ul>')).toBe('<ul>\n  <li>a</li>\n  <li>b</li>\n</ul>')
		expect(prettyBlock('<figure class="nx-banner"><img src="x"><figcaption>t</figcaption></figure>')).toBe('<figure class="nx-banner">\n  <img src="x">\n  <figcaption>t</figcaption>\n</figure>')
	})
	it('la coloration échappe tout : un texte piégé reste du texte', () => {
		const out = highlight('<p>{pseudo} <img src=x onerror=alert(1)></p>')
		expect(out).not.toMatch(/<img|<p>/)
		expect(out).toContain('<span class="vr">{pseudo}</span>')
		expect(out).toContain('<span class="tg">p</span>')
	})
})

describe('les blocs et les modèles', () => {
	it('chaque bloc a un nom, ce qu\'il fait, comment l\'avoir, en français et en anglais', () => {
		for (const k of BLOCK_KINDS) for (const f of ['name', 'what', 'how']) {
			expect((fr as Record<string, string>)[`chb.${k}_${f}`], `fr chb.${k}_${f}`).toBeTruthy()
			expect((en as Record<string, string>)[`chb.${k}_${f}`], `en chb.${k}_${f}`).toBeTruthy()
		}
		expect(PALETTE.every(k => BLOCK_KINDS.includes(k))).toBe(true)
		expect(GROUPS.flatMap(g => g[1]).sort()).toEqual([...BLOCK_KINDS].sort())
	})
	it('les variables suivent la langue de qui écrit', () => {
		expect(tokens(tFr)).toEqual({ community: '{communauté}', user: '{pseudo}' })
		expect(tokens(tEn)).toEqual({ community: '{community}', user: '{username}' })
		expect(blockCode('lead', tFr)).toBe('<p class="lead">Salut {pseudo} ! Content de te voir ici.</p>')
	})
	it('chaque modèle est prêt à allumer : une bannière, au moins trois règles', () => {
		for (const id of TEMPLATES) for (const aud of ['members', 'team'] as const) for (const t of [tFr, tEn]) {
			const html = templateHtml(id, aud, t)
			expect(html, `${id}/${aud}`).toMatch(/^<figure class="nx-banner"><img src="\/biomes\/[a-zA-Z-]+-\d\.webp" alt="[^"]+"><figcaption>[^<]+<\/figcaption><\/figure>/)
			expect((html.match(/<h2 data-color="(green|blue|violet|orange|red)">/g) ?? []).length, `${id}/${aud}`).toBeGreaterThanOrEqual(3)
			expect(html, `${id}/${aud}`).not.toMatch(/chtpl\.|\{\{/)   // aucune clé ni marque oubliée
		}
	})
	it('un texte de traduction piégé reste du texte dans un modèle', () => {
		const evil = (key: string) => (key === 'chtpl.ex_h1' ? '<img src=x onerror=alert(1)>' : tFr(key))
		expect(templateHtml('example', 'members', evil)).toContain('&lt;img src=x onerror=alert(1)&gt;')
	})
	it('les nœuds de l\'éditeur retrouvent leur bloc', () => {
		expect(kindOfNode('charterBanner')).toBe('banner')
		expect(kindOfNode('heading')).toBe('title')
		expect(kindOfNode('charterCallout')).toBe('callout')
		expect(kindOfNode('paragraph')).toBe('text')
	})
})
