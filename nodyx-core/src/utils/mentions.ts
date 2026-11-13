import { db } from '../config/database'

// Un message légitime ne mentionne jamais des dizaines de personnes distinctes.
// Sans plafond, un seul message pouvait porter ~1000 mentions distinctes et
// déclencher, PAR mention, un fetchSockets + un INSERT + un COUNT + un SELECT
// + un Web Push : un compte membre ordinaire pouvait ainsi amplifier un seul
// message en dizaines de milliers de requêtes (trouvé en audit le 16/09).
const MAX_MENTIONS_PER_MESSAGE = 20

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// Une marque de mention liée à la PERSONNE (SPECS/NODYX_MENTIONS_CDC.md, D49) :
// <span data-mention="u:<id>">@Léa</span>. Le texte du span n'est qu'un repli lisible.
const MARK_RE = new RegExp(`<span\\b[^>]*\\bdata-mention="u:(${UUID})"[^>]*>[^<]*</span>`, 'gi')

/**
 * Les personnes mentionnées dans un contenu, parmi les membres de la communauté :
 * les marques liées à la personne (la forme actuelle) ET l'ancien « @pseudo » écrit en
 * texte (les messages d'avant, et ceux tapés sans choisir dans la liste). Le texte d'une
 * marque n'est PAS relu comme « @pseudo » (il porte le nom affiché, pas le pseudo).
 * Plafond de MAX_MENTIONS_PER_MESSAGE sur l'ensemble des deux formes.
 * `communityId` scope la résolution aux membres de CETTE communauté : un
 * utilisateur exclu/banni ne doit pas pouvoir être notifié via une mention.
 */
export async function resolveMentions(html: string, communityId: string): Promise<string[]> {
  const ids = new Set<string>()
  const usernames = new Set<string>()
  const text = (html ?? '').replace(MARK_RE, (_m, id: string) => {
    if (ids.size + usernames.size < MAX_MENTIONS_PER_MESSAGE) ids.add(id.toLowerCase())
    return ' '
  })

  const mentionRegex = /@([\w\-]{2,30})/g
  let match: RegExpExecArray | null
  while (ids.size + usernames.size < MAX_MENTIONS_PER_MESSAGE && (match = mentionRegex.exec(text)) !== null) {
    usernames.add(match[1].toLowerCase())
  }

  if (ids.size === 0 && usernames.size === 0) return []

  // Exclut les utilisateurs système (bots OctoGuard et autres) :
  // un user humain ne peut pas mentionner un bot pour le notifier.
  const { rows } = await db.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM users u
     JOIN community_members cm ON cm.user_id = u.id
     WHERE (LOWER(u.username) = ANY($1) OR u.id = ANY($3::uuid[])) AND u.is_system = false AND cm.community_id = $2`,
    [Array.from(usernames), communityId, Array.from(ids)]
  )
  return rows.map(r => r.id)
}
