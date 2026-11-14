// Flux RSS des derniers sujets, propre à chaque instance. Avant (corrigé le 14/11) :
// TOUS les liens pointaient vers « https://nodyx.example.com » (adresse fictive restée
// en dur), le nom « Nodyx » était figé quelle que soit la communauté, et les sujets
// étaient rangés catégorie par catégorie au lieu du plus récent au plus ancien.
import type { RequestHandler } from './$types'
import { translatorFor } from '$lib/i18n'
import { seoInstance, seoCategories, seoAllThreads, threadPath, xml } from '$lib/server/seoData'

export const GET: RequestHandler = async ({ fetch, url }) => {
	const o = url.origin
	const [info, cats] = await Promise.all([seoInstance(fetch), seoCategories(fetch)])
	const tFn = await translatorFor(info.language)
	const threads = (await seoAllThreads(fetch, cats, 100))
		.sort((a, b) => b.created_at.localeCompare(a.created_at))
		.slice(0, 50)
	const items = threads.map(t => {
		const link = `${o}${threadPath(t)}`
		return `    <item>
      <title>${xml(t.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <pubDate>${new Date(t.created_at).toUTCString()}</pubDate>${t.author_username ? `\n      <dc:creator>${xml(t.author_username)}</dc:creator>` : ''}${t.category_name ? `\n      <category>${xml(t.category_name)}</category>` : ''}
      <description>${xml(tFn('seo.rss_item', { author: t.author_username ?? '?', category: t.category_name ?? '' }))}</description>
    </item>`
	})
	const feed = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${xml(tFn('seo.rss_title', { name: info.name }))}</title>
    <link>${xml(o)}/</link>
    <description>${xml(info.description || tFn('seo.rss_title', { name: info.name }))}</description>
    <language>${xml(info.language)}</language>
    <atom:link href="${xml(o)}/rss.xml" rel="self" type="application/rss+xml"/>
    <ttl>60</ttl>
${items.join('\n')}
  </channel>
</rss>`
	return new Response(feed, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
