import type { RequestHandler } from './$types'
import { nav }                 from '$lib/nav.js'
import { englishSource, pageUrl } from '$lib/docs.server.js'

// Index de la documentation pour les modèles de langage (format llms.txt,
// https://llmstxt.org), généré depuis la navigation réelle : une page ajoutée
// au site y apparaît d'elle-même (10/10/2026).
/**
 * Résumé d'une page pour l'index : son premier paragraphe, sans la mise en forme
 * Markdown, sans « TL;DR », émojis ni chevrons de citation, coupé à la fin d'une
 * phrase (ou d'un mot) plutôt qu'au milieu. Une IA citera ce texte tel quel.
 */
function resume(raw: string, max = 220): string {
  let pastH1 = false
  let para = ''
  for (const line of raw.split('\n')) {
    if (!pastH1) { if (/^#\s/.test(line)) pastH1 = true; continue }
    if (/^\s*(#|```|\||<|!\[|---)/.test(line)) { if (para) break; continue }
    const t = line
      .replace(/\*\*|__|\*|_/g, '').replace(/`([^`]*)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*>\s?/, '').replace(/^:::.*$/, '').trim()
    if (!t) { if (para) break; continue }
    para += (para ? ' ' : '') + t
    if (para.length > max * 2) break
  }
  para = para
    .replace(/^(TL;?DR|tl;dr)\s*:?\s*/i, '')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/(^|\s)>\s+/g, '$1').replace(/\s+/g, ' ').trim()
    .replace(/^["«]\s*(.*?)\s*["»]\.?$/, '$1')
  if (para.length <= max) return para
  const coupe = para.slice(0, max)
  const fin = Math.max(coupe.lastIndexOf('. '), coupe.lastIndexOf('? '), coupe.lastIndexOf('! '))
  return fin >= 80 ? coupe.slice(0, fin + 1) : coupe.slice(0, coupe.lastIndexOf(' ')) + '…'
}

export const GET: RequestHandler = async () => {
  const sections: string[] = []
  for (const s of nav) {
    const lignes: string[] = []
    for (const p of s.items) {
      const src = await englishSource(p.slug)
      if (src === null) continue
      const r = resume(src)
      lignes.push(`- [${p.title}](${pageUrl(p.slug, 'en')})${r ? ': ' + r : ''}`)
    }
    if (lignes.length) sections.push(`## ${s.title}\n\n${lignes.join('\n')}`)
  }

  const body = `# Nodyx documentation

> Nodyx is free, open-source community software that a community installs on its own server: a forum, real-time chat, voice and video channels and a public homepage, together in one install. One installation hosts one community. AGPL-3.0, no analytics, no ads.

This is the official documentation, written in English and partly translated into French and Spanish (same address with /fr/ or /es/ in front of the page name). It covers installation, including at home without opening any port, the architecture, the modules and the project itself.

${sections.join('\n\n')}

## Optional

- [The whole documentation in one file](https://nodyx.dev/llms-full.txt)
- [Project homepage](https://start.nodyx.org): what Nodyx is, in a few screens.
- [Source code](https://github.com/Pokled/nodyx): the GitHub repository.
- [Changelog](https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md): everything that changed, release by release.
`
  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
