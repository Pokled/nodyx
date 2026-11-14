/**
 * OctoGuard 2 : le point d'entrée UNIQUE pour tout ce qui s'écrit hors du
 * chat (forum, profils, sondages, wiki). Le chat garde son appel direct à
 * runPipeline (socket), avec le même moteur et les mêmes règles.
 *
 * - OctoGuard éteint : rien ne se passe (le filtre des symboles haineux,
 *   contentFilter.ts, reste actif à part, D11).
 * - Une règle au cran « supprimer », « avertir », sourdine ou bannissement :
 *   la publication est refusée, avec un code stable et une clé de traduction.
 * - Une règle au cran « signaler » : la publication passe, et l'appelant
 *   ouvre le dossier une fois le contenu enregistré (fileAutoReport).
 * - Une règle au cran « retenir » (forum) : l'appelant n'écrit RIEN, il
 *   confie le contenu à holdContent() et répond 202 (held.ts).
 * Ne lève jamais : en cas de panne, on laisse passer (fail-open, comme le chat).
 */

import { db } from '../../config/database'
import { getInstanceCommunityId } from '../../middleware/adminOnly'
import { isOctoGuardEnabled } from './index'
import { runPipeline } from './pipeline'
import { shieldGate, hasLink, shieldHoldRule } from './shield'
import type { PipelineUserCtx, Surface } from './types'

export type ModerationVerdict =
  | { blocked: false; report?: { rule_name: string; excerpt: string }; hold?: { rule_id: string | null; rule_name: string; excerpt: string } }
  | { blocked: true; reason: string; i18n_key: string }

/** Rôle et grade du membre dans la communauté de l'instance (immunités). */
export async function buildUserCtx(userId: string): Promise<PipelineUserCtx> {
  const communityId = await getInstanceCommunityId()
  const { rows } = await db.query<{ role: string | null; grade_id: string | null; account_age_days: number | null }>(
    `SELECT cm.role, cm.grade_id, EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 86400 AS account_age_days
     FROM users u
     LEFT JOIN community_members cm ON cm.user_id = u.id AND cm.community_id = $1
     WHERE u.id = $2`,
    [communityId, userId]
  )
  const age = rows[0]?.account_age_days
  return {
    userId,
    role: rows[0]?.role ?? 'member',
    gradeIds: rows[0]?.grade_id ? [rows[0].grade_id] : [],
    ...(age !== null && age !== undefined ? { accountAgeDays: Number(age) } : {}),
  }
}

/**
 * Le texte qu'OctoGuard examine, à partir du HTML de l'éditeur. Différent de
 * l'aperçu des signalements (toPlainText) sur deux points qui comptaient :
 * - l'adresse d'un lien est gardée, même cachée derrière un texte (« ici ») :
 *   avant, les règles de liens ne voyaient que « ici » et laissaient passer ;
 * - rien n'est tronqué : l'aperçu s'arrête à 1000 caractères, un spam placé
 *   après passait.
 */
export function textForModeration(html: string | null | undefined): string {
  return stripTags(htmlTextWithLinks(html ?? '')
    .replace(/<(br|\/p|\/div|\/li|\/h\d)\s?\/?>/gi, '\n'))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Retire les balises en un passage. « < » sans « > » derrière : le reste est du texte. */
function stripTags(s: string): string {
  let out = ''
  let i = 0
  while (i < s.length) {
    const lt = s.indexOf('<', i)
    if (lt === -1) { out += s.slice(i); break }
    const gt = s.indexOf('>', lt)
    if (gt === -1) { out += s.slice(i); break }
    out += s.slice(i, lt) + ' '
    i = gt + 1
  }
  return out
}

/**
 * Remplace chaque lien par « texte adresse », en UN passage. Pas d'expression
 * régulière sur le document entier : le texte est celui du membre, AVANT
 * nettoyage, jusqu'à 500 Ko. Une version à base de regex mettait plus de deux
 * minutes sur 40 000 « <a href> » jamais fermés, et bloquait tout le cœur
 * (mesuré le 07/11, avant fusion). Ici chaque caractère est lu un nombre
 * borné de fois : la position de « </a> » est cherchée une seule fois par
 * avancée, et une absence est retenue pour la suite.
 */
function htmlTextWithLinks(html: string): string {
  const lower = html.toLowerCase()
  let out = ''
  let i = 0
  let noMoreClose = false
  let close = -1
  while (i < html.length) {
    const a = lower.indexOf('<a', i)
    if (a === -1) { out += html.slice(i); break }
    const after = lower.charCodeAt(a + 2)
    // « <a » suivi d'un espace ou de « > » : une ancre (pas « <abbr », « <aside »)
    if (!(after === 32 || after === 9 || after === 10 || after === 13 || after === 62)) { out += html.slice(i, a + 2); i = a + 2; continue }
    const tagEnd = html.indexOf('>', a)
    if (tagEnd === -1) { out += html.slice(i); break }
    const tag = html.slice(a, tagEnd + 1)
    const hrefM = tag.length <= 4096 ? /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(tag) : null
    const href = hrefM ? (hrefM[1] ?? hrefM[2] ?? hrefM[3] ?? '') : ''
    if (!noMoreClose && close < tagEnd) {
      close = lower.indexOf('</a>', tagEnd)
      if (close === -1) noMoreClose = true
    }
    out += html.slice(i, a)
    if (noMoreClose) {
      // Ancre jamais fermée : on garde l'adresse, le reste est lu comme du texte
      out += ` ${href} `
      i = tagEnd + 1
      continue
    }
    const label = stripTags(html.slice(tagEnd + 1, close)).trim()
    out += label && label !== href ? `${label} ${href}` : href
    i = close + 4
  }
  return out
}

/** Les textes d'une publication (titre, corps, bio…) sont examinés ensemble.
 *  `opts.mentionTexts` : les mêmes textes, le corps donné en HTML et non en
 *  extraction, pour compter les mentions (leurs marques n'existent que dans le
 *  HTML : un groupe y pèse le nombre de personnes qu'il prévient). */
export async function moderateText(userId: string, surface: Surface, texts: Array<string | null | undefined>, opts: { mentionTexts?: Array<string | null | undefined> } = {}): Promise<ModerationVerdict> {
  try {
    const content = texts.filter((t): t is string => !!t && t.trim().length > 0).join('\n')
    // Le bouclier anti-raid passe AVANT OctoGuard et marche même éteint (D21c) :
    // un compte tout neuf n'écrit plus nulle part ; un lien du forum attend
    // d'être relu (l'équipe n'est jamais concernée, cf. shieldGate).
    const gate = await shieldGate(userId, surface === 'forum' ? 'forum' : 'other', { isNew: false })
    if (!gate.allow) return { blocked: true, reason: gate.code, i18n_key: gate.i18n_key }
    if (surface === 'forum' && gate.holdLinks && content && hasLink(content)) return { blocked: false, hold: shieldHoldRule(content) }
    if (!isOctoGuardEnabled()) return { blocked: false }
    if (!content) return { blocked: false }
    const userCtx = await buildUserCtx(userId)
    const mentionHtml = opts.mentionTexts?.filter((t): t is string => !!t && t.trim().length > 0).join('\n')
    const res = await runPipeline({ content, userCtx, surface, mentionHtml })
    if (res.blocked) return { blocked: true, reason: res.reason ?? 'octoguard', i18n_key: res.i18n_key ?? 'octoguard.blocked' }
    // Retenir : seul le forum sait mettre un contenu de côté (avec le chat,
    // qui appelle le moteur directement). Profil, sondage et wiki n'ont pas de
    // « brouillon en attente » : la règle y agit comme « signaler » (le contenu
    // passe, un dossier s'ouvre), ce que l'écran des règles annonce.
    if (res.hold) {
      if (surface === 'forum') return { blocked: false, hold: res.hold }
      return { blocked: false, report: { rule_name: res.hold.rule_name, excerpt: res.hold.excerpt } }
    }
    return res.report ? { blocked: false, report: { rule_name: res.report.rule_name, excerpt: res.report.excerpt } } : { blocked: false }
  } catch (err) {
    console.warn('[octoguard:moderate] failed, letting through:', err)
    return { blocked: false }
  }
}

/** Corps de la réponse 202 quand un contenu est retenu pour relecture. */
export function heldBody(h: { id: string }) {
  return { held: true, held_id: h.id, code: 'OCTOGUARD_HELD', i18n_key: 'octoguard.held' }
}

/** Corps de la réponse 422 quand OctoGuard refuse une publication. */
export function blockedBody(v: { reason: string; i18n_key: string }) {
  return { error: v.reason, code: 'OCTOGUARD_BLOCKED', i18n_key: v.i18n_key }
}
