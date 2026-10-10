import type { RequestHandler } from './$types'
import { allPages }           from '$lib/nav.js'
import { pageTranslations, pageLastModified, pageUrl } from '$lib/docs.server.js'

const BASE = 'https://nodyx.dev'
const jour = (d: Date | null) => (d ?? new Date()).toISOString().slice(0, 10)

// Chaque page, dans CHAQUE langue où elle existe vraiment, avec ses versions
// linguistiques (hreflang) et sa vraie date de modification (10/10/2026). Avant,
// seule l'anglaise était listée, toutes datées « aujourd'hui » : une date fictive
// que les moteurs repèrent, et qui leur fait ignorer le signal.
export const GET: RequestHandler = async () => {
  const urls: string[] = [
    `<url><loc>${BASE}</loc><changefreq>weekly</changefreq><priority>1.0</priority></url>`,
  ]
  for (const p of allPages) {
    const langs = pageTranslations(p.slug)
    const alternates = langs.length > 1
      ? langs.map(l => `<xhtml:link rel="alternate" hreflang="${l}" href="${pageUrl(p.slug, l)}"/>`).join('')
        + `<xhtml:link rel="alternate" hreflang="x-default" href="${pageUrl(p.slug, 'en')}"/>`
      : ''
    for (const l of langs) {
      urls.push(`<url><loc>${pageUrl(p.slug, l)}</loc><lastmod>${jour(await pageLastModified(p.slug, l))}</lastmod>`
        + `<changefreq>weekly</changefreq><priority>${l === 'en' ? '0.8' : '0.7'}</priority>${alternates}</url>`)
    }
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${urls.join('\n')}
</urlset>`

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
