import { FastifyInstance } from 'fastify'
import { rateLimit }     from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { db, redis }     from '../config/database'
import { io }            from '../socket/io'
import * as Notification from '../models/notification'

interface AuthRequest {
  user?: { userId: string; username: string }
}

interface MemberCard {
  user_id:             string
  username:            string
  avatar:              string | null
  display_name:        string | null
  name_color:          string | null
  name_glow:           string | null
  name_glow_intensity: number | null
  name_animation:      string | null
  name_font_family:    string | null
  name_font_url:       string | null
  status:              string | null
  bio:                 string | null
  points:              number
  created_at:          string
  is_online:           boolean
  activity_score:      number
}

const SELECT_MEMBER_FIELDS = `
  u.id                  AS user_id,
  u.username            AS username,
  u.avatar              AS avatar,
  u.points              AS points,
  u.created_at          AS created_at,
  p.display_name        AS display_name,
  p.name_color          AS name_color,
  p.name_glow           AS name_glow,
  p.name_glow_intensity AS name_glow_intensity,
  p.name_animation      AS name_animation,
  p.name_font_family    AS name_font_family,
  p.name_font_url       AS name_font_url,
  p.status              AS status,
  p.bio                 AS bio
`

export default async function memberRoutes(app: FastifyInstance) {

  // ── GET /api/v1/members/pulse ────────────────────────────────────────────
  // The Community Pulse: who is online with what they're doing,
  // who has been most active over 7 days, and the latest newcomers.
  // Public read (presence is already a public concept on the platform).
  app.get('/pulse', { preHandler: [rateLimit, optionalAuth] }, async (_request, reply) => {

    // Online userIds — source of truth = Socket.IO presence room
    const sockets = io ? await io.in('presence').fetchSockets() : []
    const onlineIds = new Set<string>()
    for (const s of sockets) {
      const uid = s.data?.userId
      if (uid) onlineIds.add(uid)
    }

    // ── Activity gravity (last 7 days) ───────────────────────────────────
    // Score = posts authored + replies received on own threads
    // Surfaces members who carry conversations forward.
    const { rows: gravityRows } = await db.query<MemberCard & { activity_score: number }>(
      `WITH activity AS (
         SELECT
           p.author_id AS user_id,
           COUNT(*)::int AS post_count
         FROM posts p
         WHERE p.created_at > NOW() - INTERVAL '7 days'
         GROUP BY p.author_id
       ),
       received AS (
         SELECT
           t.author_id AS user_id,
           COUNT(p2.id)::int AS replies_received
         FROM threads t
         JOIN posts p2 ON p2.thread_id = t.id AND p2.author_id <> t.author_id
         WHERE p2.created_at > NOW() - INTERVAL '7 days'
         GROUP BY t.author_id
       )
       SELECT
         ${SELECT_MEMBER_FIELDS},
         (COALESCE(a.post_count, 0) + COALESCE(r.replies_received, 0))::int AS activity_score
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       LEFT JOIN activity       a ON a.user_id = u.id
       LEFT JOIN received       r ON r.user_id = u.id
       WHERE COALESCE(a.post_count, 0) + COALESCE(r.replies_received, 0) > 0
       ORDER BY activity_score DESC, u.created_at ASC
       LIMIT 12`
    )

    // ── Newcomers (last 5 joiners) ───────────────────────────────────────
    const { rows: newcomerRows } = await db.query<MemberCard>(
      `SELECT
         ${SELECT_MEMBER_FIELDS},
         0 AS activity_score
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE u.is_system = false
       ORDER BY u.created_at DESC
       LIMIT 5`
    )

    // ── Online members (with profile theme) ──────────────────────────────
    let onlineMembers: MemberCard[] = []
    if (onlineIds.size > 0) {
      const { rows } = await db.query<MemberCard>(
        `SELECT
           ${SELECT_MEMBER_FIELDS},
           0 AS activity_score
         FROM users u
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE u.id = ANY($1::uuid[])
         ORDER BY u.username ASC`,
        [Array.from(onlineIds)]
      )
      onlineMembers = rows
    }

    // ── Just-posted activity (last 30min, surfaces "alive" feel) ─────────
    const { rows: justPostedRows } = await db.query<{
      user_id:      string
      thread_id:    string
      thread_title: string
      thread_slug:  string | null
      category_slug: string | null
      created_at:   string
    }>(
      `SELECT DISTINCT ON (p.author_id)
         p.author_id   AS user_id,
         t.id          AS thread_id,
         t.title       AS thread_title,
         t.slug        AS thread_slug,
         c.slug        AS category_slug,
         p.created_at  AS created_at
       FROM posts p
       JOIN threads t   ON t.id = p.thread_id
       JOIN categories c ON c.id = t.category_id
       WHERE p.created_at > NOW() - INTERVAL '30 minutes'
       ORDER BY p.author_id, p.created_at DESC`
    )
    const justPostedMap: Record<string, typeof justPostedRows[number]> = {}
    for (const r of justPostedRows) justPostedMap[r.user_id] = r

    // Mark online flag for gravity + newcomer rows
    const decorate = (m: MemberCard) => ({ ...m, is_online: onlineIds.has(m.user_id) })

    return reply.send({
      online: onlineMembers.map(m => ({
        ...decorate(m),
        recent_activity: justPostedMap[m.user_id] ?? null,
      })),
      gravity:    gravityRows.map(decorate),
      newcomers:  newcomerRows.map(decorate),
      counts: {
        total:   await getTotalMembers(),
        online:  onlineIds.size,
        active_7d: gravityRows.length,
      },
    })
  })

  // ── GET /api/v1/members/:userId/trail ────────────────────────────────────
  // The "co-presence trail": top 3 members this user has interacted
  // with most over the last 7 days (replied near in same threads).
  // Aggregated, threshold-gated, never reveals single events.
  app.get<{ Params: { userId: string } }>('/:userId/trail',
    { preHandler: [rateLimit, optionalAuth] },
    async (request, reply) => {
      const { userId } = request.params
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return reply.code(400).send({ error: 'Invalid userId' })
      }

      // Co-presence = two users posted in the same thread within 7 days.
      // Score = number of distinct threads they shared.
      // Threshold: only return pairs with >= 2 shared threads (privacy).
      const { rows } = await db.query<{
        user_id:       string
        username:      string
        avatar:        string | null
        name_color:    string | null
        shared_threads: number
      }>(
        `WITH my_threads AS (
           SELECT DISTINCT thread_id
           FROM posts
           WHERE author_id = $1 AND created_at > NOW() - INTERVAL '7 days'
         )
         SELECT
           u.id          AS user_id,
           u.username    AS username,
           u.avatar      AS avatar,
           p.name_color  AS name_color,
           COUNT(DISTINCT po.thread_id)::int AS shared_threads
         FROM posts po
         JOIN users u           ON u.id = po.author_id
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE po.author_id <> $1
           AND po.created_at > NOW() - INTERVAL '7 days'
           AND po.thread_id IN (SELECT thread_id FROM my_threads)
         GROUP BY u.id, u.username, u.avatar, p.name_color
         HAVING COUNT(DISTINCT po.thread_id) >= 2
         ORDER BY shared_threads DESC, u.username ASC
         LIMIT 3`,
        [userId]
      )

      return reply.send({ trail: rows })
    }
  )

  // ── POST /api/v1/members/:userId/wave ────────────────────────────────────
  // Send a single low-friction "Salut" notification to another member.
  // Rate-limited: one wave per (sender, receiver) pair every 30 days.
  // Designed to convert "newcomer arrived" silence into "the community waved back".
  app.post<{ Params: { userId: string } }>('/:userId/wave',
    { preHandler: [rateLimit, requireAuth] },
    async (request, reply) => {
      const auth = request as unknown as AuthRequest
      if (!auth.user) return reply.code(401).send({ error: 'Auth required' })

      const senderId   = auth.user.userId
      const receiverId = request.params.userId

      if (!/^[0-9a-f-]{36}$/i.test(receiverId)) {
        return reply.code(400).send({ error: 'Invalid userId' })
      }
      if (senderId === receiverId) {
        return reply.code(400).send({ error: 'Cannot wave at yourself' })
      }

      // Receiver must exist
      const { rows: receiverRows } = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE id = $1`, [receiverId]
      )
      if (receiverRows.length === 0) {
        return reply.code(404).send({ error: 'User not found' })
      }

      // Cooldown check (30 days per pair)
      const cooldownKey = `wave:${senderId}:${receiverId}`
      const exists = await redis.exists(cooldownKey)
      if (exists) {
        return reply.code(429).send({ error: 'Already waved recently', cooldown_days: 30 })
      }

      // Fire notification + set cooldown
      await Notification.create({
        user_id:  receiverId,
        type:     'wave',
        actor_id: senderId,
      })
      await redis.setex(cooldownKey, 60 * 60 * 24 * 30, '1')

      // Live-push notification badge
      if (io) {
        const count = await Notification.getUnreadCount(receiverId)
        io.to(`user:${receiverId}`).emit('notification:new', { unreadCount: count })
      }

      return reply.send({ ok: true })
    }
  )
}

async function getTotalMembers(): Promise<number> {
  const { rows } = await db.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM users`
  )
  return rows[0]?.count ?? 0
}
