/**
 * NEXUS — Instance routes
 *
 * These routes expose the identity and content of THIS Nexus instance.
 * Configuration comes from .env (NEXUS_COMMUNITY_*).
 * One instance = one community.
 */

import { FastifyInstance } from 'fastify'
import { db } from '../config/database'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as CommunityModel from '../models/community'
import * as ThreadModel from '../models/thread'
import * as TagModel from '../models/tag'
import { io } from '../socket/io'

// ── Helpers ───────────────────────────────────────────────────────────────────

function extractExcerpt(html: string, maxLen = 160): string {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen).trimEnd() + '…'
}

function extractFirstImage(html: string): string | null {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i)
  return match ? match[1] : null
}

// ── Resolve this instance's community once ───────────────────────────────────

let _communityId: string | null = null

async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId

  const slug = process.env.NEXUS_COMMUNITY_SLUG
  if (slug) {
    const community = await CommunityModel.findBySlug(slug)
    if (community) {
      _communityId = community.id
      return _communityId
    }
  }

  // Fallback: first community in the database
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  if (rows[0]) {
    _communityId = rows[0].id
    return _communityId
  }

  return null
}

// ── Routes ───────────────────────────────────────────────────────────────────

export default async function instanceRoutes(app: FastifyInstance) {

  // GET /api/v1/instance/info
  // Returns this instance's identity + live stats
  app.get('/info', { preHandler: [rateLimit] }, async (_request, reply) => {
    const communityId = await getCommunityId()

    const [memberRes, threadRes, postRes, presenceSockets, brandingRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM users`),
      db.query(`SELECT COUNT(*)::int AS count FROM threads`),
      db.query(`SELECT COUNT(*)::int AS count FROM posts`),
      io ? io.in('presence').fetchSockets() : Promise.resolve([]),
      communityId
        ? db.query<{ logo_url: string | null; banner_url: string | null }>(
            `SELECT logo_url, banner_url FROM communities WHERE id = $1`, [communityId]
          )
        : Promise.resolve({ rows: [{ logo_url: null, banner_url: null }] }),
    ])

    const seen = new Set<string>()
    for (const s of presenceSockets) { if (s.data.userId) seen.add(s.data.userId) }

    const branding = brandingRes.rows[0] ?? { logo_url: null, banner_url: null }

    return reply.send({
      name:        process.env.NEXUS_COMMUNITY_NAME        || 'Nexus',
      description: process.env.NEXUS_COMMUNITY_DESCRIPTION || '',
      language:    process.env.NEXUS_COMMUNITY_LANGUAGE    || 'fr',
      country:     process.env.NEXUS_COMMUNITY_COUNTRY     || '',
      slug:        process.env.NEXUS_COMMUNITY_SLUG        || '',
      community_id: communityId,
      member_count: memberRes.rows[0].count,
      online_count: seen.size,
      thread_count: threadRes.rows[0].count,
      post_count:   postRes.rows[0].count,
      logo_url:     branding.logo_url,
      banner_url:   branding.banner_url,
    })
  })

  // GET /api/v1/instance/categories
  // Returns the full category tree (recursive, with thread counts)
  app.get('/categories', { preHandler: [rateLimit] }, async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) {
      return reply.send({ categories: [] })
    }

    const categories = await CommunityModel.getCategoryTree(communityId)
    return reply.send({ categories })
  })

  // GET /api/v1/instance/threads/recent
  // Returns the 10 most recent threads across all categories
  app.get('/threads/recent', { preHandler: [rateLimit] }, async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) {
      return reply.send({ threads: [] })
    }

    const { rows } = await db.query(
      `SELECT
         t.id, t.title, t.views, t.is_locked, t.created_at,
         c.id   AS category_id,
         c.name AS category_name,
         u.username AS author_username,
         u.avatar   AS author_avatar,
         (SELECT COUNT(*)::int FROM posts p WHERE p.thread_id = t.id) AS post_count,
         (SELECT MAX(p2.created_at) FROM posts p2 WHERE p2.thread_id = t.id) AS last_post_at
       FROM threads t
       JOIN categories c ON c.id = t.category_id
       JOIN users     u ON u.id = t.author_id
       WHERE c.community_id = $1
       ORDER BY COALESCE(
         (SELECT MAX(p3.created_at) FROM posts p3 WHERE p3.thread_id = t.id),
         t.created_at
       ) DESC
       LIMIT 10`,
      [communityId]
    )

    return reply.send({ threads: rows })
  })

  // GET /api/v1/instance/tags
  // Returns all tags for this community (public)
  app.get('/tags', { preHandler: [rateLimit] }, async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.send({ tags: [] })
    const tags = await TagModel.listByCommunity(communityId)
    return reply.send({ tags })
  })

  // POST /api/v1/instance/tags — admin only
  app.post('/tags', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })

    const member = await CommunityModel.getMember(communityId, request.user!.userId)
    if (!member || member.role === 'member' || member.role === 'moderator') {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    const { name, color } = request.body as { name?: string; color?: string }
    if (!name?.trim()) {
      return reply.code(400).send({ error: 'Name required', code: 'BAD_REQUEST' })
    }

    const tag = await TagModel.create({
      community_id: communityId,
      name:         name.trim(),
      color:        color ?? '#6366f1',
    })
    return reply.code(201).send({ tag })
  })

  // DELETE /api/v1/instance/tags/:id — admin only
  app.delete('/tags/:id', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })

    const member = await CommunityModel.getMember(communityId, request.user!.userId)
    if (!member || member.role === 'member' || member.role === 'moderator') {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    const { id } = request.params as { id: string }
    await TagModel.remove(id)
    return reply.code(204).send()
  })

  // GET /api/v1/instance/threads/featured
  // Returns up to 3 featured threads with excerpt and thumbnail
  app.get('/threads/featured', { preHandler: [rateLimit] }, async (_request, reply) => {
    const rows = await ThreadModel.getFeatured(3)

    const articles = rows.map(t => ({
      id:             t.id,
      title:          t.title,
      categoryId:     t.category_id,
      categoryName:   t.category_name,
      authorUsername: t.author_username,
      authorAvatar:   t.author_avatar,
      createdAt:      t.created_at,
      postCount:      t.post_count,
      excerpt:        extractExcerpt(t.first_post_content ?? ''),
      imageUrl:       extractFirstImage(t.first_post_content ?? ''),
    }))

    return reply.send({ articles })
  })
}
