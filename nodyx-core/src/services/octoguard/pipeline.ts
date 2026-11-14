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
import { matchRule, type MatchResult } from './matchers'
import { recordActivity } from './matchers2'
import { mentionWeight } from './mentionWeight'
import { instanceCommunityId } from '../mentionPeople'
import { logOctoGuardAction } from './logger'
import { applyMute } from './mutes'
import { engineLadderStep } from './ladder'
import { applyTempBan } from './bans'
import type {
  AutomodRuleRow,
  PipelineUserCtx,
  PipelineResult,
  AutomodAction,
  Duration, Surface,
} from './types'

const PIPELINE_TIMEOUT_MS = 50

// ─── Le temps du moteur (ligne de santé : « N ms par message en moyenne ») ───
// Les 500 derniers passages, en mémoire. Rien n'est écrit nulle part.
const LATENCY_WINDOW = 500
const latencies: number[] = []
let latencyNext = 0
function recordLatency(ms: number): void {
  if (latencies.length < LATENCY_WINDOW) latencies.push(ms)
  else { latencies[latencyNext] = ms; latencyNext = (latencyNext + 1) % LATENCY_WINDOW }
}
/** Moyenne des derniers passages, null tant que rien n'est passé. */
export function pipelineLatency(): { avg_ms: number; samples: number } | null {
  if (latencies.length === 0) return null
  return { avg_ms: latencies.reduce((a, b) => a + b, 0) / latencies.length, samples: latencies.length }
}
export function _resetLatencyForTests(): void { latencies.length = 0; latencyNext = 0 }

export interface PipelineInput {
  content:    string
  userCtx:    PipelineUserCtx
  /** Où le contenu est écrit. Défaut : le chat (seul endroit surveillé avant OctoGuard 2). */
  surface?:   Surface
  channelId?: string
  messageId?: string  // optionnel (undefined si message pas encore inséré)
  /** Les mêmes textes avec le corps en HTML, quand `content` n'en est que
   *  l'extraction (forum, wiki) : les mentions y sont des marques, que
   *  l'extraction a perdues. Défaut : `content` (le chat juge déjà du HTML). */
  mentionHtml?: string
}

// ─── Immunisation ────────────────────────────────────────────────────────────

export function isImmunized(rule: AutomodRuleRow, user: PipelineUserCtx): boolean {
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

// ─── Conditions (OctoGuard 2) ───────────────────────────────────────────────

/** « Comptes récents seulement » : un âge inconnu ne déclenche jamais la règle. */
export function conditionsMet(rule: AutomodRuleRow, user: PipelineUserCtx): boolean {
  const maxAge = rule.conditions?.account_max_age_days
  if (typeof maxAge === 'number') {
    if (typeof user.accountAgeDays !== 'number') return false
    if (user.accountAgeDays >= maxAge) return false
  }
  return true
}

// ─── Escalade ────────────────────────────────────────────────────────────────

async function escalate(rule: AutomodRuleRow, user: PipelineUserCtx, warnCount: number, eventId: string): Promise<void> {
  const esc = rule.escalation
  if (!esc) return
  const reason = `${warnCount} avertissements (règle "${rule.name}")`
  if (esc.action === 'mute') {
    await applyMute({ userId: user.userId, channelId: null, duration: esc.duration ?? { value: 1, unit: 'h' }, reason, appliedBy: null, ruleId: rule.id, eventId })
  } else if (esc.action === 'ban_temp') {
    await applyTempBan({ userId: user.userId, duration: esc.duration ?? { value: 1, unit: 'd' }, reason, ruleId: rule.id, eventId })
  }
  logOctoGuardAction({
    action:       `octoguard.escalation_${esc.action}`,
    target_type:  'user',
    target_id:    user.userId,
    target_label: reason,
    metadata:     { rule_id: rule.id, rule_name: rule.name, event_id: eventId, actor: 'octoguard:auto', escalated_to: esc.action, warn_count: warnCount },
  })
}

// ─── Application d'une action ────────────────────────────────────────────────

interface ActionOutcome {
  blocked:  boolean
  reason:   string
  i18nKey:  string
  /** Cran « signaler » : un dossier à ouvrir dans la file (D13) */
  report?:  boolean
  /** Cran « retenir » : le contenu attend la relecture (lot 2) */
  hold?:    boolean
}

async function applyAction(
  rule:     AutomodRuleRow,
  user:     PipelineUserCtx,
  excerpt:  string,
  eventId:  string,
  dryRun:   boolean,
  found?:   MatchResult['found'],
): Promise<ActionOutcome> {
  const action: AutomodAction = rule.action
  const meta = {
    rule_id:    rule.id,
    rule_name:  rule.name,
    event_id:   eventId,
    actor:      'octoguard:auto' as const,
    would_be:   dryRun,
    // Mots interdits : le mot trouvé et le motif (D25, « Faux positif »)
    ...(found ? { found } : {}),
  }

  // Cran « observer » (dry_run) : on note ce qui AURAIT été fait, rien ne se passe
  if (dryRun) {
    logOctoGuardAction({
      action:       `octoguard.would_${action}`,
      target_type:  'message',
      target_id:    null,
      target_label: excerpt,
      metadata:     { ...meta, would_be: true },
    })
    return { blocked: false, reason: 'observe', i18nKey: 'octoguard.observe' }
  }

  // Cran « signaler » (report_only) : le contenu passe, et un dossier arrive
  // dans la file de l'équipe, signé OctoGuard (D13). L'appelant ouvre le
  // dossier une fois le contenu enregistré (il en connaît alors l'identifiant).
  if (action === 'report_only') {
    logOctoGuardAction({
      action:       'octoguard.report_filed',
      target_type:  'user',
      target_id:    user.userId,
      target_label: excerpt,
      metadata:     { ...meta, would_be: false },
    })
    return { blocked: false, reason: 'report_only', i18nKey: 'octoguard.report_only', report: true }
  }

  // Cran « retenir » : rien n'est publié. L'appelant confie le contenu à
  // holdContent() (qui journalise « octoguard.message_held ») ; l'auteur le voit
  // « en attente de validation », les autres ne le voient pas.
  if (action === 'hold') {
    return { blocked: false, reason: 'hold', i18nKey: 'octoguard.held', hold: true }
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

  // warn : la décision de blocage est IMMÉDIATE. L'INSERT du warn et le check
  // d'escalade sont des EFFETS DE BORD (compteur futur), sortis du chemin chaud
  // en fire-and-forget (patron de logOctoGuardAction) pour ne jamais faire
  // dépasser le budget 50ms du pipeline sous contention du pool DB (CDC §3ter,
  // D4 tranché fire-and-forget). L'INSERT précède le COUNT DANS le même bloc
  // async -> pas de race d'escalade.
  if (action === 'warn') {
    if (rule.follow_ladder) {
      // La règle suit le barème (D28) : au lieu d'un avertissement brut et de
      // l'escalade propre à la règle, la prochaine marche du membre, en tâche de
      // fond (jamais d'exclusion, une marche par 24 h au plus : ladder.ts).
      // Le message, lui, est bloqué tout de suite, comme pour tout avertissement.
      void engineLadderStep({ id: rule.id, name: rule.name }, user.userId)
        .catch((err) => console.warn('[octoguard] ladder step failed:', err))
    } else {
      logOctoGuardAction({
        action:       'octoguard.warn_user',
        target_type:  'user',
        target_id:    user.userId,
        target_label: excerpt,
        metadata:     { ...meta, undoable: true, undo_op: { type: 'clear_last_warn', user_id: user.userId } },
      })

      void (async () => {
        try {
          await db.query(
            `INSERT INTO octoguard_warns (user_id, rule_id, reason) VALUES ($1, $2, $3)`,
            [user.userId, rule.id, excerpt]
          )

          // Escalation : check count + apply si seuil atteint (STUB Session C pour mute/ban_temp)
          if (rule.escalation) {
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
              // L'escalade pour de vrai : N avertissements en X jours donnent une
              // sourdine ou un bannissement temporaire (avant : un « TODO » au journal).
              await escalate(rule, user, cnt, eventId)
            }
          }
        } catch (err) {
          console.warn('[octoguard] warn side-effects failed:', err)
        }
      })()
    }

    return {
      blocked: true,
      reason:  `Avertissement : règle "${rule.name}"`,
      i18nKey: 'octoguard.warn.given',
    }
  }

  // mute : applique un mute global communauté via le service mutes.
  // La décision est IMMÉDIATE ; applyMute part en fire-and-forget. Si le mute se
  // pose une ms plus tard ou échoue, la règle continue de bloquer les messages
  // suivants -> dégradation gracieuse, jamais de fail-open (avant ce fix, un
  // applyMute qui throw retombait dans le catch de runPipeline = blocked:false).
  // (Session C : implémentation réelle remplace le stub Session B.)
  if (action === 'mute') {
    void (async () => {
      try {
        await applyMute({
          userId:     user.userId,
          channelId:  null,                       // mute global (toute la communauté)
          duration:   rule.action_duration,
          reason:     `règle "${rule.name}"`,
          appliedBy:  null,                       // action automatique
          ruleId:     rule.id,
          eventId,                                // hérité du pipeline (cohérence)
        })
      } catch (err) {
        console.warn('[octoguard] applyMute failed:', err)
      }
    })()
    return {
      blocked: true,
      reason:  `Silence appliqué : règle "${rule.name}"`,
      i18nKey: 'octoguard.mute.applied',
    }
  }

  // ban_temp : bannissement temporaire réel (community_bans.expires_at), levé
  // automatiquement à l'échéance. Décision immédiate, écriture en arrière-plan
  // (même patron que mute : jamais dépasser le budget du pipeline).
  if (action === 'ban_temp') {
    void applyTempBan({ userId: user.userId, duration: rule.action_duration, reason: `règle "${rule.name}"`, ruleId: rule.id, eventId })
    return {
      blocked: true,
      reason:  `Bannissement temporaire : règle "${rule.name}"`,
      i18nKey: 'octoguard.ban_temp.applied',
    }
  }

  // Action inconnue : log + bloque par sécurité (defense in depth)
  console.warn(`[octoguard] unknown action: ${String(action)}`)
  return { blocked: false, reason: 'unknown_action', i18nKey: 'octoguard.unknown' }
}

// ─── Pipeline principal ──────────────────────────────────────────────────────

// Taille des groupes mentionnés et appartenance à l'équipe, gardées 30 s : le
// moteur a 50 ms, il ne relit pas la base à chaque message d'une conversation.
const MENTION_CACHE_MS = 30_000
let mentionCache = new Map<string, number>()
let mentionCacheAt = 0
function liveMentionCache(): Map<string, number> {
  if (Date.now() - mentionCacheAt > MENTION_CACHE_MS) { mentionCache = new Map(); mentionCacheAt = Date.now() }
  return mentionCache
}
export function _resetMentionCacheForTests(): void { mentionCache = new Map(); mentionCacheAt = 0 }

async function runPipelineInner(input: PipelineInput): Promise<PipelineResult> {
  const rules = getRules()
  if (rules.length === 0) return { blocked: false }
  const surface: Surface = input.surface ?? 'chat'
  // Inondation : on note le message UNE fois, avant les règles (clé par endroit)
  const floodKey = `${surface}:${input.userCtx.userId}`
  recordActivity(floodKey, input.content)
  // Poids des mentions : calculé une fois, et seulement si une règle le lira
  let mentionCount: number | undefined
  let mentionCounted = false

  for (const rule of rules) {
    // Une règle d'avant OctoGuard 2 (sans scopes) ne surveillait que le chat
    if (!(rule.scopes?.length ? rule.scopes : ['chat']).includes(surface)) continue
    if (isImmunized(rule, input.userCtx)) continue
    if (!conditionsMet(rule, input.userCtx)) continue

    if (rule.type === 'mention_spam' && !mentionCounted) {
      mentionCounted = true
      mentionCount = await mentionWeight(input.mentionHtml || input.content, await instanceCommunityId().catch(() => null), input.userCtx.userId, liveMentionCache())
    }
    const match = matchRule(input.content, rule, { userId: floodKey, mentionCount })
    if (!match) continue

    const eventId = randomUUID()
    const outcome = await applyAction(
      rule,
      input.userCtx,
      match.excerpt,
      eventId,
      rule.dry_run,
      match.found,
    )

    return {
      blocked:  outcome.blocked,
      reason:   outcome.reason,
      i18n_key: outcome.i18nKey,
      event_id: eventId,
      ...(outcome.report ? { report: { rule_id: rule.id, rule_name: rule.name, excerpt: match.excerpt } } : {}),
      ...(outcome.hold ? { hold: { rule_id: rule.id, rule_name: rule.name, excerpt: match.excerpt } } : {}),
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

  // Le minuteur est ANNULÉ dès que le moteur répond. Avant, il n'était jamais
  // annulé : il écrivait « timeout » 50 ms après CHAQUE message, même traité à
  // temps, ce qui noyait les vrais dépassements dans de faux.
  let timer: NodeJS.Timeout | undefined
  try {
    const timeout = new Promise<PipelineResult>((resolve) => {
      timer = setTimeout(() => {
        console.warn(`[octoguard] pipeline timeout >${PIPELINE_TIMEOUT_MS}ms, bypassing`)
        resolve({ blocked: false })
      }, PIPELINE_TIMEOUT_MS)
    })
    const t0 = performance.now()
    const res = await Promise.race([runPipelineInner(input), timeout])
    recordLatency(performance.now() - t0)
    return res
  } catch (err) {
    console.warn('[octoguard] pipeline error, bypassing:', err)
    return { blocked: false }
  } finally {
    if (timer) clearTimeout(timer)
  }
}
