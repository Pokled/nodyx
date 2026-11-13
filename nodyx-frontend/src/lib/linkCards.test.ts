import { describe, it, expect } from 'vitest'
import { toInternalPath, findInternalLinks, isSoleLink, setCardOff, MAX_CARDS } from './linkCards'

const O = 'https://communaute.example'
const E = '33333333-3333-4333-8333-333333333333'
const P = '22222222-2222-4222-8222-222222222222'

describe('reconnaître un lien Nodyx (même liste que le cœur)', () => {
	it.each([
		['/forum/jeux/quokka-ab12', '/forum/jeux/quokka-ab12'],
		[`/forum/jeux/quokka-ab12#post-${P}`, `/forum/jeux/quokka-ab12#post-${P}`],
		[`${O}/calendar/${E}`, `/calendar/${E}`],
		[`${O}/calendar/${E}/`, `/calendar/${E}`],
		[`/forum/jeux/quokka-ab12#autre-ancre`, '/forum/jeux/quokka-ab12'],
	])('%s', (href, expected) => expect(toInternalPath(href, O)).toBe(expected))

	it.each([
		`https://autre.example/calendar/${E}`, `//autre.example/calendar/${E}`, 'javascript:alert(1)',
		'/forum/jeux', '/admin/members', `https://x:y@communaute.example/calendar/${E}`, '/calendar/pas-un-id',
	])('pas une carte : %s', href => expect(toInternalPath(href, O)).toBeNull())
})

describe('les liens d’un message', () => {
	it('liens et adresses en clair, dans l’ordre, sans doublon', () => {
		const html = `<p>Voir <a href="/forum/jeux/a-1">le sujet</a> et ${O}/calendar/${E}. Encore <a href="/forum/jeux/a-1">lui</a></p>`
		expect(findInternalLinks(html, O)).toEqual(['/forum/jeux/a-1', `/calendar/${E}`])
	})

	it(`D41 : ${MAX_CARDS} cartes au plus, les autres restent des liens`, () => {
		const html = Array.from({ length: 6 }, (_, i) => `<a href="/forum/jeux/s-${i}">s${i}</a>`).join(' ')
		expect(findInternalLinks(html, O)).toEqual(['/forum/jeux/s-0', '/forum/jeux/s-1', '/forum/jeux/s-2'])
	})

	it('D43 : un lien marqué data-card="off" n’a pas de carte, même répété en clair', () => {
		const html = `<p><a href="/calendar/${E}" data-card="off">soirée</a> ${O}/calendar/${E} <a href="/forum/jeux/b-2">b</a></p>`
		expect(findInternalLinks(html, O)).toEqual(['/forum/jeux/b-2'])
	})

	it('une adresse DANS le texte d’un lien externe ne compte pas deux fois', () => {
		expect(findInternalLinks(`<a href="https://autre.example">${O}/calendar/${E}</a>`, O)).toEqual([])
	})

	it('un long message hostile se lit vite (un seul passage)', () => {
		const html = '<a href="' + 'x'.repeat(200_000) + '<p>' + 'https://a'.repeat(50_000)
		const t = performance.now(); findInternalLinks(html, O); isSoleLink(html, O)
		expect(performance.now() - t).toBeLessThan(500)
	})
})

describe('D40 : un message qui n’est QUE le lien', () => {
	it.each([
		[`<p><a href="/calendar/${E}">Soirée de lancement</a></p>`, true],
		[`<p>${O}/calendar/${E}</p>`, true],
		[`<p> <a href="${O}/forum/jeux/a-1">${O}/forum/jeux/a-1</a>&nbsp;</p>`, true],
		[`<p>Venez : <a href="/calendar/${E}">soirée</a></p>`, false],
		[`<p><a href="/calendar/${E}">a</a> <a href="/forum/jeux/a-1">b</a></p>`, false],
		[`<p><a href="/calendar/${E}">a</a></p><p><img src="/uploads/x.webp"></p>`, false],
		[`<p><a href="https://autre.example">x</a></p>`, false],
		[`<p><a href="/calendar/${E}" data-card="off">soirée</a></p>`, false],
	])('%s → %s', (html, expected) => expect(isSoleLink(html, O)).toBe(expected))
})

describe('D43 : retirer / remettre la carte', () => {
	it('un lien est marqué, puis démarqué, le reste du message intact', () => {
		const html = `<p>Voir <a href="/calendar/${E}">la soirée</a> et <strong>vite</strong></p>`
		const off = setCardOff(html, `/calendar/${E}`, true, O)
		expect(off).toContain('data-card="off"')
		expect(off).toContain('<strong>vite</strong>')
		expect(findInternalLinks(off, O)).toEqual([])
		const back = setCardOff(off, `/calendar/${E}`, false, O)
		expect(back).not.toContain('data-card')
		expect(findInternalLinks(back, O)).toEqual([`/calendar/${E}`])
	})

	it('une adresse en clair devient un lien marqué, le texte autour reste', () => {
		const off = setCardOff(`<p>Ici : ${O}/calendar/${E}, merci</p>`, `/calendar/${E}`, true, O)
		expect(off).toBe(`<p>Ici : <a href="${O}/calendar/${E}" data-card="off">${O}/calendar/${E}</a>, merci</p>`)
	})

	it('un lien déjà marqué n’est pas marqué deux fois', () => {
		const once = setCardOff(`<a href="/calendar/${E}">a</a>`, `/calendar/${E}`, true, O)
		expect(setCardOff(once, `/calendar/${E}`, true, O)).toBe(once)
		expect(once).toBe(`<a href="/calendar/${E}" data-card="off">a</a>`)
	})

	it('seul le lien visé est touché', () => {
		const off = setCardOff(`<p><a href="/calendar/${E}">a</a> <a href="/forum/jeux/a-1">b</a></p>`, '/forum/jeux/a-1', true, O)
		expect(findInternalLinks(off, O)).toEqual([`/calendar/${E}`])
	})
})
