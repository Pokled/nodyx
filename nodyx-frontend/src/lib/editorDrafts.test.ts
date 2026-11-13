import { describe, it, expect, beforeEach } from 'vitest'
import { draftKey, hasContent, readDraft, writeDraft, removeDraft, clearAllDrafts } from './editorDrafts'

// localStorage minimal (l'environnement de test n'en a pas forcément)
class MemStorage {
	private m = new Map<string, string>()
	get length() { return this.m.size }
	key(i: number) { return [...this.m.keys()][i] ?? null }
	getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null }
	setItem(k: string, v: string) { this.m.set(k, String(v)) }
	removeItem(k: string) { this.m.delete(k) }
	clear() { this.m.clear() }
}

beforeEach(() => { (globalThis as any).localStorage = new MemStorage() })

describe('brouillons de l’éditeur', () => {
	const K = draftKey('/forum/general/new', 'content')

	it('un brouillon écrit se relit', () => {
		writeDraft(K, '<p>Bonjour</p>', 1000)
		expect(readDraft(K, 2000)).toEqual({ html: '<p>Bonjour</p>', at: 1000 })
	})

	it('un éditeur vidé efface le brouillon (rien à proposer)', () => {
		writeDraft(K, '<p>Bonjour</p>')
		writeDraft(K, '<p></p>')
		expect(readDraft(K)).toBeNull()
	})

	it('une image seule compte comme un contenu', () => {
		expect(hasContent('<p><img src="/uploads/a.webp"></p>')).toBe(true)
		expect(hasContent('<p>&nbsp;</p>')).toBe(false)
	})

	it('expire au bout de 7 jours', () => {
		writeDraft(K, '<p>vieux</p>', 0)
		expect(readDraft(K, 8 * 24 * 3600 * 1000)).toBeNull()
		expect((globalThis as any).localStorage.getItem(K)).toBeNull()
	})

	it('un brouillon abîmé est ignoré et nettoyé', () => {
		;(globalThis as any).localStorage.setItem(K, '{pas du json')
		expect(readDraft(K)).toBeNull()
	})

	it('la déconnexion efface TOUS les brouillons, et rien d’autre', () => {
		writeDraft(draftKey('/a', 'content'), '<p>a</p>')
		writeDraft(draftKey('/b', 'content'), '<p>b</p>')
		;(globalThis as any).localStorage.setItem('nodyx_locale', 'fr')
		;(globalThis as any).localStorage.setItem('nodyx_peek:conv-1', '1')
		clearAllDrafts()
		expect((globalThis as any).localStorage.getItem('nodyx_peek:conv-1')).toBeNull()
		expect(readDraft(draftKey('/a', 'content'))).toBeNull()
		expect(readDraft(draftKey('/b', 'content'))).toBeNull()
		expect((globalThis as any).localStorage.getItem('nodyx_locale')).toBe('fr')
	})

	it('stockage interdit (navigation privée) : aucune erreur, juste pas de brouillon', () => {
		;(globalThis as any).localStorage = { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') }, removeItem() { throw new Error('denied') }, key() { throw new Error('denied') }, length: 0 }
		expect(() => writeDraft(K, '<p>x</p>')).not.toThrow()
		expect(readDraft(K)).toBeNull()
		expect(() => removeDraft(K)).not.toThrow()
		expect(() => clearAllDrafts()).not.toThrow()
	})
})
