/**
 * NODYX — Wiki routes
 * Internal knowledge base, gated behind the "wiki" module toggle.
 * Prefix: /api/v1/wiki
 *
 * Permissions:
 *   - Read  : any authenticated member
 *   - Write : admin or moderator only
 *   - Delete: admin or moderator only
 */

import { FastifyInstance } from 'fastify'
import { z }               from 'zod'
import { db }              from '../config/database.js'
import { requireAuth }     from '../middleware/auth.js'
import { rateLimit }       from '../middleware/rateLimit.js'
import { validate }        from '../middleware/validate.js'
import { requireModule }   from '../middleware/requireModule.js'
import { randomUUID }      from 'crypto'

// ── Slug generation ───────────────────────────────────────────────────────────

function generateWikiSlug(title: string): string {
  const base = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 72)
  return `${base}-${randomUUID().slice(0, 8)}`
}

// ── Role helper ───────────────────────────────────────────────────────────────

async function getUserRole(userId: string): Promise<string> {
  const { rows } = await db.query(
    `SELECT cm.role
     FROM community_members cm
     JOIN communities c ON c.id = cm.community_id
     WHERE cm.user_id = $1
     ORDER BY cm.joined_at ASC LIMIT 1`,
    [userId]
  )
  return rows[0]?.role ?? 'member'
}

// ── Schemas ───────────────────────────────────────────────────────────────────

const CreateBody = z.object({
  title:     z.string().min(1).max(200),
  content:   z.string(),
  excerpt:   z.string().max(500).optional(),
  category:  z.string().max(100).optional(),
  is_public: z.boolean().optional(),
})

const UpdateBody = z.object({
  title:     z.string().min(1).max(200).optional(),
  content:   z.string().optional(),
  excerpt:   z.string().max(500).optional(),
  category:  z.string().max(100).optional(),
  is_public: z.boolean().optional(),
})

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function wikiRoutes(app: FastifyInstance) {
  const guard = requireModule('wiki')

  // GET /api/v1/wiki — list all pages (optionally filtered by category)
  app.get('/', { preHandler: [rateLimit, requireAuth, guard] }, async (request, reply) => {
    const q        = request.query as Record<string, string>
    const category = q.category ?? null
    const search   = q.search   ?? null

    let sql = `
      SELECT w.id, w.slug, w.title, w.excerpt, w.category,
             w.is_public, w.views, w.created_at, w.updated_at,
             u.username   AS author_username,
             u.avatar AS author_avatar
      FROM wiki_pages w
      LEFT JOIN users u ON u.id = w.author_id
      WHERE 1=1`
    const params: unknown[] = []
    let   i = 1

    if (category) { sql += ` AND w.category = $${i++}`;                         params.push(category) }
    if (search)   { sql += ` AND w.title ILIKE $${i++}`;                        params.push(`%${search}%`) }

    sql += ` ORDER BY w.updated_at DESC`

    const { rows: pages } = await db.query(sql, params)

    const { rows: cats } = await db.query(
      `SELECT DISTINCT category FROM wiki_pages WHERE category IS NOT NULL ORDER BY category`
    )

    return reply.send({ pages, categories: cats.map((r: { category: string }) => r.category) })
  })

  // GET /api/v1/wiki/:slug — single page with full content
  app.get('/:slug', { preHandler: [rateLimit, requireAuth, guard] }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const { rows } = await db.query(
      `SELECT w.id, w.slug, w.title, w.content, w.excerpt,
              w.category, w.is_public, w.views, w.created_at, w.updated_at,
              u.username   AS author_username,
              u.avatar AS author_avatar,
              e.username   AS editor_username
       FROM wiki_pages w
       LEFT JOIN users u ON u.id = w.author_id
       LEFT JOIN users e ON e.id = w.editor_id
       WHERE w.slug = $1`,
      [slug]
    )

    if (!rows.length) return reply.code(404).send({ error: 'Page introuvable.' })

    // Async view counter — never blocks the response
    db.query(`UPDATE wiki_pages SET views = views + 1 WHERE slug = $1`, [slug]).catch(() => {})

    return reply.send(rows[0])
  })

  // POST /api/v1/wiki — create a new page (admin / moderator only)
  app.post('/', {
    preHandler: [rateLimit, requireAuth, guard, validate({ body: CreateBody })],
  }, async (request, reply) => {
    const user = (request as any).user
    const body = request.body as z.infer<typeof CreateBody>

    const role = await getUserRole(user.userId)
    if (role === 'member') {
      return reply.code(403).send({ error: 'Seuls les admins et modérateurs peuvent créer des pages wiki.' })
    }

    const slug = generateWikiSlug(body.title)

    const { rows } = await db.query(
      `INSERT INTO wiki_pages (slug, title, content, excerpt, category, is_public, author_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, slug`,
      [
        slug,
        body.title,
        body.content,
        body.excerpt  ?? null,
        body.category ?? null,
        body.is_public ?? false,
        user.userId,
      ]
    )

    return reply.code(201).send(rows[0])
  })

  // PATCH /api/v1/wiki/:slug — update a page (author or admin/mod)
  app.patch('/:slug', {
    preHandler: [rateLimit, requireAuth, guard, validate({ body: UpdateBody })],
  }, async (request, reply) => {
    const user = (request as any).user
    const { slug } = request.params as { slug: string }
    const body = request.body as z.infer<typeof UpdateBody>

    const { rows: existing } = await db.query(
      `SELECT id, author_id FROM wiki_pages WHERE slug = $1`,
      [slug]
    )
    if (!existing.length) return reply.code(404).send({ error: 'Page introuvable.' })

    const role     = await getUserRole(user.userId)
    const isAuthor = existing[0].author_id === user.userId
    if (role === 'member' && !isAuthor) {
      return reply.code(403).send({ error: 'Permission insuffisante pour modifier cette page.' })
    }

    const setParts: string[] = ['updated_at = NOW()', 'editor_id = $1']
    const values:   unknown[] = [user.userId]
    let i = 2

    if (body.title     !== undefined) { setParts.push(`title = $${i++}`);     values.push(body.title) }
    if (body.content   !== undefined) { setParts.push(`content = $${i++}`);   values.push(body.content) }
    if (body.excerpt   !== undefined) { setParts.push(`excerpt = $${i++}`);   values.push(body.excerpt) }
    if (body.category  !== undefined) { setParts.push(`category = $${i++}`);  values.push(body.category) }
    if (body.is_public !== undefined) { setParts.push(`is_public = $${i++}`); values.push(body.is_public) }

    values.push(existing[0].id)

    const { rows } = await db.query(
      `UPDATE wiki_pages SET ${setParts.join(', ')} WHERE id = $${i} RETURNING slug`,
      values
    )

    return reply.send(rows[0])
  })

  // DELETE /api/v1/wiki/:slug — delete a page (admin / moderator only)
  app.delete('/:slug', { preHandler: [rateLimit, requireAuth, guard] }, async (request, reply) => {
    const user = (request as any).user
    const { slug } = request.params as { slug: string }

    const role = await getUserRole(user.userId)
    if (!['owner', 'admin', 'moderator'].includes(role)) {
      return reply.code(403).send({ error: 'Seuls les admins et modérateurs peuvent supprimer des pages wiki.' })
    }

    const { rowCount } = await db.query(`DELETE FROM wiki_pages WHERE slug = $1`, [slug])
    if (!rowCount) return reply.code(404).send({ error: 'Page introuvable.' })

    return reply.send({ success: true })
  })
}
