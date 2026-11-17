// Mentions de groupe (SPECS/NODYX_MENTIONS_CDC.md, lot M2, D51-D52).
//
//   g:ici          les membres EN LIGNE à ce moment (tous les salons sont ouverts à tous)
//   g:equipe       propriétaire, admins, modérateurs, et tout grade qui donne un droit
//   g:moderation   ceux qui peuvent modérer les contenus ou les membres
//   g:tous         toute la communauté : réservé à l'équipe (D52)
//   g:grade:<id>   les porteurs d'un grade
//   g:event:<id>   les inscrits d'un événement : « J'y vais » et « Peut-être » (D60)
//   g:event-going:<id>  seulement « J'y vais » (« Seulement ceux qui viennent »)
//                  Appelés par l'organisateur, un inscrit ou l'équipe (D61), jusqu'à
//                  24 h après la fin de l'événement (D62). §10 du CDC des mentions.
//
// Les groupes sont développés AU SERVEUR, avec les vrais droits, et plafonnés : un
// message ne prévient jamais plus de MAX_GROUP_RECIPIENTS personnes, quoi qu'en dise
// l'interface. Jamais un compte système.
import { db } from '../config/database'
import { io } from '../socket/io'
import { getAccess } from './permissions'
import { canReadEvent } from './eventAccess'

export const MAX_GROUP_RECIPIENTS = 500
export const DEFAULT_CONFIRM_THRESHOLD = 10

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const GROUP_MARK_RE = new RegExp(`<span\\b[^>]*\\bdata-mention="g:(ici|equipe|moderation|tous|grade:${UUID}|event(?:-going)?:${UUID})"`, 'gi')
const KEY_RE = new RegExp(`^(ici|equipe|moderation|tous|grade:${UUID}|event(?:-going)?:${UUID})$`)
const EVENT_KEY_RE = new RegExp(`^event(-going)?:(${UUID})$`)

export const isGroupKey = (k: unknown): k is string => typeof k === 'string' && KEY_RE.test(k)

// ── @inscrits d'un événement ─────────────────────────────────────────────────────
export function eventKey(key: string): { id: string; goingOnly: boolean } | null {
  const m = EVENT_KEY_RE.exec(key)
  return m ? { id: m[2].toLowerCase(), goingOnly: !!m[1] } : null
}

export interface MentionEvent {
  id: string; title: string; starts_at: string; is_public: boolean; is_cancelled: boolean
  author_id: string | null; community_id: string; open: boolean
}

/** L'événement d'une clé, dans CETTE communauté ; `open` : encore appelable (D62, 24 h après la fin). */
export async function eventInCommunity(communityId: string, id: string): Promise<MentionEvent | null> {
  const { rows } = await db.query<MentionEvent>(
    `SELECT id, title, starts_at, is_public, is_cancelled, author_id, community_id,
            COALESCE(ends_at, starts_at) > NOW() - INTERVAL '24 hours' AS open
     FROM events WHERE id = $1 AND community_id = $2`, [id, communityId])
  return rows[0] ?? null
}

/** D61 : l'organisateur, un inscrit (« J'y vais » ou « Peut-être »), ou l'équipe. */
export async function canCallEvent(communityId: string, actorId: string, ev: MentionEvent): Promise<boolean> {
  if (!ev.open) return false
  if (ev.author_id === actorId) return true
  const { rows } = await db.query(
    `SELECT 1 FROM event_rsvps WHERE event_id = $1 AND user_id = $2 AND status IN ('going', 'maybe') LIMIT 1`, [ev.id, actorId])
  if (rows.length) return true
  return isTeam(communityId, actorId)
}

/** Combien viennent, combien « peut-être » (pour l'avertissement D51/D60). */
async function eventCounts(id: string): Promise<{ going: number; maybe: number }> {
  const { rows } = await db.query<{ going: number; maybe: number }>(
    `SELECT COUNT(*) FILTER (WHERE status = 'going')::int AS going, COUNT(*) FILTER (WHERE status = 'maybe')::int AS maybe
     FROM event_rsvps WHERE event_id = $1`, [id])
  return rows[0] ?? { going: 0, maybe: 0 }
}

/** Les groupes mentionnés dans un contenu (sans doublon, cinq au plus). */
export function groupKeysIn(html: string): string[] {
  const out: string[] = []
  for (const m of (html ?? '').matchAll(GROUP_MARK_RE)) {
    const k = m[1].toLowerCase()
    if (!out.includes(k)) out.push(k)
    if (out.length === 5) break
  }
  return out
}

/** L'équipe : un rôle d'équipe, ou un grade qui donne au moins un droit. */
export async function isTeam(communityId: string, userId: string): Promise<boolean> {
  const a = await getAccess(communityId, userId)
  return a.rank >= 1 || a.permissions.length > 0
}

const MEMBER = `FROM community_members cm JOIN users u ON u.id = cm.user_id
  LEFT JOIN community_grades g ON g.id = cm.grade_id AND g.community_id = cm.community_id
  WHERE cm.community_id = $1 AND u.is_system = false`

const TEAM_SQL = `(cm.role IN ('owner','admin','moderator')
  OR EXISTS (SELECT 1 FROM jsonb_each(COALESCE(g.permissions, '{}'::jsonb)) e WHERE e.value = 'true'::jsonb))`
const MOD_SQL = `(cm.role IN ('owner','admin','moderator')
  OR g.permissions->>'moderate_content' = 'true' OR g.permissions->>'moderate_members' = 'true')`

async function onlineUserIds(): Promise<string[]> {
  if (!io) return []
  const sockets = await io.in('presence').fetchSockets().catch(() => [])
  return [...new Set(sockets.map(s => s.data.userId as string).filter(Boolean))]
}

/** Les membres d'un groupe (MAX_GROUP_RECIPIENTS + 1 au plus, pour savoir si on dépasse). */
export async function membersOf(communityId: string, key: string): Promise<string[]> {
  if (!isGroupKey(key)) return []
  const lim = MAX_GROUP_RECIPIENTS + 1
  let rows: { user_id: string }[] = []
  if (key === 'tous') {
    ({ rows } = await db.query(`SELECT cm.user_id ${MEMBER} LIMIT ${lim}`, [communityId]))
  } else if (key === 'equipe') {
    ({ rows } = await db.query(`SELECT cm.user_id ${MEMBER} AND ${TEAM_SQL} LIMIT ${lim}`, [communityId]))
  } else if (key === 'moderation') {
    ({ rows } = await db.query(`SELECT cm.user_id ${MEMBER} AND ${MOD_SQL} LIMIT ${lim}`, [communityId]))
  } else if (key.startsWith('grade:')) {
    ({ rows } = await db.query(`SELECT cm.user_id ${MEMBER} AND cm.grade_id = $2 LIMIT ${lim}`, [communityId, key.slice(6)]))
  } else if (eventKey(key)) {
    const ev = eventKey(key)!
    ;({ rows } = await db.query(
      `SELECT r.user_id FROM event_rsvps r
       JOIN events e ON e.id = r.event_id AND e.community_id = $1
       JOIN community_members cm ON cm.user_id = r.user_id AND cm.community_id = $1
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = $2 AND r.status = ANY($3::text[]) AND u.is_system = false LIMIT ${lim}`,
      [communityId, ev.id, ev.goingOnly ? ['going'] : ['going', 'maybe']]))
  } else if (key === 'ici') {
    const online = await onlineUserIds()
    if (!online.length) return []
    ;({ rows } = await db.query(`SELECT cm.user_id ${MEMBER} AND cm.user_id = ANY($2::uuid[]) LIMIT ${lim}`, [communityId, online]))
  }
  return rows.map(r => r.user_id)
}

export interface GroupInfo {
  key: string; count: number; label: string | null; forbidden: boolean; needs_confirm: boolean
  /** @inscrits : qui vient, qui hésite (« 8 viennent, 3 peut-être ») */
  event?: { going: number; maybe: number }
}

/** Seuil de confirmation (D51), réglable par l'admin : instance_settings « mentions_group_confirm ». */
export async function confirmThreshold(): Promise<number> {
  const { rows } = await db.query<{ value: string }>(`SELECT value FROM instance_settings WHERE key = 'mentions_group_confirm'`).catch(() => ({ rows: [] as { value: string }[] }))
  const n = Number(rows[0]?.value)
  return Number.isInteger(n) && n >= 2 && n <= 500 ? n : DEFAULT_CONFIRM_THRESHOLD
}

/** Ce que chaque groupe va faire : combien de personnes, interdit ou non, confirmation ou non. */
export async function describeGroups(communityId: string, actorId: string, keys: string[]): Promise<GroupInfo[]> {
  const valid = [...new Set(keys.filter(isGroupKey))].slice(0, 5)
  if (!valid.length) return []
  const [team, threshold] = await Promise.all([isTeam(communityId, actorId), confirmThreshold()])
  const gradeIds = valid.filter(k => k.startsWith('grade:')).map(k => k.slice(6))
  const names = new Map<string, string>()
  if (gradeIds.length) {
    const { rows } = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM community_grades WHERE community_id = $1 AND id = ANY($2::uuid[])`, [communityId, gradeIds])
    rows.forEach(r => names.set('grade:' + r.id, r.name))
  }
  return Promise.all(valid.map(async key => {
    const evk = eventKey(key)
    if (evk) {
      const ev = await eventInCommunity(communityId, evk.id)
      const forbidden = !ev || !(await canCallEvent(communityId, actorId, ev))
      const ids = forbidden ? [] : (await membersOf(communityId, key)).filter(id => id !== actorId)
      const count = Math.min(ids.length, MAX_GROUP_RECIPIENTS)
      return { key, count, label: ev?.title ?? null, forbidden, needs_confirm: !forbidden && count > threshold,
               ...(ev && !forbidden ? { event: await eventCounts(ev.id) } : {}) }
    }
    const forbidden = key === 'tous' && !team
    const ids = forbidden ? [] : (await membersOf(communityId, key)).filter(id => id !== actorId)
    const count = Math.min(ids.length, MAX_GROUP_RECIPIENTS)
    return { key, count, label: key.startsWith('grade:') ? names.get(key) ?? null : null, forbidden, needs_confirm: !forbidden && count > threshold }
  }))
}

/** Les destinataires des groupes d'un contenu (droits vérifiés), plafonnés. */
export async function groupRecipients(html: string, communityId: string, actorId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()   // userId → groupe qui l'a prévenu
  const keys = groupKeysIn(html)
  if (!keys.length) return out
  const team = await isTeam(communityId, actorId)
  for (const key of keys) {
    if (key === 'tous' && !team) continue
    const evk = eventKey(key)
    if (evk) {
      const ev = await eventInCommunity(communityId, evk.id)
      if (!ev || !(await canCallEvent(communityId, actorId, ev))) continue
    }
    for (const id of await membersOf(communityId, key)) {
      if (id === actorId || out.has(id)) continue
      out.set(id, key)
      if (out.size >= MAX_GROUP_RECIPIENTS) return out
    }
  }
  return out
}

export interface GroupCard {
  key: string; label: string | null; color: string | null; count: number; sample: { username: string; display_name: string | null }[]
  /** @inscrits : l'événement (absent si introuvable ou interdit au lecteur : private = true) */
  event?: { id: string; starts_at: string; is_cancelled: boolean }
  private?: true
}

/**
 * Les puces de groupe : nom et couleur À JOUR (un grade renommé suit), nombre et quelques
 * noms. @inscrits : le titre seulement si CE lecteur peut lire l'événement (un événement
 * privé ne se dévoile pas dans un sujet public), et les noms seulement à un membre.
 */
export async function groupCards(communityId: string, keys: string[], viewerId: string | null = null): Promise<GroupCard[]> {
  const valid = [...new Set(keys.filter(isGroupKey))].slice(0, 10)
  if (!valid.length) return []
  const gradeIds = valid.filter(k => k.startsWith('grade:')).map(k => k.slice(6))
  const grades = new Map<string, { name: string; color: string | null }>()
  if (gradeIds.length) {
    const { rows } = await db.query<{ id: string; name: string; color: string | null }>(
      `SELECT id, name, color FROM community_grades WHERE community_id = $1 AND id = ANY($2::uuid[])`, [communityId, gradeIds])
    rows.forEach(r => grades.set('grade:' + r.id, { name: r.name, color: r.color }))
  }
  const viewerIsMember = viewerId && valid.some(k => eventKey(k))
    ? (await db.query(`SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`, [communityId, viewerId])).rows.length > 0
    : false
  return Promise.all(valid.map(async key => {
    const evk = eventKey(key)
    if (evk) {
      const ev = await eventInCommunity(communityId, evk.id)
      if (!ev || !(await canReadEvent(ev, viewerId))) return { key, label: null, color: null, count: 0, sample: [], private: true as const }
      const ids = await membersOf(communityId, key)
      const { rows } = viewerIsMember && ids.length
        ? await db.query<{ username: string; display_name: string | null }>(
            `SELECT u.username, up.display_name FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
             WHERE u.id = ANY($1::uuid[]) ORDER BY u.username LIMIT 5`, [ids.slice(0, 200)])
        : { rows: [] as { username: string; display_name: string | null }[] }
      return { key, label: ev.title, color: null, count: Math.min(ids.length, MAX_GROUP_RECIPIENTS), sample: rows,
               event: { id: ev.id, starts_at: new Date(ev.starts_at).toISOString(), is_cancelled: ev.is_cancelled } }
    }
    const ids = key.startsWith('grade:') && !grades.has(key) ? [] : await membersOf(communityId, key)
    const { rows } = ids.length
      ? await db.query<{ username: string; display_name: string | null }>(
          `SELECT u.username, up.display_name FROM users u LEFT JOIN user_profiles up ON up.user_id = u.id
           WHERE u.id = ANY($1::uuid[]) ORDER BY u.username LIMIT 5`, [ids.slice(0, 200)])
      : { rows: [] as { username: string; display_name: string | null }[] }
    const g = grades.get(key)
    return { key, label: g?.name ?? null, color: g?.color ?? null, count: Math.min(ids.length, MAX_GROUP_RECIPIENTS), sample: rows }
  }))
}
