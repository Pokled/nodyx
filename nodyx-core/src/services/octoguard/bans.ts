/**
 * OctoGuard 2 : le bannissement temporaire pour de vrai (CDC OctoGuard 2, E4a).
 *
 * Avant : l'action « ban_temp » bloquait le message et journalisait « stub ».
 * Maintenant : une ligne community_bans avec expires_at, le membre sort de la
 * communauté (comme un bannissement manuel), et un worker lève les
 * bannissements arrivés à échéance. Le membre retrouve sa place à sa
 * prochaine connexion (auth.ts réinscrit tout compte non banni).
 */

import { db } from '../../config/database'
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
  reason:   string
  ruleId?:  string | null
  eventId?: string
}

/** Pose un bannissement temporaire. Ne lève jamais : renvoie false en cas d'échec. */
export async function applyTempBan(input: TempBanInput): Promise<boolean> {
  try {
    const communityId = await getInstanceCommunityId()
    if (!communityId) return false
    const expiresAt = expiryFrom(input.duration)
    // Un bannissement définitif déjà en place n'est jamais raccourci
    const { rows } = await db.query<{ user_id: string }>(
      `INSERT INTO community_bans (community_id, user_id, banned_by, reason, expires_at)
       VALUES ($1, $2, NULL, $3, $4)
       ON CONFLICT (community_id, user_id) DO UPDATE
         SET expires_at = GREATEST(community_bans.expires_at, EXCLUDED.expires_at),
             reason     = EXCLUDED.reason
         WHERE community_bans.expires_at IS NOT NULL
       RETURNING user_id`,
      [communityId, input.userId, input.reason, expiresAt]
    )
    if (!rows[0]) return true // déjà banni définitivement
    await db.query(`DELETE FROM community_members WHERE community_id = $1 AND user_id = $2 AND role NOT IN ('owner', 'admin')`, [communityId, input.userId])
    await invalidatePermissions(communityId)
    logOctoGuardAction({
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
    const { rows } = await db.query<{ user_id: string; community_id: string }>(
      `DELETE FROM community_bans WHERE expires_at IS NOT NULL AND expires_at <= NOW()
       RETURNING user_id, community_id`
    )
    for (const r of rows) {
      logOctoGuardAction({
        action: 'octoguard.ban_expired', target_type: 'user', target_id: r.user_id, target_label: null,
        metadata: { event_id: 'ban-expired', actor: 'octoguard:auto' },
      })
    }
    if (rows.length) await invalidatePermissions(rows[0].community_id)
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
