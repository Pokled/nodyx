// « # » : montrer un endroit de la communauté (SPECS/NODYX_COMMANDES_CDC.md, lot C4 ;
// maquette https://nodyx.org/commandes-maquette.html section 2 ; décision D59).
//
// Un endroit = un salon, un événement, un sujet du forum, une page du wiki, un sondage
// ou un tableau de tâches. Le message garde une marque liée à l'endroit :
//   <a href="/calendar/<id>" data-place="event:<id>">#Soirée jeux</a>
// et le NOM est relu pour chaque lecteur (resolvePlaces) : un endroit renommé suit, un
// endroit introuvable ou interdit devient « endroit privé », sans jamais révéler son nom.
//
// Règles de lecture, les mêmes que les pages :
//   - salons, tableaux : membres de la communauté ;
//   - événements : publics, ou privés pour un membre (canReadEvent) ;
//   - sujets du forum : publics ;
//   - wiki : comptes connectés, module wiki allumé ;
//   - sondages : là où ils vivent (salon : membres ; sujet : public).
import { db } from '../config/database'
import { canReadEvent } from './eventAccess'
import { isModuleEnabled } from '../middleware/requireModule'

export type PlaceKind = 'channel' | 'event' | 'thread' | 'wiki' | 'poll' | 'board'
export const PLACE_KINDS: PlaceKind[] = ['channel', 'event', 'thread', 'wiki', 'poll', 'board']

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
/** La valeur d'une marque : « <sorte>:<uuid> ». La même règle au nettoyeur HTML. */
export const PLACE_VALUE = new RegExp(`^(channel|event|thread|wiki|poll|board):(${UUID})$`)

export interface Place {
  ref: string
  kind: PlaceKind
  title: string
  url: string
  /** Ce qui aide à choisir : « vendredi 20:00 · 8 inscrits », « dans Sorties ». Données, pas texte traduit. */
  hint: { starts_at?: string; is_all_day?: boolean; going?: number; category?: string | null; replies?: number; votes?: number; closed?: boolean; cards?: number; description?: string | null }
  /** Un événement privé : son nom ne doit pas être écrit dans un message (un forum est public). */
  private: boolean
}

const LIMIT = 8
const PER_KIND = 4

// Recherche sans accents (« soiree » trouve « Soirée »), comme les mentions
const ACCENTS_FROM = 'ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñÝýÿŒœÆæ'
const ACCENTS_TO   = 'AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNnYyyOoAa'
const fold = (col: string) => `LOWER(TRANSLATE(COALESCE(${col}, ''), '${ACCENTS_FROM}', '${ACCENTS_TO}'))`
export function foldText(s: string): string {
  // Comme TRANSLATE côté base : œ → o, æ → a (sinon « cœur » ne se retrouverait pas)
  return (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[œŒ]/g, 'o').replace(/[æÆ]/g, 'a').toLowerCase()
}
const like = (q: string) => `%${foldText(q).replace(/[\\%_]/g, c => '\\' + c)}%`

async function memberCommunity(viewerId: string): Promise<string | null> {
  const { rows } = await db.query<{ community_id: string }>(
    `SELECT community_id FROM community_members WHERE user_id = $1 LIMIT 1`, [viewerId])
  return rows[0]?.community_id ?? null
}

/**
 * Les endroits proposés pour « #<q> », dans l'ordre de D59 : salons, événements à venir,
 * sujets récents, wiki, sondages, tableaux ; à égalité le plus récent ; 8 au plus.
 * `q` vide (« # » seul) : les mêmes, sans filtre.
 */
export async function suggestPlaces(q: string, viewerId: string): Promise<Place[]> {
  const community = await memberCommunity(viewerId)
  const pat = like(q.trim())
  const wikiOn = await isModuleEnabled('wiki').catch(() => false)
  const lists = await Promise.all([
    community ? db.query<{ id: string; name: string; description: string | null }>(
      `SELECT id, name, description FROM channels
       WHERE community_id = $1 AND type IN ('text', 'voice') AND ${fold('name')} LIKE $2
       ORDER BY position LIMIT ${PER_KIND}`, [community, pat],
    ).then(r => r.rows.map((c): Place => ({ ref: `channel:${c.id}`, kind: 'channel', title: c.name, url: `/chat?channel=${c.id}`, hint: { description: c.description }, private: false }))) : [],

    db.query<{ id: string; title: string; starts_at: string; is_all_day: boolean; is_public: boolean; going: number }>(
      `SELECT e.id, e.title, e.starts_at, e.is_all_day, e.is_public,
              (SELECT COUNT(*)::int FROM event_rsvps r WHERE r.event_id = e.id AND r.status = 'going') AS going
       FROM events e
       WHERE ${fold('e.title')} LIKE $1 AND e.is_cancelled = false
         AND (e.is_public = true OR e.community_id = $2)
       ORDER BY (e.starts_at >= NOW()) DESC,
                CASE WHEN e.starts_at >= NOW() THEN e.starts_at END ASC,
                e.starts_at DESC
       LIMIT ${PER_KIND}`, [pat, community],
    ).then(r => r.rows.map((e): Place => ({ ref: `event:${e.id}`, kind: 'event', title: e.title, url: `/calendar/${e.id}`, hint: { starts_at: new Date(e.starts_at).toISOString(), is_all_day: e.is_all_day, going: e.going }, private: !e.is_public }))),

    db.query<{ id: string; slug: string | null; title: string; cat_slug: string | null; cat_name: string | null; replies: number }>(
      `SELECT t.id, t.slug, t.title, c.slug AS cat_slug, c.name AS cat_name,
              GREATEST((SELECT COUNT(*)::int FROM posts p WHERE p.thread_id = t.id) - 1, 0) AS replies
       FROM threads t LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${fold('t.title')} LIKE $1
       ORDER BY t.updated_at DESC NULLS LAST LIMIT ${PER_KIND}`, [pat],
    ).then(r => r.rows.map((t): Place => ({ ref: `thread:${t.id}`, kind: 'thread', title: t.title, url: `/forum/${t.cat_slug ?? 'forum'}/${t.slug ?? t.id}`, hint: { category: t.cat_name, replies: t.replies }, private: false }))),

    wikiOn ? db.query<{ id: string; slug: string; title: string; category: string | null }>(
      `SELECT id, slug, title, category FROM wiki_pages WHERE ${fold('title')} LIKE $1
       ORDER BY updated_at DESC NULLS LAST LIMIT ${PER_KIND}`, [pat],
    ).then(r => r.rows.map((w): Place => ({ ref: `wiki:${w.id}`, kind: 'wiki', title: w.title, url: `/wiki/${encodeURIComponent(w.slug)}`, hint: { category: w.category }, private: false }))) : [],

    db.query<{ id: string; title: string; channel_id: string | null; thread_id: string | null; closed: boolean; votes: number; cat_slug: string | null; t_slug: string | null }>(
      `SELECT p.id, p.title, p.channel_id, p.thread_id,
              (p.closed_at IS NOT NULL OR (p.closes_at IS NOT NULL AND p.closes_at < NOW())) AS closed,
              (SELECT COUNT(DISTINCT v.user_id)::int FROM poll_votes v WHERE v.poll_id = p.id) AS votes,
              c.slug AS cat_slug, t.slug AS t_slug
       FROM polls p
       LEFT JOIN channels ch ON ch.id = p.channel_id
       LEFT JOIN threads t ON t.id = p.thread_id
       LEFT JOIN categories c ON c.id = t.category_id
       WHERE ${fold('p.title')} LIKE $1
         AND (p.thread_id IS NOT NULL OR ch.community_id = $2)
       ORDER BY p.created_at DESC LIMIT ${PER_KIND}`, [pat, community],
    ).then(r => r.rows.map((p): Place => ({
      ref: `poll:${p.id}`, kind: 'poll', title: p.title, private: false, hint: { votes: p.votes, closed: p.closed },
      url: p.channel_id ? `/chat?channel=${p.channel_id}` : `/forum/${p.cat_slug ?? 'forum'}/${p.t_slug ?? p.thread_id}`,
    }))),

    community ? db.query<{ id: string; name: string; cards: number }>(
      `SELECT b.id, b.name,
              (SELECT COUNT(*)::int FROM task_cards k JOIN task_columns c ON c.id = k.column_id WHERE c.board_id = b.id) AS cards
       FROM task_boards b WHERE b.community_id = $1 AND ${fold('b.name')} LIKE $2
       ORDER BY b.created_at DESC LIMIT ${PER_KIND}`, [community, pat],
    ).then(r => r.rows.map((b): Place => ({ ref: `board:${b.id}`, kind: 'board', title: b.name, url: `/tasks/${b.id}`, hint: { cards: b.cards }, private: false }))) : [],
  ])
  return lists.flat().slice(0, LIMIT)
}

export type Resolved = { ref: string; ok: true; kind: PlaceKind; title: string; url: string } | { ref: string; ok: false }

/**
 * Le nom et l'adresse d'endroits marqués, pour CE lecteur. Un endroit introuvable OU
 * interdit donne la même réponse ({ ok: false }) : on ne révèle pas qu'il existe.
 */
export async function resolvePlaces(refs: string[], viewerId: string | null): Promise<Resolved[]> {
  const parsed = [...new Set(refs)].flatMap(r => { const m = PLACE_VALUE.exec(r); return m ? [{ ref: r, kind: m[1] as PlaceKind, id: m[2] }] : [] })
  const community = viewerId ? await memberCommunity(viewerId) : null
  const ids = (k: PlaceKind) => parsed.filter(p => p.kind === k).map(p => p.id)
  const found = new Map<string, { title: string; url: string; kind: PlaceKind }>()
  const wikiOn = viewerId && ids('wiki').length ? await isModuleEnabled('wiki').catch(() => false) : false

  if (community && ids('channel').length) {
    const { rows } = await db.query<{ id: string; name: string }>(`SELECT id, name FROM channels WHERE id = ANY($1::uuid[]) AND community_id = $2`, [ids('channel'), community])
    for (const c of rows) found.set(`channel:${c.id}`, { kind: 'channel', title: c.name, url: `/chat?channel=${c.id}` })
  }
  if (ids('event').length) {
    const { rows } = await db.query<{ id: string; title: string; is_public: boolean; community_id: string }>(`SELECT id, title, is_public, community_id FROM events WHERE id = ANY($1::uuid[])`, [ids('event')])
    for (const e of rows) if (await canReadEvent(e, viewerId)) found.set(`event:${e.id}`, { kind: 'event', title: e.title, url: `/calendar/${e.id}` })
  }
  if (ids('thread').length) {
    const { rows } = await db.query<{ id: string; slug: string | null; title: string; cat_slug: string | null }>(
      `SELECT t.id, t.slug, t.title, c.slug AS cat_slug FROM threads t LEFT JOIN categories c ON c.id = t.category_id WHERE t.id = ANY($1::uuid[])`, [ids('thread')])
    for (const t of rows) found.set(`thread:${t.id}`, { kind: 'thread', title: t.title, url: `/forum/${t.cat_slug ?? 'forum'}/${t.slug ?? t.id}` })
  }
  if (wikiOn) {
    const { rows } = await db.query<{ id: string; slug: string; title: string }>(`SELECT id, slug, title FROM wiki_pages WHERE id = ANY($1::uuid[])`, [ids('wiki')])
    for (const w of rows) found.set(`wiki:${w.id}`, { kind: 'wiki', title: w.title, url: `/wiki/${encodeURIComponent(w.slug)}` })
  }
  if (ids('poll').length) {
    const { rows } = await db.query<{ id: string; title: string; channel_id: string | null; thread_id: string | null; community_id: string | null; cat_slug: string | null; t_slug: string | null }>(
      `SELECT p.id, p.title, p.channel_id, p.thread_id, ch.community_id, c.slug AS cat_slug, t.slug AS t_slug
       FROM polls p LEFT JOIN channels ch ON ch.id = p.channel_id LEFT JOIN threads t ON t.id = p.thread_id LEFT JOIN categories c ON c.id = t.category_id
       WHERE p.id = ANY($1::uuid[])`, [ids('poll')])
    for (const p of rows) {
      if (p.channel_id && (!community || p.community_id !== community)) continue   // sondage d'un salon : membres seulement
      found.set(`poll:${p.id}`, { kind: 'poll', title: p.title, url: p.channel_id ? `/chat?channel=${p.channel_id}` : `/forum/${p.cat_slug ?? 'forum'}/${p.t_slug ?? p.thread_id}` })
    }
  }
  if (community && ids('board').length) {
    const { rows } = await db.query<{ id: string; name: string }>(`SELECT id, name FROM task_boards WHERE id = ANY($1::uuid[]) AND community_id = $2`, [ids('board'), community])
    for (const b of rows) found.set(`board:${b.id}`, { kind: 'board', title: b.name, url: `/tasks/${b.id}` })
  }
  return parsed.map(p => { const f = found.get(p.ref); return f ? { ref: p.ref, ok: true as const, ...f } : { ref: p.ref, ok: false as const } })
}
