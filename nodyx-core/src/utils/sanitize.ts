import { PLACE_VALUE } from '../services/places'
import sanitizeHtml from 'sanitize-html'
import { isContainedUploadPath } from './uploadPath'

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
  // data-mention : une mention liée à la PERSONNE (« u:<id> ») ou à un groupe
  // (« g:ici »…), voir SPECS/NODYX_MENTIONS_CDC.md. Valeur vérifiée par transformTags.span.
  'span':   ['class', 'style', 'data-align', 'data-type', 'data-mention'],
  'p':      ['class', 'style', 'data-align', 'data-type'],
  // id sur les titres : permet les sommaires à ancres (#section). Pas d'id
  // ailleurs pour limiter le risque de DOM clobbering.
  //
  // h1 EN FAIT PARTIE, et son absence a coûté cher (2026-08-19). Un rédacteur a
  // passé deux titres ancrés de h2 à h1 depuis l'éditeur : TipTap avait bien
  // conservé leur id, mais cette liste le retirait, et deux entrées du sommaire
  // sont mortes SANS le moindre message. Perdre une ancre en silence parce qu'on
  // a changé un niveau de titre est un piège, pas une protection : les trois
  // autres niveaux l'autorisaient déjà, la surface de risque est la même.
  'h1':     ['class', 'id', 'style', 'data-align', 'data-type'],
  'h2':     ['class', 'id', 'style', 'data-align', 'data-type'],
  'h3':     ['class', 'id', 'data-align', 'data-type'],
  'h4':     ['class', 'id', 'data-align', 'data-type'],
  // data-card="off" : l'auteur a choisi d'afficher ce lien Nodyx SANS sa carte
  // (« Retirer la carte », « Lien simple »). Seule la valeur « off » passe : toute
  // autre est retirée en entier par transformTags.a (une liste de valeurs laisserait
  // un « data-card » vide).
  'a':      ['href', 'target', 'rel', 'data-card', 'data-place'],
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
  if (src.startsWith('/uploads/')) return isContainedUploadPath(src)
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
  return isContainedUploadPath(src)
}

const _envBlocked = (process.env.BLOCKED_LINK_DOMAINS ?? '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)

const BLOCKED_LINK_DOMAINS = new Set([
  'pornhub.com', 'xvideos.com', 'xhamster.com', 'xnxx.com',
  'redtube.com', 'youporn.com', 'tube8.com', 'spankbang.com',
  'tnaflix.com', 'drtuber.com', 'beeg.com', 'txxx.com',
  ..._envBlocked,
])

// Les titres SANS id : même liste, moins l'ancre. Voir SanitizeOptions.headingIds.
const ATTRS_NO_HEADING_IDS: sanitizeHtml.IOptions['allowedAttributes'] = Object.fromEntries(
  Object.entries(ALLOWED_ATTRS as Record<string, string[]>).map(([tag, attrs]) =>
    [tag, /^h[1-4]$/.test(tag) ? attrs.filter(a => a !== 'id') : attrs]),
)

/** Valeurs acceptées pour data-mention : une personne (u:<uuid>) ou un groupe connu (dont @inscrits : event:<uuid>). */
export const MENTION_VALUE = /^(?:u:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|g:(?:ici|equipe|moderation|tous|(?:grade|event|event-going):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}))$/

export interface SanitizeOptions {
  /**
   * Garder l'id des titres (ancres d'un sommaire). Vrai par défaut : forum, wiki,
   * tâches, événements. FAUX pour le chat et les messages privés : la page du chat
   * retrouve sa zone de saisie par getElementById('chat-input'), et les messages
   * sont AU-DESSUS d'elle dans le document ; un titre id="chat-input" serait trouvé
   * en premier et détournerait la saisie. Un sommaire n'a pas d'usage dans un
   * message de chat : on perd une ancre, pas une fonction.
   */
  headingIds?: boolean
}

export function sanitize(raw: string, opts: SanitizeOptions = {}): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: opts.headingIds === false ? ATTRS_NO_HEADING_IDS : ALLOWED_ATTRS,
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
      'span': (tagName, attribs) => {
        const m = attribs['data-mention']
        if (m === undefined || MENTION_VALUE.test(m)) return { tagName, attribs }
        const cleaned: Record<string, string> = { ...attribs }
        delete cleaned['data-mention']
        return { tagName, attribs: cleaned }
      },
      'a': (tagName, attribs) => {
        const cleaned: Record<string, string> = { ...attribs }
        if (cleaned['data-card'] !== undefined && cleaned['data-card'] !== 'off') delete cleaned['data-card']
        // « # » (lot C4) : une marque d'endroit « <sorte>:<uuid> », rien d'autre
        if (cleaned['data-place'] !== undefined && !PLACE_VALUE.test(cleaned['data-place'])) delete cleaned['data-place']
        return { tagName, attribs: cleaned }
      },
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
      // Une iframe dont la source a été refusée (domaine inconnu, srcdoc) reste
      // sinon une boîte VIDE de 300 × 150 dans la page : on la retire entière.
      if (frame.tag === 'iframe')              return !frame.attribs?.src
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

// ── La charte (lot 7, SPECS/NODYX_OCTOGUARD_V2_CDC.md §E4j) ──────────────────
// Une liste plus COURTE que celle du forum : exactement les blocs de l'aide-mémoire
// de l'éditeur (maquette validée le 19/11/2026). Tout le reste est retiré à
// l'enregistrement, y compris ce qu'un admin colle dans la vue « Code source » :
// un bout de code trouvé sur Internet (un programme qui espionne, un lien piégé)
// ne passe pas. Pas d'iframe, pas de tableau, pas d'image d'ailleurs.
//   bannière   <figure class="nx-banner"><img><figcaption>…</figcaption></figure>
//   accroche   <p class="lead">
//   encadré    <aside class="nx-callout" data-color="…">
//   titre      <h2 data-color="…"> (et h3)
//   + paragraphe, gras, italique, souligné, barré, couleur du texte, centré,
//     liste, ligne, image, lien.
export const CHARTER_COLORS = ['green', 'blue', 'violet', 'orange', 'red'] as const
const CHARTER_COLOR = new Set<string>(CHARTER_COLORS)
// Images : celles de l'instance (/uploads/…) et les photos livrées avec Nodyx (/biomes/…)
const BIOME_IMG = /^\/biomes\/[a-zA-Z-]+-\d\.webp$/

function charterImgSrc(src: string): boolean {
  if (!src) return false
  if (src.startsWith('/uploads/')) return isContainedUploadPath(src)
  return BIOME_IMG.test(src)
}

export function sanitizeCharter(raw: string): string {
  const keepColor = (tagName: string, attribs: Record<string, string>) => {
    const out: Record<string, string> = { ...attribs }
    if (out['data-color'] !== undefined && !CHARTER_COLOR.has(out['data-color'])) delete out['data-color']
    return { tagName, attribs: out }
  }
  return sanitizeHtml(raw, {
    allowedTags: ['p', 'br', 'strong', 'em', 'u', 's', 'span', 'h2', 'h3', 'ul', 'ol', 'li', 'hr', 'a', 'img', 'figure', 'figcaption', 'aside'],
    allowedAttributes: {
      'p':      ['class', 'style'],
      'h2':     ['data-color', 'style'],
      'h3':     ['data-color', 'style'],
      'span':   ['style'],
      'aside':  ['class', 'data-color'],
      'figure': ['class'],
      'a':      ['href'],
      'img':    ['src', 'alt'],
    },
    allowedClasses: { p: ['lead'], aside: ['nx-callout'], figure: ['nx-banner'] },
    allowedStyles: {
      '*': {
        'color':      [/^#[0-9a-f]{3,8}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/i],
        'text-align': [/^(left|center|right)$/],
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    transformTags: { h2: keepColor, h3: keepColor, aside: keepColor },
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img') return !charterImgSrc(frame.attribs?.src ?? '')
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
