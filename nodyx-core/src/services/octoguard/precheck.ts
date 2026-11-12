/**
 * OctoGuard 2, lot 5 : « Tu es sûr ? » avant d'envoyer (CDC E4h).
 *
 * Avant l'envoi, le chat et le forum demandent au moteur ce qu'il ferait de ce
 * texte. Si le message serait retenu ou refusé, l'auteur est prévenu et peut le
 * reformuler, ou l'envoyer quand même (le moteur le juge alors pour de vrai).
 *
 * Garanties :
 * - AUCUN effet de bord : rien au journal, aucun avertissement, aucune marche du
 *   barème, aucune mémoire d'inondation (les règles d'inondation se jugent sur
 *   une suite de messages ; sans identifiant elles ne se déclenchent jamais).
 * - Le même jugement que le vrai envoi : mêmes règles (cache des règles
 *   allumées), même ordre (la première qui correspond décide, comme le moteur,
 *   y compris une règle en observation, qui laisse passer), même profil du
 *   membre (rôle, grade, âge du compte), même texte (assainissement du chat,
 *   extraction du forum).
 * - D20 : la réponse ne nomme JAMAIS la règle. Elle dit ce qui arriverait
 *   (retenu, refusé, averti, sanctionné) et de quelle sorte de souci il s'agit
 *   (des mots, des liens, des capitales, des mentions), pour aider à reformuler
 *   sans apprendre à contourner une règle précise.
 * - Éteint par défaut (réglage OCTOGUARD_NUDGE), et sans objet quand OctoGuard
 *   est éteint. Ne lève jamais : au moindre doute, pas d'annonce (le moteur
 *   juge de toute façon le vrai envoi).
 */

import { checkContent } from '../contentFilter'
import { isOctoGuardEnabled } from './index'
import { getRules } from './cache'
import { matchRule } from './matchers'
import { conditionsMet, isImmunized } from './pipeline'
import { buildUserCtx, textForModeration } from './moderate'
import { sanitizeChat } from '../../utils/chatSanitize'
import type { AutomodRuleRow, PipelineUserCtx } from './types'

export type NudgeOutcome = 'hold' | 'refuse' | 'warn' | 'sanction'
export type NudgeKind = 'words' | 'links' | 'caps' | 'mentions' | 'other'
export interface Nudge { outcome: NudgeOutcome; kind: NudgeKind }

/** Au-delà, pas d'annonce : le texte est jugé au vrai envoi, rien ne change. */
export const PRECHECK_MAX_CHARS = 50_000
/** Par membre et par minute ; au-delà, pas d'annonce. */
export const PRECHECK_PER_MINUTE = 60

export function isNudgeEnabled(): boolean {
  return isOctoGuardEnabled() && process.env.OCTOGUARD_NUDGE === 'true'
}

const KIND: Record<string, NudgeKind> = {
  keywords: 'words', regex: 'words',
  link_domain: 'links', link_spam: 'links',
  caps: 'caps',
  mention_spam: 'mentions',
}

/** Ce que le moteur ferait, traduit pour l'auteur. null : le message passerait. */
export function outcomeFor(rule: Pick<AutomodRuleRow, 'action' | 'dry_run'>): NudgeOutcome | null {
  if (rule.dry_run) return null                     // observer : le message passe
  switch (rule.action) {
    case 'hold':     return 'hold'                  // chat et forum savent retenir
    case 'delete':   return 'refuse'
    case 'warn':     return 'warn'
    case 'mute':
    case 'ban_temp': return 'sanction'
    default:         return null                    // signaler, notifier : le message passe
  }
}

/** Le jugement, pur : la liste des règles et le profil sont fournis. */
export function judge(content: string, rules: AutomodRuleRow[], user: PipelineUserCtx, surface: 'chat' | 'forum'): Nudge | null {
  // Le filtre du serveur (symboles haineux, motifs de l'admin) refuse avant tout
  if (!checkContent(content.replace(/<[^>]+>/g, ' '), { silent: true }).ok) return { outcome: 'refuse', kind: 'other' }
  for (const rule of rules) {
    if (!(rule.scopes?.length ? rule.scopes : ['chat']).includes(surface)) continue
    if (isImmunized(rule, user)) continue
    if (!conditionsMet(rule, user)) continue
    if (rule.type === 'flood') continue             // se juge sur une suite de messages
    const m = matchRule(content, rule)              // sans userId : aucune mémoire touchée
    if (!m) continue
    // La première règle qui correspond décide, comme le moteur
    const outcome = outcomeFor(rule)
    return outcome ? { outcome, kind: KIND[rule.type] ?? 'other' } : null
  }
  return null
}

/** Le texte que le moteur jugera au vrai envoi. */
export function textFor(surface: 'chat' | 'forum', content: string, title?: string | null): string {
  if (surface === 'chat') return sanitizeChat(content.trim())
  return [title, textForModeration(content)].filter((t): t is string => !!t && t.trim().length > 0).join('\n')
}

export async function precheck(userId: string, surface: 'chat' | 'forum', content: string, title?: string | null): Promise<Nudge | null> {
  try {
    if (!isNudgeEnabled()) return null
    if (content.length + (title?.length ?? 0) > PRECHECK_MAX_CHARS) return null
    const text = textFor(surface, content, title)
    if (!text) return null
    return judge(text, getRules(), await buildUserCtx(userId), surface)
  } catch (err) {
    console.warn('[octoguard:precheck] failed, no nudge:', err)
    return null
  }
}
