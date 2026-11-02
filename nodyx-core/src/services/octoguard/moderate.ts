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
 * Ne lève jamais : en cas de panne, on laisse passer (fail-open, comme le chat).
 */

import { db } from '../../config/database'
import { getInstanceCommunityId } from '../../middleware/adminOnly'
import { isOctoGuardEnabled } from './index'
import { runPipeline } from './pipeline'
import type { PipelineUserCtx, Surface } from './types'

export type ModerationVerdict =
  | { blocked: false; report?: { rule_name: string; excerpt: string } }
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

/** Les textes d'une publication (titre, corps, bio…) sont examinés ensemble. */
export async function moderateText(userId: string, surface: Surface, texts: Array<string | null | undefined>): Promise<ModerationVerdict> {
  try {
    if (!isOctoGuardEnabled()) return { blocked: false }
    const content = texts.filter((t): t is string => !!t && t.trim().length > 0).join('\n')
    if (!content) return { blocked: false }
    const userCtx = await buildUserCtx(userId)
    const res = await runPipeline({ content, userCtx, surface })
    if (res.blocked) return { blocked: true, reason: res.reason ?? 'octoguard', i18n_key: res.i18n_key ?? 'octoguard.blocked' }
    return res.report ? { blocked: false, report: { rule_name: res.report.rule_name, excerpt: res.report.excerpt } } : { blocked: false }
  } catch (err) {
    console.warn('[octoguard:moderate] failed, letting through:', err)
    return { blocked: false }
  }
}

/** Corps de la réponse 422 quand OctoGuard refuse une publication. */
export function blockedBody(v: { reason: string; i18n_key: string }) {
  return { error: v.reason, code: 'OCTOGUARD_BLOCKED', i18n_key: v.i18n_key }
}
