import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import sanitizeHtml from 'sanitize-html'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import * as CommunityModel from '../models/community'
import * as ThreadModel from '../models/thread'
import * as PostModel from '../models/post'
import * as ReactionModel from '../models/reaction'
import * as ThanksModel from '../models/thanks'
import * as TagModel from '../models/tag'
import * as NotificationModel from '../models/notification'
import { resolveMentions } from '../utils/mentions'
import { db } from '../config/database'
import { checkHtmlContent } from '../services/contentFilter'
import { io } from '../socket/io'

// Check if userId is owner/admin/moderator in the community that owns a thread
async function isMod(userId: string, threadId: string): Promise<boolean> {
  const { rows } = await db.query<{ role: string }>(
    `SELECT cm.role
     FROM community_members cm
     JOIN categories cat ON cat.community_id = cm.community_id
     JOIN threads t ON t.category_id = cat.id
     WHERE t.id = $1 AND cm.user_id = $2
     LIMIT 1`,
    [threadId, userId]
  )
  const role = rows[0]?.role
  return role === 'owner' || role === 'admin' || role === 'moderator'
}

// Check if userId is owner or admin (not moderator) in the community that owns a thread
// Used for privileged operations: lock thread, pin thread
async function isAdmin(userId: string, threadId: string): Promise<boolean> {
  const { rows } = await db.query<{ role: string }>(
    `SELECT cm.role
     FROM community_members cm
     JOIN categories cat ON cat.community_id = cm.community_id
     JOIN threads t ON t.category_id = cat.id
     WHERE t.id = $1 AND cm.user_id = $2
     LIMIT 1`,
    [threadId, userId]
  )
  const role = rows[0]?.role
  return role === 'owner' || role === 'admin'
}

// Get author_id of a post (used for thanks)
async function getPostAuthor(postId: string): Promise<{ author_id: string; thread_id: string } | null> {
  return PostModel.getAuthorAndThread(postId)
}

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
  'h1', 'h2', 'h3', 'h4',
  'ul', 'ol', 'li',
  'blockquote', 'hr',
  'a', 'img',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'div', 'span',
  'iframe',
]

const ALLOWED_ATTRS: sanitizeHtml.IOptions['allowedAttributes'] = {
  '*':      ['class', 'data-align', 'data-type'],
  'span':   ['class', 'style', 'data-align', 'data-type'],
  'p':      ['class', 'style', 'data-align', 'data-type'],
  'a':      ['href', 'target', 'rel'],
  'img':    ['src', 'alt', 'width', 'height'],
  'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow'],
  'th':     ['rowspan', 'colspan'],
  'td':     ['rowspan', 'colspan'],
}

// Images autorisées : serveur propre + CDN GIF uniquement
const ALLOWED_IMG_HOSTS_FORUM = new Set([
  'media.tenor.com', 'c.tenor.com', 'media1.tenor.com', 'tenor.com',
  'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com',
  'media2.giphy.com', 'media3.giphy.com', 'i.giphy.com',
])

function isAllowedImgSrcForum(src: string): boolean {
  if (!src) return false
  if (src.startsWith('/uploads/')) return true
  if (src.startsWith('data:image/')) return true
  try {
    return ALLOWED_IMG_HOSTS_FORUM.has(new URL(src).hostname)
  } catch {
    return false
  }
}

const _envBlockedForum = (process.env.BLOCKED_LINK_DOMAINS ?? '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)

const BLOCKED_LINK_DOMAINS_FORUM = new Set([
  'pornhub.com', 'xvideos.com', 'xhamster.com', 'xnxx.com',
  'redtube.com', 'youporn.com', 'tube8.com', 'spankbang.com',
  'tnaflix.com', 'drtuber.com', 'beeg.com', 'txxx.com',
  ..._envBlockedForum,
])

function sanitize(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedIframeHostnames: ['www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com', 'player.vimeo.com', 'vimeo.com'],
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img') return !isAllowedImgSrcForum(frame.attribs?.src ?? '')
      if (frame.tag === 'a') {
        const href = frame.attribs?.href ?? ''
        try {
          const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, '')
          return BLOCKED_LINK_DOMAINS_FORUM.has(hostname)
        } catch { return false }
      }
      return false
    },
  })
}

const CreateCategoryBody = z.object({
  community_id: z.string().uuid(),
  name:         z.string().min(1).max(100),
  description:  z.string().max(500).optional(),
  position:     z.number().int().min(0).optional(),
})

const ThreadsQuery = z.object({
  category_id: z.string().min(1), // accepts UUID or slug — resolved server-side
  limit:       z.coerce.number().int().min(1).max(100).optional(),
  offset:      z.coerce.number().int().min(0).optional(),
})

const CreateThreadBody = z.object({
  category_id: z.string().min(1), // accepts UUID or slug — resolved server-side
  title:       z.string().min(3).max(300),
  content:     z.string().min(1).max(500_000), // ~500 KB max
  tag_ids:     z.array(z.string().uuid()).max(5).optional(),
})

const CreatePostBody = z.object({
  thread_id: z.string().min(1), // accepts UUID or slug — resolved server-side
  content:   z.string().min(1).max(500_000),
})

const ReactionBody = z.object({
  emoji: z.string().min(1).max(10),
})

export default async function forumRoutes(app: FastifyInstance) {
  // GET /api/v1/forums/:community
  app.get('/:community', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { community } = request.params as { community: string }

    const found = await CommunityModel.findBySlug(community)
    if (!found) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const categories = await CommunityModel.getCategories(found.id)
    return reply.send({ categories })
  })

  // POST /api/v1/forums/categories
  app.post('/categories', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateCategoryBody })],
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof CreateCategoryBody>

    const community = await CommunityModel.findById(data.community_id)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const member = await CommunityModel.getMember(community.id, request.user!.userId)
    if (!member || member.role === 'member') {
      return reply.code(403).send({ error: 'Only moderators and owners can create categories', code: 'FORBIDDEN' })
    }

    const category = await CommunityModel.createCategory(data)
    return reply.code(201).send({ category })
  })

// GET /api/v1/forums/threads
app.get('/threads', {
  preHandler: [rateLimit, validate({ query: ThreadsQuery })],
}, async (request, reply) => {
  const { category_id: rawCatId, limit, offset } = request.query as z.infer<typeof ThreadsQuery>

  // Resolve slug → UUID if needed
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCatId)
  let category_id = rawCatId
  if (!isUuid) {
    const { rows: catRows } = await db.query(
      `SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [rawCatId]
    )
    if (!catRows[0]) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })
    category_id = catRows[0].id
  }

  const { rows } = await db.query(`
    SELECT
      t.*,
      c.name as category_name,
      c.slug as category_slug,
      c.description as category_description,
      u.username as author_username,
      u.avatar as author_avatar,
      (SELECT COUNT(*)::int FROM posts p WHERE p.thread_id = t.id) as post_count
    FROM threads t
    LEFT JOIN categories c ON t.category_id = c.id
    LEFT JOIN users u ON t.author_id = u.id
    WHERE t.category_id = $1
    ORDER BY
      t.is_pinned DESC,
      COALESCE(
        (SELECT MAX(p.created_at) FROM posts p WHERE p.thread_id = t.id),
        t.created_at
      ) DESC
    LIMIT $2 OFFSET $3
  `, [category_id, limit || 50, offset || 0])

  const threadIds = rows.map(t => t.id)
  const tagsMap = await TagModel.getTagsForThreads(threadIds)
  const enriched = rows.map(t => ({
    ...t,
    tags: tagsMap.get(t.id) ?? []
  }))

  const catSlug = rows[0]?.category_slug ?? null
  const categoryInfo = {
    id:          category_id,
    name:        rows[0]?.category_name || 'Discussions',
    slug:        catSlug,
    description: rows[0]?.category_description || null
  }

  return reply.send({
    threads: enriched,
    category: categoryInfo
  })
})

  // POST /api/v1/forums/threads
  app.post('/threads', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateThreadBody })],
  }, async (request, reply) => {
    const { category_id: rawCatId, title, content, tag_ids } = request.body as z.infer<typeof CreateThreadBody>

    // Resolve slug → UUID if needed
    const isCatUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCatId)
    let category_id = rawCatId
    if (!isCatUuid) {
      const { rows: slugRows } = await db.query(
        `SELECT id FROM categories WHERE slug = $1 LIMIT 1`, [rawCatId]
      )
      if (!slugRows[0]) return reply.code(404).send({ error: 'Category not found', code: 'NOT_FOUND' })
      category_id = slugRows[0].id
    }

    // Check if user is banned from this community
    const { rows: catRows } = await db.query<{ community_id: string }>(
      `SELECT community_id FROM categories WHERE id = $1 LIMIT 1`, [category_id]
    )
    if (catRows[0]) {
      const { rows: banRows } = await db.query(
        `SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
        [catRows[0].community_id, request.user!.userId]
      )
      if (banRows.length > 0) {
        return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
      }
    }

    const thread = await ThreadModel.create({
      category_id,
      author_id: request.user!.userId,
      title,
    })

    // Create the opening post (sanitize HTML from WYSIWYG editor)
    const sanitizedContent = sanitize(content)
    const threadContentCheck = checkHtmlContent(sanitizedContent)
    if (!threadContentCheck.ok) {
      return reply.code(422).send({ error: threadContentCheck.reason, code: 'CONTENT_BLOCKED' })
    }
    // Also check the title (plain text)
    const titleCheck = checkHtmlContent(title)
    if (!titleCheck.ok) {
      return reply.code(422).send({ error: titleCheck.reason, code: 'CONTENT_BLOCKED' })
    }

    const post = await PostModel.create({
      thread_id: thread.id,
      author_id: request.user!.userId,
      content: sanitizedContent,
    })

    // Attach tags if provided
    if (tag_ids && tag_ids.length > 0) {
      await TagModel.setThreadTags(thread.id, tag_ids)
    }

    const tags = await TagModel.getTagsForThread(thread.id)
    return reply.code(201).send({ thread: { ...thread, tags }, post })
  })

  // GET /api/v1/forums/threads/:id
  app.get('/threads/:id', {
    preHandler: [rateLimit, optionalAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const query  = request.query as { limit?: string; offset?: string }
    const viewerId = request.user?.userId

    const thread = await ThreadModel.findById(id)
    if (!thread) {
      return reply.code(404).send({ error: 'Thread not found', code: 'NOT_FOUND' })
    }

    // Always use the resolved UUID — id may be a slug
    const threadId = thread.id

    const [posts, tags] = await Promise.all([
      PostModel.listByThread(threadId, {
        limit:    query.limit  ? Number(query.limit)  : undefined,
        offset:   query.offset ? Number(query.offset) : undefined,
        viewerId,
      }),
      TagModel.getTagsForThread(threadId),
      ThreadModel.incrementViews(threadId),
    ])

    return reply.send({ thread: { ...thread, tags }, posts })
  })

  // POST /api/v1/forums/posts
  app.post('/posts', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreatePostBody })],
  }, async (request, reply) => {
    const { thread_id, content } = request.body as z.infer<typeof CreatePostBody>
    const userId = request.user!.userId

    const thread = await ThreadModel.findById(thread_id)
    if (!thread) {
      return reply.code(404).send({ error: 'Thread not found', code: 'NOT_FOUND' })
    }
    if (thread.is_locked) {
      return reply.code(403).send({ error: 'Thread is locked', code: 'THREAD_LOCKED' })
    }

    // Always use resolved UUID — thread_id may be a slug
    const resolvedThreadId = thread.id

    // Check if user is banned from this community
    const { rows: banRows } = await db.query(
      `SELECT 1 FROM community_bans cb
       JOIN categories cat ON cat.community_id = cb.community_id
       JOIN threads t ON t.category_id = cat.id
       WHERE cb.user_id = $1 AND t.id = $2 LIMIT 1`,
      [userId, resolvedThreadId]
    )
    if (banRows.length > 0) {
      return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
    }

    const sanitized = sanitize(content)
    const replyContentCheck = checkHtmlContent(sanitized)
    if (!replyContentCheck.ok) {
      return reply.code(422).send({ error: replyContentCheck.reason, code: 'CONTENT_BLOCKED' })
    }

    const post = await PostModel.create({
      thread_id: resolvedThreadId,
      author_id: userId,
      content:   sanitized,
    })

    // Notifications (fire-and-forget)
    ;(async () => {
      try {
        // Notify thread author of a reply (if different user)
        if (thread.author_id !== userId) {
          await NotificationModel.create({
            user_id:   thread.author_id,
            type:      'thread_reply',
            actor_id:  userId,
            thread_id: thread.id,
            post_id:   post.id,
          })
          if (io) {
            const count = await NotificationModel.getUnreadCount(thread.author_id)
            io.to(`user:${thread.author_id}`).emit('notification:new', { unreadCount: count })
          }
        }
        // Notify mentioned users
        const mentionedIds = await resolveMentions(sanitized)
        for (const mentionedId of mentionedIds) {
          if (mentionedId !== userId) {
            await NotificationModel.create({
              user_id:   mentionedId,
              type:      'mention',
              actor_id:  userId,
              thread_id: thread.id,
              post_id:   post.id,
            })
            if (io) {
              const count = await NotificationModel.getUnreadCount(mentionedId)
              io.to(`user:${mentionedId}`).emit('notification:new', { unreadCount: count })
            }
          }
        }
      } catch {
        // Never block the response for notification failures
      }
    })()

    return reply.code(201).send({ post })
  })

  // PUT /api/v1/forums/posts/:id — edit a post (author or mod)
  app.put('/posts/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const { content } = request.body as { content?: string }
    if (!content?.trim()) {
      return reply.code(400).send({ error: 'Content required', code: 'BAD_REQUEST' })
    }

    const existing = await PostModel.getAuthorAndThread(id)
    if (!existing) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    const userId = request.user!.userId
    const isAuthor = existing.author_id === userId
    const modAccess = !isAuthor && await isMod(userId, existing.thread_id)

    if (!isAuthor && !modAccess) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    const editSanitized = sanitize(content)
    const editCheck = checkHtmlContent(editSanitized)
    if (!editCheck.ok) {
      return reply.code(422).send({ error: editCheck.reason, code: 'CONTENT_BLOCKED' })
    }

    const post = await PostModel.updateContent(id, editSanitized)
    return reply.send({ post })
  })

  // DELETE /api/v1/forums/posts/:id — delete a post (author or mod)
  app.delete('/posts/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }

    const existing = await PostModel.getAuthorAndThread(id)
    if (!existing) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    const userId = request.user!.userId
    const isAuthor = existing.author_id === userId
    const modAccess = !isAuthor && await isMod(userId, existing.thread_id)

    if (!isAuthor && !modAccess) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    await PostModel.removeById(id)
    return reply.code(204).send()
  })

  // PATCH /api/v1/forums/threads/:id — author (title) + mod (pin/lock/delete/tags)
  app.patch('/threads/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      title?:       string
      is_pinned?:   boolean
      is_locked?:   boolean
      is_featured?: boolean
      tag_ids?:     string[]
      delete?:      boolean
    }

    const thread = await ThreadModel.findById(id)
    if (!thread) {
      return reply.code(404).send({ error: 'Thread not found', code: 'NOT_FOUND' })
    }

    // Always use resolved UUID — id may be a slug
    const threadId = thread.id

    const userId    = request.user!.userId
    const isAuthor  = thread.author_id === userId
    const modAccess = await isMod(userId, threadId)

    if (!isAuthor && !modAccess) {
      return reply.code(403).send({ error: 'Forbidden', code: 'FORBIDDEN' })
    }

    // Authors without mod rights can only edit the title
    if (isAuthor && !modAccess) {
      if (!body.title?.trim()) {
        return reply.code(403).send({ error: 'Authors can only edit the title', code: 'FORBIDDEN' })
      }
      const updated = await ThreadModel.update(threadId, { title: body.title.trim() })
      return reply.send({ thread: updated })
    }

    // Pin / lock are restricted to owner or admin (not moderator)
    if ((body.is_pinned !== undefined || body.is_locked !== undefined)) {
      const adminAccess = await isAdmin(userId, threadId)
      if (!adminAccess) {
        return reply.code(403).send({ error: 'Only admins and owners can pin or lock threads', code: 'FORBIDDEN' })
      }
    }

    // Mod/owner actions
    if (body.delete) {
      await ThreadModel.remove(threadId)
      return reply.code(204).send()
    }

    if (body.tag_ids !== undefined) {
      await TagModel.setThreadTags(threadId, body.tag_ids)
    }

    const updated = await ThreadModel.update(threadId, {
      title:       body.title?.trim() || undefined,
      is_pinned:   body.is_pinned,
      is_locked:   body.is_locked,
      is_featured: body.is_featured,
    })
    return reply.send({ thread: updated })
  })

  // POST /api/v1/forums/posts/:id/reactions
  app.post('/posts/:id/reactions', {
    preHandler: [rateLimit, requireAuth, validate({ body: ReactionBody })],
  }, async (request, reply) => {
    const { id }   = request.params as { id: string }
    const { emoji } = request.body as z.infer<typeof ReactionBody>
    const userId   = request.user!.userId

    const post = await PostModel.getAuthorAndThread(id)
    if (!post) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    const result = await ReactionModel.toggleReaction(id, userId, emoji)
    return reply.send(result)
  })

  // POST /api/v1/forums/posts/:id/thanks
  app.post('/posts/:id/thanks', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const userId = request.user!.userId

    const post = await PostModel.getAuthorAndThread(id)
    if (!post) {
      return reply.code(404).send({ error: 'Post not found', code: 'NOT_FOUND' })
    }

    if (post.author_id === userId) {
      return reply.code(400).send({ error: 'Cannot thank your own post', code: 'BAD_REQUEST' })
    }

    const result = await ThanksModel.toggleThanks(id, userId, post.author_id)

    // Notify if thanks was added (not removed)
    if (result.added) {
      NotificationModel.create({
        user_id:   post.author_id,
        type:      'post_thanks',
        actor_id:  userId,
        thread_id: post.thread_id,
        post_id:   id,
      }).then(async () => {
        if (io) {
          const count = await NotificationModel.getUnreadCount(post.author_id)
          io.to(`user:${post.author_id}`).emit('notification:new', { unreadCount: count })
        }
      }).catch(() => {})
    }

    return reply.send(result)
  })
}
