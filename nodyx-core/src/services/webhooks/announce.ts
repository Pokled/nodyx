/**
 * Webhooks : les annonces de la communauté (familles publiques, D39).
 *
 * Chaque fonction relit le contenu EN BASE avant d'annoncer : seul ce que tout le
 * monde peut déjà voir part (wiki et calendrier : `is_public` ; forum : catégories
 * lisibles par tous). Un fil retenu par OctoGuard n'est annoncé qu'à sa
 * publication (held.ts appelle announceThread après l'approbation). Jamais
 * bloquant : une annonce ratée ne retarde ni ne casse rien.
 */
import { db } from '../../config/database'
import { textForModeration } from '../octoguard/moderate'
import { emitEvent } from './dispatch'

const run = (fn: () => Promise<void>) => { void fn().catch((err) => console.warn('[webhooks] annonce', err)) }
const excerpt = (html: string | null | undefined) => {
  const t = textForModeration(html ?? '').replace(/\s+/g, ' ').trim()
  return t.length > 280 ? `${t.slice(0, 279)}…` : t
}

/** Un nouvel article du forum (ou un article mis en avant). */
export function announceThread(threadId: string, family: 'forum_article' | 'forum_pinned' = 'forum_article'): void {
  run(async () => {
    const { rows } = await db.query<{ title: string; slug: string | null; cat_id: string; cat_name: string; cat_slug: string | null; author: string | null; content: string | null }>(
      `SELECT t.title, t.slug, c.id AS cat_id, c.name AS cat_name, c.slug AS cat_slug, u.username AS author,
              (SELECT p.content FROM posts p WHERE p.thread_id = t.id ORDER BY p.created_at ASC LIMIT 1) AS content
         FROM threads t JOIN categories c ON c.id = t.category_id LEFT JOIN users u ON u.id = t.author_id
        WHERE t.id = $1`, [threadId])
    const t = rows[0]
    if (!t) return
    emitEvent({
      type: family === 'forum_pinned' ? 'forum.pinned' : 'forum.article', family, at: new Date().toISOString(),
      actor: { type: 'member', name: t.author }, item: { title: t.title, category: t.cat_name, excerpt: excerpt(t.content) },
      details: { category_id: t.cat_id }, path: `/forum/${t.cat_slug ?? t.cat_id}/${t.slug ?? threadId}`,
    })
  })
}

export function announceTrack(trackId: string): void {
  run(async () => {
    const { rows } = await db.query<{ title: string; artist: string | null; duration: number | null }>(
      `SELECT title, artist, duration_seconds AS duration FROM music_tracks WHERE id = $1`, [trackId])
    const t = rows[0]
    if (!t) return
    emitEvent({ type: 'music.track', family: 'music', at: new Date().toISOString(), item: { title: t.title, artist: t.artist, duration_seconds: t.duration }, path: '/musique' })
  })
}

export function announceCalendarEvent(eventId: string): void {
  run(async () => {
    const { rows } = await db.query<{ title: string; starts_at: string; location: string | null; is_public: boolean; is_cancelled: boolean }>(
      `SELECT title, starts_at, location, is_public, is_cancelled FROM events WHERE id = $1`, [eventId])
    const e = rows[0]
    if (!e || !e.is_public || e.is_cancelled) return
    emitEvent({
      type: 'calendar.event', family: 'calendar', at: new Date().toISOString(),
      item: { title: e.title, starts_at: e.starts_at ? new Date(e.starts_at).toISOString() : null, place: e.location },
      path: `/calendar/${eventId}`,
    })
  })
}

export function announcePoll(pollId: string, authorId: string): void {
  run(async () => {
    // Les sondages vivent dans les salons, tous lisibles par les membres : rien de privé ici
    const { rows } = await db.query<{ title: string }>(`SELECT title FROM polls WHERE id = $1`, [pollId])
    const p = rows[0]
    if (!p) return
    const { rows: u } = await db.query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [authorId])
    emitEvent({ type: 'poll.created', family: 'polls', at: new Date().toISOString(), actor: { type: 'member', name: u[0]?.username ?? null }, item: { title: p.title }, path: '/polls' })
  })
}

export function announceWikiPage(slug: string): void {
  run(async () => {
    const { rows } = await db.query<{ title: string; slug: string; is_public: boolean; author: string | null }>(
      `SELECT w.title, w.slug, w.is_public, u.username AS author FROM wiki_pages w LEFT JOIN users u ON u.id = w.author_id WHERE w.slug = $1`, [slug])
    const w = rows[0]
    if (!w || !w.is_public) return
    emitEvent({ type: 'wiki.page', family: 'wiki', at: new Date().toISOString(), actor: { type: 'member', name: w.author }, item: { title: w.title }, path: `/wiki/${w.slug}` })
  })
}

export function announceLive(streamer: string, title: string | null, game: string | null, path = '/'): void {
  emitEvent({ type: 'live.started', family: 'live', at: new Date().toISOString(), actor: { type: 'member', name: streamer }, item: { title, game }, path })
}

export function announceMember(username: string): void {
  emitEvent({ type: 'member.joined', family: 'members', at: new Date().toISOString(), actor: { type: 'member', name: username }, path: `/users/${encodeURIComponent(username)}` })
}
