/**
 * NEXUS — Admin routes
 * All routes require owner or admin role (adminOnly middleware).
 * Prefix: /api/v1/admin
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../config/database'
import { adminOnly } from '../middleware/adminOnly'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import * as ChannelModel from '../models/channel'
import { io } from '../socket/io'
import { randomUUID } from 'crypto'
import { createWriteStream, mkdirSync } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
const ALLOWED_MIME_BRANDING = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// ── Resolve instance community (cached) ──────────────────────────────────────

let _communityId: string | null = null

async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId
  const slug = process.env.NEXUS_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId }
  }
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  if (rows[0]) { _communityId = rows[0].id; return _communityId }
  return null
}

// ── Schemas ──────────────────────────────────────────────────────────────────

const PatchMemberBody = z.object({
  role: z.enum(['admin', 'moderator', 'member']).optional(),
})

const PatchThreadBody = z.object({
  is_pinned:   z.boolean().optional(),
  is_locked:   z.boolean().optional(),
  category_id: z.string().uuid().optional(),
})

const PatchCategoryBody = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  position:    z.number().int().min(0).optional(),
  parent_id:   z.string().uuid().nullable().optional(),
})

const CreateChannelBody = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  type:        z.enum(['text', 'voice']).optional(),
})

const ReorderChannelsBody = z.object({ ids: z.array(z.string().uuid()).min(1) })

// ── Routes ───────────────────────────────────────────────────────────────────

export default async function adminRoutes(app: FastifyInstance) {

  // ── Dashboard stats ────────────────────────────────────────────────────────

  app.get('/stats', {
    preHandler: [rateLimit, adminOnly],
  }, async (_req, reply) => {
    const communityId = await getCommunityId()

    const [usersRes, threadsRes, postsRes, catRes, presenceSockets] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
                FROM users`),
      db.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE t.created_at > NOW() - INTERVAL '7 days')::int AS new_this_week,
                       COUNT(*) FILTER (WHERE t.is_locked = true)::int AS locked,
                       COUNT(*) FILTER (WHERE t.is_pinned = true)::int AS pinned
                FROM threads t
                JOIN categories c ON c.id = t.category_id
                WHERE c.community_id = $1`, [communityId]),
      db.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE p.created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
                FROM posts p
                JOIN threads t ON t.id = p.thread_id
                JOIN categories c ON c.id = t.category_id
                WHERE c.community_id = $1`, [communityId]),
      db.query(`SELECT COUNT(*)::int AS total FROM categories WHERE community_id = $1`, [communityId]),
      io ? io.in('presence').fetchSockets() : Promise.resolve([]),
    ])

    const seenOnline = new Set<string>()
    for (const s of presenceSockets) { if (s.data.userId) seenOnline.add(s.data.userId) }

    // Activity by day — last 7 days
    const activityRes = await db.query(
      `SELECT DATE(p.created_at) AS day, COUNT(*)::int AS posts
       FROM posts p
       JOIN threads t ON t.id = p.thread_id
       JOIN categories c ON c.id = t.category_id
       WHERE c.community_id = $1 AND p.created_at > NOW() - INTERVAL '7 days'
       GROUP BY day ORDER BY day ASC`,
      [communityId]
    )

    // Top contributors (last 30 days)
    const topContribRes = await db.query(
      `SELECT u.username, u.avatar, COUNT(p.id)::int AS post_count
       FROM posts p
       JOIN users u ON u.id = p.author_id
       JOIN threads t ON t.id = p.thread_id
       JOIN categories c ON c.id = t.category_id
       WHERE c.community_id = $1 AND p.created_at > NOW() - INTERVAL '30 days'
       GROUP BY u.id, u.username, u.avatar
       ORDER BY post_count DESC
       LIMIT 5`,
      [communityId]
    )

    return reply.send({
      users:    usersRes.rows[0],
      threads:  threadsRes.rows[0],
      posts:    postsRes.rows[0],
      categories: catRes.rows[0],
      online:   seenOnline.size,
      activity_last_7_days: activityRes.rows,
      top_contributors:     topContribRes.rows,
    })
  })

  // ── Members ────────────────────────────────────────────────────────────────

  app.get('/members', {
    preHandler: [rateLimit, adminOnly],
  }, async (_req, reply) => {
    const communityId = await getCommunityId()

    const { rows } = await db.query(
      `SELECT
         cm.user_id, cm.role, cm.joined_at,
         u.username, u.email, u.avatar, u.created_at AS registered_at,
         cg.id   AS grade_id,
         cg.name AS grade_name,
         cg.color AS grade_color,
         (SELECT COUNT(*)::int FROM threads t
          JOIN categories c ON c.id = t.category_id
          WHERE t.author_id = u.id AND c.community_id = $1) AS thread_count,
         (SELECT COUNT(*)::int FROM posts p
          JOIN threads t ON t.id = p.thread_id
          JOIN categories c ON c.id = t.category_id
          WHERE p.author_id = u.id AND c.community_id = $1) AS post_count
       FROM community_members cm
       JOIN users u ON u.id = cm.user_id
       LEFT JOIN community_grades cg ON cg.id = cm.grade_id
       WHERE cm.community_id = $1
       ORDER BY
         CASE cm.role
           WHEN 'owner'     THEN 1
           WHEN 'admin'     THEN 2
           WHEN 'moderator' THEN 3
           ELSE 4
         END,
         cm.joined_at ASC`,
      [communityId]
    )

    return reply.send({ members: rows })
  })

  app.patch('/members/:userId', {
    preHandler: [rateLimit, adminOnly, validate({ body: PatchMemberBody })],
  }, async (request, reply) => {
    const { userId }  = request.params as { userId: string }
    const body        = request.body as z.infer<typeof PatchMemberBody>
    const communityId = await getCommunityId()

    // Cannot change owner's role
    const { rows: check } = await db.query(
      `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId]
    )
    if (!check[0]) return reply.code(404).send({ error: 'Member not found' })
    if (check[0].role === 'owner') return reply.code(403).send({ error: 'Cannot change owner role' })

    if (body.role) {
      await db.query(
        `UPDATE community_members SET role = $1 WHERE community_id = $2 AND user_id = $3`,
        [body.role, communityId, userId]
      )
    }

    return reply.send({ ok: true })
  })

  // Kick member from community (not a full ban — can re-join if public)
  app.delete('/members/:userId', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { userId }  = request.params as { userId: string }
    const communityId = await getCommunityId()

    const { rows: check } = await db.query(
      `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId]
    )
    if (!check[0]) return reply.code(404).send({ error: 'Member not found' })
    if (check[0].role === 'owner') return reply.code(403).send({ error: 'Cannot kick the owner' })

    await db.query(
      `DELETE FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId]
    )
    return reply.send({ ok: true })
  })

  // ── Threads (moderation) ───────────────────────────────────────────────────

  app.get('/threads', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    const q = request.query as { limit?: string; offset?: string; category_id?: string }
    const limit  = Math.min(Number(q.limit  ?? 50), 100)
    const offset = Number(q.offset ?? 0)

    let where = `c.community_id = $1`
    const params: unknown[] = [communityId]

    if (q.category_id) {
      params.push(q.category_id)
      where += ` AND t.category_id = $${params.length}`
    }

    const { rows } = await db.query(
      `SELECT
         t.id, t.title, t.is_pinned, t.is_locked, t.views, t.created_at,
         t.category_id,
         c.name  AS category_name,
         u.username AS author_username,
         u.avatar   AS author_avatar,
         COUNT(p.id)::int AS post_count
       FROM threads t
       JOIN categories c ON c.id = t.category_id
       JOIN users     u ON u.id = t.author_id
       LEFT JOIN posts p ON p.thread_id = t.id
       WHERE ${where}
       GROUP BY t.id, c.name, u.username, u.avatar
       ORDER BY t.is_pinned DESC, t.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    )

    // Total count
    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS total
       FROM threads t
       JOIN categories c ON c.id = t.category_id
       WHERE ${where}`,
      params
    )

    return reply.send({ threads: rows, total: countRows[0].total })
  })

  app.patch('/threads/:id', {
    preHandler: [rateLimit, adminOnly, validate({ body: PatchThreadBody })],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body   = request.body as z.infer<typeof PatchThreadBody>

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    if (body.is_pinned   !== undefined) { fields.push(`is_pinned = $${i++}`);   values.push(body.is_pinned)   }
    if (body.is_locked   !== undefined) { fields.push(`is_locked = $${i++}`);   values.push(body.is_locked)   }
    if (body.category_id !== undefined) { fields.push(`category_id = $${i++}`); values.push(body.category_id) }

    if (fields.length === 0) return reply.code(400).send({ error: 'Nothing to update' })

    values.push(id)
    const { rows } = await db.query(
      `UPDATE threads SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Thread not found' })

    return reply.send({ thread: rows[0] })
  })

  app.delete('/threads/:id', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { rowCount } = await db.query(`DELETE FROM threads WHERE id = $1`, [id])
    if (!rowCount) return reply.code(404).send({ error: 'Thread not found' })
    return reply.send({ ok: true })
  })

  // ── Categories ────────────────────────────────────────────────────────────

  app.patch('/categories/:id', {
    preHandler: [rateLimit, adminOnly, validate({ body: PatchCategoryBody })],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body   = request.body as z.infer<typeof PatchCategoryBody>

    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    if (body.name        !== undefined) { fields.push(`name = $${i++}`);        values.push(body.name)        }
    if (body.description !== undefined) { fields.push(`description = $${i++}`); values.push(body.description) }
    if (body.position    !== undefined) { fields.push(`position = $${i++}`);    values.push(body.position)    }
    if (body.parent_id   !== undefined) { fields.push(`parent_id = $${i++}`);   values.push(body.parent_id)   }

    if (fields.length === 0) return reply.code(400).send({ error: 'Nothing to update' })

    values.push(id)
    const { rows } = await db.query(
      `UPDATE categories SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $${i} RETURNING *`,
      values
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Category not found' })

    return reply.send({ category: rows[0] })
  })

  app.delete('/categories/:id', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    // Count threads in this category (and all subcategories)
    const { rows: countRows } = await db.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM categories WHERE id = $1
         UNION ALL
         SELECT c.id FROM categories c JOIN sub ON c.parent_id = sub.id
       )
       SELECT COUNT(*)::int AS total FROM threads WHERE category_id IN (SELECT id FROM sub)`,
      [id]
    )

    if (countRows[0].total > 0) {
      return reply.code(409).send({
        error: `Cette catégorie contient ${countRows[0].total} fil(s). Supprimez-les d'abord ou déplacez-les.`,
        code: 'CATEGORY_NOT_EMPTY',
        thread_count: countRows[0].total,
      })
    }

    const { rowCount } = await db.query(`DELETE FROM categories WHERE id = $1`, [id])
    if (!rowCount) return reply.code(404).send({ error: 'Category not found' })

    return reply.send({ ok: true })
  })

  // ── Channels ──────────────────────────────────────────────────────────────

  app.get('/channels', {
    preHandler: [rateLimit, adminOnly],
  }, async (_req, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })
    const channels = await ChannelModel.listByCommunity(communityId)
    return reply.send({ channels })
  })

  app.post('/channels', {
    preHandler: [rateLimit, adminOnly, validate({ body: CreateChannelBody })],
  }, async (request, reply) => {
    const body        = request.body as z.infer<typeof CreateChannelBody>
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    // Check slug uniqueness
    const slug = body.name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100)

    const { rows: existing } = await db.query(
      `SELECT id FROM channels WHERE community_id = $1 AND slug = $2`,
      [communityId, slug]
    )
    if (existing[0]) {
      return reply.code(409).send({ error: 'Un canal avec ce nom existe déjà', code: 'CONFLICT' })
    }

    const channel = await ChannelModel.create({ community_id: communityId, name: body.name, description: body.description, type: body.type })
    return reply.code(201).send({ channel })
  })

  app.put('/channels/reorder', {
    preHandler: [rateLimit, adminOnly, validate({ body: ReorderChannelsBody })],
  }, async (request, reply) => {
    const { ids } = request.body as z.infer<typeof ReorderChannelsBody>
    await ChannelModel.reorder(ids)
    return reply.send({ ok: true })
  })

  app.delete('/channels/:id', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const channel = await ChannelModel.findById(id)
    if (!channel) return reply.code(404).send({ error: 'Channel not found' })
    await ChannelModel.remove(id)
    return reply.send({ ok: true })
  })

  // PATCH /api/v1/admin/branding — update instance logo_url and/or banner_url
  app.patch('/branding', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(404).send({ error: 'Community not found' })

    const body = request.body as { logo_url?: string | null; banner_url?: string | null }
    const fields: string[] = []
    const values: unknown[] = []
    let i = 1

    if (body.logo_url   !== undefined) { fields.push(`logo_url = $${i++}`);   values.push(body.logo_url)   }
    if (body.banner_url !== undefined) { fields.push(`banner_url = $${i++}`); values.push(body.banner_url) }

    if (fields.length === 0) return reply.code(400).send({ error: 'Nothing to update' })

    values.push(communityId)
    const { rows } = await db.query(
      `UPDATE communities SET ${fields.join(', ')} WHERE id = $${i} RETURNING logo_url, banner_url`,
      values
    )
    return reply.send({ branding: rows[0] })
  })

  // POST /api/v1/admin/branding/upload?type=logo|banner — upload image file
  app.post('/branding/upload', {
    preHandler: [adminOnly],
  }, async (request, reply) => {
    const { type } = request.query as { type?: string }
    if (!type || !['logo', 'banner'].includes(type)) {
      return reply.code(400).send({ error: 'type must be "logo" or "banner"' })
    }

    const data = await request.file()
    if (!data) return reply.code(400).send({ error: 'No file provided' })
    if (!ALLOWED_MIME_BRANDING.includes(data.mimetype)) {
      return reply.code(400).send({ error: 'Format non supporté (JPEG, PNG, WebP, GIF)' })
    }

    const ext      = data.mimetype.split('/')[1].replace('jpeg', 'jpg')
    const folder   = `${type}s`
    const filename = `${randomUUID()}.${ext}`
    const dir      = path.join(UPLOADS_DIR, folder)
    mkdirSync(dir, { recursive: true })
    await pipeline(data.file, createWriteStream(path.join(dir, filename)))

    return reply.send({ url: `/uploads/${folder}/${filename}` })
  })
}
