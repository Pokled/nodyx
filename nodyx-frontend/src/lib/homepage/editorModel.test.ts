import { describe, it, expect } from 'vitest'
import type { GridLayout } from '$lib/types/homepage'
import {
	toBlocks, toLayout, groupRows, widthOf, setSpan, removeBlock, insertIntoEmpty,
	insertRowAfter, moveBlock, duplicateBlock, type EditorBlock,
} from './editorModel'

const ids = () => { let n = 0; return () => `n${++n}` }
const col = (id: string, span: number, widget: string | null, extra: Record<string, unknown> = {}) =>
	({ id, span, widget, config: widget ? { titre: `bloc ${id}` } : {}, ...extra })

// La forme des pages réellement publiées le 21/11 (nodyx.org : 8+4, 12, 7+5 ; vieuxlooters :
// span_md), plus les cas que le format permet : colonne vide, titre, masquages, fond de rangée.
const PAGE: GridLayout = {
	rows: [
		{ id: 'r1', gap: '1rem', padding_y: '2rem', columns: [col('a', 8, 'hero-banner'), col('b', 4, 'join-card', { title: 'Rejoindre' })] },
		{ id: 'r2', gap: '0', padding_y: '1rem', bg_override: '#101418', columns: [col('c', 12, 'stats-bar', { span_md: 12, span_sm: 12 })] },
		{ id: 'r3', gap: '2rem', padding_y: '3rem', columns: [col('d', 7, 'recent-threads', { hide_mobile: true }), col('e', 5, 'twitch-stream')] },
		{ id: 'r4', gap: '1rem', padding_y: '2rem', columns: [col('f', 6, 'announcement-banner'), col('g', 6, null)] },
	],
}
const widgets = (bs: EditorBlock[]) => bs.filter(b => b.widget).map(b => `${b.id}:${b.span}`)
const shape = (bs: EditorBlock[]) => groupRows(bs).map(r => r.map(b => `${b.widget ? b.id : '·'}${b.span}`).join('+'))

describe('le format enregistré ne change pas', () => {
	it('page → blocs → page redonne la page à l’identique', () => {
		expect(toLayout(toBlocks(PAGE))).toEqual(PAGE)
	})

	it('un aller-retour ne touche pas à la page d’origine (pas de partage de références)', () => {
		const avant = structuredClone(PAGE)
		const bs = toBlocks(PAGE)
		bs[0].config.titre = 'modifié'; bs[0].extra.title = 'x'; bs[0].row.gap = '9rem'
		expect(PAGE).toEqual(avant)
	})

	it('une page vide ou absente donne une liste vide, et inversement', () => {
		expect(toBlocks({ rows: [] })).toEqual([])
		expect(toBlocks(undefined as unknown as GridLayout)).toEqual([])
		expect(toLayout([])).toEqual({ rows: [] })
	})

	it('chaque bloc garde sa rangée', () => {
		expect(shape(toBlocks(PAGE))).toEqual(['a8+b4', 'c12', 'd7+e5', 'f6+·6'])
	})
})

describe('les largeurs en mots', () => {
	it('12, 8, 6, 4 ont un nom ; le reste est « sur mesure » et reste intact', () => {
		expect([12, 8, 6, 4].map(widthOf)).toEqual(['full', 'two_thirds', 'half', 'third'])
		expect([7, 5, 3, 1].map(widthOf)).toEqual(['custom', 'custom', 'custom', 'custom'])
	})
})

describe('changer la largeur', () => {
	it('plus étroit : le bloc garde sa largeur, la place libérée devient libre (R4)', () => {
		const bs = setSpan(toBlocks(PAGE), 'c', 6, ids())
		expect(shape(bs)).toEqual(['a8+b4', 'c6+·6', 'd7+e5', 'f6+·6'])
	})

	it('plus large dans une rangée qui a de la place libre : la place libre se réduit', () => {
		const bs = setSpan(toBlocks(PAGE), 'f', 8, ids())
		expect(shape(bs)).toEqual(['a8+b4', 'c12', 'd7+e5', 'f8+·4'])
	})

	it('trop large pour sa rangée : le bloc descend sur sa propre rangée, l’ancienne se complète', () => {
		const bs = setSpan(toBlocks(PAGE), 'b', 8, ids())
		expect(shape(bs)).toEqual(['a8+·4', 'b8+·4', 'c12', 'd7+e5', 'f6+·6'])
		const L = toLayout(bs, ids())
		expect(new Set(L.rows.map(r => r.id)).size).toBe(L.rows.length)
	})

	it('chaque rangée fait toujours 12', () => {
		let bs = toBlocks(PAGE)
		for (const [id, s] of [['a', 4], ['c', 3], ['d', 12], ['f', 12], ['b', 6]] as const) bs = setSpan(bs, id, s, ids())
		for (const r of toLayout(bs).rows) expect(r.columns.reduce((t, c) => t + c.span, 0)).toBe(12)
	})

	it('une largeur hors bornes est ramenée entre 1 et 12', () => {
		expect(widgets(setSpan(toBlocks(PAGE), 'c', 40, ids()))).toContain('c:12')
		expect(widgets(setSpan(toBlocks(PAGE), 'c', -3, ids()))).toContain('c:1')
	})

	it('les réglages de colonne et de rangée sont gardés', () => {
		const bs = setSpan(toBlocks(PAGE), 'd', 6, ids())
		const d = bs.find(b => b.id === 'd')!
		expect(d.extra.hide_mobile).toBe(true)
		expect(d.row.gap).toBe('2rem')
	})
})

describe('ajouter, retirer, déplacer, dupliquer', () => {
	it('ajouter dans une place libre : le bloc en prend la largeur exacte', () => {
		const bs = insertIntoEmpty(toBlocks(PAGE), 'g', { widget: 'agenda', config: { nombre: 3 } }, ids())
		expect(shape(bs)).toEqual(['a8+b4', 'c12', 'd7+e5', 'f6+n16'])
		expect(bs.find(b => b.id === 'n1')!.config).toEqual({ nombre: 3 })
	})

	it('ajouter ailleurs que dans une place libre ne fait rien', () => {
		const avant = toBlocks(PAGE)
		expect(insertIntoEmpty(avant, 'a', { widget: 'agenda', config: {} }, ids())).toEqual(avant)
	})

	it('ajouter une rangée après un bloc, ou tout en haut', () => {
		expect(shape(insertRowAfter(toBlocks(PAGE), 'b', { widget: 'agenda', config: {} }, ids()))).toEqual(['a8+b4', 'n112', 'c12', 'd7+e5', 'f6+·6'])
		expect(shape(insertRowAfter(toBlocks(PAGE), null, { widget: 'agenda', config: {} }, ids()))[0]).toBe('n112')
		expect(shape(insertRowAfter(toBlocks(PAGE), 'g', { widget: 'agenda', config: {}, span: 6 }, ids())).slice(-1)[0]).toBe('n16+·6')
	})

	it('retirer : les voisins restent, la place devient libre ; une rangée vide disparaît', () => {
		expect(shape(removeBlock(toBlocks(PAGE), 'e', ids()))).toEqual(['a8+b4', 'c12', 'd7+·5', 'f6+·6'])
		expect(shape(removeBlock(toBlocks(PAGE), 'c', ids()))).toEqual(['a8+b4', 'd7+e5', 'f6+·6'])
		expect(shape(removeBlock(toBlocks(PAGE), 'f', ids()))).toEqual(['a8+b4', 'c12', 'd7+e5'])
	})

	it('monter un bloc seul dans sa rangée déplace toute la rangée', () => {
		expect(shape(moveBlock(toBlocks(PAGE), 'c', -1))).toEqual(['c12', 'a8+b4', 'd7+e5', 'f6+·6'])
		expect(shape(moveBlock(toBlocks(PAGE), 'f', -1))).toEqual(['a8+b4', 'c12', 'f6+·6', 'd7+e5'])
	})

	it('avec des voisins, le bloc échange sa place dans la rangée ; au bord, rien ne bouge', () => {
		expect(shape(moveBlock(toBlocks(PAGE), 'b', -1))).toEqual(['b4+a8', 'c12', 'd7+e5', 'f6+·6'])
		expect(moveBlock(toBlocks(PAGE), 'a', -1)).toEqual(toBlocks(PAGE))
		expect(moveBlock(toBlocks(PAGE), 'f', 1)).toEqual(toBlocks(PAGE))
	})

	it('un bloc déplacé garde ses réglages, et la page reste enregistrable', () => {
		const bs = moveBlock(toBlocks(PAGE), 'd', 1)
		expect(bs.find(b => b.id === 'd')!.extra.hide_mobile).toBe(true)
		for (const r of toLayout(bs).rows) expect(r.columns.reduce((t, c) => t + c.span, 0)).toBe(12)
	})

	it('dupliquer : une copie indépendante, juste en dessous, à la même largeur', () => {
		const bs = duplicateBlock(toBlocks(PAGE), 'd', ids())
		expect(shape(bs)).toEqual(['a8+b4', 'c12', 'd7+e5', 'n17+·5', 'f6+·6'])
		bs.find(b => b.id === 'n1')!.config.titre = 'copie'
		expect(bs.find(b => b.id === 'd')!.config.titre).toBe('bloc d')
	})

	it('un identifiant inconnu ne change rien', () => {
		const bs = toBlocks(PAGE)
		for (const f of [() => setSpan(bs, 'zz', 6), () => removeBlock(bs, 'zz'), () => moveBlock(bs, 'zz', 1), () => duplicateBlock(bs, 'zz'), () => duplicateBlock(bs, 'g')])
			expect(f()).toBe(bs)
	})
})
