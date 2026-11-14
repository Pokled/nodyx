/**
 * OctoGuard 2, lot 11 (CDC E4h, D26) : « Rejouer une règle sur 30 jours ».
 *
 * Fait passer une règle sur les messages du chat et du forum des 30 derniers
 * jours, comme si elle avait été active, SANS RIEN TOUCHER : ni message, ni
 * membre, ni journal, ni la mémoire du moteur en direct. Le résultat n'existe
 * que dans la réponse (D26).
 *
 * Bornes, parce que c'est l'admin qui lance un calcul lourd sur le serveur :
 *  - 20 000 messages au plus, lus par paquets de 500, textes tronqués à la lecture ;
 *  - 3 secondes de calcul au plus ;
 *  - une pause toutes les 200 lectures (setImmediate) : le cœur continue de
 *    servir les autres pendant le rejeu ;
 *  - un seul rejeu à la fois sur l'instance (la route refuse le second).
 * L'inondation est rejouée avec sa propre mémoire (floodVerdict) : rejouer ne
 * pousse jamais hors de la mémoire du moteur la trace des membres actifs.
 */

import { db } from '../../config/database'
import { getInstanceCommunityId } from '../../middleware/adminOnly'
import { matchRule } from './matchers'
import { floodVerdict, floodFingerprint, FLOOD_MEMORY_MS, FLOOD_MEMORY_PER_USER, normalize } from './matchers2'
import { textForModeration } from './moderate'
import { mentionWeight } from './mentionWeight'
import { conditionsMet, isImmunized } from './pipeline'
import type { AutomodRuleRow, Surface } from './types'

export const REPLAY_DAYS = 30
export const REPLAY_MAX_MESSAGES = 20_000
export const REPLAY_BUDGET_MS = 3_000
const PAGE = 500
const READ_MAX_CHARS = 20_000
const EXAMPLES = 5
const EXAMPLE_CHARS = 200

export interface ReplayExample {
  at: string
  author: string | null
  place: string | null
  surface: 'chat' | 'forum'
  text: string
  excerpt: string
  probable_fp: boolean
}
export interface ReplayResult {
  replayable: boolean
  days: number
  scanned: number
  matched: number
  members: number
  probable_fp: number
  examples: ReplayExample[]
  truncated: null | 'too_many' | 'too_long'
}

type Row = { id: string; author_id: string; role: string | null; grade_id: string | null; author: string | null; author_created: string; place: string | null; content: string; at: string }

const yieldToLoop = () => new Promise<void>(r => setImmediate(r))
const clean = (s: string) => normalize(s).replace(/[^\p{L}]/gu, '')

/** Le texte d'un exemple, sans balise, coupé. */
function shortText(html: string): string {
  const t = textForModeration(html)
  return t.length > EXAMPLE_CHARS ? t.slice(0, EXAMPLE_CHARS) + '…' : t
}

/**
 * Faux positif probable (indice, pas verdict), selon le type de règle :
 *  - mots interdits : SEULEMENT un mot attrapé par un motif partiel sans être
 *    le motif (« contenu » pour « *con* »). Une insulte reste une insulte,
 *    quelle que soit l'ancienneté de son auteur ;
 *  - règles de comportement (inondation, majuscules, mentions, liens…) : un
 *    membre ancien (plus de 30 jours au moment du message) jamais averti, par
 *    exemple quelqu'un qui écrit vite pendant un direct.
 */
export function probableFalsePositive(ruleType: string, found: { token: string; pattern: string; kind: string } | undefined, ageDays: number, neverWarned: boolean): boolean {
  if (ruleType === 'keywords') {
    return !!found && found.kind !== 'word' && clean(found.token) !== clean(found.pattern.replace(/^\*|\*$/g, ''))
  }
  return ageDays > 30 && neverWarned
}

export async function replayRule(rule: AutomodRuleRow): Promise<ReplayResult> {
  const result: ReplayResult = { replayable: true, days: REPLAY_DAYS, scanned: 0, matched: 0, members: 0, probable_fp: 0, examples: [], truncated: null }
  const communityId = await getInstanceCommunityId()
  const scopes = (rule.scopes?.length ? rule.scopes : ['chat']) as Surface[]
  const surfaces = (['chat', 'forum'] as const).filter(s => scopes.includes(s))
  const authors = new Set<string>()
  const warnedCache = new Map<string, boolean>()
  const started = Date.now()
  // Tailles des groupes et équipe des auteurs, lues une fois pour tout le rejeu
  const mentionCache = new Map<string, number>()

  // Qui n'a jamais été averti : lu par paquet, une fois par auteur
  async function neverWarned(ids: string[]): Promise<void> {
    const missing = [...new Set(ids)].filter(id => !warnedCache.has(id))
    if (!missing.length) return
    const { rows } = await db.query<{ user_id: string }>(`SELECT DISTINCT user_id FROM octoguard_warns WHERE user_id = ANY($1::uuid[])`, [missing])
    const warned = new Set(rows.map(r => r.user_id))
    for (const id of missing) warnedCache.set(id, !warned.has(id))
  }

  outer:
  for (const surface of surfaces) {
    // Mémoire d'inondation PROPRE au rejeu, jetée à la fin
    const flood = new Map<string, Array<{ t: number; h: string }>>()
    let cursor: { at: string; id: string } | null = null
    for (;;) {
      if (result.scanned >= REPLAY_MAX_MESSAGES) { result.truncated = 'too_many'; break outer }
      if (Date.now() - started > REPLAY_BUDGET_MS) { result.truncated = 'too_long'; break outer }
      const limit = Math.min(PAGE, REPLAY_MAX_MESSAGES - result.scanned)
      const params: unknown[] = [communityId, String(REPLAY_DAYS), READ_MAX_CHARS, cursor?.at ?? null, cursor?.id ?? null, limit]
      const { rows }: { rows: Row[] } = surface === 'chat'
        ? await db.query<Row>(
          `SELECT m.id, m.author_id, cm.role, cm.grade_id, u.username AS author, u.created_at::text AS author_created,
                  ch.name AS place, LEFT(m.content, $3) AS content, m.created_at::text AS at
             FROM channel_messages m
             JOIN users u ON u.id = m.author_id
             LEFT JOIN channels ch ON ch.id = m.channel_id
             LEFT JOIN community_members cm ON cm.user_id = m.author_id AND cm.community_id = $1
            WHERE m.created_at > NOW() - ($2 || ' days')::interval AND m.is_deleted = false
              AND ($4::timestamptz IS NULL OR (m.created_at, m.id) > ($4::timestamptz, $5::uuid))
            ORDER BY m.created_at, m.id
            LIMIT $6`, params)
        : await db.query<Row>(
          `SELECT p.id, p.author_id, cm.role, cm.grade_id, u.username AS author, u.created_at::text AS author_created,
                  t.title AS place, LEFT(p.content, $3) AS content, p.created_at::text AS at
             FROM posts p
             JOIN users u ON u.id = p.author_id
             LEFT JOIN threads t ON t.id = p.thread_id
             LEFT JOIN community_members cm ON cm.user_id = p.author_id AND cm.community_id = $1
            WHERE p.created_at > NOW() - ($2 || ' days')::interval
              AND ($4::timestamptz IS NULL OR (p.created_at, p.id) > ($4::timestamptz, $5::uuid))
            ORDER BY p.created_at, p.id
            LIMIT $6`, params)
      if (rows.length === 0) break
      cursor = { at: rows[rows.length - 1].at, id: rows[rows.length - 1].id }

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i]
        if (i % 200 === 199) {
          await yieldToLoop()
          if (Date.now() - started > REPLAY_BUDGET_MS) { result.truncated = 'too_long'; break outer }
        }
        result.scanned++
        const at = new Date(r.at).getTime()
        const ageDays = (at - new Date(r.author_created).getTime()) / 86_400_000
        const user = { userId: r.author_id, role: r.role ?? 'member', gradeIds: r.grade_id ? [r.grade_id] : [], accountAgeDays: ageDays }
        // Même texte que le moteur en direct : le chat lit le HTML nettoyé, le forum son texte (liens compris)
        const content = surface === 'forum' ? textForModeration(r.content) : r.content

        let match
        if (rule.type === 'flood') {
          // Comme en direct : le message est noté AVANT la décision
          const key = r.author_id
          const list = (flood.get(key) ?? []).filter(e => at - e.t < FLOOD_MEMORY_MS)
          list.push({ t: at, h: floodFingerprint(content) })
          if (list.length > FLOOD_MEMORY_PER_USER) list.splice(0, list.length - FLOOD_MEMORY_PER_USER)
          flood.set(key, list)
          if (isImmunized(rule, user) || !conditionsMet(rule, user)) continue
          match = floodVerdict(list, list[list.length - 1].h, at, rule.params ?? {})
        } else {
          if (isImmunized(rule, user) || !conditionsMet(rule, user)) continue
          // Mentions : le HTML d'origine (marques de groupe comprises). « @enligne »
          // pèse les membres en ligne MAINTENANT : qui l'était alors n'est pas gardé.
          const mentionCount = rule.type === 'mention_spam' ? await mentionWeight(r.content, communityId, r.author_id, mentionCache) : undefined
          match = matchRule(content, rule, { mentionCount })
        }
        if (!match) continue

        result.matched++
        authors.add(r.author_id)
        await neverWarned([r.author_id])
        const fp = probableFalsePositive(rule.type, match.found, ageDays, warnedCache.get(r.author_id) ?? false)
        if (fp) result.probable_fp++
        // On garde les plus récents : un admin juge sur ce qui vient d'arriver
        result.examples.push({ at: r.at, author: r.author, place: r.place, surface, text: shortText(r.content), excerpt: match.excerpt.slice(0, EXAMPLE_CHARS), probable_fp: fp })
        if (result.examples.length > EXAMPLES) result.examples.shift()
      }
      if (rows.length < limit) break
    }
  }
  result.members = authors.size
  result.examples.reverse()
  return result
}
