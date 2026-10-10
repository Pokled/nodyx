import type { RequestHandler } from './$types'
import { nav }                 from '$lib/nav.js'
import { englishSource, pageUrl } from '$lib/docs.server.js'

// Toute la documentation anglaise en un seul fichier, dans l'ordre de la
// navigation, pour qu'un modèle de langage la lise d'un trait (10/10/2026).
export const GET: RequestHandler = async () => {
  const parties: string[] = [
    '# Nodyx documentation, complete\n\nThe full English documentation of Nodyx, self-hosted community software (forum, chat, voice and video, homepage), in navigation order. Each page starts with its address on https://nodyx.dev.',
  ]
  for (const s of nav) {
    for (const p of s.items) {
      const src = await englishSource(p.slug)
      if (src === null) continue
      parties.push(`---\n\nSource: ${pageUrl(p.slug, 'en')}\nSection: ${s.title}\n\n${src.trim()}`)
    }
  }
  return new Response(parties.join('\n\n') + '\n', {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  })
}
