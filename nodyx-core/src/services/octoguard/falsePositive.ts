/**
 * OctoGuard 2, lot 10 (CDC E4h, D25) : « Faux positif » et « C'était normal ».
 *
 * Règle d'or : un faux positif n'affaiblit JAMAIS une règle en silence.
 * On n'apprend qu'un seul cas sûr : une règle de mots interdits a attrapé un
 * mot qui CONTIENT un motif partiel sans être le motif lui-même (« contenu »
 * attrapé par « *con* »). Ce mot-là devient une exception, affichée à l'admin
 * avant qu'il valide. Tout le reste est seulement compté.
 */

import { normalize } from './matchers2'

/** Ce que le journal a retenu d'un déclenchement (metadata d'admin_audit_log). */
export interface LogMeta {
  rule_id?: string
  actor?: string
  would_be?: boolean
  undoable?: boolean
  found?: { token?: unknown; pattern?: unknown; kind?: unknown }
}

/** Les actions d'OctoGuard qu'on peut marquer « faux positif ». */
export const ACTED_BY_ENGINE = new Set([
  'octoguard.delete_message', 'octoguard.warn_user', 'octoguard.mute_user', 'octoguard.ban_temp_user',
  'octoguard.report_filed', 'octoguard.notify', 'octoguard.message_held',
])

export type NoLearnReason = 'not_keywords' | 'no_token' | 'exact_word' | 'already_excepted' | 'rule_gone'

export type LearnPlan =
  | { learn: true; token: string; pattern: string }
  | { learn: false; reason: NoLearnReason }

const clean = (s: string) => normalize(s).replace(/[^\p{L}]/gu, '')

/**
 * Le mot qu'on PEUT apprendre, ou la raison pour laquelle on ne le fait pas.
 * Fonction pure : testée sans base de données.
 */
export function planLearning(meta: LogMeta, rule: { type: string; params: { words?: string[]; exceptions?: string[] } } | null): LearnPlan {
  if (!rule) return { learn: false, reason: 'rule_gone' }
  if (rule.type !== 'keywords') return { learn: false, reason: 'not_keywords' }
  const f = meta.found
  if (!f || typeof f.token !== 'string' || typeof f.pattern !== 'string' || !f.token) return { learn: false, reason: 'no_token' }
  const token = clean(f.token)
  if (token.length < 2) return { learn: false, reason: 'no_token' }
  // Le mot est-il LUI-MÊME interdit ? (mot entier listé, ou motif égal au mot)
  const words = rule.params.words ?? []
  const exactlyBanned = words.some(w => {
    const v = clean(w.replace(/^\*|\*$/g, ''))
    return v === token
  })
  if (f.kind === 'word' || exactlyBanned) return { learn: false, reason: 'exact_word' }
  const exceptions = new Set((rule.params.exceptions ?? []).map(clean))
  if (exceptions.has(token)) return { learn: false, reason: 'already_excepted' }
  return { learn: true, token, pattern: f.pattern.slice(0, 64) }
}
