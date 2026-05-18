import { db } from '../config/database'

// Scan HTML content for @username mentions, return matching user IDs
export async function resolveMentions(html: string): Promise<string[]> {
  const mentionRegex = /@([\w\-]{2,30})/g
  const usernames    = new Set<string>()
  let match: RegExpExecArray | null

  while ((match = mentionRegex.exec(html)) !== null) {
    usernames.add(match[1].toLowerCase())
  }

  if (usernames.size === 0) return []

  // Exclut les utilisateurs système (bots OctoGuard et autres) :
  // un user humain ne peut pas mentionner un bot pour le notifier.
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE LOWER(username) = ANY($1) AND is_system = false`,
    [Array.from(usernames)]
  )
  return rows.map(r => r.id)
}
