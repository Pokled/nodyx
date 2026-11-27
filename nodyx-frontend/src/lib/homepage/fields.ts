// Les réglages d'un bloc dans le nouvel éditeur (lot L0, SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md §4) :
// valeurs par défaut, champs conditionnels, listes et liens. Module pur, testé sans navigateur.

import type { FieldSchema } from '$lib/components/homepage/plugins/_types'
import { safeInternalPath } from '$lib/safeRedirect'

/** La valeur de départ d'un champ : son `default`, sinon une valeur neutre de son type. */
export function defaultOf(f: FieldSchema): unknown {
	if (f.default !== undefined) return structuredClone(f.default)
	switch (f.type) {
		case 'boolean': return false
		case 'number': case 'slider': return f.min ?? 0
		case 'list': case 'categories': return []
		case 'select': case 'choice-visual': return f.options?.[0]?.value ?? ''
		default: return ''
	}
}

/** La config complète d'un bloc neuf : chaque champ (et chaque réglage replié) à sa valeur de départ. */
export function defaultsFor(schema: FieldSchema[], advanced: FieldSchema[] = []): Record<string, unknown> {
	const out: Record<string, unknown> = {}
	for (const f of [...schema, ...advanced]) out[f.key] = defaultOf(f)
	return out
}

/** Les champs à montrer pour cette config (règle `showIf` : toutes les valeurs doivent correspondre). */
export function visibleFields(schema: FieldSchema[], config: Record<string, unknown>): FieldSchema[] {
	return schema.filter(f => !f.showIf || Object.entries(f.showIf).every(([k, v]) => config[k] === v))
}

/** L'exemple n'apparaît que sur un champ vide : sinon il répète ce que l'admin a écrit (règle R8). */
export function showExample(f: FieldSchema, value: unknown): boolean {
	return !!f.example && (value === undefined || value === null || value === '')
}

// ── Listes : chaque geste rend une nouvelle liste ───────────────────────────

export function listAdd<T>(list: T[], item: T, max?: number): T[] {
	if (max !== undefined && list.length >= max) return list
	return [...list, structuredClone(item)]
}

export function listRemove<T>(list: T[], i: number): T[] {
	if (i < 0 || i >= list.length) return list
	return list.filter((_, k) => k !== i)
}

export function listMove<T>(list: T[], from: number, to: number): T[] {
	if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
	const out = list.slice()
	const [x] = out.splice(from, 1)
	out.splice(to, 0, x)
	return out
}

// ── Liens (règle R9 : aucun lien cassé possible) ─────────────────────────────

export type LinkCheck = { ok: true; kind: 'internal' | 'external' } | { ok: false }

/** Un chemin de l'instance (même contrôle que la connexion), ou une adresse https vers un
 *  vrai nom de domaine. Le reste (http, javascript:, adresse privée, « //site ») est refusé. */
export function checkLink(raw: unknown): LinkCheck {
	if (typeof raw !== 'string' || !raw) return { ok: false }
	if (safeInternalPath(raw, '') === raw) return { ok: true, kind: 'internal' }
	let u: URL
	try { u = new URL(raw) } catch { return { ok: false } }
	if (u.protocol !== 'https:' || u.username || u.password) return { ok: false }
	const h = u.hostname
	if (!h.includes('.') || h.endsWith('.local') || h.endsWith('.internal') || h === 'localhost') return { ok: false }
	if (/^\d+(\.\d+){3}$/.test(h) || h.startsWith('[')) return { ok: false }
	return { ok: true, kind: 'external' }
}

// ── Choisir un lien (R9) : les pages qui existent, puis « une adresse à moi » ──

/** Les pages de Nodyx qu'un bloc peut viser. Chaque chemin existe dans toute instance. */
export const PAGE_LINKS: { path: string; key: string }[] = [
	{ path: '/', key: 'hpe.link_home' },
	{ path: '/forum', key: 'hpe.link_forum' },
	{ path: '/chat', key: 'hpe.link_chat' },
	{ path: '/calendar', key: 'hpe.link_calendar' },
	{ path: '/members', key: 'hpe.link_members' },
	{ path: '/wiki', key: 'hpe.link_wiki' },
	{ path: '/polls', key: 'hpe.link_polls' },
	{ path: '/library', key: 'hpe.link_library' },
	{ path: '/charter', key: 'hpe.link_charter' },
	{ path: '/auth/register', key: 'hpe.link_register' },
	{ path: '/auth/login', key: 'hpe.link_login' },
]

export interface CategoryRef { slug: string; name: string; thread_count?: number; depth?: number }
export interface LinkChoice { value: string; key?: string; label?: string }

/** Les choix du sélecteur de lien : les pages, puis chaque catégorie du forum. */
export function linkChoices(categories: CategoryRef[]): LinkChoice[] {
	return [
		...PAGE_LINKS.map(p => ({ value: p.path, key: p.key })),
		...categories.filter(c => c.slug).map(c => ({ value: `/forum/${c.slug}`, label: c.name })),
	]
}

/** Le lien est-il une page de la liste (sinon c'est « une adresse à moi ») ? Un champ vide compte comme une page. */
export function isListedLink(value: unknown, choices: LinkChoice[]): boolean {
	return value === '' || value === undefined || value === null || choices.some(c => c.value === value)
}

// ── La médiathèque ─────────────────────────────────────────────────────────────

export interface AssetRef { id: string; name: string; file_path: string; thumbnail_path?: string | null }

/** L'adresse d'un fichier de la médiathèque, sur l'instance elle-même (jamais d'adresse extérieure). */
export function assetUrl(a: Pick<AssetRef, 'file_path'>): string {
	return '/uploads/' + a.file_path.replace(/^\/+/, '')
}
export function assetThumb(a: AssetRef): string {
	return assetUrl({ file_path: a.thumbnail_path || a.file_path })
}

// ── Listes : le nom d'un élément replié ─────────────────────────────────────

/** Le nom d'un élément de liste replié : la valeur de `itemLabelKey`, sinon « Élément n ». */
export function listItemLabel(item: unknown, f: FieldSchema, i: number, fallback: (n: number) => string): string {
	const v = f.itemLabelKey && item && typeof item === 'object' ? (item as Record<string, unknown>)[f.itemLabelKey] : undefined
	return typeof v === 'string' && v.trim() ? v.trim() : fallback(i + 1)
}
