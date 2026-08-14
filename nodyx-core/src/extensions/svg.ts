// Assainissement des SVG livrés par une extension.
//
// Pourquoi ce module existe : l'icône et l'aperçu d'une extension sont
// affichés par la page d'administration et par le magasin, donc HORS du bac à
// sable, sur l'origine principale. Un SVG n'est pas une image : il peut porter
// <script>, des attributs on*, des <foreignObject>, des références externes.
// Sans traitement, l'icône d'une extension devient une XSS sur la page
// d'administration, indépendamment de toute l'isolation de la frame.
// cf NODYX_SDK_SECURITY.md §4.7

import sanitizeHtml from 'sanitize-html'

/** Sous-ensemble SVG considéré comme sûr : du dessin, rien d'exécutable. */
const ALLOWED_TAGS = [
  'svg', 'g', 'defs', 'title', 'desc', 'symbol', 'use',
  'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'pattern',
  'text', 'tspan',
]

const ALLOWED_ATTRS = [
  'viewBox', 'xmlns', 'width', 'height', 'fill', 'fill-rule', 'fill-opacity',
  'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
  'stroke-opacity', 'opacity', 'transform', 'd', 'x', 'y', 'x1', 'y1', 'x2', 'y2',
  'cx', 'cy', 'r', 'rx', 'ry', 'points', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'clip-path', 'mask', 'id', 'class', 'style',
  'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline',
  'preserveAspectRatio',
]

export interface SvgSanitizeResult {
  /** Le SVG réécrit, sûr à servir. */
  svg:      string
  /** Ce qui a été retiré, pour le dire à l'auteur plutôt que de le taire. */
  stripped: string[]
}

export class SvgRejected extends Error {
  constructor(public readonly reason: string) {
    super(reason)
    this.name = 'SvgRejected'
  }
}

/**
 * Réécrit un SVG vers un sous-ensemble sûr.
 *
 * Lève `SvgRejected` si le fichier ne survit pas : on ne sert jamais un SVG
 * silencieusement vidé de sa substance, l'auteur doit savoir que son icône est
 * refusée plutôt que découvrir un carré blanc en production.
 */
export function sanitizeSvg(raw: string): SvgSanitizeResult {
  if (!/<svg[\s>]/i.test(raw)) throw new SvgRejected('ce fichier ne contient pas de balise <svg>')

  const stripped: string[] = []
  const note = (what: string) => { if (!stripped.includes(what)) stripped.push(what) }

  // Repérage AVANT nettoyage : on veut nommer ce qui a été retiré.
  if (/<script[\s>]/i.test(raw))             note('<script>')
  if (/<foreignObject[\s>]/i.test(raw))      note('<foreignObject>')
  if (/\son[a-z]+\s*=/i.test(raw))           note('attributs de gestionnaire on*')
  if (/(href|xlink:href)\s*=\s*["']?\s*(https?:|\/\/)/i.test(raw)) note('références externes')
  if (/javascript:/i.test(raw))              note('URL javascript:')
  if (/<(iframe|object|embed|animate|set)[\s>]/i.test(raw))        note('éléments actifs')

  const svg = sanitizeHtml(raw, {
    allowedTags:       ALLOWED_TAGS,
    allowedAttributes: { '*': ALLOWED_ATTRS },
    // Aucun schéma d'URL n'est autorisé : un SVG d'icône n'a rien à aller
    // chercher ailleurs, et une référence externe est un traceur.
    allowedSchemes:    [],
    parser:            { lowerCaseTags: false, lowerCaseAttributeNames: false },
    disallowedTagsMode: 'discard',
  }).trim()

  if (!/<svg[\s>]/i.test(svg))  throw new SvgRejected('le fichier ne survit pas à l\'assainissement, la racine <svg> a disparu')
  if (!/<\/svg>/i.test(svg))    throw new SvgRejected('SVG malformé, balise racine non fermée')

  // Un SVG réduit à sa racine ne dessine plus rien : autant le dire.
  const hasDrawing = /<(path|rect|circle|ellipse|line|polyline|polygon|text|use|g)[\s>]/i.test(svg)
  if (!hasDrawing) throw new SvgRejected('le fichier ne survit pas à l\'assainissement, il ne reste aucun élément de dessin')

  return { svg, stripped }
}
