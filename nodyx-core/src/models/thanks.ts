import { db } from '../config/database'

export interface ThanksSummary {
  count:        number
  user_thanked: boolean
}

export async function toggleThanks(
  postId:   string,
  userId:   string,
  authorId: string
): Promise<{ added: boolean; new_count: number; new_points: number }> {
  if (userId === authorId) {
    throw new Error('Cannot thank your own post')
  }

  const { rows: existing } = await db.query(
    `SELECT 1 FROM post_thanks WHERE post_id = $1 AND user_id = $2`,
    [postId, userId]
  )

  let added: boolean
  if (existing.length > 0) {
    await db.query(`DELETE FROM post_thanks WHERE post_id = $1 AND user_id = $2`, [postId, userId])
    await db.query(`UPDATE users SET points = GREATEST(0, points - 5) WHERE id = $1`, [authorId])
    added = false
  } else {
    await db.query(`INSERT INTO post_thanks (post_id, user_id) VALUES ($1, $2)`, [postId, userId])
    await db.query(`UPDATE users SET points = points + 5 WHERE id = $1`, [authorId])
    added = true
  }

  const [thanksResult, pointsResult] = await Promise.all([
    db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM post_thanks WHERE post_id = $1`,
      [postId]
    ),
    db.query<{ points: number }>(
      `SELECT points FROM users WHERE id = $1`,
      [authorId]
    ),
  ])
  return { added, new_count: thanksResult.rows[0].count, new_points: pointsResult.rows[0].points }
}

// Bulk fetch thanks for a list of post IDs
export async function getThanksForPosts(
  postIds:   string[],
  viewerId?: string
): Promise<Map<string, ThanksSummary>> {
  if (postIds.length === 0) return new Map()

  const { rows } = await db.query<{
    post_id:      string
    count:        number
    user_thanked: boolean
  }>(
    `SELECT post_id, COUNT(*)::int AS count,
            BOOL_OR(user_id = $2) AS user_thanked
     FROM post_thanks
     WHERE post_id = ANY($1)
     GROUP BY post_id`,
    [postIds, viewerId ?? '00000000-0000-0000-0000-000000000000']
  )

  const map = new Map<string, ThanksSummary>()
  for (const row of rows) {
    map.set(row.post_id, { count: row.count, user_thanked: row.user_thanked })
  }
  return map
}
