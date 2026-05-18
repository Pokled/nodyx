/**
 * Pipeline OctoGuard, orchestrateur du matching auto-mod.
 * Conforme à SESSION-B-CDC §3.4.
 *
 * Algorithme (cf. CDC §3.4) :
 *  1. Si !isOctoGuardEnabled() → bypass total.
 *  2. Wrap dans Promise.race avec timeout 50ms (fail-open).
 *  3. Pour chaque règle active : skip si immunisé, sinon évalue.
 *  4. Premier match wins. Action appliquée selon CDC §5.
 *
 * Jamais throw. Fail-open partout : si erreur, le message passe normalement.
 */

import { randomUUID } from 'crypto'
import { db } from '../../config/database'
import { isOctoGuardEnabled } from './index'
import { getRules } from './cache'
import { matchRule } from './matchers'
import { logOctoGuardAction } from './logger'
import { applyMute } from './mutes'
import type {
  AutomodRuleRow,
  PipelineUserCtx,
  PipelineResult,
  AutomodAction,
  Duration,
} from './types'

const PIPELINE_TIMEOUT_MS = 50

export interface PipelineInput {
  content:    string
  userCtx:    PipelineUserCtx
  channelId:  string
  messageId?: string  // optionnel (undefined si message pas encore inséré)
}

// ─── Immunisation ────────────────────────────────────────────────────────────

function isImmunized(rule: AutomodRuleRow, user: PipelineUserCtx): boolean {
  const roleTypes  = rule.immunized_role_types ?? []
  const gradeIds   = rule.immunized_grade_ids  ?? []
  if (roleTypes.includes(user.role)) return true
  if (gradeIds.length > 0 && user.gradeIds.some(g => gradeIds.includes(g))) return true
  return false
}

// ─── Calcul d'expiration (utile pour stubs mute / ban_temp) ─────────────────

export function computeExpiresAt(duration: Duration | null): Date | null {
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

// ─── Application d'une action ────────────────────────────────────────────────

interface ActionOutcome {
  blocked:  boolean
  reason:   string
  i18nKey:  string
}

async function applyAction(
  rule:     AutomodRuleRow,
  user:     PipelineUserCtx,
  excerpt:  string,
  eventId:  string,
  dryRun:   boolean,
): Promise<ActionOutcome> {
  const action: AutomodAction = rule.action
  const meta = {
    rule_id:    rule.id,
    rule_name:  rule.name,
    event_id:   eventId,
    actor:      'octoguard:auto' as const,
    would_be:   dryRun,
  }

  // dry_run OU action report_only : on log et on laisse passer
  if (dryRun || action === 'report_only') {
    logOctoGuardAction({
      action:       `octoguard.would_${action}`,
      target_type:  'message',
      target_id:    null,
      target_label: excerpt,
      metadata:     { ...meta, would_be: true },
    })
    return { blocked: false, reason: 'report_only', i18nKey: 'octoguard.report_only' }
  }

  // notify_only : log + webhook (webhook Session D), pas de blocage
  if (action === 'notify_only') {
    logOctoGuardAction({
      action:       'octoguard.notify',
      target_type:  'message',
      target_id:    null,
      target_label: excerpt,
      metadata:     { ...meta, would_be: false },
    })
    return { blocked: false, reason: 'notify_only', i18nKey: 'octoguard.notify' }
  }

  // delete : on bloque le message
  if (action === 'delete') {
    logOctoGuardAction({
      action:       'octoguard.delete_message',
      target_type:  'message',
      target_id:    null,
      target_label: excerpt,
      metadata:     { ...meta, undoable: false },
    })
    return {
      blocked: true,
      reason:  `Message bloqué : règle "${rule.name}"`,
      i18nKey: 'octoguard.message.deleted',
    }
  }

  // warn : INSERT warn + check escalation + bloque le message (CDC §5)
  if (action === 'warn') {
    await db.query(
      `INSERT INTO octoguard_warns (user_id, rule_id, reason) VALUES ($1, $2, $3)`,
      [user.userId, rule.id, excerpt]
    ).catch(err => console.warn('[octoguard] INSERT octoguard_warns failed:', err))

    logOctoGuardAction({
      action:       'octoguard.warn_user',
      target_type:  'user',
      target_id:    user.userId,
      target_label: excerpt,
      metadata:     { ...meta, undoable: true, undo_op: { type: 'clear_last_warn', user_id: user.userId } },
    })

    // Escalation : check count + apply si seuil atteint (STUB Session C pour mute/ban_temp)
    if (rule.escalation) {
      try {
        const windowDays = rule.escalation.window_days
        const { rows } = await db.query<{ cnt: number }>(
          `SELECT COUNT(*)::int AS cnt
             FROM octoguard_warns
            WHERE user_id = $1
              AND rule_id = $2
              AND cleared_at IS NULL
              AND created_at > NOW() - ($3 || ' days')::interval`,
          [user.userId, rule.id, String(windowDays)]
        )
        const cnt = rows[0]?.cnt ?? 0
        if (cnt >= rule.escalation.warns_threshold) {
          console.warn(`[octoguard] escalation triggered (cnt=${cnt} >= ${rule.escalation.warns_threshold}, action=${rule.escalation.action}) → TODO Session C apply mute/ban_temp`)
          logOctoGuardAction({
            action:       `octoguard.escalation_${rule.escalation.action}`,
            target_type:  'user',
            target_id:    user.userId,
            target_label: `escalated after ${cnt} warns`,
            metadata:     { ...meta, escalated_to: rule.escalation.action, warn_count: cnt, stub: true },
          })
        }
      } catch (err) {
        console.warn('[octoguard] escalation check failed:', err)
      }
    }

    return {
      blocked: true,
      reason:  `Avertissement : règle "${rule.name}"`,
      i18nKey: 'octoguard.warn.given',
    }
  }

  // mute : applique un mute global communauté via le service mutes
  // (Session C : implémentation réelle remplace le stub Session B).
  if (action === 'mute') {
    await applyMute({
      userId:     user.userId,
      channelId:  null,                       // mute global (toute la communauté)
      duration:   rule.action_duration,
      reason:     `règle "${rule.name}"`,
      appliedBy:  null,                       // action automatique
      ruleId:     rule.id,
      eventId,                                // hérité du pipeline (cohérence)
    })
    return {
      blocked: true,
      reason:  `Silence appliqué : règle "${rule.name}"`,
      i18nKey: 'octoguard.mute.applied',
    }
  }

  // ban_temp : STUB Session C, bloque comme delete + log "TODO"
  if (action === 'ban_temp') {
    console.warn(`[octoguard] action=ban_temp STUB Session C, blocking like delete for now`)
    logOctoGuardAction({
      action:       'octoguard.ban_temp_user',
      target_type:  'user',
      target_id:    user.userId,
      target_label: excerpt,
      metadata:     { ...meta, stub: 'Session C will implement community_bans INSERT + expires_at', duration: rule.action_duration },
    })
    return {
      blocked: true,
      reason:  `Bannissement temporaire (stub) : règle "${rule.name}"`,
      i18nKey: 'octoguard.ban_temp.applied',
    }
  }

  // Action inconnue : log + bloque par sécurité (defense in depth)
  console.warn(`[octoguard] unknown action: ${String(action)}`)
  return { blocked: false, reason: 'unknown_action', i18nKey: 'octoguard.unknown' }
}

// ─── Pipeline principal ──────────────────────────────────────────────────────

async function runPipelineInner(input: PipelineInput): Promise<PipelineResult> {
  const rules = getRules()
  if (rules.length === 0) return { blocked: false }

  for (const rule of rules) {
    if (isImmunized(rule, input.userCtx)) continue

    const match = matchRule(input.content, rule)
    if (!match) continue

    const eventId = randomUUID()
    const outcome = await applyAction(
      rule,
      input.userCtx,
      match.excerpt,
      eventId,
      rule.dry_run,
    )

    return {
      blocked:  outcome.blocked,
      reason:   outcome.reason,
      i18n_key: outcome.i18nKey,
      event_id: eventId,
    }
  }

  return { blocked: false }
}

/**
 * Point d'entrée appelé depuis socket/index.ts.
 * Garanties : ne throw jamais, p95 < 5ms cible, hard timeout 50ms fail-open.
 */
export async function runPipeline(input: PipelineInput): Promise<PipelineResult> {
  if (!isOctoGuardEnabled()) return { blocked: false }

  try {
    const timeout = new Promise<PipelineResult>((resolve) => {
      setTimeout(() => {
        console.warn(`[octoguard] pipeline timeout >${PIPELINE_TIMEOUT_MS}ms, bypassing`)
        resolve({ blocked: false })
      }, PIPELINE_TIMEOUT_MS)
    })
    return await Promise.race([runPipelineInner(input), timeout])
  } catch (err) {
    console.warn('[octoguard] pipeline error, bypassing:', err)
    return { blocked: false }
  }
}
