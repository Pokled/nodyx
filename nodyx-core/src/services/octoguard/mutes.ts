/**
 * OctoGuard, mutes / timeouts chat (Module 6, spec v2.1.1).
 *
 * Mute = restriction temporaire d'envoi de messages.
 * - Mute global : channel_id = NULL → bloque dans tous les channels de la communauté
 * - Mute par channel : channel_id = X → bloque uniquement dans ce channel
 * - expires_at = NULL → mute permanent (jusqu'à unmute manuel)
 * - expires_at futur → mute temporaire, purgé automatiquement par le worker
 *
 * Cache RAM avec TTL 60s par userId (cohérent avec project_octoguard_roadmap.md).
 * Worker setInterval 60s qui purge les mutes expirés.
 *
 * Le check mute se fait AVANT le pipeline auto-mod dans socket/index.ts
 * (un user muté ne doit pas matcher de règles ni polluer les logs).
 */

import { db } from '../../config/database'
import { logOctoGuardAction } from './logger'
import { randomUUID } from 'crypto'
import type { ChatMuteRow, Duration } from './types'

// ─── Cache RAM ───────────────────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000  // 60s : balance fraîcheur / pression DB

interface CacheEntry {
  ts:    number
  mutes: ChatMuteRow[]
}

const _cache = new Map<string, CacheEntry>()

function isFresh(entry: CacheEntry): boolean {
  return Date.now() - entry.ts < CACHE_TTL_MS
}

/** Invalide le cache pour un user (à appeler après apply/remove). */
export function invalidateMuteCache(userId: string): void {
  _cache.delete(userId)
}

/** Vide tout le cache (utile pour tests / shutdown). */
export function clearMuteCache(): void {
  _cache.clear()
}

// ─── Calcul d'expiration ─────────────────────────────────────────────────────

/** Convertit une Duration en Date d'expiration. Exposé pour les tests. */
export function durationToExpiresAt(duration: Duration | null): Date | null {
  if (!duration) return null
  const ms =
    duration.unit === 'm' ? duration.value * 60_000 :
    duration.unit === 'h' ? duration.value * 3_600_000 :
    duration.unit === 'd' ? duration.value * 86_400_000 :
    duration.unit === 'w' ? duration.value * 7 * 86_400_000 :
    duration.unit === 'M' ? duration.value * 30 * 86_400_000 :
    0
  if (ms <= 0) return null
  return new Date(Date.now() + ms)
}

// ─── Récupération des mutes actifs ───────────────────────────────────────────

async function loadActiveMutes(userId: string): Promise<ChatMuteRow[]> {
  const { rows } = await db.query<ChatMuteRow>(
    `SELECT id, user_id, channel_id, reason, applied_by,
            applied_at::text  AS applied_at,
            expires_at::text  AS expires_at
       FROM chat_mutes
      WHERE user_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId]
  )
  return rows
}

/**
 * Vérifie si un user est muté (global ou pour le channel donné).
 * Utilise le cache RAM avec TTL 60s, recharge si stale.
 *
 * Jamais throw : si erreur DB, retourne "non muté" (fail-open).
 */
export interface MuteCheckResult {
  muted:      boolean
  expires_at?: string | null
  reason?:    string | null
  channel_id?: string | null
}

export async function isUserMuted(
  userId:     string,
  channelId?: string,
): Promise<MuteCheckResult> {
  try {
    let entry = _cache.get(userId)
    if (!entry || !isFresh(entry)) {
      const mutes = await loadActiveMutes(userId)
      entry = { ts: Date.now(), mutes }
      _cache.set(userId, entry)
    }

    // Trouver un mute applicable : global (channel_id IS NULL) ou ciblé
    for (const m of entry.mutes) {
      if (m.channel_id === null || m.channel_id === channelId) {
        return {
          muted:       true,
          expires_at:  m.expires_at,
          reason:      m.reason,
          channel_id:  m.channel_id,
        }
      }
    }
    return { muted: false }
  } catch (err) {
    console.warn('[octoguard:mutes] isUserMuted error, fail-open:', err)
    return { muted: false }
  }
}

// ─── Application d'un mute ───────────────────────────────────────────────────

export interface ApplyMuteInput {
  userId:     string
  channelId?: string | null      // null = global
  duration?:  Duration | null    // null = permanent
  reason?:    string | null
  appliedBy?: string | null      // null = action automatique OctoGuard
  ruleId?:    string | null      // si déclenché par une règle auto-mod
  eventId?:   string             // si non fourni, généré ici (UUID v4)
}

export async function applyMute(input: ApplyMuteInput): Promise<ChatMuteRow | null> {
  try {
    const expiresAt = durationToExpiresAt(input.duration ?? null)
    const { rows } = await db.query<ChatMuteRow>(
      `INSERT INTO chat_mutes (user_id, channel_id, reason, applied_by, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, channel_id, reason, applied_by,
                 applied_at::text AS applied_at,
                 expires_at::text AS expires_at`,
      [
        input.userId,
        input.channelId ?? null,
        input.reason ?? null,
        input.appliedBy ?? null,
        expiresAt,
      ]
    )
    const row = rows[0]
    if (!row) return null

    invalidateMuteCache(input.userId)

    // Log dans admin_audit_log
    logOctoGuardAction({
      action:       'octoguard.mute_user',
      target_type:  'user',
      target_id:    input.userId,
      target_label: input.reason ?? null,
      metadata: {
        event_id:    input.eventId ?? randomUUID(),
        actor:       input.appliedBy ? 'admin' : 'octoguard:auto',
        rule_id:     input.ruleId ?? undefined,
        channel_id:  input.channelId ?? null,
        expires_at:  row.expires_at,
        duration:    input.duration ?? null,
        undoable:    true,
        undo_op:     { type: 'remove_mute', mute_id: row.id },
      },
    })

    return row
  } catch (err) {
    console.warn('[octoguard:mutes] applyMute error:', err)
    return null
  }
}

// ─── Suppression d'un mute ───────────────────────────────────────────────────

export async function removeMute(muteId: string, removedBy?: string | null): Promise<boolean> {
  try {
    const { rows } = await db.query<{ user_id: string }>(
      `DELETE FROM chat_mutes WHERE id = $1 RETURNING user_id`,
      [muteId]
    )
    if (!rows[0]) return false

    invalidateMuteCache(rows[0].user_id)

    logOctoGuardAction({
      action:       'octoguard.unmute_user',
      target_type:  'user',
      target_id:    rows[0].user_id,
      target_label: null,
      metadata: {
        event_id:  randomUUID(),
        actor:     removedBy ? 'admin' : 'octoguard:auto',
        mute_id:   muteId,
        undoable:  false,  // un unmute n'est pas réversible (info purement perdue)
      },
    })

    return true
  } catch (err) {
    console.warn('[octoguard:mutes] removeMute error:', err)
    return false
  }
}

// ─── Worker purge expirés ────────────────────────────────────────────────────

const PURGE_INTERVAL_MS = 60_000

let _purgeTimer: NodeJS.Timeout | null = null

export async function purgeExpiredMutes(): Promise<number> {
  try {
    const { rows } = await db.query<{ user_id: string }>(
      `DELETE FROM chat_mutes
        WHERE expires_at IS NOT NULL AND expires_at <= NOW()
       RETURNING user_id`
    )
    // Invalider le cache pour les users dont les mutes ont expiré
    for (const r of rows) invalidateMuteCache(r.user_id)
    return rows.length
  } catch (err) {
    console.warn('[octoguard:mutes] purgeExpiredMutes error:', err)
    return 0
  }
}

export function startMutePurgeWorker(): void {
  if (_purgeTimer) return  // déjà démarré
  _purgeTimer = setInterval(() => {
    purgeExpiredMutes().then(count => {
      if (count > 0) {
        console.log(`[octoguard:mutes] purged ${count} expired mute(s)`)
      }
    })
  }, PURGE_INTERVAL_MS)
  if (_purgeTimer.unref) _purgeTimer.unref()  // ne pas tenir le process vivant
}

export function stopMutePurgeWorker(): void {
  if (_purgeTimer) {
    clearInterval(_purgeTimer)
    _purgeTimer = null
  }
}
