/**
 * OctoGuard 2 : le bac à sable et les chiffres (CDC OctoGuard 2, E4b).
 *
 * Bac à sable : un message, un endroit, un âge de compte. Pour chaque règle
 * (active ou non), dit si elle le prendrait et ce qui se passerait. AUCUN
 * effet de bord : rien au journal, pas d'avertissement, pas de mémoire
 * d'inondation (une règle d'inondation se juge sur une suite de messages :
 * elle est marquée « non testable ici »).
 *
 * Chiffres : par règle sur N jours, ce qu'elle a fait et ce qu'elle aurait
 * fait (cran « observer »), lus dans le journal.
 */

import { db } from '../../config/database'
import { checkContent } from '../contentFilter'
import { matchRule } from './matchers'
import { conditionsMet } from './pipeline'
import type { AutomodRuleRow, Surface } from './types'

export type SandboxOutcome = 'none' | 'observe' | 'report' | 'hold' | 'warn' | 'delete' | 'mute' | 'ban_temp' | 'notify'

export interface SandboxRuleResult {
  id: string; name: string; preset_key: string | null; type: string
  enabled: boolean; applies_here: boolean; immune: boolean; conditions_ok: boolean
  testable: boolean; matched: boolean; excerpt: string | null; outcome: SandboxOutcome
  /** Ce que la règle ferait sans le cran « observer » */
  intended: SandboxOutcome
}

export interface SandboxResult {
  system: { blocked: boolean; rule: string | null }
  rules: SandboxRuleResult[]
  /** La première règle active qui agirait (le moteur s'arrête à la première) */
  first: string | null
}

const ACTION_OUTCOME: Record<string, SandboxOutcome> = {
  delete: 'delete', warn: 'warn', mute: 'mute', ban_temp: 'ban_temp', report_only: 'report', notify_only: 'notify', hold: 'hold',
}

export async function runSandbox(input: { content: string; surface: Surface; accountAgeDays?: number; role?: string }): Promise<SandboxResult> {
  const sys = checkContent(input.content.replace(/<[^>]+>/g, ' '), { silent: true })
  const { rows } = await db.query(
    `SELECT id, name, type, params, action, action_duration, escalation, immunized_role_types, immunized_grade_ids,
            dry_run, enabled, scopes, preset_key, customized, conditions, created_at::text, updated_at::text
     FROM octoguard_automod_rules ORDER BY created_at ASC`)
  const role = input.role ?? 'member'
  const user = { userId: 'sandbox', role, gradeIds: [] as string[], ...(typeof input.accountAgeDays === 'number' ? { accountAgeDays: input.accountAgeDays } : {}) }
  const out: SandboxRuleResult[] = []
  let first: string | null = null
  for (const r of rows as any[]) {
    const rule = { ...r, params: r.params ?? {}, scopes: r.scopes?.length ? r.scopes : ['chat'], conditions: r.conditions ?? {} } as AutomodRuleRow
    const applies = rule.scopes.includes(input.surface)
    const immune = (rule.immunized_role_types ?? []).includes(role)
    const condOk = conditionsMet(rule, user)
    const testable = rule.type !== 'flood'
    const m = testable ? matchRule(input.content, rule, { userId: `sandbox-${Math.random()}` }) : null
    // Retenir n'existe qu'au chat et au forum ; ailleurs la règle signale (moderate.ts)
    const mapped = ACTION_OUTCOME[rule.action] ?? 'none'
    const intended: SandboxOutcome = mapped === 'hold' && input.surface !== 'chat' && input.surface !== 'forum' ? 'report' : mapped
    const acts = !!m && applies && !immune && condOk
    const outcome: SandboxOutcome = acts ? (rule.dry_run ? 'observe' : intended) : 'none'
    if (acts && rule.enabled && !rule.dry_run && first === null) first = rule.id
    out.push({
      id: rule.id, name: rule.name, preset_key: rule.preset_key ?? null, type: rule.type, enabled: !!rule.enabled,
      applies_here: applies, immune, conditions_ok: condOk, testable, matched: !!m, excerpt: m?.excerpt ?? null,
      outcome, intended,
    })
  }
  return { system: { blocked: !sys.ok, rule: sys.rule ?? null }, rules: out, first }
}

const ACTED = ['octoguard.delete_message', 'octoguard.warn_user', 'octoguard.mute_user', 'octoguard.ban_temp_user', 'octoguard.report_filed', 'octoguard.notify']

export async function ruleStats(days: number) {
  const d = Math.min(Math.max(Math.trunc(days) || 7, 1), 90)
  const { rows } = await db.query<{ rule_id: string | null; action: string; n: number }>(
    `SELECT metadata->>'rule_id' AS rule_id, action, COUNT(*)::int AS n
     FROM admin_audit_log
     WHERE action LIKE 'octoguard.%' AND created_at > NOW() - ($1 || ' days')::interval
     GROUP BY 1, 2`, [String(d)])
  const rules: Record<string, { acted: number; observed: number; false_positive: number; normal: number; by_action: Record<string, number> }> = {}
  const system = { hate_symbol_blocked: 0, admin_pattern_blocked: 0 }
  let undone = 0
  for (const r of rows) {
    if (r.action === 'octoguard.hate_symbol_blocked') { system.hate_symbol_blocked += r.n; continue }
    if (r.action === 'octoguard.admin_pattern_blocked') { system.admin_pattern_blocked += r.n; continue }
    if (r.action === 'octoguard.action_undone') { undone += r.n; continue }
    if (!r.rule_id) continue
    const s = (rules[r.rule_id] ??= { acted: 0, observed: 0, false_positive: 0, normal: 0, by_action: {} })
    // Lot 10 : les marques de l'équipe, comptées à part (ni action ni observation)
    if (r.action === 'octoguard.false_positive') { s.false_positive += r.n; continue }
    if (r.action === 'octoguard.observed_normal') { s.normal += r.n; continue }
    s.by_action[r.action] = (s.by_action[r.action] ?? 0) + r.n
    if (r.action.startsWith('octoguard.would_')) s.observed += r.n
    else if (ACTED.includes(r.action)) s.acted += r.n
  }
  const acted = Object.values(rules).reduce((a, s) => a + s.acted, 0)
  const observed = Object.values(rules).reduce((a, s) => a + s.observed, 0)
  const normal = Object.values(rules).reduce((a, s) => a + s.normal, 0)
  // « Justesse » : une action annulée ET marquée faux positif ne compte qu'une fois
  const { rows: w } = await db.query<{ n: number }>(
    `SELECT COUNT(DISTINCT target_id)::int AS n FROM admin_audit_log
      WHERE action IN ('octoguard.action_undone', 'octoguard.false_positive')
        AND created_at > NOW() - ($1 || ' days')::interval`, [String(d)])
  const wrong = Math.min(w[0]?.n ?? 0, acted)
  return { days: d, rules, system, totals: { acted, observed, undone, wrong, normal } }
}

export async function ruleHits(ruleId: string, limit = 20) {
  const { rows } = await db.query(
    `SELECT id, action, target_type, target_id, target_label AS excerpt, created_at::text AS at,
            (metadata->>'would_be')::boolean AS observed
     FROM admin_audit_log
     WHERE action LIKE 'octoguard.%' AND metadata->>'rule_id' = $1
     ORDER BY created_at DESC LIMIT $2`, [ruleId, Math.min(Math.max(limit, 1), 100)])
  return rows
}
