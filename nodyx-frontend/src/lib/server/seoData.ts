// Ce que les fichiers pour robots (sitemap.xml, rss.xml, llms.txt) savent de
// l'instance. Tout vient de l'API PUBLIQUE, lue sans compte : un fichier pour
// robots ne contient jamais que ce qu'un visiteur anonyme peut déjà lire.
import { apiFetch } from '$lib/api'

type Fetch = typeof fetch

export interface SeoInstance { name: string; description: string; language: string }
export interface SeoCategory { id: string; slug: string | null; name: string; description: string | null; updated_at: string | null; thread_count: number }
export interface SeoThread { id: string; slug: string | null; title: string; category_slug: string | null; category_id: string; category_name: string | null; author_username: string | null; created_at: string; updated_at: string | null }
export interface SeoEvent { id: string; title: string; description: string | null; starts_at: string }

export async function seoInstance(fetch: Fetch): Promise<SeoInstance> {
	try {
		const r = await apiFetch(fetch, '/instance/info')
		const j = r.ok ? await r.json() : {}
		return { name: j.name || 'Nodyx', description: j.description || '', language: j.language || 'en' }
	} catch {
		return { name: 'Nodyx', description: '', language: 'en' }
	}
}

function flatten(cats: any[]): any[] {
	return cats.flatMap((c: any) => [c, ...flatten(c.children ?? [])])
}

export async function seoCategories(fetch: Fetch): Promise<SeoCategory[]> {
	try {
		const r = await apiFetch(fetch, '/instance/categories')
		if (!r.ok) return []
		return flatten((await r.json()).categories ?? []).map((c: any) => ({
			id: c.id, slug: c.slug ?? null, name: c.name, description: c.description ?? null,
			updated_at: c.updated_at ?? null, thread_count: Number(c.thread_count) || 0,
		}))
	} catch {
		return []
	}
}

/**
 * Les sujets d'une catégorie, page après page (l'API en rend 100 au plus par appel).
 * Bornée à `max` : un plan du site n'a pas à épuiser une base de cent mille sujets.
 */
export async function seoThreads(fetch: Fetch, cat: SeoCategory, max = 2000): Promise<SeoThread[]> {
	const out: SeoThread[] = []
	for (let offset = 0; offset < max; offset += 100) {
		try {
			const r = await apiFetch(fetch, `/forums/threads?category_id=${cat.id}&limit=100&offset=${offset}`)
			if (!r.ok) break
			const page = ((await r.json()).threads ?? []) as any[]
			for (const t of page) out.push({
				id: t.id, slug: t.slug ?? null, title: t.title, category_slug: t.category_slug ?? cat.slug,
				category_id: t.category_id ?? cat.id, category_name: t.category_name ?? cat.name,
				author_username: t.author_username ?? null, created_at: t.created_at, updated_at: t.updated_at ?? null,
			})
			if (page.length < 100) break
		} catch {
			break
		}
	}
	return out
}

export async function seoAllThreads(fetch: Fetch, cats: SeoCategory[], max?: number): Promise<SeoThread[]> {
	return (await Promise.all(cats.map(c => seoThreads(fetch, c, max)))).flat()
}

/** Les événements publics à venir (10 au plus, ce que l'API publique expose). */
export async function seoEvents(fetch: Fetch): Promise<SeoEvent[]> {
	try {
		const r = await apiFetch(fetch, '/instance/events-public?limit=10')
		if (!r.ok) return []
		return ((await r.json()).events ?? []).map((e: any) => ({ id: e.id, title: e.title, description: e.description ?? null, starts_at: e.starts_at }))
	} catch {
		return []
	}
}

export const threadPath = (t: SeoThread) => `/forum/${encodeURIComponent(t.category_slug ?? t.category_id)}/${encodeURIComponent(t.slug ?? t.id)}`
export const categoryPath = (c: SeoCategory) => `/forum/${encodeURIComponent(c.slug ?? c.id)}`

/** XML : les cinq caractères à échapper (texte ET attributs). */
export function xml(s: string): string {
	return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** Une ligne de texte pour un fichier brut : sans HTML, sans retours, bornée. */
export function plain(s: string | null | undefined, max = 200): string {
	const t = String(s ?? '').replace(/<[^<>]*>/g, ' ').replace(/\s+/g, ' ').trim()
	return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t
}
