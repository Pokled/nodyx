/**
 * OctoGuard 2, lot 8 : contester une décision (D23, D33-D35 validées le 11/11).
 *
 * Un membre conteste un avertissement ou une sourdine qu'il a reçus, une fois par
 * décision, dans les 30 jours. Un AUTRE membre de l'équipe tranche : l'auteur de la
 * décision ne le peut pas (refus du serveur). Si c'est OctoGuard qui a décidé, toute
 * l'équipe le peut. « Annuler la décision » est une vraie annulation : avertissement
 * retiré, sourdine levée, marche du barème défaite.
 *
 * Ce que le membre ne voit JAMAIS : le nom de la règle (D20, ne pas apprendre à
 * contourner) ni le nom de la personne qui l'a sanctionné. Il voit « l'équipe » ou
 * « OctoGuard ».
 *
 * Pendant la relecture, la sourdine reste en place (D34). L'équipe n'est pas
 * notifiée à chaque contestation : le compteur de l'onglet suffit (D35).
 */
import { db } from '../../config/database'
import { removeMute } from './mutes'
import { logOctoGuardAction } from './logger'
import { checkTarget, undoLadder, type Fail } from './ladder'
import type { MemberAccess } from '../permissions'
import * as NotificationModel from '../../models/notification'
import { io } from '../../socket/io'
import { randomUUID } from 'crypto'

export const APPEAL_DAYS = 30
export const APPEAL_MIN = 10
export const APPEAL_MAX = 1000
export const REPLY_MAX = 500

export type DecisionType = 'warn' | 'mute'
export type Outcome = 'upheld' | 'overturned'

const fail = (status: number, code: string, error: string): Fail => ({ ok: false, status, code, error })

interface Actor { userId: string; access: MemberAccess }

/** Une décision, quelle que soit sa source (règle, barème, équipe). */
export interface Decision {
  type: DecisionType
  id: string
  user_id: string
  at: string
  reason: string | null
  decided_by: string | null       // NULL = OctoGuard
  rule_id: string | null
  rule_name: string | null
  ladder_id: string | null
  ladder_status: string | null
  ladder_step: number | null
  expires_at: string | null       // sourdine seulement
  active: boolean                 // avertissement non retiré, sourdine en cours
  undone: boolean                 // retirée ou levée par quelqu'un (pas l'expiration naturelle)
}

const WARN_SQL = `
  SELECT 'warn' AS type, w.id, w.user_id, w.created_at::text AS at, w.reason, w.issued_by AS decided_by,
         COALESCE(w.rule_id, l.rule_id) AS rule_id, r.name AS rule_name,
         l.id AS ladder_id, l.status AS ladder_status, l.step AS ladder_step, NULL::text AS expires_at,
         (w.cleared_at IS NULL) AS active,
         (w.cleared_at IS NOT NULL OR l.status = 'undone') AS undone
    FROM octoguard_warns w
    LEFT JOIN LATERAL (SELECT id, status, step, rule_id FROM octoguard_ladder WHERE warn_id = w.id ORDER BY created_at DESC LIMIT 1) l ON TRUE
    LEFT JOIN octoguard_automod_rules r ON r.id = COALESCE(w.rule_id, l.rule_id)`

// Une sourdine sortie de chat_mutes AVANT sa fin prévue a été levée par quelqu'un ;
// après, c'est l'expiration naturelle (le ménage passe toutes les 60 s).
const MUTE_SQL = `
  SELECT 'mute' AS type, m.id, m.user_id, m.applied_at::text AS at, m.reason, m.applied_by AS decided_by,
         COALESCE(m.rule_id, l.rule_id) AS rule_id, r.name AS rule_name,
         l.id AS ladder_id, l.status AS ladder_status, l.step AS ladder_step, m.expires_at::text AS expires_at,
         (m.ended_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > NOW())) AS active,
         (l.status = 'undone' OR (m.ended_at IS NOT NULL AND (m.expires_at IS NULL OR m.ended_at < m.expires_at))) AS undone
    FROM octoguard_mute_log m
    LEFT JOIN LATERAL (SELECT id, status, step, rule_id FROM octoguard_ladder WHERE mute_id = m.id ORDER BY created_at DESC LIMIT 1) l ON TRUE
    LEFT JOIN octoguard_automod_rules r ON r.id = COALESCE(m.rule_id, l.rule_id)`

const norm = (d: Decision): Decision => ({ ...d, active: d.active === true, undone: d.undone === true })

export async function loadDecision(type: DecisionType, id: string): Promise<Decision | null> {
  const { rows } = await db.query<Decision>(`${type === 'warn' ? WARN_SQL : MUTE_SQL} WHERE ${type === 'warn' ? 'w' : 'm'}.id = $1`, [id])
  return rows[0] ? norm(rows[0]) : null
}

const tooOld = (at: string, now = Date.now()) => now - new Date(at).getTime() > APPEAL_DAYS * 86_400_000

function journal(action: string, targetId: string, actorId: string, actor: 'member' | 'admin', meta: Record<string, unknown>): void {
  logOctoGuardAction({
    action, target_type: 'user', target_id: targetId, target_label: null, actor_id: actorId,
    metadata: { event_id: randomUUID(), actor, ...meta },
  })
}

// ─── Côté membre ────────────────────────────────────────────────────────────

/** Ce que voit le membre : ses décisions des 30 derniers jours. Ni règle ni auteur. */
export async function listMine(userId: string) {
  const since = `NOW() - INTERVAL '${APPEAL_DAYS} days'`
  const [{ rows: warns }, { rows: mutes }, { rows: appeals }] = await Promise.all([
    db.query<Decision>(`${WARN_SQL} WHERE w.user_id = $1 AND w.created_at > ${since}`, [userId]),
    db.query<Decision>(`${MUTE_SQL} WHERE m.user_id = $1 AND m.applied_at > ${since}`, [userId]),
    db.query<{ decision_type: DecisionType; decision_id: string; status: string; reply: string | null; created_at: string; handled_at: string | null }>(
      `SELECT decision_type, decision_id, status, reply, created_at::text AS created_at, handled_at::text AS handled_at
         FROM octoguard_appeals WHERE user_id = $1`, [userId]),
  ])
  const byDecision = new Map(appeals.map(a => [`${a.decision_type}:${a.decision_id}`, a]))
  return [...warns, ...mutes].map(norm)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map(d => {
      const a = byDecision.get(`${d.type}:${d.id}`)
      return {
        type: d.type, id: d.id, at: d.at, reason: d.reason,
        source: d.decided_by === null ? 'octoguard' : 'team',
        ladder_step: d.ladder_status === 'applied' || d.ladder_status === 'undone' ? d.ladder_step : null,
        expires_at: d.expires_at, active: d.active, undone: d.undone,
        contestable: !a && !d.undone && !tooOld(d.at),
        appeal: a ? { status: a.status, reply: a.reply, created_at: a.created_at, handled_at: a.handled_at } : null,
      }
    })
}

export async function fileAppeal(userId: string, input: { decision_type: DecisionType; decision_id: string; message: string }) {
  const message = input.message.trim()
  if (message.length < APPEAL_MIN || message.length > APPEAL_MAX) return fail(400, 'APPEAL_MESSAGE_LENGTH', `The message must be ${APPEAL_MIN} to ${APPEAL_MAX} characters`)
  const d = await loadDecision(input.decision_type, input.decision_id)
  // La décision d'un autre : même réponse qu'une décision inconnue (rien à apprendre)
  if (!d || d.user_id !== userId) return fail(404, 'NOT_FOUND', 'Decision not found')
  if (d.undone) return fail(409, 'DECISION_UNDONE', 'This decision has already been undone')
  if (tooOld(d.at)) return fail(409, 'APPEAL_TOO_LATE', `A decision can be contested within ${APPEAL_DAYS} days`)
  const { rows } = await db.query<{ id: string; created_at: string }>(
    `INSERT INTO octoguard_appeals (user_id, decision_type, decision_id, decided_by, decided_by_engine, message)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ON CONSTRAINT uq_octoguard_appeals_decision DO NOTHING
     RETURNING id, created_at::text AS created_at`,
    [userId, d.type, d.id, d.decided_by, d.decided_by === null, message])
  if (!rows[0]) return fail(409, 'APPEAL_EXISTS', 'This decision has already been contested')
  journal('octoguard.appeal_filed', userId, userId, 'member', { appeal_id: rows[0].id, decision_type: d.type, decision_id: d.id })
  return { ok: true as const, id: rows[0].id, status: 'open' as const, created_at: rows[0].created_at }
}

// ─── Côté équipe ────────────────────────────────────────────────────────────

interface AppealRow {
  id: string; user_id: string; username: string | null; decision_type: DecisionType; decision_id: string
  decided_by: string | null; decided_by_engine: boolean; decided_by_username: string | null
  message: string; status: string; reply: string | null; created_at: string
  handled_by: string | null; handled_by_username: string | null; handled_at: string | null
}

const APPEAL_SQL = `
  SELECT a.id, a.user_id, u.username, a.decision_type, a.decision_id, a.decided_by, a.decided_by_engine,
         d.username AS decided_by_username, a.message, a.status, a.reply, a.created_at::text AS created_at,
         a.handled_by, h.username AS handled_by_username, a.handled_at::text AS handled_at
    FROM octoguard_appeals a
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN users d ON d.id = a.decided_by
    LEFT JOIN users h ON h.id = a.handled_by`

/** Pourquoi CETTE personne ne peut pas trancher, ou null. */
function whyNot(actorId: string, a: Pick<AppealRow, 'user_id' | 'decided_by'>): string | null {
  if (actorId === a.user_id) return 'APPEAL_OWN'
  if (a.decided_by && a.decided_by === actorId) return 'APPEAL_SAME_AUTHOR'
  return null
}

export async function listAppeals(actorId: string, which: 'open' | 'done') {
  const { rows } = await db.query<AppealRow>(
    `${APPEAL_SQL} WHERE ${which === 'open' ? `a.status = 'open'` : `a.status <> 'open'`}
      ORDER BY ${which === 'open' ? 'a.created_at ASC' : 'a.handled_at DESC NULLS LAST'} LIMIT 200`)
  const { rows: c } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM octoguard_appeals WHERE status = 'open'`)
  const appeals = await Promise.all(rows.map(async a => {
    const d = await loadDecision(a.decision_type, a.decision_id)
    return {
      ...a,
      decided_by_engine: a.decided_by_engine === true,
      decision: d ? { at: d.at, reason: d.reason, rule_name: d.rule_name, ladder_step: d.ladder_step, ladder_status: d.ladder_status, expires_at: d.expires_at, active: d.active, undone: d.undone } : null,
      cannot_decide: whyNot(actorId, a),
    }
  }))
  return { appeals, open_count: c[0]?.n ?? 0 }
}

export async function openAppealCount(): Promise<number> {
  const { rows } = await db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM octoguard_appeals WHERE status = 'open'`)
  return rows[0]?.n ?? 0
}

export async function decideAppeal(actor: Actor, appealId: string, input: { outcome: Outcome; reply?: string | null }) {
  const reply = input.reply?.trim() ? input.reply.trim() : null
  if (reply && reply.length > REPLY_MAX) return fail(400, 'APPEAL_REPLY_LENGTH', `The reply must be at most ${REPLY_MAX} characters`)
  const { rows } = await db.query<AppealRow>(`${APPEAL_SQL} WHERE a.id = $1`, [appealId])
  const a = rows[0]
  if (!a) return fail(404, 'NOT_FOUND', 'Appeal not found')
  if (a.status !== 'open') return fail(409, 'APPEAL_DECIDED', 'This appeal has already been decided')
  const why = whyNot(actor.userId, a)
  if (why === 'APPEAL_OWN') return fail(403, why, 'You cannot decide your own appeal')
  if (why === 'APPEAL_SAME_AUTHOR') return fail(403, why, 'Another team member must review a decision you took')
  if (!actor.access.permissions.includes('moderate_members')) return fail(403, 'FORBIDDEN', 'Missing permission: moderate_members')
  // Le garde-fou de rang du barème : jamais sur un pair ou plus haut
  const target = await checkTarget(actor, a.user_id)
  if (!target.ok) return target

  // Réserver la contestation : deux personnes qui tranchent en même temps, une seule gagne
  const { rows: won } = await db.query(
    `UPDATE octoguard_appeals SET status = $2, handled_by = $3, handled_at = NOW(), reply = $4
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [appealId, input.outcome, actor.userId, reply])
  if (!won.length) return fail(409, 'APPEAL_DECIDED', 'This appeal has already been decided')

  let undone = false
  if (input.outcome === 'overturned') {
    const d = await loadDecision(a.decision_type, a.decision_id)
    try {
      if (d && !d.undone) {
        if (d.ladder_id && d.ladder_status === 'applied') {
          // Une marche du barème : la défaire remet aussi le membre une marche plus bas
          const r = await undoLadder(actor, d.ladder_id)
          if (!r.ok && r.code !== 'ALREADY_UNDONE' && r.code !== 'NOTHING_TO_UNDO') throw Object.assign(new Error(r.error), { fail: r })
        } else if (d.type === 'warn') {
          await db.query(`UPDATE octoguard_warns SET cleared_at = NOW() WHERE id = $1 AND cleared_at IS NULL`, [d.id])
        } else if (d.active) {
          await removeMute(d.id, actor.userId)
        }
        undone = true
      }
    } catch (err) {
      // L'annulation n'a pas pu se faire : la contestation redevient à trancher
      await db.query(`UPDATE octoguard_appeals SET status = 'open', handled_by = NULL, handled_at = NULL, reply = NULL WHERE id = $1`, [appealId])
      const f = (err as { fail?: Fail }).fail
      return f ?? fail(500, 'APPEAL_UNDO_FAILED', 'The decision could not be undone')
    }
  }

  journal(input.outcome === 'overturned' ? 'octoguard.appeal_overturned' : 'octoguard.appeal_upheld', a.user_id, actor.userId, 'admin',
    { appeal_id: appealId, decision_type: a.decision_type, decision_id: a.decision_id, undone })
  try {
    // Structure seulement : l'écran du membre construit la phrase. La réponse est celle d'un humain.
    await NotificationModel.create({ user_id: a.user_id, type: 'appeal_resolved', meta: { outcome: input.outcome, decision_type: a.decision_type, ...(reply ? { reply } : {}) } })
    if (io) io.to(`user:${a.user_id}`).emit('notification:new', { unreadCount: await NotificationModel.getUnreadCount(a.user_id) })
  } catch { /* la notification ne bloque jamais la décision */ }
  return { ok: true as const, status: input.outcome, undone }
}
