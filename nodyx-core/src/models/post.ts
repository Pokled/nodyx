import { db } from '../config/database'
import { getReactionsForPosts, type ReactionSummary } from './reaction'
import { getThanksForPosts } from './thanks'

// ── Types ────────────────────────────────────────────────────

export interface Post {
  id:         string
  thread_id:  string
  author_id:  string
  content:    string
  is_edited:  boolean
  created_at: Date
  updated_at: Date
}

// Post with author info — used in thread view
export interface PostWithAuthor extends Post {
  author_username:          string
  author_avatar:            string | null
  author_name_color:        string | null
  author_name_glow:         string | null
  author_name_glow_intensity: number | null
  author_name_animation:    string | null
  author_name_font_family:  string | null
  author_name_font_url:     string | null
  author_points:            number
  author_tags:         string[]
  author_member_since: Date
  author_grade_name:   string | null
  author_grade_color:  string | null
  // Social
  reactions:    ReactionSummary[]
  thanks_count: number
  user_thanked: boolean
}

// ── Queries ──────────────────────────────────────────────────

export async function findById(id: string): Promise<PostWithAuthor | null> {
  const { rows } = await db.query<PostWithAuthor>(
    `SELECT p.*,
            u.username   AS author_username,
            u.avatar     AS author_avatar,
            up.name_color          AS author_name_color,
            up.name_glow           AS author_name_glow,
            up.name_glow_intensity AS author_name_glow_intensity,
            up.name_animation      AS author_name_animation,
            up.name_font_family    AS author_name_font_family,
            up.name_font_url       AS author_name_font_url,
            u.points     AS author_points,
            u.created_at AS author_member_since,
            COALESCE(up.tags, '{}') AS author_tags,
            cg.name      AS author_grade_name,
            cg.color     AS author_grade_color
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN user_profiles up ON up.user_id = p.author_id
     JOIN threads t ON t.id = p.thread_id
     JOIN categories cat ON cat.id = t.category_id
     LEFT JOIN community_members cm ON cm.community_id = cat.community_id AND cm.user_id = p.author_id
     LEFT JOIN community_grades cg ON cg.id = cm.grade_id
     WHERE p.id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function listByThread(threadId: string, opts: {
  limit?:    number
  offset?:   number
  viewerId?: string
} = {}): Promise<PostWithAuthor[]> {
  const limit  = opts.limit  ?? 30
  const offset = opts.offset ?? 0
  const { rows } = await db.query<PostWithAuthor>(
    `SELECT p.*,
            u.username   AS author_username,
            u.avatar     AS author_avatar,
            up.name_color          AS author_name_color,
            up.name_glow           AS author_name_glow,
            up.name_glow_intensity AS author_name_glow_intensity,
            up.name_animation      AS author_name_animation,
            up.name_font_family    AS author_name_font_family,
            up.name_font_url       AS author_name_font_url,
            u.points     AS author_points,
            u.created_at AS author_member_since,
            COALESCE(up.tags, '{}') AS author_tags,
            cg.name      AS author_grade_name,
            cg.color     AS author_grade_color
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN user_profiles up ON up.user_id = p.author_id
     JOIN threads t ON t.id = p.thread_id
     JOIN categories cat ON cat.id = t.category_id
     LEFT JOIN community_members cm ON cm.community_id = cat.community_id AND cm.user_id = p.author_id
     LEFT JOIN community_grades cg ON cg.id = cm.grade_id
     WHERE p.thread_id = $1
     ORDER BY p.created_at ASC
     LIMIT $2 OFFSET $3`,
    [threadId, limit, offset]
  )

  if (rows.length === 0) return rows

  const postIds = rows.map(p => p.id)
  const [reactionsMap, thanksMap] = await Promise.all([
    getReactionsForPosts(postIds, opts.viewerId),
    getThanksForPosts(postIds, opts.viewerId),
  ])

  return rows.map(p => ({
    ...p,
    reactions:    reactionsMap.get(p.id) ?? [],
    thanks_count: thanksMap.get(p.id)?.count        ?? 0,
    user_thanked: thanksMap.get(p.id)?.user_thanked ?? false,
  }))
}

export async function create(data: {
  thread_id: string
  author_id: string
  content:   string
}): Promise<Post> {
  const { rows } = await db.query<Post>(
    `INSERT INTO posts (thread_id, author_id, content)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.thread_id, data.author_id, data.content]
  )
  return rows[0]
}

export async function update(id: string, authorId: string, content: string): Promise<Post | null> {
  const { rows } = await db.query<Post>(
    `UPDATE posts SET content = $1, is_edited = true
     WHERE id = $2 AND author_id = $3
     RETURNING *`,
    [content, id, authorId]
  )
  return rows[0] ?? null
}

export async function remove(id: string, authorId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM posts WHERE id = $1 AND author_id = $2`,
    [id, authorId]
  )
  return (rowCount ?? 0) > 0
}

// Mod-level: update without author restriction.
// L'ancien texte est gardé dans message_edits par la MÊME requête (lot 3
// d'OctoGuard 2), avec qui a modifié (l'auteur ou un modérateur).
export async function updateContent(id: string, content: string, editorId: string | null = null): Promise<Post | null> {
  const { rows } = await db.query<Post>(
    `WITH old AS (
       SELECT id, content FROM posts WHERE id = $2 FOR UPDATE
     ), upd AS (
       UPDATE posts p SET content = $1, is_edited = true, updated_at = NOW()
         FROM old WHERE p.id = old.id
       RETURNING p.*
     ), kept AS (
       INSERT INTO message_edits (target_type, target_id, editor_id, old_content)
       SELECT 'post', old.id, $3, old.content FROM old WHERE old.content IS DISTINCT FROM $1
     )
     SELECT * FROM upd`,
    [content, id, editorId]
  )
  return rows[0] ?? null
}

// Mod-level: delete without author restriction
export async function removeById(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM posts WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

// Get minimal post info (for auth checks)
export async function getAuthorAndThread(id: string): Promise<{ author_id: string; thread_id: string } | null> {
  const { rows } = await db.query<{ author_id: string; thread_id: string }>(
    `SELECT author_id, thread_id FROM posts WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}
