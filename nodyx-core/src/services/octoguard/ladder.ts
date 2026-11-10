/**
 * OctoGuard 2, lot 4b : le barème des sanctions (CDC §E4i, D27-D32 validées le 09/11).
 *
 * Principe (Jonathan) : simple et intransigeant. Un humain décide, le serveur refuse
 * ce qui n'a pas de sens, et rien n'est réglable au-delà de la maquette :
 *  - 4 étapes, chacune choisie dans une LISTE FERMÉE (SANCTIONS), jamais plus douce
 *    que la précédente (une étape égale est permise) ;
 *  - l'oubli : 30, 60 ou 90 jours ;
 *  - la double validation : oui ou non. Elle joue pour une exclusion de 7 jours ou
 *    plus et n'est activable qu'à deux personnes ayant le droit d'exclure.
 * Le garde-fou contre l'énervement : toute exclusion demande un motif écrit.
 *
 * La position d'un membre se calcule à la lecture : dernière étape appliquée, moins
 * une étape par période d'oubli écoulée depuis. Aucune tâche planifiée ne la change.
 *
 * Règle de langue (§E4i) : rien n'est enregistré en phrase. Le journal et la table
 * ne portent que des valeurs ; « Barème, étape 2 » se construit à l'affichage.
 */
import { db } from '../../config/database'
import { getInstanceCommunityId } from '../../middleware/adminOnly'
import { getInstanceAccess, outranks, rankOf, invalidatePermissions, type MemberAccess } from '../permissions'
import { applyMute, removeMute } from './mutes'
import { applyTempBan, restoreAfterBan, type LiftedBan } from './bans'
import { logOctoGuardAction } from './logger'
import { closeReports, claimReports } from './reportClose'
import * as NotificationModel from '../../models/notification'
import { io } from '../../socket/io'
import { randomUUID } from 'crypto'

/** Une entrée de journal du barème : des valeurs, jamais une phrase (§E4i). */
function journal(action: string, targetId: string | null, label: string | null, actorId: string | null, meta: Record<string, unknown>): void {
  logOctoGuardAction({
    action, target_type: targetId ? 'user' : null, target_id: targetId, target_label: label, actor_id: actorId,
    metadata: { event_id: randomUUID(), actor: actorId ? 'admin' : 'octoguard:auto', ...meta },
  })
}

// ─── La liste fermée, du plus doux au plus ferme ────────────────────────────

export const SANCTIONS = ['warn', 'mute_10m', 'mute_1h', 'mute_24h', 'mute_7d', 'ban_1d', 'ban_7d', 'ban_30d'] as const
export type Sanction = typeof SANCTIONS[number]
export const SANCTION_MINUTES: Record<Sanction, number> = {
  warn: 0, mute_10m: 10, mute_1h: 60, mute_24h: 1440, mute_7d: 10_080, ban_1d: 1440, ban_7d: 10_080, ban_30d: 43_200,
}
export const FORGET_CHOICES = [30, 60, 90] as const
export const LADDER_STEPS = 4
/** Une demande sans second avis tombe au bout de 72 h. */
export const PENDING_HOURS = 72
/** Une exclusion de 7 jours OU PLUS demande un second avis (si la double validation est activée). */
export const SECOND_OPINION_FROM_MINUTES = 7 * 1440

export type SanctionKind = 'warn' | 'mute' | 'ban'
export const kindOf = (s: Sanction): SanctionKind => s === 'warn' ? 'warn' : s.startsWith('mute') ? 'mute' : 'ban'
export const needsSecondOpinion = (s: Sanction): boolean => kindOf(s) === 'ban' && SANCTION_MINUTES[s] >= SECOND_OPINION_FROM_MINUTES

export interface LadderSettings {
  steps: Sanction[]
  forget_days: number
  double_validation: boolean
}
export const DEFAULT_SETTINGS: LadderSettings = { steps: ['warn', 'mute_1h', 'mute_24h', 'ban_7d'], forget_days: 30, double_validation: false }

/** 4 valeurs de la liste fermée, chacune au moins aussi ferme que la précédente. null sinon. */
export function validateSteps(steps: unknown): Sanction[] | null {
  if (!Array.isArray(steps) || steps.length !== LADDER_STEPS) return null
  let prev = -1
  for (const s of steps) {
    const i = SANCTIONS.indexOf(s as Sanction)
    if (i < 0 || i < prev) return null
    prev = i
  }
  return steps as Sanction[]
}

/** Position actuelle : dernière étape appliquée, moins une étape par période d'oubli écoulée. */
export function positionOf(last: { step: number; at: string | Date } | null, forgetDays: number, now = Date.now()): number {
  if (!last) return 0
  const elapsedDays = (now - new Date(last.at).getTime()) / 86_400_000
  return Math.max(0, last.step - Math.floor(elapsedDays / forgetDays))
}

/** L'étape suivante, ou null : au-delà de la dernière, c'est la décision d'un admin. */
export const nextStepOf = (position: number): number | null => position >= LADDER_STEPS ? null : position + 1

// ─── Réglages ───────────────────────────────────────────────────────────────

export async function getLadderSettings(): Promise<LadderSettings> {
  const { rows } = await db.query<{ steps: string[]; forget_days: number; double_validation: boolean }>(
    `SELECT steps, forget_days, double_validation FROM octoguard_ladder_settings WHERE id = 1`)
  const r = rows[0]
  if (!r) return DEFAULT_SETTINGS
  return { steps: validateSteps(r.steps) ?? DEFAULT_SETTINGS.steps, forget_days: r.forget_days, double_validation: r.double_validation }
}

/** Les personnes de l'équipe (comptes système exclus) qui peuvent exclure, hors `except`. */
async function banCapableIds(except: string | null): Promise<string[]> {
  const communityId = await getInstanceCommunityId()
  const { rows } = await db.query<{ user_id: string }>(
    `SELECT cm.user_id
       FROM community_members cm
       JOIN users u ON u.id = cm.user_id AND u.is_system = false
       LEFT JOIN community_grades cg ON cg.id = cm.grade_id AND cg.community_id = cm.community_id
      WHERE cm.community_id = $1
        AND (cm.role IN ('owner', 'admin') OR cg.permissions -> 'ban_members' = 'true'::jsonb)
        AND ($2::uuid IS NULL OR cm.user_id <> $2::uuid)`,
    [communityId, except])
  return rows.map(r => r.user_id)
}
export const countBanCapable = async (except: string | null): Promise<number> => (await banCapableIds(except)).length

export type Fail = { ok: false; status: number; code: string; error: string }
const fail = (status: number, code: string, error: string): Fail => ({ ok: false, status, code, error })

export async function saveLadderSettings(input: { steps: unknown; forget_days: unknown; double_validation: unknown }, actorId: string): Promise<{ ok: true; settings: LadderSettings } | Fail> {
  const steps = validateSteps(input.steps)
  if (!steps) return fail(400, 'LADDER_STEPS_INVALID', 'Four steps from the list, never milder than the previous one')
  if (!FORGET_CHOICES.includes(input.forget_days as 30)) return fail(400, 'LADDER_FORGET_INVALID', 'Forget period must be 30, 60 or 90 days')
  if (typeof input.double_validation !== 'boolean') return fail(400, 'INVALID_REQUEST', 'double_validation must be a boolean')
  if (input.double_validation && await countBanCapable(null) < 2) {
    return fail(409, 'LADDER_NEEDS_TWO', 'Double validation needs at least two team members allowed to ban')
  }
  await db.query(
    `UPDATE octoguard_ladder_settings SET steps = $1, forget_days = $2, double_validation = $3, updated_by = $4, updated_at = NOW() WHERE id = 1`,
    [steps, input.forget_days, input.double_validation, actorId])
  journal('octoguard.ladder_settings', null, null, actorId, { steps, forget_days: input.forget_days, double_validation: input.double_validation })
  return { ok: true, settings: { steps, forget_days: input.forget_days as number, double_validation: input.double_validation } }
}

// ─── Lecture : où en est un membre ──────────────────────────────────────────

export interface LadderRow {
  id: string; user_id: string; step: number; sanction: Sanction; status: string
  actor_id: string | null; second_id: string | null; reason: string | null
  report_id: string | null; report_category: string | null
  mute_id: string | null; warn_id: string | null; created_at: string
}
const ROW_COLS = `id, user_id, step, sanction, status, actor_id, second_id, reason, report_id, report_category, mute_id, warn_id, created_at::text AS created_at`

async function lastApplied(userId: string): Promise<{ step: number; at: string } | null> {
  const { rows } = await db.query<{ step: number; at: string }>(
    `SELECT step, created_at::text AS at FROM octoguard_ladder
      WHERE user_id = $1 AND status = 'applied' ORDER BY created_at DESC LIMIT 1`, [userId])
  return rows[0] ?? null
}

export async function memberLadder(userId: string) {
  const settings = await getLadderSettings()
  const position = positionOf(await lastApplied(userId), settings.forget_days)
  const next = nextStepOf(position)
  const { rows: history } = await db.query<LadderRow & { actor: string | null; second: string | null }>(
    `SELECT l.id, l.user_id, l.step, l.sanction, l.status, l.actor_id, l.second_id, l.reason, l.report_id, l.report_category,
            l.mute_id, l.warn_id, l.created_at::text AS created_at, a.username AS actor, s.username AS second
       FROM octoguard_ladder l
       LEFT JOIN users a ON a.id = l.actor_id
       LEFT JOIN users s ON s.id = l.second_id
      WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 20`, [userId])
  return {
    position,
    next: next ? { step: next, sanction: settings.steps[next - 1] } : null,
    pending: history.find(h => h.status === 'pending') ?? null,
    history,
    settings,
  }
}

// ─── Appliquer ──────────────────────────────────────────────────────────────

/**
 * Un seul calcul à la fois par membre : deux modérateurs qui cliquent en même temps
 * ne posent pas deux étapes. Le cœur tourne en un seul processus ; `expected_step`
 * (l'étape que l'écran affichait) protège en plus contre un écran périmé.
 */
const locks = new Map<string, Promise<unknown>>()
async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  locks.set(key, run)
  try { return await run } finally { if (locks.get(key) === run) locks.delete(key) }
}

interface Actor { userId: string; access: MemberAccess }

/** Le garde-fou de rang, comme partout : jamais le propriétaire, jamais soi-même, jamais un pair. */
async function checkTarget(actor: Actor, targetId: string): Promise<{ ok: true; username: string } | Fail> {
  if (targetId === actor.userId) return fail(403, 'RANK_TOO_LOW', 'Cannot sanction yourself')
  const { rows } = await db.query<{ username: string; is_system: boolean }>(`SELECT username, is_system FROM users WHERE id = $1`, [targetId])
  if (!rows[0] || rows[0].is_system) return fail(404, 'NOT_FOUND', 'Member not found')
  // Une personne exclue n'est plus membre : son rang est celui qu'elle avait AVANT
  // (gardé dans la ligne d'exclusion depuis #957). Sinon, n'importe quel modérateur
  // « dépasserait » un autre modérateur exclu, et pourrait lever son exclusion.
  let role = (await getInstanceAccess(targetId)).role as string | null
  if (!role) {
    const { rows: was } = await db.query<{ prev_role: string | null }>(
      `SELECT prev_role FROM community_bans WHERE community_id = $1 AND user_id = $2`, [await getInstanceCommunityId(), targetId])
    role = was[0]?.prev_role ?? null
  }
  if (role === 'owner' || !(actor.access.rank >= rankOf('admin') || outranks(actor.access, role))) {
    return fail(403, 'RANK_TOO_LOW', 'Cannot act on a member of equal or higher rank')
  }
  return { ok: true, username: rows[0].username }
}

function permissionFor(s: Sanction): 'ban_members' | 'moderate_members' {
  return kindOf(s) === 'ban' ? 'ban_members' : 'moderate_members'
}

/** Pose la sanction avec les vrais outils. Renvoie les identifiants, ou null si elle a échoué. */
async function perform(row: { user_id: string; sanction: Sanction; step: number; reason: string | null }, actorId: string): Promise<{ mute_id?: string; warn_id?: string } | null> {
  const minutes = SANCTION_MINUTES[row.sanction]
  const kind = kindOf(row.sanction)
  if (kind === 'warn') {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO octoguard_warns (user_id, reason, issued_by) VALUES ($1, $2, $3) RETURNING id`,
      [row.user_id, row.reason, actorId])
    try {
      // Structure seulement : l'écran du membre dit « avertissement », et le motif s'il y en a un
      await NotificationModel.create({ user_id: row.user_id, type: 'moderation_warning', meta: { ladder_step: row.step, ...(row.reason ? { reason: row.reason } : {}) } })
      if (io) io.to(`user:${row.user_id}`).emit('notification:new', { unreadCount: await NotificationModel.getUnreadCount(row.user_id) })
    } catch { /* la notification ne bloque jamais la sanction */ }
    return { warn_id: rows[0].id }
  }
  if (kind === 'mute') {
    const mute = await applyMute({ userId: row.user_id, duration: { value: minutes, unit: 'm' }, reason: row.reason, appliedBy: actorId, silent: true })
    return mute ? { mute_id: mute.id } : null
  }
  const ok = await applyTempBan({ userId: row.user_id, duration: { value: minutes, unit: 'm' }, reason: row.reason, actorId, silent: true })
  if (!ok) return null
  // Les connexions en direct tombent tout de suite (sinon jusqu'à 30 s de répit)
  if (io) {
    try {
      for (const s of await io.in(`user:${row.user_id}`).fetchSockets()) { s.emit('banned', { message: 'banned' }); s.disconnect(true) }
    } catch { /* la vérification périodique du socket rattrape */ }
  }
  return {}
}

type Applied = { ok: true; status: 'applied' | 'pending'; ladder_id: string; step: number; sanction: Sanction }

export async function applyLadder(actor: Actor, input: { user_id: string; expected_step: number; report_id?: string | null; reason?: string | null }): Promise<Applied | Fail> {
  const who = await checkTarget(actor, input.user_id)
  if (!who.ok) return who
  return withLock(input.user_id, async () => {
    const settings = await getLadderSettings()
    const next = nextStepOf(positionOf(await lastApplied(input.user_id), settings.forget_days))
    if (next === null) return fail(409, 'LADDER_MAX_REACHED', 'Beyond the last step, an admin decides')
    if (next !== input.expected_step) return fail(409, 'LADDER_STEP_CHANGED', 'The member moved on the ladder meanwhile')
    const sanction = settings.steps[next - 1]
    if (!actor.access.permissions.includes(permissionFor(sanction))) return fail(403, 'FORBIDDEN', `Missing permission: ${permissionFor(sanction)}`)
    const reason = input.reason?.trim() || null
    // Le garde-fou contre l'énervement : une exclusion s'écrit
    if (kindOf(sanction) === 'ban' && (!reason || reason.length < 3)) return fail(400, 'LADDER_REASON_REQUIRED', 'A ban needs a written reason')

    const { rows: pend } = await db.query(`SELECT 1 FROM octoguard_ladder WHERE user_id = $1 AND status = 'pending'`, [input.user_id])
    if (pend.length) return fail(409, 'LADDER_PENDING_APPROVAL', 'A ban for this member is waiting for a second opinion')

    let report: { id: string; target_type: string; target_id: string; category: string | null } | null = null
    if (input.report_id) {
      const { rows } = await db.query<{ id: string; target_type: string; target_id: string; category: string | null; target_author_id: string | null; status: string }>(
        `SELECT id, target_type, target_id, category, target_author_id, status FROM reports WHERE id = $1`, [input.report_id])
      const r = rows[0]
      if (!r) return fail(404, 'NOT_FOUND', 'Report not found')
      const about = r.target_author_id === input.user_id || (r.target_type === 'user' && r.target_id === input.user_id)
      if (!about) return fail(400, 'LADDER_REPORT_MISMATCH', 'This report is not about this member')
      if (r.status !== 'open') return fail(409, 'ALREADY_DECIDED', 'This report is already closed')
      report = r
    }

    const pending = settings.double_validation && needsSecondOpinion(sanction)
    if (pending && await countBanCapable(actor.userId) < 1) {
      return fail(409, 'LADDER_NO_SECOND_VALIDATOR', 'Nobody else can give the second opinion')
    }

    const { rows: ins } = await db.query<{ id: string }>(
      `INSERT INTO octoguard_ladder (user_id, step, sanction, status, actor_id, reason, report_id, report_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [input.user_id, next, sanction, pending ? 'pending' : 'applied', actor.userId, reason, report?.id ?? null, report?.category ?? null])
    const ladderId = ins[0].id
    const meta = { via: 'ladder', ladder_id: ladderId, step: next, sanction, duration_min: SANCTION_MINUTES[sanction], report_id: report?.id ?? null, report_category: report?.category ?? null }

    if (pending) {
      if (report) await claimReports(report.id, actor.userId)
      await notifySecondOpinion(actor.userId, ladderId, input.user_id, who.username)
      journal('octoguard.ladder_proposed', input.user_id, who.username, actor.userId, meta)
      return { ok: true, status: 'pending', ladder_id: ladderId, step: next, sanction }
    }

    const done = await perform({ user_id: input.user_id, sanction, step: next, reason }, actor.userId)
    if (!done) {
      await db.query(`DELETE FROM octoguard_ladder WHERE id = $1`, [ladderId])
      return fail(500, 'LADDER_APPLY_FAILED', 'The sanction could not be applied')
    }
    await db.query(`UPDATE octoguard_ladder SET mute_id = $2, warn_id = $3 WHERE id = $1`, [ladderId, done.mute_id ?? null, done.warn_id ?? null])
    if (report) await closeReports(report, 'actioned', actor.userId, null)
    journal('octoguard.ladder_applied', input.user_id, who.username, actor.userId, { ...meta, undoable: true, undo_op: { type: 'ladder_undo', ladder_id: ladderId } })
    return { ok: true, status: 'applied', ladder_id: ladderId, step: next, sanction }
  })
}

/** Prévient les personnes qui peuvent donner le second avis (pas celle qui propose). */
async function notifySecondOpinion(proposerId: string, ladderId: string, userId: string, username: string): Promise<void> {
  try {
    for (const id of await banCapableIds(proposerId)) {
      await NotificationModel.create({ user_id: id, type: 'ladder_pending', actor_id: proposerId, meta: { ladder_id: ladderId, user_id: userId, username } })
      if (io) io.to(`user:${id}`).emit('notification:new', { unreadCount: await NotificationModel.getUnreadCount(id) })
    }
  } catch { /* la notification ne bloque jamais la demande */ }
}

// ─── Le second avis ─────────────────────────────────────────────────────────

async function loadRow(id: string): Promise<LadderRow | null> {
  const { rows } = await db.query<LadderRow>(`SELECT ${ROW_COLS} FROM octoguard_ladder WHERE id = $1`, [id])
  return rows[0] ?? null
}

export async function approveLadder(actor: Actor, ladderId: string): Promise<Applied | Fail> {
  const row = await loadRow(ladderId)
  if (!row) return fail(404, 'NOT_FOUND', 'Not found')
  if (row.status !== 'pending') return fail(409, 'ALREADY_DECIDED', 'Already decided')
  if (row.actor_id === actor.userId) return fail(403, 'CANNOT_APPROVE_OWN', 'The second opinion must come from someone else')
  if (!actor.access.permissions.includes('ban_members')) return fail(403, 'FORBIDDEN', 'Missing permission: ban_members')
  const who = await checkTarget(actor, row.user_id)
  if (!who.ok) return who
  if (Date.now() - new Date(row.created_at).getTime() > PENDING_HOURS * 3_600_000) {
    await expirePendingLadder()
    return fail(409, 'LADDER_EXPIRED', 'The request expired after 72 hours')
  }
  // Prendre la décision AVANT d'agir : un second clic, même simultané, ne passe pas
  const { rows: won } = await db.query(
    `UPDATE octoguard_ladder SET status = 'applied', second_id = $2, decided_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id`,
    [ladderId, actor.userId])
  if (!won.length) return fail(409, 'ALREADY_DECIDED', 'Already decided')
  const done = await perform({ user_id: row.user_id, sanction: row.sanction, step: row.step, reason: row.reason }, row.actor_id ?? actor.userId)
  if (!done) {
    await db.query(`UPDATE octoguard_ladder SET status = 'pending', second_id = NULL, decided_at = NULL WHERE id = $1`, [ladderId])
    return fail(500, 'LADDER_APPLY_FAILED', 'The sanction could not be applied')
  }
  if (row.report_id) {
    const { rows: rep } = await db.query<{ id: string; target_type: string; target_id: string }>(`SELECT id, target_type, target_id FROM reports WHERE id = $1`, [row.report_id])
    if (rep[0]) await closeReports(rep[0], 'actioned', actor.userId, null)
  }
  journal('octoguard.ladder_approved', row.user_id, who.username, actor.userId, { via: 'ladder', ladder_id: ladderId, step: row.step, sanction: row.sanction, duration_min: SANCTION_MINUTES[row.sanction], proposed_by: row.actor_id,
      report_id: row.report_id, report_category: row.report_category, undoable: true, undo_op: { type: 'ladder_undo', ladder_id: ladderId } })
  return { ok: true, status: 'applied', ladder_id: ladderId, step: row.step, sanction: row.sanction }
}

/** Refuser (ou, pour la personne qui l'a proposée, retirer) une demande. */
export async function refuseLadder(actor: Actor, ladderId: string): Promise<{ ok: true } | Fail> {
  const row = await loadRow(ladderId)
  if (!row) return fail(404, 'NOT_FOUND', 'Not found')
  if (!actor.access.permissions.includes('ban_members')) return fail(403, 'FORBIDDEN', 'Missing permission: ban_members')
  const { rows } = await db.query(
    `UPDATE octoguard_ladder SET status = 'refused', second_id = $2, decided_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING id`,
    [ladderId, actor.userId])
  if (!rows.length) return fail(409, 'ALREADY_DECIDED', 'Already decided')
  if (row.report_id) await claimReports(row.report_id, null)   // le dossier redevient libre
  journal('octoguard.ladder_refused', row.user_id, null, actor.userId, { via: 'ladder', ladder_id: ladderId, step: row.step, sanction: row.sanction, proposed_by: row.actor_id, withdrawn: row.actor_id === actor.userId })
  return { ok: true }
}

/** Les demandes sans réponse depuis 72 h tombent ; la personne qui l'a proposée est prévenue. */
export async function expirePendingLadder(): Promise<number> {
  try {
    const { rows } = await db.query<{ id: string; user_id: string; username: string; actor_id: string | null; report_id: string | null; step: number; sanction: string }>(
      `UPDATE octoguard_ladder l SET status = 'expired', decided_at = NOW()
         FROM users u
        WHERE u.id = l.user_id AND l.status = 'pending' AND l.created_at < NOW() - ($1 || ' hours')::interval
        RETURNING l.id, l.user_id, u.username, l.actor_id, l.report_id, l.step, l.sanction`, [String(PENDING_HOURS)])
    for (const r of rows) {
      if (r.report_id) await claimReports(r.report_id, null)
      journal('octoguard.ladder_expired', r.user_id, null, null, { via: 'ladder', ladder_id: r.id, step: r.step, sanction: r.sanction, proposed_by: r.actor_id })
      if (r.actor_id) {
        try {
          await NotificationModel.create({ user_id: r.actor_id, type: 'ladder_expired', meta: { ladder_id: r.id, user_id: r.user_id, username: r.username } })
        } catch { /* rien de bloquant */ }
      }
    }
    return rows.length
  } catch (err) {
    console.warn('[octoguard:ladder] expirePendingLadder failed:', err)
    return 0
  }
}

// ─── Annuler ────────────────────────────────────────────────────────────────

/** Une étape annulée lève sa sanction et ne compte plus dans la position. */
export async function undoLadder(actor: Actor, ladderId: string): Promise<{ ok: true } | Fail> {
  const row = await loadRow(ladderId)
  if (!row) return fail(404, 'NOT_FOUND', 'Not found')
  if (row.status !== 'applied') return fail(409, 'NOTHING_TO_UNDO', 'Only an applied step can be undone')
  if (!actor.access.permissions.includes(permissionFor(row.sanction))) return fail(403, 'FORBIDDEN', `Missing permission: ${permissionFor(row.sanction)}`)
  const who = await checkTarget(actor, row.user_id)
  if (!who.ok) return who
  const { rows: won } = await db.query(
    `UPDATE octoguard_ladder SET status = 'undone', undone_by = $2, undone_at = NOW() WHERE id = $1 AND status = 'applied' RETURNING id`,
    [ladderId, actor.userId])
  if (!won.length) return fail(409, 'ALREADY_UNDONE', 'Already undone')

  const kind = kindOf(row.sanction)
  if (kind === 'warn' && row.warn_id) {
    await db.query(`UPDATE octoguard_warns SET cleared_at = NOW() WHERE id = $1 AND cleared_at IS NULL`, [row.warn_id])
  } else if (kind === 'mute' && row.mute_id) {
    await removeMute(row.mute_id, actor.userId)   // déjà levée : rien à faire
  } else if (kind === 'ban') {
    // Seulement une exclusion TEMPORAIRE : un bannissement définitif posé depuis reste en place
    const communityId = await getInstanceCommunityId()
    const { rows: lifted } = await db.query<LiftedBan>(
      `DELETE FROM community_bans WHERE community_id = $1 AND user_id = $2 AND expires_at IS NOT NULL
       RETURNING user_id, community_id, prev_role, prev_grade_id, prev_joined_at::text AS prev_joined_at`,
      [communityId, row.user_id])
    if (lifted.length) await restoreAfterBan(lifted)
    else await invalidatePermissions(communityId)
  }
  journal('octoguard.ladder_undone', row.user_id, who.username, actor.userId, { via: 'ladder', ladder_id: ladderId, step: row.step, sanction: row.sanction })
  return { ok: true }
}
