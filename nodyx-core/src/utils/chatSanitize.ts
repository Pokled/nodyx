// Assainissement d'un message du chat, partagé par le socket (envoi, modification)
// et par la pré-vérification « Tu es sûr ? » (lot 5) : le moteur et l'annonce
// doivent juger exactement le même texte. Déplacé tel quel de socket/index.ts.

import sanitizeHtml from 'sanitize-html'
import { isContainedUploadPath } from './uploadPath'

// ── Sanitize ──────────────────────────────────────────────────────────────────

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'blockquote', 'hr',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span',
  'iframe',
]

const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*':      ['class', 'data-align', 'data-type'],
  'span':   ['class', 'style', 'data-align', 'data-type'],
  'p':      ['class', 'style', 'data-align', 'data-type'],
  'a':      ['href', 'target', 'rel'],
  'img':    ['src', 'alt', 'width', 'height'],
  'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow'],
  'th':     ['rowspan', 'colspan'],
  'td':     ['rowspan', 'colspan'],
}

// ── Content security — images & links ─────────────────────────────────────────

// Seules les images hébergées sur ce serveur ou issues des CDN GIF sont autorisées.
// Tout <img src="https://site-externe.com/..."> est supprimé silencieusement.
const ALLOWED_IMG_HOSTS = new Set([
  'media.tenor.com', 'c.tenor.com', 'media1.tenor.com', 'tenor.com',
  'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com',
  'media2.giphy.com', 'media3.giphy.com', 'i.giphy.com',
])

function isAllowedImgSrc(src: string): boolean {
  if (!src) return false
  if (src.startsWith('/uploads/')) return isContainedUploadPath(src)
  if (src.startsWith('data:image/')) return true  // images collées depuis le presse-papiers
  try {
    return ALLOWED_IMG_HOSTS.has(new URL(src).hostname)
  } catch {
    return false
  }
}

// Domaines bloqués dans les liens <a href> (contenu illicite / adulte connu)
// L'admin peut étendre la liste via la variable d'environnement BLOCKED_LINK_DOMAINS
// (liste de domaines séparés par des virgules).
const _envBlocked = (process.env.BLOCKED_LINK_DOMAINS ?? '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)

const BLOCKED_LINK_DOMAINS = new Set([
  'pornhub.com', 'xvideos.com', 'xhamster.com', 'xnxx.com',
  'redtube.com', 'youporn.com', 'tube8.com', 'spankbang.com',
  'tnaflix.com', 'drtuber.com', 'beeg.com', 'txxx.com',
  ..._envBlocked,
])

function isBlockedHref(href: string): boolean {
  if (!href) return false
  try {
    const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, '')
    return BLOCKED_LINK_DOMAINS.has(hostname)
  } catch {
    return false
  }
}

export function sanitizeChat(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedIframeHostnames: [
      'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
      'player.vimeo.com', 'vimeo.com',
    ],
    // Supprime les <img> dont le src n'est pas sur ce serveur ou un CDN GIF autorisé
    // Supprime les <a> pointant vers des domaines illicites connus
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img') return !isAllowedImgSrc(frame.attribs?.src ?? '')
      if (frame.tag === 'a')   return isBlockedHref(frame.attribs?.href ?? '')
      return false
    },
  })
}
