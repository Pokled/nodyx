// Plan du site : toutes les pages qu'un visiteur anonyme peut lire.
// Revu le 14/11 : les sujets au-delà des 100 premiers d'une catégorie manquaient,
// les événements publics, le calendrier et l'aide n'y étaient pas, et aucune page
// de liste ne disait quand elle avait changé (lastmod, le seul repère que Google
// lit encore ; changefreq et priority sont ignorés, on ne les envoie plus).
import type { RequestHandler } from './$types'
import { seoCategories, seoAllThreads, seoEvents, threadPath, categoryPath, xml } from '$lib/server/seoData'

const day = (iso: string | null | undefined) => {
	const d = iso ? new Date(iso) : null
	return d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : undefined
}
const entry = (loc: string, lastmod?: string) =>
	`  <url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`

export const GET: RequestHandler = async ({ fetch, url }) => {
	const o = url.origin
	const [cats, events] = await Promise.all([seoCategories(fetch), seoEvents(fetch)])
	const threads = await seoAllThreads(fetch, cats)

	// Une catégorie change quand l'un de ses sujets change ; le forum, quand l'une d'elles change
	const latest = new Map<string, string>()
	for (const t of threads) {
		const d = day(t.updated_at ?? t.created_at)
		if (d && (!latest.has(t.category_id) || latest.get(t.category_id)! < d)) latest.set(t.category_id, d)
	}
	const forumDay = [...latest.values()].sort().at(-1)

	const entries = [
		entry(`${o}/`, forumDay),
		entry(`${o}/forum`, forumDay),
		entry(`${o}/calendar`),
		entry(`${o}/help`),
		...cats.map(c => entry(`${o}${categoryPath(c)}`, latest.get(c.id) ?? day(c.updated_at))),
		...threads.map(t => entry(`${o}${threadPath(t)}`, day(t.updated_at ?? t.created_at))),
		...events.map(e => entry(`${o}/calendar/${e.id}`)),
	]

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
	return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
