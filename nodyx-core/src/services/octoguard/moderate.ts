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
import type { PipelineUserCtx, Surface } from './types'

export type ModerationVerdict =
  | { blocked: false; report?: { rule_name: string; excerpt: string }; hold?: { rule_id: string; rule_name: string; excerpt: string } }
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
  return (html ?? '')
    .replace(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi, (_m, _q, href: string, label: string) => {
      const text = label.replace(/<[^>]*>/g, '').trim()
      return text && text !== href ? `${text} ${href}` : href
    })
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Les textes d'une publication (titre, corps, bio…) sont examinés ensemble. */
export async function moderateText(userId: string, surface: Surface, texts: Array<string | null | undefined>): Promise<ModerationVerdict> {
  try {
    if (!isOctoGuardEnabled()) return { blocked: false }
    const content = texts.filter((t): t is string => !!t && t.trim().length > 0).join('\n')
    if (!content) return { blocked: false }
    const userCtx = await buildUserCtx(userId)
    const res = await runPipeline({ content, userCtx, surface })
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
