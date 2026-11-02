/**
 * OctoGuard 2 : le cran « signaler » ouvre un dossier dans la file de
 * l'équipe (D13), comme un signalement de membre, signé OctoGuard.
 * Appelé APRÈS l'enregistrement du contenu (on en connaît l'identifiant).
 * Ne lève jamais : un dossier raté ne bloque pas la publication.
 */

import { db } from '../../config/database'
import { resolveReportTarget, type ReportTargetType } from '../reports'

export interface AutoReportInput {
  targetType: ReportTargetType
  targetId:   string
  ruleName:   string
  excerpt:    string
}

export async function fileAutoReport(input: AutoReportInput): Promise<void> {
  try {
    const target = await resolveReportTarget(input.targetType, input.targetId)
    if (!target) return
    // Un seul dossier ouvert par contenu et par OctoGuard
    await db.query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, category, source,
                            target_author_id, snapshot, target_label, target_link)
       SELECT NULL, $1::varchar, $2::uuid, $3::text, 'other', 'octoguard', $4::uuid, $5::text, $6::text, $7::text
       WHERE NOT EXISTS (
         SELECT 1 FROM reports WHERE target_type = $1::varchar AND target_id = $2::uuid AND source = 'octoguard' AND status = 'open'
       )`,
      // Types explicites : $1 et $2 servent deux fois, PostgreSQL refusait de
      // les déduire (« inconsistent types deduced for parameter $1 »).
      [input.targetType, input.targetId, `OctoGuard · ${input.ruleName}`, target.authorId, target.snapshot, target.label, target.link]
    )
  } catch (err) {
    console.warn('[octoguard:autoReport] failed (non-fatal):', err)
  }
}
