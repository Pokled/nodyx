// ─── Inline image rehost ──────────────────────────────────────────────────
// Quand un utilisateur colle dans l'éditeur WYSIWYG du forum une <img> avec
// un src externe (Imgur, CDN tiers, screenshot Discord...), le sanitizer
// strip silencieusement l'image au save (whitelist stricte : /uploads/* +
// Tenor + Giphy). Friction UX énorme : "j'ai inséré une image, elle apparait,
// je save, elle disparait sans message".
//
// Ce service intercepte AVANT le sanitize : pour chaque <img> externe, on
// télécharge l'image (timeout, taille max, MIME check), on stocke dans
// uploads/inline_images/<sha256>.<ext>, on remplace le src dans le HTML. La
// sanitize-html voit ensuite une URL /uploads/* qu'elle laisse passer.
//
// Gains de bord :
//   - Dédup naturelle : 2 utilisateurs qui collent la même image partagent
//     le même fichier sur disque (hash sha256 du contenu).
//   - Anti-rot des liens : l'image survit même si la source externe meurt.
//   - Anti-tracking : plus de leak d'IP du viewer vers les CDN tiers.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { isContainedUploadPath } from '../utils/uploadPath'
import { safeRequest, OutboundBlocked, type SafeResponse } from '../utils/ssrfGuard'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads', 'inline_images')

// MIME → extension. On accepte uniquement les formats statiques + GIF, pas de
// SVG (XSS possible via <script>), pas d'image vectorielle / format exotique.
const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg':  'jpg',
  'image/png':  'png',
  'image/webp': 'webp',
  'image/gif':  'gif',
}

const MAX_SIZE_BYTES       = 10 * 1024 * 1024   // 10 MB par image
const FETCH_TIMEOUT_MS     = 8_000               // 8s par download
const MAX_IMAGES_PER_POST  = 20                  // anti-DoS sur un seul post

export interface RehostResult {
  html:      string
  rehosted:  number
  failed:    Array<{ src: string; reason: string }>
  skipped:   number      // déjà allowed (uploads, data:, tenor/giphy), pas re-téléchargées
}

// ── Helpers d'allowlist (alignés avec le sanitizer du forum) ───────────────

function isAlreadyAllowed(src: string): boolean {
  if (!src) return true
  if (src.startsWith('/uploads/')) return isContainedUploadPath(src)
  if (src.startsWith('data:image/')) return true
  try {
    const host = new URL(src).hostname.toLowerCase()
    if (host === 'tenor.com' || host.endsWith('.tenor.com')) return true
    if (host === 'giphy.com' || host.endsWith('.giphy.com')) return true
    return false
  } catch {
    return true  // URL invalide → on laisse passer (le sanitizer la strip de toute façon)
  }
}

// ── Download + store ───────────────────────────────────────────────────────

async function downloadAndStore(src: string): Promise<string> {
  let parsed: URL
  try { parsed = new URL(src) }
  catch { throw new Error('invalid_url') }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('unsupported_protocol')
  }

  // Garde anti-SSRF (11/11/2026) : l'adresse vient d'un MEMBRE. Elle est vérifiée
  // à la connexion même (jamais loopback, réseau privé, métadonnées), et chaque
  // redirection repasse par la garde (3 au plus).
  let res: SafeResponse
  let url = parsed.href
  for (let hop = 0; ; hop++) {
    try {
      res = await safeRequest(url, { headers: { 'User-Agent': 'Nodyx-Rehost/1.0' }, timeoutMs: FETCH_TIMEOUT_MS, maxBytes: MAX_SIZE_BYTES + 1 })
    } catch (err) {
      if (err instanceof OutboundBlocked) throw new Error(err.code === 'URL_FORBIDDEN' ? 'forbidden_address' : 'invalid_url')
      throw new Error((err as { name?: string }).name === 'AbortError' ? 'timeout' : 'network')
    }
    const loc = res.headers.location
    if (res.status >= 300 && res.status < 400 && loc) {
      if (hop >= 3) throw new Error('too_many_redirects')
      url = new URL(loc, url).href
      continue
    }
    break
  }

  if (res.status < 200 || res.status >= 300) throw new Error(`http_${res.status}`)

  const contentType = String(res.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const ext = MIME_EXT[contentType]
  if (!ext) throw new Error(`mime_${contentType || 'unknown'}`)

  const buffer = res.body
  if (res.truncated || buffer.length > MAX_SIZE_BYTES) throw new Error('too_large')
  if (buffer.length === 0)              throw new Error('empty')

  // Hash sha256 du contenu → dédup naturelle entre users.
  const hash = createHash('sha256').update(buffer).digest('hex')
  const filename = `${hash}.${ext}`
  const diskPath = path.join(UPLOADS_DIR, filename)

  await fs.mkdir(UPLOADS_DIR, { recursive: true })

  // Si l'image existe déjà (même hash = même contenu binaire), on skip l'écriture
  // pour ne pas réécrire un fichier identique.
  let exists = false
  try { await fs.access(diskPath); exists = true } catch { /* not present */ }
  if (!exists) await fs.writeFile(diskPath, buffer)

  return `/uploads/inline_images/${filename}`
}

// ── Entrée publique ────────────────────────────────────────────────────────
// Parse le HTML, trouve les <img src>, rehoste les externes, retourne le HTML
// patché + des statistiques pour que la route puisse renvoyer un toast info.

export async function rehostExternalImages(html: string): Promise<RehostResult> {
  if (!html || typeof html !== 'string') {
    return { html: html ?? '', rehosted: 0, failed: [], skipped: 0 }
  }

  // Matche les <img> et capture le src. Tolère attrs avant/après, double ou
  // simple quote, espaces.
  const imgRegex = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["'][^>]*>/gi

  // Première passe : collecte des src uniques candidats au rehost.
  const srcsToRehost = new Set<string>()
  let skipped = 0
  let m: RegExpExecArray | null
  let totalImg = 0
  while ((m = imgRegex.exec(html)) !== null) {
    totalImg++
    const src = m[1]
    if (isAlreadyAllowed(src)) { skipped++; continue }
    srcsToRehost.add(src)
    if (srcsToRehost.size >= MAX_IMAGES_PER_POST) break  // anti-DoS
  }
  if (srcsToRehost.size === 0) {
    return { html, rehosted: 0, failed: [], skipped }
  }

  // Deuxième passe : download chaque src unique (en parallèle modéré : 4 à la
  // fois). Si un download échoue, on garde le src original — le sanitizer va
  // ensuite le strip, mais on a essayé.
  const failed: Array<{ src: string; reason: string }> = []
  const replacements = new Map<string, string>()

  const tasks = Array.from(srcsToRehost)
  const CONCURRENCY = 4
  for (let i = 0; i < tasks.length; i += CONCURRENCY) {
    const slice = tasks.slice(i, i + CONCURRENCY)
    const results = await Promise.allSettled(slice.map(downloadAndStore))
    for (let j = 0; j < slice.length; j++) {
      const src = slice[j]
      const r = results[j]
      if (r.status === 'fulfilled') {
        replacements.set(src, r.value)
      } else {
        const reason = (r.reason as Error)?.message ?? 'unknown'
        failed.push({ src, reason })
      }
    }
  }

  // Troisième passe : remplace dans le HTML. On échappe les chars regex et on
  // remplace toutes les occurrences (un même src peut apparaitre plusieurs fois).
  let patched = html
  for (const [oldSrc, newSrc] of replacements) {
    // replaceAll sur string littérale = pas de regex, donc safe.
    patched = patched.split(oldSrc).join(newSrc)
  }

  return {
    html:      patched,
    rehosted:  replacements.size,
    failed,
    skipped,
  }
}
