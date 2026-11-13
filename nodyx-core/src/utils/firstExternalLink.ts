// Le lien dont un statut garde un aperçu (Open Graph, copié à la publication).
// Un lien vers un contenu de CETTE instance n'en a pas : il a sa carte vivante, lue au
// moment de l'affichage avec les droits du lecteur (services/linkCards.ts). Avant le
// 13/11/2026, le serveur allait copier sa propre page (un aperçu figé, en double de la
// carte) dès qu'un statut commençait par un lien Nodyx.
import { parseInternalLink } from '../services/linkCards'

const HREF = /<a\s[^>]*?href=["'](https?:\/\/[^"'\s]+)["']/gi

/** Premier lien vers un AUTRE site, ou null. Dix liens examinés au plus. */
export function firstExternalLink(html: string): string | null {
  let n = 0
  for (const m of (html ?? '').matchAll(HREF)) {
    if (++n > 10) break
    const url = m[1].replace(/&amp;/g, '&')
    if (!parseInternalLink(url)) return url
  }
  return null
}
