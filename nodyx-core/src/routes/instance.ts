/**
 * NODYX — Instance routes
 *
 * These routes expose the identity and content of THIS Nodyx instance.
 * Configuration comes from .env (NODYX_COMMUNITY_*).
 * One instance = one community.
 */

import { FastifyInstance } from 'fastify'
import * as fs   from 'fs'
import * as path from 'path'

const NODYX_VERSION = process.env.NODYX_VERSION ?? '1.8.0'
import { db, redis } from '../config/database'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as CommunityModel from '../models/community'
import * as ThreadModel from '../models/thread'
import * as TagModel from '../models/tag'
import { io } from '../socket/io'

// ── ESY Key (lazy-loaded once from disk) ─────────────────────────────────────

let _esyKey: Record<string, unknown> | null = null

function loadEsyKey(): Record<string, unknown> | null {
  if (_esyKey) return _esyKey
  const esyPath = process.env.ESY_KEY_PATH
    ?? path.resolve(process.cwd(), '..', 'instance.esy')
  if (!fs.existsSync(esyPath)) return null
  try {
    _esyKey = JSON.parse(fs.readFileSync(esyPath, 'utf8'))
    return _esyKey
  } catch {
    return null
  }
}

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

  const slug = process.env.NODYX_COMMUNITY_SLUG
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

  // GET /api/v1/instance/maintenance
  // Public, lightweight, polled by the frontend banner.
  // Returns { active, reason?, since?, label? }.
  app.get('/maintenance', { preHandler: [rateLimit] }, async (_request, reply) => {
    const { getMaintenance } = await import('../services/maintenanceService')
    return reply.send(await getMaintenance())
  })

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
      name:        process.env.NODYX_COMMUNITY_NAME        || 'Nodyx',
      description: process.env.NODYX_COMMUNITY_DESCRIPTION || '',
      language:    process.env.NODYX_COMMUNITY_LANGUAGE    || 'fr',
      country:     process.env.NODYX_COMMUNITY_COUNTRY     || '',
      slug:        process.env.NODYX_COMMUNITY_SLUG        || '',
      version:     NODYX_VERSION,
      community_id: communityId,
      member_count: memberRes.rows[0].count,
      online_count: seen.size,
      thread_count: threadRes.rows[0].count,
      post_count:   postRes.rows[0].count,
      logo_url:     branding.logo_url,
      banner_url:   branding.banner_url,
      demo_mode:    process.env.NODYX_DEMO_MODE === 'true',
    })
  })

  // GET /api/v1/instance/members — full member list (username + avatar), for presence sidebar
  app.get('/members', { preHandler: [rateLimit] }, async (_request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.send({ members: [] })

    const { rows } = await db.query<{ user_id: string; username: string; avatar: string | null }>(
      `SELECT u.id AS user_id, u.username, u.avatar
       FROM community_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.community_id = $1
         AND NOT EXISTS (
           SELECT 1 FROM community_bans cb
           WHERE cb.community_id = $1 AND cb.user_id = cm.user_id
         )
       ORDER BY u.username ASC
       LIMIT 500`,
      [communityId]
    )
    return reply.send({ members: rows })
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
         (SELECT MAX(p2.created_at) FROM posts p2 WHERE p2.thread_id = t.id) AS last_post_at,
         (SELECT u2.username FROM posts lp JOIN users u2 ON u2.id = lp.author_id
          WHERE lp.thread_id = t.id ORDER BY lp.created_at DESC LIMIT 1) AS last_poster_username,
         (SELECT u2.avatar FROM posts lp JOIN users u2 ON u2.id = lp.author_id
          WHERE lp.thread_id = t.id ORDER BY lp.created_at DESC LIMIT 1) AS last_poster_avatar
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

  // GET /api/v1/instance/threads/showcase
  // Threads "éditorialisés" avec cover image + excerpt extraits du 1er post.
  // Query params: category (slug ou UUID), pinned_only, limit (max 20), order (recent|popular|most_viewed)
  app.get('/threads/showcase', { preHandler: [rateLimit] }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.send({ threads: [] })

    const query = request.query as {
      category?:    string
      pinned_only?: string
      limit?:       string
      order?:       string
    }

    const limit       = Math.min(20, Math.max(1, parseInt(query.limit ?? '6', 10) || 6))
    const pinnedOnly  = query.pinned_only === 'true' || query.pinned_only === '1'
    const orderKey    = ['recent', 'popular', 'most_viewed'].includes(query.order ?? '')
      ? (query.order as string)
      : 'recent'
    const categoryRaw = (query.category ?? '').trim()

    // Cache 30s — les articles changent mais pas toutes les secondes
    const cacheKey = `showcase:${communityId}:${categoryRaw}:${pinnedOnly}:${limit}:${orderKey}`
    const cached = await redis.get(cacheKey)
    if (cached) {
      reply.header('x-cache', 'HIT')
      return reply.send(JSON.parse(cached))
    }

    const conditions: string[] = ['c.community_id = $1']
    const params: unknown[] = [communityId]

    if (categoryRaw) {
      conditions.push(`(c.id::text = $${params.length + 1} OR c.slug = $${params.length + 1})`)
      params.push(categoryRaw)
    }
    if (pinnedOnly) conditions.push('t.is_pinned = true')

    const orderClause =
      orderKey === 'popular'     ? 'post_count DESC NULLS LAST, t.created_at DESC' :
      orderKey === 'most_viewed' ? 't.views DESC, t.created_at DESC' :
      'COALESCE((SELECT MAX(p3.created_at) FROM posts p3 WHERE p3.thread_id = t.id), t.created_at) DESC'

    params.push(limit)
    const limitIdx = params.length

    const { rows } = await db.query(
      `SELECT
         t.id, t.slug, t.title, t.views, t.is_pinned, t.is_locked, t.created_at,
         c.id   AS category_id,
         c.slug AS category_slug,
         c.name AS category_name,
         u.username AS author_username,
         u.avatar   AS author_avatar,
         (SELECT p.content FROM posts p
            WHERE p.thread_id = t.id
            ORDER BY p.created_at ASC LIMIT 1) AS first_post_content,
         (SELECT COUNT(*)::int FROM posts p WHERE p.thread_id = t.id) AS post_count
       FROM threads t
       JOIN categories c ON c.id = t.category_id
       JOIN users      u ON u.id = t.author_id
       WHERE ${conditions.join(' AND ')}
       ORDER BY ${orderClause}
       LIMIT $${limitIdx}`,
      params
    )

    // Extraction cover image + excerpt depuis le HTML du 1er post
    const IMG_RE = /<img[^>]+src=["']([^"']+)["']/i
    const TAG_RE = /<[^>]+>/g
    const WHITESPACE_RE = /\s+/g
    function stripHtml(html: string): string {
      return html
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(TAG_RE, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g,  '&')
        .replace(/&lt;/g,   '<')
        .replace(/&gt;/g,   '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .replace(WHITESPACE_RE, ' ')
        .trim()
    }

    const threads = rows.map(r => {
      const content: string = r.first_post_content ?? ''
      const imgMatch = content.match(IMG_RE)
      const cover    = imgMatch ? imgMatch[1] : null
      const text     = stripHtml(content)
      const excerpt  = text.length > 240 ? text.slice(0, 240).trimEnd() + '…' : text

      return {
        id:              r.id,
        slug:            r.slug,
        title:           r.title,
        views:           r.views,
        is_pinned:       r.is_pinned,
        is_locked:       r.is_locked,
        created_at:      r.created_at,
        category_id:     r.category_id,
        category_slug:   r.category_slug,
        category_name:   r.category_name,
        author_username: r.author_username,
        author_avatar:   r.author_avatar,
        post_count:      r.post_count,
        cover_url:       cover,
        excerpt,
      }
    })

    const response = { threads }
    await redis.set(cacheKey, JSON.stringify(response), 'EX', 30)
    reply.header('x-cache', 'MISS')
    return reply.send(response)
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
    if (!member || member.role === 'member') {
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
    if (!member || member.role === 'member') {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    const { id } = request.params as { id: string }
    await TagModel.remove(id)
    return reply.code(204).send()
  })

  // GET /api/v1/instance/threads/featured
  // Returns featured threads (or recent threads from a category) with excerpt and thumbnail
  // Query params: ?limit=1-10 (default 5), ?category_id=slug-or-uuid (optional)
  app.get('/threads/featured', { preHandler: [rateLimit] }, async (request, reply) => {
    const q = request.query as Record<string, string>
    const limit = Math.min(10, Math.max(1, parseInt(q.limit ?? '5') || 5))
    const categoryId = q.category_id?.trim() || undefined

    const rows = await ThreadModel.getFeatured(limit, categoryId)

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

  // GET /api/v1/instance/announcement — active announcement (public)
  app.get('/announcement', { preHandler: [rateLimit] }, async (_request, reply) => {
    try {
      const { rows } = await db.query(
        `SELECT id, message, color
         FROM system_announcements
         WHERE is_active = true
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY created_at DESC
         LIMIT 1`
      )
      return reply.send({ announcement: rows[0] ?? null })
    } catch {
      return reply.send({ announcement: null })
    }
  })

  // POST /api/v1/instance/status — set/clear the current user's presence status
  // Uses HTTP so it works even if the socket connection is still establishing.
  app.post('/status', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const userId = request.user!.userId
    const body = request.body as { emoji?: string; text?: string } | null

    const status = body && (body.emoji || body.text)
      ? { emoji: (body.emoji ?? '').slice(0, 8), text: (body.text ?? '').slice(0, 60) }
      : null

    if (status) {
      await redis.set(`status:${userId}`, JSON.stringify(status), 'EX', 86400).catch(() => {})
    } else {
      await redis.del(`status:${userId}`).catch(() => {})
    }

    // Update all sockets of this user and broadcast to presence room
    if (io) {
      const sockets = await io.in('presence').fetchSockets()
      sockets.filter(s => s.data.userId === userId).forEach(s => { (s.data as any).status = status })
      io.to('presence').emit('presence:status_update', { userId, status })
    }

    return reply.send({ ok: true, status })
  })

  // GET /api/v1/instance/esy-public — ESY barbarization params (auth required)
  // Returns the full ESY key so the browser can run barbarize/debarbarize locally.
  // Requires authentication to avoid leaking the permutation to anonymous crawlers.
  // GET /api/v1/instance/events-public — prochains événements publics (no auth, pour la homepage)
  app.get('/events-public', { preHandler: [rateLimit] }, async (request, reply) => {
    const { limit = '4' } = request.query as { limit?: string }
    const lim = Math.min(Math.max(1, Number(limit) || 4), 10)
    const communityId = await getCommunityId()
    const { rows } = await db.query(`
      SELECT id, title, description, location, starts_at, ends_at, is_all_day,
             cover_url, tags, rsvp_enabled,
             (SELECT COUNT(*) FROM event_rsvps WHERE event_id = e.id) AS rsvp_count
      FROM   events e
      WHERE  is_public    = true
      AND    is_cancelled = false
      AND    starts_at    > now()
      ${communityId ? 'AND community_id = $2' : ''}
      ORDER  BY starts_at ASC
      LIMIT  $1
    `, communityId ? [lim, communityId] : [lim])
    return reply.send({ events: rows })
  })

  // ── GET /api/v1/instance/homepage ─────────────────────────────────────────
  // Retourne toutes les positions activées avec leurs widgets ordonnés.
  // Cache Redis 60s. Invalide sur toute modification admin.
  // Public — no auth required.
  app.get('/homepage', { preHandler: [rateLimit] }, async (_request, reply) => {
    const CACHE_KEY = 'homepage:cache'

    const cached = await redis.get(CACHE_KEY)
    if (cached) {
      return reply.header('X-Cache', 'HIT').send(JSON.parse(cached))
    }

    const posRes = await db.query<{
      id: string; label: string; layout: string;
      max_widgets: number | null; sort_order: number; enabled: boolean
    }>(
      `SELECT id, label, layout, max_widgets, sort_order
       FROM homepage_positions
       WHERE enabled = true
       ORDER BY sort_order ASC`
    )

    const widRes = await db.query<{
      id: string; position_id: string; widget_type: string; title: string | null;
      config: Record<string, unknown>; sort_order: number; enabled: boolean;
      visibility: Record<string, unknown>; width: string;
      mobile_height: string | null; hide_mobile: boolean; hide_tablet: boolean
    }>(
      `SELECT id, position_id, widget_type, title, config, sort_order, enabled,
              visibility, width, mobile_height, hide_mobile, hide_tablet
       FROM homepage_widgets
       WHERE enabled = true
       ORDER BY position_id, sort_order ASC`
    )

    // Group widgets by position
    const widgetsByPosition: Record<string, typeof widRes.rows> = {}
    for (const w of widRes.rows) {
      if (!widgetsByPosition[w.position_id]) widgetsByPosition[w.position_id] = []
      widgetsByPosition[w.position_id].push(w)
    }

    const data = {
      positions: posRes.rows.map(p => ({
        ...p,
        widgets: widgetsByPosition[p.id] ?? []
      }))
    }

    await redis.setex(CACHE_KEY, 60, JSON.stringify(data))
    return reply.header('X-Cache', 'MISS').send(data)
  })

  // ── GET /api/v1/instance/homepage/grid ────────────────────────────────────
  // Retourne le layout Grid Builder v2 publié + thème. Cache Redis 60s.
  // Public — no auth required.
  app.get('/homepage/grid', { preHandler: [rateLimit] }, async (_request, reply) => {
    const CACHE_KEY = 'homepage:grid:cache'

    const cached = await redis.get(CACHE_KEY)
    if (cached) {
      return reply.header('X-Cache', 'HIT').send(JSON.parse(cached))
    }

    const { rows } = await db.query<{
      published_layout: unknown; theme: unknown
    }>('SELECT published_layout, theme FROM homepage_grid LIMIT 1')

    const row = rows[0] ?? {}
    const data = {
      layout: row.published_layout ?? null,
      theme:  row.theme ?? {}
    }

    await redis.setex(CACHE_KEY, 60, JSON.stringify(data))
    return reply.header('X-Cache', 'MISS').send(data)
  })

  app.get('/esy-public', { preHandler: [rateLimit, requireAuth] }, async (_request, reply) => {
    const key = loadEsyKey()
    if (!key) {
      return reply.code(503).send({
        error:   'ESY key not generated. Run: npm run generate-esy',
        code:    'ESY_NOT_CONFIGURED',
        enabled: false,
      })
    }
    // Expose ALL fields needed by the client (permutation, inverse, seed, rounds, glyphs)
    return reply.send({
      enabled:             true,
      version:             key.version,
      permutation:         key.permutation,
      inverse_permutation: key.inverse_permutation,
      noise_seed:          key.noise_seed,
      rounds:              key.rounds,
      glyphs:              key.glyphs,
      fingerprint:         key.fingerprint,
    })
  })
}
