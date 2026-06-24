import { lookup } from 'dns/promises'

// ── Aperçu de lien (Open Graph) avec garde-fou SSRF ─────────────────────────
// On récupère côté serveur les métadonnées d'une URL (titre/description/image)
// pour afficher une carte d'aperçu dans le fil d'actu. Comme on fetch une URL
// fournie par un utilisateur, on se protège du SSRF : protocole http(s) seul,
// blocage des hôtes locaux et IP privées, redirections suivies MANUELLEMENT et
// revalidées à chaque saut, timeout court, taille de réponse plafonnée.

export interface LinkPreview {
  url:         string
  title?:      string
  description?: string
  image?:      string
  site_name?:  string
}

const TIMEOUT_MS = 4000
const MAX_BYTES  = 512 * 1024
const MAX_HOPS   = 3

function isPrivateIp(ip: string): boolean {
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const a = +v4[1], b = +v4[2]
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true            // link-local
    if (a === 172 && b >= 16 && b <= 31) return true   // private
    if (a === 192 && b === 168) return true            // private
    if (a === 100 && b >= 64 && b <= 127) return true  // CGNAT
    if (a >= 224) return true                          // multicast/reserved
    return false
  }
  const h = ip.toLowerCase()
  if (h === '::1' || h === '::' || h === '0:0:0:0:0:0:0:1') return true
  if (h.startsWith('fe80')) return true                // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true // ULA
  if (h.startsWith('::ffff:')) return isPrivateIp(h.replace('::ffff:', '')) // IPv4-mapped
  return false
}

async function isSafeHost(hostname: string): Promise<boolean> {
  const h = hostname.toLowerCase().replace(/\.$/, '')
  if (!h || h === 'localhost') return false
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return false
  if (/^[\d.]+$/.test(h) || h.includes(':')) return !isPrivateIp(h)  // IP littérale
  try {
    const addrs = await lookup(h, { all: true })
    return addrs.length > 0 && addrs.every(a => !isPrivateIp(a.address))
  } catch {
    return false
  }
}

function meta(html: string, prop: string): string | undefined {
  const a = new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]*content=["']([^"']*)["']`, 'i')
  const b = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${prop}["']`, 'i')
  return (html.match(a)?.[1] ?? html.match(b)?.[1])?.trim() || undefined
}

function decode(s?: string): string | undefined {
  if (!s) return s
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&#x27;/gi, "'")
          .replace(/&nbsp;/g, ' ').trim() || undefined
}

// Suit les redirections à la main en revalidant chaque hôte (anti-SSRF).
async function safeFetchHtml(startUrl: string): Promise<{ html: string; finalUrl: string } | null> {
  let current = startUrl
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let u: URL
    try { u = new URL(current) } catch { return null }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!await isSafeHost(u.hostname)) return null

    let res: Response
    try {
      res = await fetch(u.href, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'NodyxBot/1.0 (+https://nodyx.org)', 'Accept': 'text/html' },
      })
    } catch { return null }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      if (!loc) return null
      current = new URL(loc, u.href).href
      continue
    }
    if (!res.ok) return null
    if (!(res.headers.get('content-type') ?? '').includes('text/html')) return null

    const reader = res.body?.getReader()
    if (!reader) return null
    const dec = new TextDecoder()
    let html = '', total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.length
      html += dec.decode(value, { stream: true })
      if (total > MAX_BYTES || /<\/head>/i.test(html)) { try { await reader.cancel() } catch { /* noop */ } break }
    }
    return { html, finalUrl: u.href }
  }
  return null
}

export async function fetchLinkPreview(rawUrl: string): Promise<LinkPreview | null> {
  const fetched = await safeFetchHtml(rawUrl)
  if (!fetched) return null
  const { html, finalUrl } = fetched

  const title       = decode(meta(html, 'og:title') ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1])
  const description = decode(meta(html, 'og:description') ?? meta(html, 'description'))
  const site_name   = decode(meta(html, 'og:site_name')) ?? new URL(finalUrl).hostname.replace(/^www\./, '')
  let   image       = meta(html, 'og:image') ?? meta(html, 'og:image:url')

  if (image) {
    try { image = new URL(image, finalUrl).href } catch { image = undefined }
    if (image && !/^https?:\/\//i.test(image)) image = undefined
  }

  if (!title && !description && !image) return null
  return {
    url:         rawUrl,
    title:       title?.slice(0, 300),
    description: description?.slice(0, 500),
    image,
    site_name:   site_name?.slice(0, 100),
  }
}
