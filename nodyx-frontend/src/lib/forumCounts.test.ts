import { describe, it, expect } from 'vitest'
import { replyCount, isUnanswered } from './forumCounts'

describe('replyCount', () => {
	// Le cas exact rapporté : un sujet ouvert, aucune réponse, affichait
	// « 1 réponse ». Ce test TOMBE sur l'ancien code (qui rendait post_count tel quel).
	it('un sujet avec le seul message d ouverture a ZERO reponse', () => {
		expect(replyCount(1)).toBe(0)
	})

	it('retranche toujours le message d ouverture', () => {
		expect(replyCount(2)).toBe(1)
		expect(replyCount(10)).toBe(9)
		expect(replyCount(45)).toBe(44)
	})

	// Le premier message n'est pas protégé contre la suppression : un sujet peut
	// tomber à 0 message. Sans la borne, l'écran afficherait « -1 réponse ».
	it('ne descend jamais sous zero', () => {
		expect(replyCount(0)).toBe(0)
		expect(replyCount(-5)).toBe(0)
	})

	it('traite l absence de valeur comme zero', () => {
		expect(replyCount(null)).toBe(0)
		expect(replyCount(undefined)).toBe(0)
	})
})

describe('isUnanswered', () => {
	// La cause du filtre vide : la condition d origine etait `post_count === 0`,
	// qu AUCUN sujet ne pouvait satisfaire puisque tous portent leur ouverture.
	it('est vrai pour un sujet qui n a que son ouverture', () => {
		expect(isUnanswered(1)).toBe(true)
	})

	it('est faux des la premiere reponse', () => {
		expect(isUnanswered(2)).toBe(false)
		expect(isUnanswered(30)).toBe(false)
	})

	it('reste vrai pour un sujet vide ou une valeur absente', () => {
		expect(isUnanswered(0)).toBe(true)
		expect(isUnanswered(null)).toBe(true)
	})

	// Garde-fou de non-regression : sur les donnees reelles de nodyx.org au
	// 2026-08-14, 14 sujets sur 58 n avaient qu un seul message. Le filtre doit
	// les faire apparaitre, la ou il en montrait zero.
	it('selectionne bien les sujets a un seul message dans une liste', () => {
		const sujets = [{ post_count: 1 }, { post_count: 1 }, { post_count: 5 }, { post_count: 2 }]
		expect(sujets.filter(s => isUnanswered(s.post_count)).length).toBe(2)
	})
})
