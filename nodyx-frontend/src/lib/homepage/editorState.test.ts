import { describe, it, expect } from 'vitest'
import { historyStart, historyPush, historyUndo, historyRedo, HISTORY_LIMIT, publishStatus, blockTitle, structureBlocks, withHidden } from './editorState'
import { toBlocks, toLayout, type ColumnExtra } from './editorModel'
import type { GridLayout } from '$lib/types/homepage'

describe('annuler, rétablir (R3)', () => {
	it('un geste se défait puis se refait', () => {
		let h = historyStart(1)
		h = historyPush(h, 2)
		h = historyPush(h, 3)
		h = historyUndo(h); expect(h.present).toBe(2)
		h = historyUndo(h); expect(h.present).toBe(1)
		h = historyUndo(h); expect(h.present).toBe(1)          // rien de plus à défaire
		h = historyRedo(h); expect(h.present).toBe(2)
		h = historyRedo(h); expect(h.present).toBe(3)
		h = historyRedo(h); expect(h.present).toBe(3)
	})

	it('un nouveau geste après « annuler » efface ce qu’on pouvait rétablir', () => {
		let h = historyPush(historyPush(historyStart('a'), 'b'), 'c')
		h = historyUndo(h)
		h = historyPush(h, 'x')
		expect(h.future).toEqual([])
		expect(historyUndo(h).present).toBe('b')
	})

	it('une frappe continue ne fait qu’une étape', () => {
		let h = historyPush(historyStart(''), 'M')
		h = historyPush(h, 'Mo', true)
		h = historyPush(h, 'Mon', true)
		expect(historyUndo(h).present).toBe('')
	})

	it(`garde au moins ${HISTORY_LIMIT} gestes, et jamais une liste sans fin`, () => {
		let h = historyStart(0)
		for (let i = 1; i <= HISTORY_LIMIT + 30; i++) h = historyPush(h, i)
		expect(h.past.length).toBe(HISTORY_LIMIT)
		for (let i = 0; i < HISTORY_LIMIT; i++) h = historyUndo(h)
		expect(h.present).toBe(30)
	})
})

const PAGE: GridLayout = { rows: [
	{ id: 'r1', gap: '1rem', padding_y: '2rem', columns: [{ id: 'c1', span: 12, widget: 'vitrine', config: { title: '  Montre  ce que tu crées. ' } }] },
	{ id: 'r2', gap: '1rem', padding_y: '2rem', columns: [{ id: 'c2', span: 8, widget: 'recent-threads', config: {} }, { id: 'c3', span: 4, widget: null, config: {} }] },
] }

describe('l’état de la page', () => {
	it('sans version publiée : « Pas encore publiée »', () => {
		expect(publishStatus(PAGE, null)).toBe('unpublished')
		expect(publishStatus(PAGE, { rows: [] })).toBe('unpublished')
	})

	it('la page publiée relue telle quelle reste « Publiée » (aller-retour par l’éditeur)', () => {
		expect(publishStatus(toLayout(toBlocks(PAGE)), PAGE)).toBe('published')
	})

	it('la page enregistrée écrit ses clés dans un autre ordre : toujours « Publiée »', () => {
		// Ordre réel de la base : rangée { id, columns, gap… }, colonne { id, config, span, widget }
		const stored = { rows: PAGE.rows.map(r => ({ columns: r.columns.map(c => ({ config: c.config, widget: c.widget, span: c.span, id: c.id })), padding_y: r.padding_y, gap: r.gap, id: r.id })) } as GridLayout
		expect(publishStatus(toLayout(toBlocks(stored)), stored)).toBe('published')
	})

	it('un réglage changé : « Modifiée »', () => {
		const b = toBlocks(PAGE)
		b[0].config = { title: 'Autre' }
		expect(publishStatus(toLayout(b), PAGE)).toBe('modified')
	})
})

describe('la Structure', () => {
	it('montre le titre écrit dans le bloc, sur une ligne', () => {
		const b = toBlocks(PAGE)
		expect(blockTitle(b[0])).toBe('Montre ce que tu crées.')
		expect(blockTitle(b[1])).toBe('')
	})

	it('ne montre pas les places libres', () => {
		expect(structureBlocks(toBlocks(PAGE)).map(b => b.widget)).toEqual(['vitrine', 'recent-threads'])
	})
})

describe('masquer, réafficher', () => {
	it('masqué puis réaffiché : le bloc redevient exactement le bloc publié', () => {
		const b = toBlocks(PAGE)
		b[0].extra = withHidden(withHidden(b[0].extra, true), false)
		expect(b[0].extra).toEqual({})
		expect(publishStatus(toLayout(b), PAGE)).toBe('published')
	})

	it('masqué : la marque est posée, le reste de la colonne est gardé', () => {
		expect(withHidden<ColumnExtra>({ hide_mobile: true }, true)).toEqual({ hide_mobile: true, hidden: true })
	})
})
