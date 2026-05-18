/**
 * Cache RAM des règles auto-mod actives.
 * Conforme à SESSION-B-CDC §3.2.
 *
 * Invalidation explicite (pas de TTL automatique). Session D appellera
 * `reloadRules()` après chaque CRUD admin pour rafraîchir.
 *
 * Mono-process en Phase 1 (cf. CDC §9). Pour multi-process, ajouter
 * un canal Redis pub/sub plus tard.
 */

import { db } from '../../config/database'
import type { AutomodRuleRow, AutomodRuleParams, Escalation, Duration } from './types'

let _rules:  AutomodRuleRow[] = []
let _loaded: boolean          = false

/** Recharge toutes les règles activées depuis Postgres. */
export async function reloadRules(): Promise<void> {
  const { rows } = await db.query<{
    id:                    string
    name:                  string
    type:                  string
    params:                unknown
    action:                string
    action_duration:       unknown
    escalation:            unknown
    immunized_role_types:  string[]
    immunized_grade_ids:   string[]
    dry_run:               boolean
    enabled:               boolean
    created_at:            string
    updated_at:            string
  }>(`
    SELECT id, name, type, params, action, action_duration, escalation,
           immunized_role_types, immunized_grade_ids, dry_run, enabled,
           created_at, updated_at
      FROM octoguard_automod_rules
     WHERE enabled = true
     ORDER BY created_at ASC
  `)

  _rules = rows.map(r => ({
    id:                    r.id,
    name:                  r.name,
    type:                  r.type as AutomodRuleRow['type'],
    params:                (r.params ?? {}) as AutomodRuleParams,
    action:                r.action as AutomodRuleRow['action'],
    action_duration:       (r.action_duration ?? null) as Duration | null,
    escalation:            (r.escalation ?? null)      as Escalation | null,
    immunized_role_types:  r.immunized_role_types ?? [],
    immunized_grade_ids:   r.immunized_grade_ids  ?? [],
    dry_run:               !!r.dry_run,
    enabled:               !!r.enabled,
    created_at:            r.created_at,
    updated_at:            r.updated_at,
  }))
  _loaded = true
}

/** Accès direct au cache. Les consommateurs ne mutent pas. */
export function getRules(): AutomodRuleRow[] {
  return _rules
}

/** True si le cache a été chargé au moins une fois. */
export function isLoaded(): boolean {
  return _loaded
}

/** Vide le cache (utile pour tests / urgence). */
export function clearRules(): void {
  _rules  = []
  _loaded = false
}

/**
 * Setter dédié aux benchmarks et tests.
 * Permet d'injecter directement un set de règles sans passer par la DB.
 * NE PAS UTILISER en code applicatif.
 */
export function _setRulesForBench(rules: AutomodRuleRow[]): void {
  _rules  = rules
  _loaded = true
}
