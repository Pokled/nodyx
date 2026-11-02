// Signalements : ce qui est signalé, par qui il a été écrit, et ce qu'il
// disait au moment du signalement (CDC SPECS/NODYX_MODERATION_CDC.md, E2).
//
// La photo (snapshot) est prise À L'ENVOI : si l'auteur modifie ou supprime
// son message ensuite, l'équipe garde la preuve de ce qui a été signalé.

import { db } from '../config/database'

export type ReportTargetType = 'message' | 'user' | 'thread' | 'post'

export interface ReportTarget {
  authorId:    string
  communityId: string | null
  snapshot:    string
  label:       string
  link:        string
}

const SNAPSHOT_MAX = 1000

/** Texte brut lisible à partir du HTML d'un message (éditeur, chat). */
export function toPlainText(html: string | null | undefined): string {
  return (html ?? '')
    .replace(/<\s*(br|\/p|\/div|\/li|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, SNAPSHOT_MAX)
}

/**
 * Retrouve la cible d'un signalement. null si elle n'existe pas (ou plus) :
 * on ne signale pas un identifiant inventé.
 */
export async function resolveReportTarget(type: ReportTargetType, id: string): Promise<ReportTarget | null> {
  switch (type) {
    case 'post': {
      const { rows } = await db.query<{ author_id: string; content: string; title: string; thread_ref: string; cat_ref: string; community_id: string }>(
        `SELECT p.author_id, p.content, t.title, COALESCE(t.slug, t.id::text) AS thread_ref,
                COALESCE(c.slug, c.id::text) AS cat_ref, c.community_id
         FROM posts p JOIN threads t ON t.id = p.thread_id JOIN categories c ON c.id = t.category_id
         WHERE p.id = $1`, [id])
      const r = rows[0]
      if (!r) return null
      return { authorId: r.author_id, communityId: r.community_id, snapshot: toPlainText(r.content), label: r.title, link: `/forum/${r.cat_ref}/${r.thread_ref}#post-${id}` }
    }
    case 'thread': {
      const { rows } = await db.query<{ author_id: string; title: string; thread_ref: string; cat_ref: string; community_id: string; first: string | null }>(
        `SELECT t.author_id, t.title, COALESCE(t.slug, t.id::text) AS thread_ref,
                COALESCE(c.slug, c.id::text) AS cat_ref, c.community_id,
                (SELECT p.content FROM posts p WHERE p.thread_id = t.id ORDER BY p.created_at ASC LIMIT 1) AS first
         FROM threads t JOIN categories c ON c.id = t.category_id
         WHERE t.id = $1`, [id])
      const r = rows[0]
      if (!r) return null
      return { authorId: r.author_id, communityId: r.community_id, snapshot: toPlainText(`${r.title}\n\n${r.first ?? ''}`), label: r.title, link: `/forum/${r.cat_ref}/${r.thread_ref}` }
    }
    case 'message': {
      const { rows } = await db.query<{ author_id: string; content: string; is_deleted: boolean; channel_id: string; name: string; community_id: string }>(
        `SELECT m.author_id, m.content, m.is_deleted, m.channel_id, ch.name, ch.community_id
         FROM channel_messages m JOIN channels ch ON ch.id = m.channel_id
         WHERE m.id = $1`, [id])
      const r = rows[0]
      if (!r || r.is_deleted) return null
      return { authorId: r.author_id, communityId: r.community_id, snapshot: toPlainText(r.content), label: `#${r.name}`, link: `/chat?channel=${r.channel_id}` }
    }
    case 'user': {
      const { rows } = await db.query<{ id: string; username: string; bio: string | null; is_system: boolean }>(
        `SELECT id, username, bio, is_system FROM users WHERE id = $1`, [id])
      const r = rows[0]
      if (!r || r.is_system) return null
      return { authorId: r.id, communityId: null, snapshot: toPlainText(r.bio), label: r.username, link: `/users/${encodeURIComponent(r.username)}` }
    }
  }
}
