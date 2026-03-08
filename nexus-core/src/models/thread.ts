import { db } from '../config/database'

// ── Types ────────────────────────────────────────────────────

export interface Thread {
  id:              string
  category_id:     string
  author_id:       string
  title:           string
  slug:            string | null
  is_pinned:       boolean
  is_locked:       boolean
  is_featured:     boolean
  is_indexed:      boolean
  views:           number
  created_at:      Date
  updated_at:      Date
  last_indexed_at: Date | null
}

// ── Slug generation ──────────────────────────────────────────

export function generateSlug(title: string, id: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip accents
    .replace(/[^a-z0-9\s-]/g, '')       // keep letters, digits, spaces, hyphens
    .trim()
    .replace(/\s+/g, '-')               // spaces → hyphens
    .replace(/-{2,}/g, '-')             // collapse consecutive hyphens
    .slice(0, 80)                        // max 80 chars for the title part
    .replace(/-$/, '')                   // strip trailing hyphen
  const suffix = id.replace(/-/g, '').slice(0, 8)
  return `${base}-${suffix}`
}

export interface FeaturedThread {
  id:               string
  title:            string
  category_id:      string
  category_name:    string
  author_username:  string
  author_avatar:    string | null
  created_at:       Date
  post_count:       number
  first_post_content: string
}

// Thread with author info and post count — used for list views
export interface ThreadSummary extends Thread {
  author_username: string
  author_avatar:   string | null
  post_count:      number
}

// ── Queries ──────────────────────────────────────────────────

// Accepts either a UUID or a slug
export async function findById(idOrSlug: string): Promise<ThreadSummary | null> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrSlug)
  const { rows } = await db.query<ThreadSummary>(
    `SELECT t.*,
            u.username AS author_username,
            u.avatar   AS author_avatar,
            COUNT(p.id)::int AS post_count
     FROM threads t
     JOIN users u        ON u.id = t.author_id
     LEFT JOIN posts p   ON p.thread_id = t.id
     WHERE ${isUuid ? 't.id = $1' : 't.slug = $1'}
     GROUP BY t.id, u.username, u.avatar`,
    [idOrSlug]
  )
  return rows[0] ?? null
}

export async function listByCategory(categoryId: string, opts: {
  limit?:  number
  offset?: number
} = {}): Promise<ThreadSummary[]> {
  const limit  = opts.limit  ?? 20
  const offset = opts.offset ?? 0
  const { rows } = await db.query<ThreadSummary>(
    `SELECT t.*,
            u.username AS author_username,
            u.avatar   AS author_avatar,
            COUNT(p.id)::int AS post_count
     FROM threads t
     JOIN users u        ON u.id = t.author_id
     LEFT JOIN posts p   ON p.thread_id = t.id
     WHERE t.category_id = $1
     GROUP BY t.id, u.username, u.avatar
     ORDER BY t.is_pinned DESC, t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [categoryId, limit, offset]
  )
  return rows
}

export async function create(data: {
  category_id: string
  author_id:   string
  title:       string
}): Promise<Thread> {
  // Insert without slug first to get the generated UUID
  const { rows: inserted } = await db.query<Thread>(
    `INSERT INTO threads (category_id, author_id, title)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [data.category_id, data.author_id, data.title]
  )
  const thread = inserted[0]

  // Generate and persist the slug
  const slug = generateSlug(data.title, thread.id)
  const { rows } = await db.query<Thread>(
    `UPDATE threads SET slug = $1 WHERE id = $2 RETURNING *`,
    [slug, thread.id]
  )
  return rows[0] ?? thread
}

export async function update(id: string, data: {
  title?:       string
  is_pinned?:   boolean
  is_locked?:   boolean
  is_featured?: boolean
}): Promise<Thread | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.title      !== undefined) { fields.push(`title = $${i++}`);      values.push(data.title)      }
  if (data.is_pinned  !== undefined) { fields.push(`is_pinned = $${i++}`);  values.push(data.is_pinned)  }
  if (data.is_locked  !== undefined) { fields.push(`is_locked = $${i++}`);  values.push(data.is_locked)  }
  if (data.is_featured !== undefined) { fields.push(`is_featured = $${i++}`); values.push(data.is_featured) }

  if (fields.length === 0) {
    const { rows } = await db.query<Thread>(`SELECT * FROM threads WHERE id = $1`, [id])
    return rows[0] ?? null
  }

  values.push(id)
  const { rows } = await db.query<Thread>(
    `UPDATE threads SET ${fields.join(', ')}
     WHERE id = $${i}
     RETURNING *`,
    values
  )
  return rows[0] ?? null
}

export async function remove(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM threads WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}

export async function incrementViews(id: string): Promise<void> {
  await db.query(
    `UPDATE threads SET views = views + 1 WHERE id = $1`,
    [id]
  )
}

export async function getFeatured(limit = 3): Promise<FeaturedThread[]> {
  const { rows } = await db.query<FeaturedThread>(
    `SELECT
       t.id,
       t.title,
       t.category_id,
       c.name        AS category_name,
       u.username    AS author_username,
       u.avatar      AS author_avatar,
       t.created_at,
       (SELECT COUNT(*)::int FROM posts p WHERE p.thread_id = t.id) AS post_count,
       (SELECT p2.content FROM posts p2 WHERE p2.thread_id = t.id ORDER BY p2.created_at ASC LIMIT 1) AS first_post_content
     FROM threads t
     JOIN categories c ON c.id = t.category_id
     JOIN users u      ON u.id = t.author_id
     WHERE t.is_featured = true
     ORDER BY t.created_at DESC
     LIMIT $1`,
    [limit]
  )
  return rows
}
