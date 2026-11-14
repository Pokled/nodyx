// llms.txt (https://llmstxt.org) : le résumé d'une instance pour les assistants
// d'IA, propre à CHAQUE instance et dans SA langue. Avant, un fichier statique qui
// décrivait le projet Nodyx et pointait vers nodyx.org, servi tel quel par toutes
// les communautés auto-hébergées. Ne contient que ce qu'un visiteur anonyme lit.
import type { RequestHandler } from './$types'
import { translatorFor } from '$lib/i18n'
import { seoInstance, seoCategories, seoAllThreads, seoEvents, threadPath, categoryPath, plain } from '$lib/server/seoData'

export const GET: RequestHandler = async ({ fetch, url }) => {
	const o = url.origin
	const [info, cats, events] = await Promise.all([seoInstance(fetch), seoCategories(fetch), seoEvents(fetch)])
	const tFn = await translatorFor(info.language)
	const threads = (await seoAllThreads(fetch, cats, 100))
		.sort((a, b) => (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at))
		.slice(0, 30)
	const md = (title: string) => title.replace(/[\[\]]/g, '')
	const lines: string[] = [
		`# ${info.name}`,
		'',
		...(info.description ? [`> ${plain(info.description, 300)}`, ''] : []),
		tFn('seo.llms_intro', { name: info.name }),
		'',
		`## ${tFn('seo.llms_h_main')}`,
		'',
		`- [${md(info.name)}](${o}/): ${tFn('seo.llms_home')}`,
		`- [${tFn('nav.forum')}](${o}/forum): ${tFn('seo.llms_forum')}`,
		`- [${tFn('calendar.page_title')}](${o}/calendar): ${tFn('seo.llms_calendar')}`,
		`- [${tFn('cmd.page_title')}](${o}/help): ${tFn('seo.llms_help')}`,
		'',
	]
	if (cats.length) {
		lines.push(`## ${tFn('seo.llms_h_categories')}`, '')
		for (const c of cats) lines.push(`- [${md(c.name)}](${o}${categoryPath(c)})${c.description ? `: ${plain(c.description, 160)}` : ''}`)
		lines.push('')
	}
	if (threads.length) {
		lines.push(`## ${tFn('seo.llms_h_recent')}`, '')
		for (const t of threads) lines.push(`- [${md(t.title)}](${o}${threadPath(t)})${t.category_name ? `: ${plain(t.category_name, 80)}` : ''}`)
		lines.push('')
	}
	if (events.length) {
		lines.push(`## ${tFn('seo.llms_h_events')}`, '')
		for (const e of events) lines.push(`- [${md(e.title)}](${o}/calendar/${e.id}): ${e.starts_at.slice(0, 10)}${e.description ? `, ${plain(e.description, 140)}` : ''}`)
		lines.push('')
	}
	lines.push(
		`## ${tFn('seo.llms_h_private')}`, '',
		tFn('seo.llms_private'), '',
		'## Optional', '',
		`- [sitemap.xml](${o}/sitemap.xml): ${tFn('seo.llms_sitemap')}`,
		`- [rss.xml](${o}/rss.xml): ${tFn('seo.llms_rss')}`,
		`- [Nodyx](https://github.com/Pokled/nodyx): ${tFn('seo.llms_nodyx')}`,
		'',
		tFn('seo.llms_license'), '',
	)
	return new Response(lines.join('\n'), { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' } })
}
