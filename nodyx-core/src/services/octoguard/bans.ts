/**
 * OctoGuard 2 : le bannissement temporaire pour de vrai (CDC OctoGuard 2, E4a).
 *
 * Avant : l'action « ban_temp » bloquait le message et journalisait « stub ».
 * Maintenant : une ligne community_bans avec expires_at, le membre sort de la
 * communauté (comme un bannissement manuel), et un worker lève les
 * bannissements arrivés à échéance.
 *
 * Lot 4a (08/11/2026), deux défauts corrigés :
 *  - la marque Redis `banned:<id>` (qui bloque toute l'API et le temps réel)
 *    était posée SANS échéance à la connexion d'un membre exclu, et jamais
 *    effacée à la levée : une exclusion de 7 jours devenait définitive dès
 *    que la personne tentait de se reconnecter. Elle porte maintenant
 *    l'échéance de l'exclusion, et la levée l'efface ;
 *  - le membre perdait son rôle, son grade et sa date d'arrivée : ils sont
 *    gardés dans la ligne d'exclusion et rendus à la levée (D32).
 */

import { db, redis } from '../../config/database'
import { getInstanceCommunityId } from '../../middleware/adminOnly'
import { invalidatePermissions } from '../permissions'
import { logOctoGuardAction } from './logger'
import type { Duration } from './types'

const DEFAULT_TEMP_BAN_MS = 24 * 3_600_000
const PURGE_INTERVAL_MS = 60_000

export function expiryFrom(duration: Duration | null | undefined, now = Date.now()): Date {
  if (!duration) return new Date(now + DEFAULT_TEMP_BAN_MS)
  const unitMs = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 7 * 86_400_000, M: 30 * 86_400_000 }[duration.unit]
  const ms = (unitMs ?? 0) * duration.value
  return new Date(now + (ms > 0 ? ms : DEFAULT_TEMP_BAN_MS))
}

export interface TempBanInput {
  userId:   string
  duration: Duration | null | undefined
  reason:   string | null
  ruleId?:  string | null
  eventId?: string
  /** Qui exclut (l'équipe via le barème). Absent = OctoGuard. */
  actorId?: string | null
  /** true : l'appelant écrit lui-même au journal (le barème : une seule entrée par étape). */
  silent?:  boolean
}

/** Délai de grâce ajouté à la marque Redis : la levée tourne chaque minute. */
const MARK_GRACE_S = 5

/**
 * Pose la marque Redis qui bloque l'API et le temps réel. Une exclusion
 * temporaire porte son échéance ; null = bannissement définitif. Une échéance
 * déjà passée (levée pas encore faite) bloque jusqu'à la prochaine levée.
 */
export async function setBanMark(userId: string, expiresAt: Date | string | null): Promise<void> {
  if (expiresAt === null) { await redis.set(`banned:${userId}`, '1'); return }
  const left = Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 1000)
  await redis.set(`banned:${userId}`, '1', 'EX', Math.max(left, 0) + (left > 0 ? MARK_GRACE_S : PURGE_INTERVAL_MS / 1000))
}

export interface LiftedBan {
  user_id: string
  community_id: string
  prev_role: string | null
  prev_grade_id: string | null
  prev_joined_at: string | null
}

/**
 * Après la levée d'une exclusion (échéance ou débannissement manuel) : efface
 * la marque Redis et rend au membre son rôle, son grade et sa date d'arrivée.
 * Le grade n'est rendu que s'il existe encore. Une ligne de membre déjà
 * présente n'est pas écrasée. Ne lève jamais.
 */
export async function restoreAfterBan(lifted: LiftedBan[]): Promise<void> {
  for (const b of lifted) {
    try {
      await redis.del(`banned:${b.user_id}`)
      if (!b.prev_role) continue
      await db.query(
        `INSERT INTO community_members (community_id, user_id, role, grade_id, joined_at)
         VALUES ($1, $2, $3, (SELECT id FROM community_grades WHERE id = $4::uuid), COALESCE($5::timestamp, NOW()))
         ON CONFLICT (community_id, user_id) DO NOTHING`,
        [b.community_id, b.user_id, b.prev_role, b.prev_grade_id, b.prev_joined_at]
      )
    } catch (err) {
      console.warn('[octoguard:bans] restoreAfterBan failed for', b.user_id, err)
    }
  }
  const communities = [...new Set(lifted.map(b => b.community_id))]
  for (const c of communities) await invalidatePermissions(c)
}

/** Pose un bannissement temporaire. Ne lève jamais : renvoie false en cas d'échec. */
export async function applyTempBan(input: TempBanInput): Promise<boolean> {
  try {
    const communityId = await getInstanceCommunityId()
    if (!communityId) return false
    const expiresAt = expiryFrom(input.duration)
    // Ce que le membre était, pour le lui rendre à l'échéance (D32)
    const { rows: was } = await db.query<{ role: string; grade_id: string | null; joined_at: string }>(
      `SELECT role, grade_id, joined_at FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [communityId, input.userId]
    )
    const prev = was[0] ?? null
    // Un bannissement définitif déjà en place n'est jamais raccourci. Une
    // exclusion prolongée garde ce que le membre était AVANT la première.
    const { rows } = await db.query<{ user_id: string; expires_at: string }>(
      `INSERT INTO community_bans (community_id, user_id, banned_by, reason, expires_at, prev_role, prev_grade_id, prev_joined_at)
       VALUES ($1, $2, $8, $3, $4, $5, $6, $7)
       ON CONFLICT (community_id, user_id) DO UPDATE
         SET expires_at     = GREATEST(community_bans.expires_at, EXCLUDED.expires_at),
             reason         = EXCLUDED.reason,
             prev_role      = COALESCE(community_bans.prev_role, EXCLUDED.prev_role),
             prev_grade_id  = COALESCE(community_bans.prev_grade_id, EXCLUDED.prev_grade_id),
             prev_joined_at = COALESCE(community_bans.prev_joined_at, EXCLUDED.prev_joined_at)
         WHERE community_bans.expires_at IS NOT NULL
       RETURNING user_id, expires_at`,
      [communityId, input.userId, input.reason, expiresAt, prev?.role ?? null, prev?.grade_id ?? null, prev?.joined_at ?? null, input.actorId ?? null]
    )
    if (!rows[0]) return true // déjà banni définitivement
    // Les sessions déjà ouvertes sont bloquées tout de suite, jusqu'à l'échéance
    await setBanMark(input.userId, rows[0].expires_at)
    await db.query(`DELETE FROM community_members WHERE community_id = $1 AND user_id = $2 AND role NOT IN ('owner', 'admin')`, [communityId, input.userId])
    await invalidatePermissions(communityId)
    if (!input.silent) logOctoGuardAction({
      action:       'octoguard.ban_temp_user',
      target_type:  'user',
      target_id:    input.userId,
      target_label: input.reason,
      metadata:     { event_id: input.eventId ?? 'ban-temp', actor: 'octoguard:auto', rule_id: input.ruleId ?? undefined, expires_at: expiresAt.toISOString() },
    })
    return true
  } catch (err) {
    console.warn('[octoguard:bans] applyTempBan failed:', err)
    return false
  }
}

/** Lève les bannissements temporaires échus. Renvoie le nombre levé. */
export async function purgeExpiredBans(): Promise<number> {
  try {
    const { rows } = await db.query<LiftedBan>(
      `DELETE FROM community_bans WHERE expires_at IS NOT NULL AND expires_at <= NOW()
       RETURNING user_id, community_id, prev_role, prev_grade_id, prev_joined_at::text AS prev_joined_at`
    )
    for (const r of rows) {
      logOctoGuardAction({
        action: 'octoguard.ban_expired', target_type: 'user', target_id: r.user_id, target_label: null,
        metadata: { event_id: 'ban-expired', actor: 'octoguard:auto' },
      })
    }
    // La marque Redis s'efface et le membre retrouve son rôle et son grade
    if (rows.length) await restoreAfterBan(rows)
    return rows.length
  } catch (err) {
    console.warn('[octoguard:bans] purgeExpiredBans failed:', err)
    return 0
  }
}

let _timer: NodeJS.Timeout | null = null
export function startBanExpiryWorker(): void {
  if (_timer) return
  _timer = setInterval(() => {
    purgeExpiredBans().then(n => { if (n > 0) console.log(`[octoguard:bans] lifted ${n} expired temporary ban(s)`) })
  }, PURGE_INTERVAL_MS)
  if (_timer.unref) _timer.unref()
}
