// « Nodyx relié » : la carte d'un lien interne (SPECS/NODYX_EDITEUR_V2_CDC.md, E5).
//
// Un lien vers un sujet, une réponse précise ou un événement de CETTE instance devient
// une carte vivante (titre, auteur, date, participants…), lue AU MOMENT de l'affichage :
// le titre et l'heure sont ceux d'aujourd'hui, pas une copie figée.
//
// RÈGLE DE SÉCURITÉ : une carte ne montre que ce que CE lecteur a le droit de voir, avec
// la même règle que la page du contenu (forum : public ; événement : canReadEvent).
// Un contenu introuvable OU interdit donne la même carte « indisponible » : on ne révèle
// pas qu'un événement privé existe. Seuls des champs choisis un par un sortent d'ici
// (jamais une ligne `users` entière : pas d'e-mail, pas de rôle).
import sanitizeHtml from 'sanitize-html'
import { db } from '../config/database'
import * as ThreadModel from '../models/thread'
import { canReadEvent } from './eventAccess'
import { ownOrigins } from '../utils/instanceOrigins'

export type LinkRef =
  | { kind: 'thread'; thread: string; postId: string | null }
  | { kind: 'event'; id: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUG = /^[a-z0-9][a-z0-9-]{0,299}$/i

/**
 * Reconnaît un lien interne : un chemin (« /forum/… ») ou une adresse complète sur
 * l'origine de l'instance. Tout le reste (autre site, chemin inconnu) → null : le lien
 * reste un lien ordinaire.
 */
export function parseInternalLink(input: string): LinkRef | null {
  if (typeof input !== 'string' || input.length > 2048) return null
  let u: URL
  try {
    u = input.startsWith('/') && !input.startsWith('//')
      ? new URL(input, 'http://instance.invalid')
      : new URL(input)
  } catch { return null }
  if (u.origin !== 'http://instance.invalid' && !ownOrigins().has(u.origin)) return null
  if (u.username || u.password) return null

  const parts = u.pathname.split('/').filter(Boolean).map(p => { try { return decodeURIComponent(p) } catch { return '' } })

  // /forum/<catégorie>/<sujet>[#post-<id>]
  if (parts.length === 3 && parts[0] === 'forum' && SLUG.test(parts[1]) && (UUID.test(parts[2]) || SLUG.test(parts[2]))) {
    const m = u.hash.match(/^#post-([0-9a-f-]{36})$/i)
    return { kind: 'thread', thread: parts[2], postId: m && UUID.test(m[1]) ? m[1].toLowerCase() : null }
  }
  // /calendar/<id>
  if (parts.length === 2 && parts[0] === 'calendar' && UUID.test(parts[1])) {
    return { kind: 'event', id: parts[1].toLowerCase() }
  }
  return null
}

/** Texte brut d'un HTML de message, pour un extrait. À afficher comme TEXTE, jamais en {@html}. */
export function plainExcerpt(html: string, max = 200): string {
  const text = sanitizeHtml(html ?? '', { allowedTags: [], allowedAttributes: {} })
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim()
  return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text
}

export type LinkCard =
  | { type: 'thread'; url: string; title: string; category: string | null; author: { username: string; avatar: string | null }
      replies: number; created_at: string; last_activity_at: string; is_locked: boolean; tags: string[] }
  | { type: 'post'; url: string; thread: { title: string; url: string }; author: { username: string; avatar: string | null }
      excerpt: string; created_at: string }
  | { type: 'event'; url: string; title: string; starts_at: string; ends_at: string | null; is_all_day: boolean
      location: string | null; cover_url: string | null; is_cancelled: boolean; going_count: number
      rsvp_enabled: boolean; my_rsvp: string | null; is_full: boolean
      going_preview: { username: string; avatar: string | null }[] }
  | { type: 'unavailable' }

const UNAVAILABLE: LinkCard = { type: 'unavailable' }

export async function resolveCard(ref: LinkRef, viewerId: string | null): Promise<LinkCard> {
  if (ref.kind === 'thread') {
    const t = await ThreadModel.findById(ref.thread)
    if (!t) return UNAVAILABLE
    const threadUrl = `/forum/${t.category_slug ?? 'forum'}/${t.slug ?? t.id}`
    if (ref.postId) {
      const { rows } = await db.query<{ id: string; content: string; created_at: string; username: string; avatar: string | null }>(
        `SELECT p.id, p.content, p.created_at, u.username, u.avatar
         FROM posts p JOIN users u ON u.id = p.author_id
         WHERE p.id = $1 AND p.thread_id = $2 LIMIT 1`,
        [ref.postId, t.id],
      )
      const p = rows[0]
      if (!p) return UNAVAILABLE
      return {
        type: 'post', url: `${threadUrl}#post-${p.id}`,
        thread: { title: t.title, url: threadUrl },
        author: { username: p.username, avatar: p.avatar },
        excerpt: plainExcerpt(p.content), created_at: p.created_at,
      }
    }
    const { rows: cat } = await db.query<{ name: string }>(`SELECT name FROM categories WHERE id = $1`, [t.category_id])
    // Tags (trois au plus, comme sur la liste du forum) et dernière activité : ce qu'on
    // voit sur la page du sujet, rien de plus.
    const { rows: extra } = await db.query<{ last_at: string | Date | null; tags: string[] | null }>(
      `SELECT (SELECT MAX(p.created_at) FROM posts p WHERE p.thread_id = $1) AS last_at,
              (SELECT array_agg(x.name ORDER BY x.name) FROM (
                 SELECT tg.name FROM thread_tags tt JOIN tags tg ON tg.id = tt.tag_id
                 WHERE tt.thread_id = $1 ORDER BY tg.name LIMIT 3) x) AS tags`,
      [t.id],
    )
    const lastAt = extra[0]?.last_at ? new Date(extra[0].last_at) : new Date(t.created_at)
    return {
      type: 'thread', url: threadUrl, title: t.title, category: cat[0]?.name ?? null,
      author: { username: t.author_username, avatar: t.author_avatar ?? null },
      // post_count compte le premier message : les RÉPONSES sont les suivants.
      replies: Math.max(0, (t.post_count ?? 1) - 1), created_at: new Date(t.created_at).toISOString(),
      last_activity_at: lastAt.toISOString(), is_locked: !!t.is_locked, tags: extra[0]?.tags ?? [],
    }
  }

  const { rows } = await db.query<{
    id: string; title: string; starts_at: string; ends_at: string | null; is_all_day: boolean; location: string | null
    cover_url: string | null; is_cancelled: boolean; rsvp_enabled: boolean; is_public: boolean; community_id: string
    going_count: number; my_rsvp: string | null; max_attendees: number | null
  }>(
    `SELECT e.id, e.title, e.starts_at, e.ends_at, e.is_all_day, e.location, e.cover_url, e.is_cancelled,
            e.rsvp_enabled, e.is_public, e.community_id, e.max_attendees,
            (SELECT COUNT(*)::int FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going_count,
            (SELECT r2.status FROM event_rsvps r2 WHERE r2.event_id = e.id AND r2.user_id = $2 LIMIT 1) AS my_rsvp
     FROM events e WHERE e.id = $1`,
    [ref.id, viewerId],
  )
  const e = rows[0]
  if (!e || !(await canReadEvent(e, viewerId))) return UNAVAILABLE
  // Les trois premiers inscrits : la page de l'événement les montre déjà à ce lecteur
  // (même règle canReadEvent). Pseudo et avatar seulement.
  const { rows: going } = e.rsvp_enabled
    ? await db.query<{ username: string; avatar: string | null }>(
        `SELECT u.username, u.avatar FROM event_rsvps r JOIN users u ON u.id = r.user_id
         WHERE r.event_id = $1 AND r.status = 'going' ORDER BY r.created_at ASC LIMIT 3`,
        [e.id],
      )
    : { rows: [] as { username: string; avatar: string | null }[] }
  return {
    type: 'event', url: `/calendar/${e.id}`, title: e.title, starts_at: e.starts_at, ends_at: e.ends_at,
    is_all_day: e.is_all_day, location: e.location, cover_url: e.cover_url, is_cancelled: e.is_cancelled,
    going_count: e.going_count, rsvp_enabled: e.rsvp_enabled, my_rsvp: viewerId ? e.my_rsvp : null,
    is_full: e.max_attendees !== null && e.going_count >= e.max_attendees,
    going_preview: going.map(g => ({ username: g.username, avatar: g.avatar })),
  }
}
