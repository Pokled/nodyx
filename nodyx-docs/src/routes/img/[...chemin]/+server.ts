import type { RequestHandler } from './$types'
import { error } from '@sveltejs/kit'
import { readFile, realpath } from 'fs/promises'
import { resolve, extname, sep } from 'path'

// Les images de la documentation vivent dans docs/img/ (celles qu'affiche
// GitHub). nodyx.dev en servait une copie manuelle, static/img/, jamais
// resynchronisée : des images manquaient en direct (icône du README français
// en 404, captures de la vitrine absentes, 12/10/2026). Un fichier présent dans
// static/img/ reste servi tel quel (les fichiers statiques passent avant les
// routes) ; pour tout le reste, on lit docs/img/ directement.
const RACINE = resolve(process.cwd(), '..', 'docs', 'img')

const TYPES: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
}

export const GET: RequestHandler = async ({ params }) => {
  const type = TYPES[extname(params.chemin).toLowerCase()]
  if (!type) error(404)
  let chemin: string
  try {
    // realpath : un lien symbolique ne doit pas faire sortir de docs/img/.
    const racine = await realpath(RACINE)
    chemin = await realpath(resolve(racine, params.chemin))
    if (!chemin.startsWith(racine + sep)) error(404)
  } catch {
    error(404)
  }
  const contenu = await readFile(chemin).catch(() => null)
  if (!contenu) error(404)
  return new Response(new Uint8Array(contenu), {
    headers: {
      'content-type': type,
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      // Un SVG ouvert seul ne doit rien exécuter.
      ...(type === 'image/svg+xml' ? { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  })
}
