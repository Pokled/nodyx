// Le modèle du nouvel éditeur de page d'accueil (lot L0, SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md).
//
// Le FORMAT ENREGISTRÉ NE CHANGE PAS : `homepage_grid` garde ses rangées et ses colonnes
// sur 12 (quatre instances ont une page publiée, dont une rangée « 7 + 5 »). L'éditeur,
// lui, travaille sur une LISTE DE BLOCS, plus simple à manipuler : chaque bloc garde sa
// rangée, sa largeur exacte et tous ses réglages de colonne, si bien que
// toLayout(toBlocks(page)) redonne la page à l'identique.
//
// - « Place libre » = une vraie colonne vide (`widget: null`), ce que le format sait déjà
//   enregistrer : un bloc mis à « La moitié » seul garde sa largeur, le reste est libre.
// - Les largeurs en mots (Toute la largeur, Deux tiers, La moitié, Un tiers) sont une
//   façon de MONTRER 12, 8, 6 et 4. Toute autre largeur reste intacte (« Sur mesure »).
//
// Module pur : aucun DOM, aucune requête. Chaque geste rend une nouvelle liste.

import type { GridColumn, GridLayout, GridRow } from '$lib/types/homepage'
import { genId } from '$lib/types/homepage'

export type RowProps = Omit<GridRow, 'columns'>
export type ColumnExtra = Omit<GridColumn, 'id' | 'span' | 'widget' | 'config'>

export interface EditorBlock {
	id:        string
	/** null = une place libre (colonne vide) */
	widget:    string | null
	config:    Record<string, unknown>
	/** 1 à 12 */
	span:      number
	/** Les autres réglages de la colonne (span_md, span_sm, title, hide_mobile…), gardés tels quels */
	extra:     ColumnExtra
	/** Les réglages de la rangée qui contient ce bloc */
	row:       RowProps
	/** Ce bloc ouvre une nouvelle rangée */
	startsRow: boolean
}

export type IdGen = () => string

// ── Les largeurs en mots ─────────────────────────────────────────────────────

export const WIDTHS = { full: 12, two_thirds: 8, half: 6, third: 4 } as const
export type WidthWord = keyof typeof WIDTHS
/** Une largeur en mots, ou « custom » quand la colonne a une largeur sans nom (7/12…). */
export function widthOf(span: number): WidthWord | 'custom' {
	const hit = (Object.keys(WIDTHS) as WidthWord[]).find(w => WIDTHS[w] === span)
	return hit ?? 'custom'
}

export const DEFAULT_ROW: Omit<RowProps, 'id'> = { gap: '1rem', padding_y: '2rem' }

const clone = <T>(v: T): T => structuredClone(v)
const clampSpan = (n: number) => Math.min(12, Math.max(1, Math.round(n)))

// ── Format enregistré ⇄ blocs ────────────────────────────────────────────────

export function toBlocks(layout: GridLayout): EditorBlock[] {
	return (layout?.rows ?? []).flatMap(r => {
		const { columns, ...row } = r
		return (columns ?? []).map((c, i) => {
			const { id, span, widget, config, ...extra } = c
			return {
				id, widget: widget ?? null, config: clone(config ?? {}), span,
				extra: clone(extra), row: clone(row), startsRow: i === 0,
			}
		})
	})
}

/** Les blocs regroupés par rangée, dans l'ordre (même règle que toLayout). */
export function groupRows(blocks: EditorBlock[]): EditorBlock[][] {
	const rows: EditorBlock[][] = []
	let sum = 0
	for (const b of blocks) {
		if (!rows.length || b.startsRow || sum + b.span > 12) { rows.push([]); sum = 0 }
		rows[rows.length - 1].push(b)
		sum += b.span
	}
	return rows
}

export function toLayout(blocks: EditorBlock[], idGen: IdGen = genId): GridLayout {
	return {
		rows: groupRows(blocks).map(group => {
			// Une rangée qui déborde (sans startsRow) prend un identifiant neuf : deux rangées
			// ne partagent jamais le même id.
			const row = group[0].startsRow ? clone(group[0].row) : { ...clone(group[0].row), id: idGen() }
			return {
				...row,
				columns: group.map(b => ({ id: b.id, span: b.span, widget: b.widget, config: clone(b.config), ...clone(b.extra) })),
			}
		}),
	}
}

// ── Les gestes ───────────────────────────────────────────────────────────────

const isEmpty = (b: EditorBlock) => b.widget === null

/** Une rangée refaite : ses blocs (sans les places libres), puis une place libre pour compléter 12. */
function refill(widgets: EditorBlock[], row: RowProps, idGen: IdGen): EditorBlock[] {
	const used = widgets.reduce((s, b) => s + b.span, 0)
	const out = widgets.map((b, i) => ({ ...b, row: clone(row), startsRow: i === 0 }))
	if (used < 12) out.push({ id: idGen(), widget: null, config: {}, span: 12 - used, extra: {}, row: clone(row), startsRow: out.length === 0 })
	return out
}

function locate(blocks: EditorBlock[], id: string) {
	const rows = groupRows(blocks)
	const r = rows.findIndex(g => g.some(b => b.id === id))
	return { rows, r, row: rows[r] }
}

/** Change la largeur d'un bloc. Plus étroit : la place libérée devient libre. Trop large pour
 *  sa rangée : le bloc part sur sa propre rangée, juste en dessous, et l'ancienne se complète. */
export function setSpan(blocks: EditorBlock[], id: string, span: number, idGen: IdGen = genId): EditorBlock[] {
	const { rows, r, row } = locate(blocks, id)
	if (r < 0) return blocks
	const s = clampSpan(span)
	const props = row[0].row
	const widgets = row.filter(b => !isEmpty(b)).map(b => (b.id === id ? { ...b, span: s } : b))
	const total = widgets.reduce((sum, b) => sum + b.span, 0)
	let replacement: EditorBlock[]
	if (total <= 12) replacement = refill(widgets, props, idGen)
	else {
		const moved = widgets.find(b => b.id === id)!
		const others = widgets.filter(b => b.id !== id)
		replacement = [...(others.length ? refill(others, props, idGen) : []), ...refill([moved], { ...DEFAULT_ROW, ...props, id: idGen() }, idGen)]
	}
	return [...rows.slice(0, r).flat(), ...replacement, ...rows.slice(r + 1).flat()]
}

/** Retire un bloc. Ses voisins de rangée restent, sa place devient libre ; une rangée sans
 *  plus aucun bloc disparaît. */
export function removeBlock(blocks: EditorBlock[], id: string, idGen: IdGen = genId): EditorBlock[] {
	const { rows, r, row } = locate(blocks, id)
	if (r < 0) return blocks
	const widgets = row.filter(b => !isEmpty(b) && b.id !== id)
	const replacement = widgets.length ? refill(widgets, row[0].row, idGen) : []
	return [...rows.slice(0, r).flat(), ...replacement, ...rows.slice(r + 1).flat()]
}

export interface NewBlock { widget: string; config: Record<string, unknown>; span?: number }

/** Ajoute un bloc dans une place libre : il en prend la largeur exacte. */
export function insertIntoEmpty(blocks: EditorBlock[], emptyId: string, nb: NewBlock, idGen: IdGen = genId): EditorBlock[] {
	return blocks.map(b => (b.id === emptyId && isEmpty(b)
		? { ...b, id: idGen(), widget: nb.widget, config: clone(nb.config) }
		: b))
}

/** Ajoute un bloc sur sa propre rangée, après la rangée du bloc `afterId` (null = tout en haut). */
export function insertRowAfter(blocks: EditorBlock[], afterId: string | null, nb: NewBlock, idGen: IdGen = genId): EditorBlock[] {
	const rows = groupRows(blocks)
	const at = afterId === null ? 0 : rows.findIndex(g => g.some(b => b.id === afterId)) + 1
	const created = refill([{ id: idGen(), widget: nb.widget, config: clone(nb.config), span: clampSpan(nb.span ?? 12), extra: {}, row: { id: '', ...DEFAULT_ROW }, startsRow: true }], { id: idGen(), ...DEFAULT_ROW }, idGen)
	const pos = at <= 0 ? 0 : at
	return [...rows.slice(0, pos).flat(), ...created, ...rows.slice(pos).flat()]
}

/** Monte ou descend un bloc. Seul dans sa rangée : toute la rangée change de place. Avec des
 *  voisins : il échange sa place avec le bloc d'à côté ; au bord de la rangée, rien ne bouge. */
export function moveBlock(blocks: EditorBlock[], id: string, dir: -1 | 1): EditorBlock[] {
	const { rows, r, row } = locate(blocks, id)
	if (r < 0) return blocks
	const widgets = row.filter(b => !isEmpty(b))
	if (widgets.length === 1) {
		const to = r + dir
		if (to < 0 || to >= rows.length) return blocks
		const next = rows.slice();
		[next[r], next[to]] = [next[to], next[r]]
		return next.flat()
	}
	const i = row.findIndex(b => b.id === id)
	let j = i + dir
	while (j >= 0 && j < row.length && isEmpty(row[j])) j += dir
	if (j < 0 || j >= row.length) return blocks
	const swapped = row.slice();
	[swapped[i], swapped[j]] = [swapped[j], swapped[i]]
	const fixed = swapped.map((b, k) => ({ ...b, startsRow: k === 0 }))
	return [...rows.slice(0, r).flat(), ...fixed, ...rows.slice(r + 1).flat()]
}

/** Duplique un bloc sur sa propre rangée, juste en dessous, à la même largeur. */
export function duplicateBlock(blocks: EditorBlock[], id: string, idGen: IdGen = genId): EditorBlock[] {
	const b = blocks.find(x => x.id === id)
	if (!b || isEmpty(b)) return blocks
	return insertRowAfter(blocks, id, { widget: b.widget!, config: b.config, span: b.span }, idGen)
}
