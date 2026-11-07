/**
 * OctoGuard 2, lot 3 (CDC E4h, D18) : on ne juge jamais un message seul.
 * Pour un signalement ou un contenu retenu, l'équipe voit :
 *  - la conversation autour (5 messages avant, 5 après, même salon ou même fil),
 *  - ce que l'auteur a modifié (message_edits, migration 132),
 *  - la fiche courte de l'auteur (ancienneté, avertissements actifs, sourdine).
 * Lecture seule. Réservé à l'équipe (routes sous la garde des signalements).
 * Les textes sont bornés : un message du forum peut peser 500 Ko.
 */

import { db } from '../../config/database'

export const AROUND = 5
const AROUND_MAX_CHARS = 4000
const EDIT_MAX_CHARS = 20000
/** L'ancien texte d'un message modifié n'est pas gardé indéfiniment. */
export const EDITS_RETENTION_DAYS = 90

export interface AroundItem {
  id: string
  author_id: string | null
  author_username: string | null
  content: string | null      // null : message supprimé
  created_at: string
  edited: boolean
  is_target: boolean
}
export interface EditItem { old_content: string; edited_at: string; editor_username: string | null; by_author: boolean }
export interface AuthorBrief { id: string; username: string; created_at: string; warns_active: number; muted_until: string | null; muted: boolean }
export interface ContentContext {
  place: 'chat' | 'forum' | 'profile'
  around: AroundItem[]
  current: string | null
  edits: EditItem[]
  author: AuthorBrief | null
}

const cut = (s: string | null, n: number) => (s === null ? null : s.length > n ? s.slice(0, n) + '…' : s)

async function chatAround(channelId: string, at: string, targetId: string | null): Promise<AroundItem[]> {
  const sel = `SELECT m.id, m.author_id, u.username AS author_username,
                      CASE WHEN m.is_deleted THEN NULL ELSE m.content END AS content,
                      m.created_at, (m.edited_at IS NOT NULL) AS edited
                 FROM channel_messages m LEFT JOIN users u ON u.id = m.author_id`
  const [before, target, after] = await Promise.all([
    db.query(`${sel} WHERE m.channel_id = $1 AND m.created_at < $2::timestamptz AND m.id IS DISTINCT FROM $3::uuid
              ORDER BY m.created_at DESC LIMIT ${AROUND}`, [channelId, at, targetId]),
    targetId ? db.query(`${sel} WHERE m.id = $1`, [targetId]) : Promise.resolve({ rows: [] }),
    db.query(`${sel} WHERE m.channel_id = $1 AND m.created_at > $2::timestamptz AND m.id IS DISTINCT FROM $3::uuid
              ORDER BY m.created_at ASC LIMIT ${AROUND}`, [channelId, at, targetId]),
  ])
  return [
    ...before.rows.reverse().map((r: any) => ({ ...r, is_target: false })),
    ...target.rows.map((r: any) => ({ ...r, is_target: true })),
    ...after.rows.map((r: any) => ({ ...r, is_target: false })),
  ].map(r => ({ ...r, content: cut(r.content, AROUND_MAX_CHARS) }))
}

async function forumAround(threadId: string, at: string, targetId: string | null): Promise<AroundItem[]> {
  const sel = `SELECT p.id, p.author_id, u.username AS author_username, p.content, p.created_at, p.is_edited AS edited
                 FROM posts p LEFT JOIN users u ON u.id = p.author_id`
  const [before, target, after] = await Promise.all([
    db.query(`${sel} WHERE p.thread_id = $1 AND p.created_at < $2::timestamptz AND p.id IS DISTINCT FROM $3::uuid
              ORDER BY p.created_at DESC LIMIT ${AROUND}`, [threadId, at, targetId]),
    targetId ? db.query(`${sel} WHERE p.id = $1`, [targetId]) : Promise.resolve({ rows: [] }),
    db.query(`${sel} WHERE p.thread_id = $1 AND p.created_at > $2::timestamptz AND p.id IS DISTINCT FROM $3::uuid
              ORDER BY p.created_at ASC LIMIT ${AROUND}`, [threadId, at, targetId]),
  ])
  return [
    ...before.rows.reverse().map((r: any) => ({ ...r, is_target: false })),
    ...target.rows.map((r: any) => ({ ...r, is_target: true })),
    ...after.rows.map((r: any) => ({ ...r, is_target: false })),
  ].map(r => ({ ...r, content: cut(r.content, AROUND_MAX_CHARS) }))
}

async function editsOf(type: 'message' | 'post', id: string, authorId: string | null): Promise<EditItem[]> {
  const { rows } = await db.query(
    `SELECT e.old_content, e.edited_at, u.username AS editor_username, (e.editor_id = $3::uuid) AS by_author
       FROM message_edits e LEFT JOIN users u ON u.id = e.editor_id
      WHERE e.target_type = $1 AND e.target_id = $2
      ORDER BY e.edited_at ASC
      LIMIT 20`,
    [type, id, authorId]
  )
  return rows.map((r: any) => ({ ...r, by_author: !!r.by_author, old_content: cut(r.old_content, EDIT_MAX_CHARS) as string }))
}

export async function authorBrief(userId: string | null): Promise<AuthorBrief | null> {
  if (!userId) return null
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.created_at,
            (SELECT COUNT(*) FROM octoguard_warns w WHERE w.user_id = u.id AND w.cleared_at IS NULL)::int AS warns_active,
            (SELECT bool_or(true) FROM chat_mutes cm WHERE cm.user_id = u.id AND (cm.expires_at IS NULL OR cm.expires_at > NOW())) AS muted,
            (SELECT MAX(cm.expires_at) FROM chat_mutes cm WHERE cm.user_id = u.id AND cm.expires_at > NOW()) AS muted_until
       FROM users u WHERE u.id = $1`,
    [userId]
  )
  const r = rows[0]
  return r ? { ...r, muted: !!r.muted } : null
}

/** Le contexte d'un contenu signalé (cible d'un signalement). null : la cible n'existe plus. */
export async function reportContext(targetType: string, targetId: string): Promise<ContentContext | null> {
  if (targetType === 'message') {
    const { rows } = await db.query(`SELECT channel_id, author_id, created_at, CASE WHEN is_deleted THEN NULL ELSE content END AS content FROM channel_messages WHERE id = $1`, [targetId])
    const t = rows[0]; if (!t) return null
    const [around, edits, author] = await Promise.all([chatAround(t.channel_id, t.created_at, targetId), editsOf('message', targetId, t.author_id), authorBrief(t.author_id)])
    return { place: 'chat', around, current: cut(t.content, EDIT_MAX_CHARS), edits, author }
  }
  if (targetType === 'post' || targetType === 'thread') {
    // Un fil signalé : son premier message tient lieu de cible
    const { rows } = targetType === 'post'
      ? await db.query(`SELECT id, thread_id, author_id, created_at, content FROM posts WHERE id = $1`, [targetId])
      : await db.query(`SELECT id, thread_id, author_id, created_at, content FROM posts WHERE thread_id = $1 ORDER BY created_at ASC LIMIT 1`, [targetId])
    const t = rows[0]; if (!t) return null
    const [around, edits, author] = await Promise.all([forumAround(t.thread_id, t.created_at, t.id), editsOf('post', t.id, t.author_id), authorBrief(t.author_id)])
    return { place: 'forum', around, current: cut(t.content, EDIT_MAX_CHARS), edits, author }
  }
  if (targetType === 'user') {
    return { place: 'profile', around: [], current: null, edits: [], author: await authorBrief(targetId) }
  }
  return null
}

/** Le contexte d'un contenu retenu : ce qui s'est dit autour, au moment où il a été écrit. */
export async function heldContext(heldId: string): Promise<ContentContext | null> {
  const { rows } = await db.query(`SELECT kind, author_id, channel_id, thread_id, post_id, created_at FROM octoguard_held WHERE id = $1`, [heldId])
  const h = rows[0]; if (!h) return null
  const author = await authorBrief(h.author_id)
  if (h.kind === 'chat' && h.channel_id) {
    return { place: 'chat', around: await chatAround(h.channel_id, h.created_at, null), current: null, edits: [], author }
  }
  if (h.kind === 'post_edit' && h.post_id) {
    const { rows: p } = await db.query(`SELECT thread_id, created_at, content FROM posts WHERE id = $1`, [h.post_id])
    if (!p[0]) return { place: 'forum', around: [], current: null, edits: [], author }
    const [around, edits] = await Promise.all([forumAround(p[0].thread_id, p[0].created_at, h.post_id), editsOf('post', h.post_id, h.author_id)])
    return { place: 'forum', around, current: cut(p[0].content, EDIT_MAX_CHARS), edits, author }
  }
  if (h.kind === 'post' && h.thread_id) {
    return { place: 'forum', around: await forumAround(h.thread_id, h.created_at, null), current: null, edits: [], author }
  }
  return { place: 'forum', around: [], current: null, edits: [], author }
}

/** Efface l'ancien texte des modifications de plus de 90 jours. */
export async function purgeOldEdits(): Promise<number> {
  const { rows } = await db.query(
    `DELETE FROM message_edits WHERE edited_at < NOW() - ($1 || ' days')::interval RETURNING id`,
    [String(EDITS_RETENTION_DAYS)]
  )
  return rows.length
}
