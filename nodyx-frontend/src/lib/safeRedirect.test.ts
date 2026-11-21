import { describe, it, expect } from 'vitest'
import { safeInternalPath } from './safeRedirect'

describe('safeInternalPath : on ne suit que les chemins de l’instance', () => {
	it('garde les chemins internes ordinaires', () => {
		for (const p of ['/', '/chat', '/charter', '/forum/moteurs/123', '/calendar/42/edit', '/admin/octoguard?tab=rules', '/search?q=godot%20shader', '/wiki/page#titre'])
			expect(safeInternalPath(p)).toBe(p)
	})

	it('refuse les adresses qui sortent du site', () => {
		for (const p of ['https://site-pirate.example', 'http://site-pirate.example/chat', '//site-pirate.example', '///site-pirate.example', 'site-pirate.example'])
			expect(safeInternalPath(p)).toBe('/')
	})

	it('refuse l’antislash, que les navigateurs lisent comme un « / »', () => {
		for (const p of ['/\\site-pirate.example', '/\\/site-pirate.example', '/chat\\..\\'])
			expect(safeInternalPath(p)).toBe('/')
	})

	it('refuse le code (javascript:, data:) même déguisé', () => {
		for (const p of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '/x"><script>'])
			expect(safeInternalPath(p)).toBe('/')
	})

	it('refuse les blancs et caractères de contrôle que le navigateur effacerait', () => {
		for (const p of [' /chat', '/\t/site-pirate.example', '/\n/site-pirate.example', '/chat\u0000', '/chat ', ' /chat'])
			expect(safeInternalPath(p)).toBe('/')
	})

	it('refuse ce qui n’est pas une chaîne, ou trop long', () => {
		for (const p of [null, undefined, 42, {}, ['/chat'], '/' + 'a'.repeat(2048)])
			expect(safeInternalPath(p)).toBe('/')
	})

	it('rend la valeur de repli choisie', () => {
		expect(safeInternalPath('https://site-pirate.example', '/chat')).toBe('/chat')
	})
})
