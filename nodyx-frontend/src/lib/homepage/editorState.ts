// L'état du nouvel éditeur de page d'accueil (lot L1a, SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md §3).
// Module pur : l'historique (R3, tout se défait), l'état de la page dans la barre du haut,
// et le nom d'un bloc dans la Structure. Aucun DOM, aucune requête.

import type { GridLayout } from '$lib/types/homepage'
import { moveBlock, groupRows, type EditorBlock } from './editorModel'

// ── Annuler, rétablir (R3) ───────────────────────────────────────────────────

export const HISTORY_LIMIT = 80

export interface History<T> { past: T[]; present: T; future: T[] }

export function historyStart<T>(present: T): History<T> {
	return { past: [], present, future: [] }
}

/** Un geste de plus. `merge` : la suite d'une même frappe, qui ne crée pas d'étape de plus. */
export function historyPush<T>(h: History<T>, next: T, merge = false): History<T> {
	if (merge && h.past.length) return { past: h.past, present: next, future: [] }
	const past = [...h.past, h.present]
	return { past: past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, present: next, future: [] }
}

export function historyUndo<T>(h: History<T>): History<T> {
	if (!h.past.length) return h
	return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] }
}

export function historyRedo<T>(h: History<T>): History<T> {
	if (!h.future.length) return h
	return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) }
}

// ── L'état de la page (barre du haut) ────────────────────────────────────────

export type PageStatus = 'unpublished' | 'modified' | 'published'

/** Le même contenu écrit toujours de la même façon : clés triées, à toute profondeur. */
export function canonical(v: unknown): string {
	if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`
	if (v && typeof v === 'object') {
		const o = v as Record<string, unknown>
		return `{${Object.keys(o).filter(k => o[k] !== undefined).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`
	}
	return JSON.stringify(v) ?? 'null'
}

/** Comparaison sur le CONTENU (identifiants compris), pas sur l'ordre des clés : la page
 *  enregistrée et celle que l'éditeur reconstruit n'écrivent pas leurs clés dans le même ordre. */
export function publishStatus(current: GridLayout, published: GridLayout | null | undefined): PageStatus {
	if (!published || !published.rows?.length) return 'unpublished'
	return canonical(current) === canonical(published) ? 'published' : 'modified'
}

// ── Le nom d'un bloc dans la Structure ───────────────────────────────────────

/** Ce que l'admin a écrit comme titre dans le bloc, sinon rien (la Structure montre alors le type). */
export function blockTitle(b: EditorBlock): string {
	for (const k of ['title', 'heading', 'text']) {
		const v = b.config?.[k]
		if (typeof v === 'string' && v.trim()) return v.trim().replace(/\s+/g, ' ')
	}
	return ''
}

/** Les blocs que la Structure montre : sans les places libres. */
export function structureBlocks(blocks: EditorBlock[]): EditorBlock[] {
	return blocks.filter(b => b.widget !== null)
}

/** Masquer, réafficher : réafficher RETIRE la marque (pas de `hidden: false`), pour qu'un bloc
 *  masqué puis réaffiché redevienne exactement le bloc publié. */
export function withHidden<T extends { hidden?: boolean }>(extra: T, hidden: boolean): T {
	const { hidden: _drop, ...rest } = extra
	return (hidden ? { ...rest, hidden: true } : rest) as T
}

/** Glisser-déposer dans la Structure : le bloc avance pas à pas (mêmes règles que les flèches,
 *  `moveBlock`) jusqu'à la place du bloc visé. S'il ne peut plus avancer (au bord de sa rangée),
 *  il s'arrête là : jamais de geste qui casse une rangée. */
export function moveToward(blocks: EditorBlock[], id: string, targetId: string): EditorBlock[] {
	const order = (bs: EditorBlock[]) => structureBlocks(bs).map(b => b.id)
	const target = order(blocks).indexOf(targetId)
	const start = order(blocks).indexOf(id)
	if (target < 0 || start < 0 || target === start) return blocks
	const dir: -1 | 1 = target > start ? 1 : -1
	let cur = blocks
	for (let n = 0; n < 64; n++) {
		const next = moveBlock(cur, id, dir)
		if (next === cur) break
		cur = next
		const at = order(cur).indexOf(id)
		if (dir > 0 ? at >= target : at <= target) break
	}
	return cur
}

/** Le fond d'une section : « Aucun » RETIRE la clé (le bloc redevient exactement le bloc publié). */
export function withFond<T extends { fond?: 'clair' | 'sombre' }>(extra: T, fond: 'clair' | 'sombre' | null): T {
	const { fond: _drop, ...rest } = extra
	return (fond ? { ...rest, fond } : rest) as T
}

/** Le bloc est-il seul dans sa rangée (sans compter les places libres) ? Le fond ne se règle que là. */
export function aloneInRow(blocks: EditorBlock[], id: string): boolean {
	const row = groupRows(blocks).find(g => g.some(b => b.id === id))
	return !!row && row.filter(b => b.widget !== null).length === 1
}
