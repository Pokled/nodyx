import type { RequestHandler }     from './$types'
import { buildSearchIndex }        from '$lib/docs.server.js'
import { allPages }                from '$lib/nav.js'

export const GET: RequestHandler = async ({ url }) => {
  const q = url.searchParams.get('q')?.trim().toLowerCase()
  if (!q || q.length < 2) return new Response('[]', { headers: { 'Content-Type': 'application/json' } })

  const index   = await buildSearchIndex(allPages)
  const terms   = q.split(/\s+/).filter(Boolean)

  const results = index
    .map(entry => {
      const haystack = `${entry.title.toLowerCase()} ${entry.excerpt.toLowerCase()}`
      const score    = terms.filter(t => haystack.includes(t)).length
      // Find matching excerpt snippet
      const firstMatch = entry.excerpt.toLowerCase().indexOf(terms[0])
      const start      = Math.max(0, firstMatch - 40)
      const excerpt    = firstMatch >= 0
        ? '…' + entry.excerpt.slice(start, start + 120) + '…'
        : entry.excerpt.slice(0, 120) + '…'
      return { slug: entry.slug, title: entry.title, excerpt, score }
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)

  return new Response(JSON.stringify(results), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=60',
    }
  })
}
