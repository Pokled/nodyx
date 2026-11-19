// Vignettes : une image téléversée, servie à la taille où elle est AFFICHÉE.
// Avant le 19/11/2026, l'accueil de nodyx.org téléchargeait et décodait des photos
// de 4 256 px pour des cartes de 288 px, un logo de 1,27 Mo pour 40 px, un GIF de
// 1,9 Mo pour un papier peint figé : 8,8 Mo d'images, et un zoom au survol qui
// redessinait 12 mégapixels.
//
//   /uploads/_w/<largeur>/<chemin>     vignette WebP de cette largeur (animée si l'original l'est)
//   /uploads/_w/<largeur>s/<chemin>    vignette FIXE (première image) : papier peint
//
// Fabriquée UNE fois, gardée sur le disque (uploads/_thumbs), servie ensuite comme un
// fichier. Largeurs prédéfinies seulement (un visiteur ne peut pas remplir le disque
// en demandant toutes les tailles), jamais d'agrandissement, chemin vérifié (il ne peut
// pas sortir du dossier des images), deux fabrications au plus en même temps.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { isContainedUploadPath } from '../utils/uploadPath'

export const THUMB_WIDTHS = [64, 128, 256, 384, 512, 768, 1024, 1536] as const
const ROOT = path.join(process.cwd(), 'uploads')
const CACHE = path.join(ROOT, '_thumbs')
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i
const MAX_SOURCE = 25 * 1024 * 1024

export interface ThumbRequest { width: number; still: boolean; rel: string }

/** « 256 », « 512s » + « posts/x.webp » → requête valide, ou null. */
export function parseThumb(widthPart: string, rel: string): ThumbRequest | null {
  const m = /^(\d{1,4})(s?)$/.exec(widthPart)
  if (!m) return null
  const width = Number(m[1])
  if (!(THUMB_WIDTHS as readonly number[]).includes(width)) return null
  if (!IMAGE_EXT.test(rel) || rel.startsWith('_thumbs/')) return null
  if (!isContainedUploadPath('/uploads/' + rel) || rel.includes('?') || rel.includes('#')) return null
  return { width, still: m[2] === 's', rel }
}

export const thumbFile = (t: ThumbRequest): string =>
  path.join(CACHE, `${t.width}${t.still ? 's' : ''}`, t.rel.replace(IMAGE_EXT, '') + '.webp')

// Deux fabrications au plus à la fois ; une même vignette demandée deux fois n'est
// fabriquée qu'une fois (les deux attendent la même).
const inflight = new Map<string, Promise<string | null>>()
let running = 0
const waiting: (() => void)[] = []
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= 2) await new Promise<void>(r => waiting.push(r))
  running++
  try { return await fn() } finally { running--; waiting.shift()?.() }
}

/** Le fichier de la vignette (fabriquée au besoin), ou null si l'original n'existe pas / n'est pas une image. */
export async function ensureThumb(t: ThumbRequest): Promise<string | null> {
  const out = thumbFile(t)
  try { await fs.access(out); return out } catch { /* à fabriquer */ }
  const hit = inflight.get(out)
  if (hit) return hit
  const job = slot(async () => {
    const src = path.join(ROOT, t.rel)
    if (!src.startsWith(ROOT + path.sep)) return null
    const st = await fs.stat(src).catch(() => null)
    if (!st?.isFile() || st.size > MAX_SOURCE) return null
    try {
      const animated = !t.still && /\.(gif|webp)$/i.test(t.rel)
      const buf = await sharp(src, { animated, limitInputPixels: 80_000_000 })
        .rotate()
        .resize({ width: t.width, withoutEnlargement: true })
        .webp({ quality: 80, effort: 4 })
        .toBuffer()
      await fs.mkdir(path.dirname(out), { recursive: true })
      const tmp = `${out}.${process.pid}.tmp`
      await fs.writeFile(tmp, buf)
      await fs.rename(tmp, out)   // jamais un fichier à moitié écrit servi
      return out
    } catch {
      return null
    }
  }).finally(() => inflight.delete(out))
  inflight.set(out, job)
  return job
}
