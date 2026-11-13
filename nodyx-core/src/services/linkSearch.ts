// « Nodyx relié », lot 6b : chercher dans TOUT Nodyx pour poser un lien (bouton Lien,
// « @ » pour un membre, « # » pour un salon ou un sujet). SPECS/NODYX_EDITEUR_V2_CDC.md, E5.
//
// RÈGLE : on ne propose que ce que CE lecteur peut ouvrir, avec la règle de chaque page :
//   - sujets du forum : publics ;
//   - événements : publics, ou privés si le lecteur est membre (canReadEvent) ;
//   - membres, salons : réservés aux membres de la communauté ;
//   - pages du wiki : comptes connectés, module wiki activé.
// La route exige un compte (c'est un outil d'écriture). Champs choisis un par un.
import { db } from '../config/database'
import { isModuleEnabled } from '../middleware/requireModule'

export type LinkKind = 'thread' | 'event' | 'member' | 'channel' | 'wiki'
export const LINK_KINDS: LinkKind[] = ['thread', 'event', 'member', 'channel', 'wiki']

export interface LinkResult {
  type: LinkKind
  title: string
  url: string
  subtitle: string | null
  avatar?: string | null
}

const PER_KIND = 5

/** « %_\ » sont des jokers pour LIKE : un « 100% » tapé doit être cherché tel quel. */
export function likePattern(q: string, mode: 'contains' | 'prefix'): string {
  const esc = q.replace(/[\\%_]/g, c => '\\' + c)
  return mode === 'prefix' ? `${esc}%` : `%${esc}%`
}

async function communityOf(viewerId: string): Promise<string | null> {
  const { rows } = await db.query<{ community_id: string }>(
    `SELECT community_id FROM community_members WHERE user_id = $1 LIMIT 1`, [viewerId])
  return rows[0]?.community_id ?? null
}

export async function searchLinks(q: string, kinds: LinkKind[], viewerId: string): Promise<LinkResult[]> {
  const community = await communityOf(viewerId)
  const contains = likePattern(q, 'contains')
  const prefix   = likePattern(q, 'prefix')
  const tasks: Promise<LinkResult[]>[] = []

  if (kinds.includes('thread')) tasks.push(db.query<{ id: string; slug: string | null; title: string; cat_slug: string | null; cat_name: string | null }>(
    `SELECT t.id, t.slug, t.title, c.slug AS cat_slug, c.name AS cat_name
     FROM threads t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.title ILIKE $1
     ORDER BY t.updated_at DESC NULLS LAST LIMIT ${PER_KIND}`, [contains],
  ).then(r => r.rows.map(t => ({
    type: 'thread' as const, title: t.title, url: `/forum/${t.cat_slug ?? 'forum'}/${t.slug ?? t.id}`, subtitle: t.cat_name,
  }))))

  if (kinds.includes('event')) tasks.push(db.query<{ id: string; title: string; starts_at: string }>(
    // Même règle que la liste et la page de l'événement : public, ou membre de SA communauté.
    `SELECT e.id, e.title, e.starts_at FROM events e
     WHERE e.title ILIKE $1
       AND (e.is_public = true OR e.community_id = $2)
     -- Les prochains d'abord (le plus proche en tête), puis les passés (le plus récent).
     ORDER BY (e.starts_at >= NOW()) DESC,
              CASE WHEN e.starts_at >= NOW() THEN e.starts_at END ASC,
              e.starts_at DESC
     LIMIT ${PER_KIND}`, [contains, community],
  ).then(r => r.rows.map(e => ({
    type: 'event' as const, title: e.title, url: `/calendar/${e.id}`, subtitle: new Date(e.starts_at).toISOString(),
  }))))

  // Membres et salons : seulement pour un membre de la communauté.
  if (community && kinds.includes('member')) tasks.push(db.query<{ username: string; avatar: string | null; display_name: string | null }>(
    `SELECT u.username, u.avatar, p.display_name
     FROM community_members cm
     JOIN users u ON u.id = cm.user_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE cm.community_id = $1
       AND (u.username ILIKE $2 OR p.display_name ILIKE $2)
       AND NOT EXISTS (SELECT 1 FROM community_bans b WHERE b.community_id = cm.community_id AND b.user_id = u.id)
     ORDER BY lower(u.username) LIMIT ${PER_KIND}`, [community, prefix],
  ).then(r => r.rows.map(m => ({
    type: 'member' as const, title: m.display_name || m.username, url: `/users/${encodeURIComponent(m.username)}`,
    subtitle: `@${m.username}`, avatar: m.avatar,
  }))))

  if (community && kinds.includes('channel')) tasks.push(db.query<{ id: string; name: string; description: string | null }>(
    `SELECT id, name, description FROM channels
     WHERE community_id = $1 AND type = 'text' AND name ILIKE $2
     ORDER BY position LIMIT ${PER_KIND}`, [community, contains],
  ).then(r => r.rows.map(c => ({
    type: 'channel' as const, title: c.name, url: `/chat?channel=${c.id}`, subtitle: c.description,
  }))))

  if (kinds.includes('wiki')) tasks.push(isModuleEnabled('wiki').then(on => !on ? [] : db.query<{ slug: string; title: string; category: string | null }>(
    `SELECT slug, title, category FROM wiki_pages WHERE title ILIKE $1
     ORDER BY updated_at DESC NULLS LAST LIMIT ${PER_KIND}`, [contains],
  ).then(r => r.rows.map(w => ({
    type: 'wiki' as const, title: w.title, url: `/wiki/${encodeURIComponent(w.slug)}`, subtitle: w.category,
  })))))

  return (await Promise.all(tasks)).flat()
}
