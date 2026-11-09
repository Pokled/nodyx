/**
 * Clore un dossier de signalements : TOUS les signalements ouverts du même contenu,
 * puis prévenir chaque personne qui a signalé (D6 : sans détail de la décision).
 *
 * Partagé par la route PATCH /reports/:id et par le barème (D31), pour qu'il n'y
 * ait qu'une seule façon de clore un dossier.
 */
import { db } from '../../config/database'
import * as NotificationModel from '../../models/notification'
import { io } from '../../socket/io'

export type ReportOutcome = 'reviewed' | 'dismissed' | 'actioned'

export interface ClosedReports {
  target_type: string
  target_id: string
  resolved: number
  notified: number
}

/** Le signalement est déjà en main : on ne le relit pas. */
export async function closeReports(report: { id: string; target_type: string; target_id: string }, status: ReportOutcome, actorId: string, resolution: string | null): Promise<ClosedReports> {
  const { target_type, target_id } = report
  const { rows } = await db.query<{ id: string; reporter_id: string | null }>(
    `UPDATE reports
        SET status      = $1,
            resolution  = COALESCE($2, resolution),
            reviewed_by = $3,
            reviewed_at = NOW()
      WHERE target_type = $4 AND target_id = $5 AND (status = 'open' OR id = $6)
      RETURNING id, reporter_id`,
    [status, resolution, actorId, target_type, target_id, report.id]
  )

  const reporters = [...new Set(rows.map(r => r.reporter_id).filter((x): x is string => !!x))]
  for (const reporterId of reporters) {
    try {
      await NotificationModel.create({ user_id: reporterId, type: 'report_resolved' })
      if (io) {
        const count = await NotificationModel.getUnreadCount(reporterId)
        io.to(`user:${reporterId}`).emit('notification:new', { unreadCount: count })
      }
    } catch { /* une notification ratée ne bloque jamais la modération */ }
  }
  return { target_type, target_id, resolved: rows.length, notified: reporters.length }
}

/** Prendre en charge (ou rendre) un dossier : visible de toute l'équipe. */
export async function claimReports(reportId: string, actorId: string | null): Promise<void> {
  await db.query(
    `UPDATE reports r SET claimed_by = $2, claimed_at = CASE WHEN $2::uuid IS NULL THEN NULL ELSE NOW() END
       FROM reports src
      WHERE src.id = $1 AND r.target_type = src.target_type AND r.target_id = src.target_id AND r.status = 'open'`,
    [reportId, actorId]
  )
}
