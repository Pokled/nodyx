import { describe, it, expect } from 'vitest'
import { outline, OUTLINE_MIN } from './outline'
import { signaturePath } from './signature'

describe('le sommaire se fait tout seul depuis les titres', () => {
	const html = '<h2 data-color="green">Le respect</h2><p>On se parle bien.</p><h2 data-color="blue">Pas de <strong>spam</strong></h2><h2>Toi &amp; nous</h2>'
	it('chaque titre devient une entrée, dans l’ordre, avec sa couleur', () => {
		expect(outline(html).items).toEqual([
			{ id: 'regle-1', text: 'Le respect', color: 'green' },
			{ id: 'regle-2', text: 'Pas de spam', color: 'blue' },
			{ id: 'regle-3', text: 'Toi & nous', color: null },
		])
	})
	it('chaque titre reçoit son ancre et peut recevoir le focus du clavier', () => {
		const h = outline(html).html
		expect(h).toContain('<h2 id="regle-1" tabindex="-1" data-color="green">Le respect</h2>')
		expect(h).toContain('<h2 id="regle-3" tabindex="-1">Toi &amp; nous</h2>')
		expect(h).toContain('<p>On se parle bien.</p>')
	})
	it('une couleur inconnue n’est pas reprise ; un titre vide n’entre pas au sommaire', () => {
		const r = outline('<h2 data-color="pink">A</h2><h2> </h2>')
		expect(r.items).toEqual([{ id: 'regle-1', text: 'A', color: null }])
	})
	it('pas de titre : pas de sommaire, le texte est rendu tel quel', () => {
		expect(outline('<p>Une seule règle.</p>')).toEqual({ html: '<p>Une seule règle.</p>', items: [] })
		expect(OUTLINE_MIN).toBe(3)
	})
	it('un titre écrit pour piéger reste du texte (le HTML vient déjà nettoyé du serveur)', () => {
		const r = outline('<h2>&lt;img src=x onerror=alert(1)&gt;</h2>')
		expect(r.items[0].text).toBe('<img src=x onerror=alert(1)>')
		expect(r.html).toContain('&lt;img')
	})
	it('un texte énorme passe vite (pas de retour arrière)', () => {
		const big = '<h2>' + 'a'.repeat(400_000) + '</h2>' + '<p>x</p>'.repeat(20_000)
		const t = performance.now(); outline(big); expect(performance.now() - t).toBeLessThan(300)
	})
})

describe('la signature se réécrit', () => {
	it('rien de tracé : rien à rejouer', () => {
		expect(signaturePath([])).toBe('')
		expect(signaturePath([[]])).toBe('')
	})
	it('le tracé est recadré dans la boîte, sans déformation, centré', () => {
		const d = signaturePath([[{ x: 100, y: 50 }, { x: 300, y: 50 }, { x: 300, y: 100 }]], { w: 280, h: 92, pad: 6 })
		// 200 x 50 dans 268 x 80 : facteur 1.34, centré
		expect(d).toBe('M6 12.5 L274 12.5 L274 79.5')
	})
	it('plusieurs traits restent séparés (un M par trait)', () => {
		const d = signaturePath([[{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 20, y: 0 }, { x: 30, y: 10 }]])
		expect(d.match(/M/g)).toHaveLength(2)
	})
})
