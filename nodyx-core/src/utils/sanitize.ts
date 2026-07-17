import sanitizeHtml from 'sanitize-html'

// ── Sanitizer HTML partagé (forum + réseau social) ──────────────────────────
// Allowlist éprouvée : on autorise le rendu riche de l'éditeur Nodyx (titres,
// listes, tables, images de notre serveur ou CDN GIF, audio interne, iframes
// YouTube/Vimeo) et on retire tout le reste (script, on*, src d'images/audio
// externes, domaines bloqués). Utilisé partout où du contenu utilisateur est
// rendu en {@html}. NE JAMAIS rendre du contenu utilisateur sans passer par ici.

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'blockquote', 'hr',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span',
  'iframe',
  'audio',
  'nodyx-audio-player',
  'nodyx-track',
]

const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*':      ['class', 'data-align', 'data-type'],
  'span':   ['class', 'style', 'data-align', 'data-type'],
  'p':      ['class', 'style', 'data-align', 'data-type'],
  // id sur les titres : permet les sommaires à ancres (#section). Pas d'id
  // ailleurs pour limiter le risque de DOM clobbering.
  'h2':     ['class', 'id', 'style', 'data-align', 'data-type'],
  'h3':     ['class', 'id', 'data-align', 'data-type'],
  'h4':     ['class', 'id', 'data-align', 'data-type'],
  'a':      ['href', 'target', 'rel'],
  'img':    ['src', 'alt', 'width', 'height'],
  'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow'],
  'audio':              ['src', 'controls', 'preload'],
  'nodyx-audio-player': ['src', 'track-title', 'artist', 'cover', 'download'],
  'nodyx-track':        ['src', 'track-title', 'artist', 'cover'],
  'th':     ['rowspan', 'colspan'],
  'td':     ['rowspan', 'colspan'],
}

// Images autorisées : serveur propre + CDN GIF uniquement
const ALLOWED_IMG_HOSTS = new Set([
  'media.tenor.com', 'c.tenor.com', 'media1.tenor.com', 'tenor.com',
  'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com',
  'media2.giphy.com', 'media3.giphy.com', 'i.giphy.com',
])

function isAllowedImgSrc(src: string): boolean {
  if (!src) return false
  if (src.startsWith('/uploads/')) return true
  if (src.startsWith('data:image/')) return true
  try {
    return ALLOWED_IMG_HOSTS.has(new URL(src).hostname)
  } catch {
    return false
  }
}

// Audio : uniquement les fichiers servis par notre /uploads/.
function isAllowedAudioSrc(src: string): boolean {
  if (!src) return false
  return src.startsWith('/uploads/')
}

const _envBlocked = (process.env.BLOCKED_LINK_DOMAINS ?? '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)

const BLOCKED_LINK_DOMAINS = new Set([
  'pornhub.com', 'xvideos.com', 'xhamster.com', 'xnxx.com',
  'redtube.com', 'youporn.com', 'tube8.com', 'spankbang.com',
  'tnaflix.com', 'drtuber.com', 'beeg.com', 'txxx.com',
  ..._envBlocked,
])

export function sanitize(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    // Embeds vidéo : uniquement les domaines de lecteur OFFICIELS de chaque
    // plateforme (pas une page quelconque du site). Twitch permet d'intégrer un
    // live dans un post : le LECTEUR vit sur player.twitch.tv, le CHAT sur
    // www.twitch.tv/embed/<chaine>/chat. Les deux EXIGENT un paramètre
    // `parent=<domaine>` correspondant au site qui les affiche.
    //
    // ⚠ `embed.twitch.tv` (le layout tout-en-un lecteur+chat) est VOLONTAIREMENT
    // absent : la CSP de prod ne l'autorise pas en frame-src. L'ajouter ici
    // poserait un piège, le sanitizer le laisserait passer et le navigateur le
    // bloquerait, sans que l'auteur comprenne pourquoi son embed est mort.
    allowedIframeHostnames: [
      'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
      'player.vimeo.com', 'vimeo.com',
      'player.twitch.tv', 'www.twitch.tv',
    ],
    transformTags: {
      'nodyx-audio-player': (tagName, attribs) => {
        if (attribs.cover && !isAllowedImgSrc(attribs.cover)) {
          const cleaned: Record<string, string> = { ...attribs }
          delete cleaned.cover
          return { tagName, attribs: cleaned }
        }
        return { tagName, attribs }
      },
      'nodyx-track': (tagName, attribs) => {
        if (attribs.cover && !isAllowedImgSrc(attribs.cover)) {
          const cleaned: Record<string, string> = { ...attribs }
          delete cleaned.cover
          return { tagName, attribs: cleaned }
        }
        return { tagName, attribs }
      },
    },
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img')                 return !isAllowedImgSrc(frame.attribs?.src ?? '')
      if (frame.tag === 'audio')               return !isAllowedAudioSrc(frame.attribs?.src ?? '')
      if (frame.tag === 'nodyx-audio-player')  return !!frame.attribs?.src && !isAllowedAudioSrc(frame.attribs.src)
      if (frame.tag === 'nodyx-track')         return !isAllowedAudioSrc(frame.attribs?.src ?? '')
      if (frame.tag === 'a') {
        const href = frame.attribs?.href ?? ''
        try {
          const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, '')
          return BLOCKED_LINK_DOMAINS.has(hostname)
        } catch { return false }
      }
      return false
    },
  })
}
