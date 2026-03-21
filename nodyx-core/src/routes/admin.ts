/**
 * NODYX — Admin routes
 * All routes require owner or admin role (adminOnly middleware).
 * Prefix: /api/v1/admin
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, redis } from '../config/database'
import { adminOnly } from '../middleware/adminOnly'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import * as ChannelModel from '../models/channel'
import { generateCategorySlug } from '../models/community'
import { io } from '../socket/io'
import { invalidateUserSessions } from './auth'
import { isSmtpConfigured, sendPasswordResetEmail } from '../services/emailService'
import { scanBuffer } from '../services/fileScanner'
import { randomUUID, createHash, randomBytes } from 'crypto'
import { createWriteStream, mkdirSync } from 'fs'
import { pipeline } from 'stream/promises'
import path from 'path'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')
const ALLOWED_MIME_BRANDING = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

// ── Resolve instance community (cached) ──────────────────────────────────────

let _communityId: string | null = null

async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId
  const slug = process.env.NODYX_COMMUNITY_SLUG
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

// ── Audit log helper ──────────────────────────────────────────────────────────

async function logAction(
  actorId: string,
  action: string,
  targetType: string | null,
  targetId: string | null,
  targetLabel: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    const { rows } = await db.query(`SELECT username FROM users WHERE id = $1`, [actorId])
    const actorUsername = rows[0]?.username ?? 'unknown'
    await db.query(
      `INSERT INTO admin_audit_log (actor_id, actor_username, action, target_type, target_id, target_label, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actorId, actorUsername, action, targetType, targetId, targetLabel, JSON.stringify(metadata)]
    )
  } catch { /* never fail the main operation */ }
}

// ── Routes ───────────────────────────────────────────────────────────────────

export default async function adminRoutes(app: FastifyInstance) {

  // ── Dashboard stats ────────────────────────────────────────────────────────

  app.get('/stats', {
    preHandler: [rateLimit, adminOnly],
  }, async (_req, reply) => {
    const communityId = await getCommunityId()

    const [usersRes, threadsRes, postsRes, catRes, presenceSockets,
           eventsRes, pollsRes, assetsRes, chatRes, dmRes] = await Promise.all([
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
      // Events
      db.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE starts_at >= NOW() AND is_cancelled = false)::int AS upcoming
                FROM events`).catch(() => ({ rows: [{ total: 0, upcoming: 0 }] })),
      // Polls
      db.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE closed_at IS NULL)::int AS open
                FROM polls`).catch(() => ({ rows: [{ total: 0, open: 0 }] })),
      // Assets
      db.query(`SELECT COUNT(*)::int AS total
                FROM community_assets
                WHERE is_public = true AND is_banned = false`).catch(() => ({ rows: [{ total: 0 }] })),
      // Chat messages
      db.query(`SELECT COUNT(*)::int AS total,
                       COUNT(*) FILTER (WHERE cm.created_at > NOW() - INTERVAL '7 days')::int AS new_this_week
                FROM channel_messages cm
                JOIN channels ch ON ch.id = cm.channel_id
                WHERE ch.community_id = $1`, [communityId]).catch(() => ({ rows: [{ total: 0, new_this_week: 0 }] })),
      // DM conversations
      db.query(`SELECT COUNT(*)::int AS total FROM dm_conversations`).catch(() => ({ rows: [{ total: 0 }] })),
    ])

    const seenOnline = new Set<string>()
    for (const s of presenceSockets) { if (s.data.userId) seenOnline.add(s.data.userId) }

    // Activity by day — last 7 days (posts + new members)
    const [activityRes, membersActivityRes] = await Promise.all([
      db.query(
        `SELECT DATE(p.created_at) AS day, COUNT(*)::int AS posts
         FROM posts p
         JOIN threads t ON t.id = p.thread_id
         JOIN categories c ON c.id = t.category_id
         WHERE c.community_id = $1 AND p.created_at > NOW() - INTERVAL '7 days'
         GROUP BY day ORDER BY day ASC`,
        [communityId]
      ).catch(() => ({ rows: [] as any[] })),
      db.query(
        `SELECT DATE(joined_at) AS day, COUNT(*)::int AS new_members
         FROM community_members
         WHERE community_id = $1 AND joined_at > NOW() - INTERVAL '7 days'
         GROUP BY day ORDER BY day ASC`,
        [communityId]
      ).catch(() => ({ rows: [] as any[] })),
    ])

    // Merge posts + new_members by day
    const membersByDay: Record<string, number> = {}
    for (const r of membersActivityRes.rows) membersByDay[r.day] = r.new_members
    const activity = activityRes.rows.map((r: any) => ({
      day: r.day,
      posts: r.posts,
      new_members: membersByDay[r.day] ?? 0,
    }))

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
    ).catch(() => ({ rows: [] as any[] }))

    // Recent registrations (last 5)
    const recentMembersRes = await db.query(
      `SELECT u.username, u.avatar, u.email, cm.joined_at, cm.role
       FROM community_members cm
       JOIN users u ON u.id = cm.user_id
       WHERE cm.community_id = $1
       ORDER BY cm.joined_at DESC
       LIMIT 5`,
      [communityId]
    ).catch(() => ({ rows: [] as any[] }))

    return reply.send({
      users:    usersRes.rows[0],
      threads:  threadsRes.rows[0],
      posts:    postsRes.rows[0],
      categories: catRes.rows[0],
      online:   seenOnline.size,
      events:   eventsRes.rows[0],
      polls:    pollsRes.rows[0],
      assets:   assetsRes.rows[0],
      chat:     chatRes.rows[0],
      dms:      dmRes.rows[0],
      activity_last_7_days: activity,
      top_contributors:     topContribRes.rows,
      recent_members:       recentMembersRes.rows,
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
         AND NOT EXISTS (
           SELECT 1 FROM community_bans cb
           WHERE cb.community_id = $1 AND cb.user_id = cm.user_id
         )
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
    const adminUser   = (request as any).user as { userId: string }

    // Cannot change owner's role
    const { rows: check } = await db.query(
      `SELECT cm.role, u.username FROM community_members cm JOIN users u ON u.id = cm.user_id WHERE cm.community_id = $1 AND cm.user_id = $2`,
      [communityId, userId]
    )
    if (!check[0]) return reply.code(404).send({ error: 'Member not found' })
    if (check[0].role === 'owner') return reply.code(403).send({ error: 'Cannot change owner role' })

    if (body.role) {
      await db.query(
        `UPDATE community_members SET role = $1 WHERE community_id = $2 AND user_id = $3`,
        [body.role, communityId, userId]
      )
      logAction(adminUser.userId, 'change_role', 'user', userId, check[0].username,
        { old_role: check[0].role, new_role: body.role })
    }

    return reply.send({ ok: true })
  })

  // POST /api/v1/admin/members/:userId/reset-link
  // Génère un lien de réinitialisation de mot de passe pour un membre.
  // Utile quand le SMTP n'est pas configuré — l'admin envoie le lien manuellement.
  app.post('/members/:userId/reset-link', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { userId } = request.params as { userId: string }

    const { rows: userRows } = await db.query<{ id: string; username: string; email: string }>(
      `SELECT id, username, email FROM users WHERE id = $1`,
      [userId]
    )
    if (!userRows[0]) return reply.code(404).send({ error: 'User not found' })

    const user = userRows[0]

    // Invalider les tokens existants non utilisés
    await db.query(
      `DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    )

    const rawToken  = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1h

    await db.query(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, ip_address)
       VALUES ($1, $2, $3, $4)`,
      [userId, tokenHash, expiresAt, request.ip]
    )

    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`

    let emailSent = false
    if (isSmtpConfigured()) {
      try {
        await sendPasswordResetEmail({ to: user.email, username: user.username, resetUrl })
        emailSent = true
      } catch {
        // SMTP configuré mais échec — on retourne quand même le lien
      }
    }

    return reply.send({
      username:   user.username,
      email:      user.email,
      reset_url:  resetUrl,
      expires_at: expiresAt.toISOString(),
      email_sent: emailSent,
    })
  })

  // Kick member from community (not a full ban — can re-join if public)
  app.delete('/members/:userId', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { userId }  = request.params as { userId: string }
    const communityId = await getCommunityId()
    const adminUser   = (request as any).user as { userId: string }

    const { rows: check } = await db.query(
      `SELECT cm.role, u.username FROM community_members cm JOIN users u ON u.id = cm.user_id WHERE cm.community_id = $1 AND cm.user_id = $2`,
      [communityId, userId]
    )
    if (!check[0]) return reply.code(404).send({ error: 'Member not found' })
    if (check[0].role === 'owner') return reply.code(403).send({ error: 'Cannot kick the owner' })

    await db.query(
      `DELETE FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId]
    )
    logAction(adminUser.userId, 'kick_member', 'user', userId, check[0].username, {})
    return reply.send({ ok: true })
  })

  // ── Bans ───────────────────────────────────────────────────────────────────

  // GET /api/v1/admin/bans — list banned users
  app.get('/bans', {
    preHandler: [rateLimit, adminOnly],
  }, async (_req, reply) => {
    const communityId = await getCommunityId()
    const { rows } = await db.query(
      `SELECT
         cb.user_id, cb.banned_at, cb.reason,
         u.username, u.email, u.avatar,
         bu.username AS banned_by_username
       FROM community_bans cb
       JOIN users u  ON u.id  = cb.user_id
       LEFT JOIN users bu ON bu.id = cb.banned_by
       WHERE cb.community_id = $1
       ORDER BY cb.banned_at DESC`,
      [communityId]
    )
    return reply.send(rows)
  })

  // POST /api/v1/admin/members/:userId/ban — ban member (kick + blacklist)
  app.post('/members/:userId/ban', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { userId }  = request.params as { userId: string }
    const communityId = await getCommunityId()
    const adminUser   = (request as any).user as { userId: string }
    const body        = (request.body ?? {}) as { reason?: string; ban_ip?: boolean; ban_email?: boolean }

    // Fetch user info (role + registration_ip + email)
    const { rows: userRows } = await db.query(
      `SELECT u.username, u.email, u.registration_ip,
              cm.role
       FROM users u
       LEFT JOIN community_members cm ON cm.community_id = $1 AND cm.user_id = u.id
       WHERE u.id = $2`,
      [communityId, userId]
    )
    if (!userRows[0]) return reply.code(404).send({ error: 'User not found' })
    if (userRows[0].role === 'owner') return reply.code(403).send({ error: 'Cannot ban the owner' })

    const { username: targetUsername, email, registration_ip } = userRows[0]

    // Insert community ban (upsert — idempotent)
    await db.query(
      `INSERT INTO community_bans (community_id, user_id, banned_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (community_id, user_id) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = now()`,
      [communityId, userId, adminUser.userId, body.reason ?? null]
    )
    // Remove from members if still present
    await db.query(
      `DELETE FROM community_members WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId]
    )

    // Optional: ban IP — never ban internal/loopback addresses
    const PROTECTED_IPS = ['127.0.0.1', '::1', '0.0.0.0', 'localhost']
    if (body.ban_ip && registration_ip && !PROTECTED_IPS.includes(registration_ip)) {
      await db.query(
        `INSERT INTO ip_bans (ip, reason, banned_by)
         VALUES ($1::inet, $2, $3)
         ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = now()`,
        [registration_ip, body.reason ?? null, adminUser.userId]
      ).catch(() => {})
    }

    // Optional: ban email
    if (body.ban_email && email) {
      await db.query(
        `INSERT INTO email_bans (email, reason, banned_by)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = now()`,
        [email, body.reason ?? null, adminUser.userId]
      ).catch(() => {})
    }

    // Mark user as banned in Redis — blocks requireAuth immediately
    await redis.set(`banned:${userId}`, '1')

    // Invalider toutes les sessions Redis de l'utilisateur banni (via index inversé)
    try {
      await invalidateUserSessions(userId)
    } catch { /* non-critical */ }

    // Kick active socket connections for this user immediately
    if (io) {
      const sockets = await io.in(`user:${userId}`).fetchSockets()
      for (const s of sockets) {
        s.emit('banned', { message: 'You have been banned from this community.' })
        s.disconnect(true)
      }
    }

    logAction(adminUser.userId, 'ban_user', 'user', userId, targetUsername,
      { reason: body.reason ?? null, ban_ip: !!body.ban_ip, ban_email: !!body.ban_email })
    return reply.send({ ok: true, registration_ip: registration_ip ?? null })
  })

  // DELETE /api/v1/admin/members/:userId/ban — unban
  app.delete('/members/:userId/ban', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { userId }  = request.params as { userId: string }
    const communityId = await getCommunityId()
    const adminUser   = (request as any).user as { userId: string }

    const { rows: targetRows } = await db.query(`SELECT username FROM users WHERE id = $1`, [userId])

    await db.query(
      `DELETE FROM community_bans WHERE community_id = $1 AND user_id = $2`,
      [communityId, userId]
    )
    // Remove Redis ban flag so user can log in again
    await redis.del(`banned:${userId}`)
    logAction(adminUser.userId, 'unban_user', 'user', userId, targetRows[0]?.username ?? null, {})
    return reply.send({ ok: true })
  })

  // ── IP Bans ────────────────────────────────────────────────────────────────

  // GET /api/v1/admin/ip-bans
  app.get('/ip-bans', {
    preHandler: [rateLimit, adminOnly],
  }, async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT ib.ip, ib.reason, ib.banned_at, u.username AS banned_by_username
       FROM ip_bans ib
       LEFT JOIN users u ON u.id = ib.banned_by
       ORDER BY ib.banned_at DESC`
    )
    return reply.send(rows)
  })

  // POST /api/v1/admin/ip-bans
  app.post('/ip-bans', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const adminUser = (request as any).user as { userId: string }
    const body = (request.body ?? {}) as { ip: string; reason?: string }
    if (!body.ip) return reply.code(400).send({ error: 'ip required' })
    const PROTECTED_IPS = ['127.0.0.1', '::1', '0.0.0.0', 'localhost']
    if (PROTECTED_IPS.includes(body.ip)) {
      return reply.code(400).send({ error: 'Cette IP ne peut pas être bannie.', code: 'PROTECTED_IP' })
    }
    await db.query(
      `INSERT INTO ip_bans (ip, reason, banned_by)
       VALUES ($1::inet, $2, $3)
       ON CONFLICT (ip) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = now()`,
      [body.ip, body.reason ?? null, adminUser.userId]
    )
    logAction(adminUser.userId, 'ip_ban_add', 'ip', body.ip, body.ip, { reason: body.reason })
    return reply.send({ ok: true })
  })

  // DELETE /api/v1/admin/ip-bans/:ip
  app.delete('/ip-bans/:ip', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const adminUser = (request as any).user as { userId: string }
    const { ip } = request.params as { ip: string }
    await db.query(`DELETE FROM ip_bans WHERE ip = $1::inet`, [ip])
    logAction(adminUser.userId, 'ip_ban_remove', 'ip', ip, ip, {})
    return reply.send({ ok: true })
  })

  // ── Email Bans ─────────────────────────────────────────────────────────────

  // GET /api/v1/admin/email-bans
  app.get('/email-bans', {
    preHandler: [rateLimit, adminOnly],
  }, async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT eb.email, eb.reason, eb.banned_at, u.username AS banned_by_username
       FROM email_bans eb
       LEFT JOIN users u ON u.id = eb.banned_by
       ORDER BY eb.banned_at DESC`
    )
    return reply.send(rows)
  })

  // POST /api/v1/admin/email-bans
  app.post('/email-bans', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const adminUser = (request as any).user as { userId: string }
    const body = (request.body ?? {}) as { email: string; reason?: string }
    if (!body.email) return reply.code(400).send({ error: 'email required' })
    await db.query(
      `INSERT INTO email_bans (email, reason, banned_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET reason = EXCLUDED.reason, banned_by = EXCLUDED.banned_by, banned_at = now()`,
      [body.email, body.reason ?? null, adminUser.userId]
    )
    logAction(adminUser.userId, 'email_ban_add', 'email', body.email, body.email, { reason: body.reason })
    return reply.send({ ok: true })
  })

  // DELETE /api/v1/admin/email-bans/:email
  app.delete('/email-bans/:email', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const adminUser = (request as any).user as { userId: string }
    const { email } = request.params as { email: string }
    const decoded = decodeURIComponent(email)
    await db.query(`DELETE FROM email_bans WHERE email = $1`, [decoded])
    logAction(adminUser.userId, 'email_ban_remove', 'email', decoded, decoded, {})
    return reply.send({ ok: true })
  })

  // ── Threads (moderation) ───────────────────────────────────────────────────

  app.get('/threads', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    const q = request.query as { limit?: string; offset?: string; category_id?: string }
    const limit  = Math.min(Number(q.limit  ?? 50), 100)
    const offset = Math.max(0, Math.min(Number(q.offset ?? 0), 100000))

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
    const adminUser = (request as any).user as { userId: string }

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

    if (body.is_pinned !== undefined) {
      logAction(adminUser.userId, body.is_pinned ? 'pin_thread' : 'unpin_thread', 'thread', id, rows[0].title, {})
    }
    if (body.is_locked !== undefined) {
      logAction(adminUser.userId, body.is_locked ? 'lock_thread' : 'unlock_thread', 'thread', id, rows[0].title, {})
    }

    return reply.send({ thread: rows[0] })
  })

  app.delete('/threads/:id', {
    preHandler: [rateLimit, adminOnly],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminUser = (request as any).user as { userId: string }

    const { rows: threadRows } = await db.query(`SELECT title FROM threads WHERE id = $1`, [id])
    const { rowCount } = await db.query(`DELETE FROM threads WHERE id = $1`, [id])
    if (!rowCount) return reply.code(404).send({ error: 'Thread not found' })
    logAction(adminUser.userId, 'delete_thread', 'thread', id, threadRows[0]?.title ?? null, {})
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

    if (body.name        !== undefined) { fields.push(`name = $${i++}`);        values.push(body.name);                                fields.push(`slug = $${i++}`); values.push(generateCategorySlug(body.name)) }
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
    preHandler: [rateLimit, adminOnly],
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

    // Buffer the file so we can scan magic bytes before writing to disk
    const chunks: Buffer[] = []
    for await (const chunk of data.file) chunks.push(chunk as Buffer)
    const fileBuffer = Buffer.concat(chunks)

    const scan = scanBuffer(fileBuffer, data.mimetype)
    if (!scan.ok) {
      return reply.code(400).send({ error: `Fichier rejeté : ${scan.reason}` })
    }

    const ext      = data.mimetype.split('/')[1].replace('jpeg', 'jpg')
    const folder   = `${type}s`
    const filename = `${randomUUID()}.${ext}`
    const dir      = path.join(UPLOADS_DIR, folder)
    mkdirSync(dir, { recursive: true })
    await import('fs/promises').then(fs => fs.writeFile(path.join(dir, filename), fileBuffer))

    return reply.send({ url: `/uploads/${folder}/${filename}` })
  })

  // ── Update check ─────────────────────────────────────────────────────────

  app.get('/update-check', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    const CACHE_KEY = 'nodyx:update_check'
    const CURRENT = process.env.NODYX_VERSION ?? '1.8.0'

    const cached = await redis.get(CACHE_KEY).catch(() => null)
    if (cached) return reply.send(JSON.parse(cached))

    try {
      const ghRes = await fetch('https://api.github.com/repos/Pokled/Nodyx/releases/latest', {
        headers: { 'User-Agent': 'Nodyx-Instance/1.0', Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(8000),
      })
      if (!ghRes.ok) throw new Error(`GitHub API ${ghRes.status}`)

      const ghJson = await ghRes.json() as { tag_name: string; html_url: string }
      const latest = (ghJson.tag_name ?? '').replace(/^v/, '')
      const parseVer = (v: string) => v.split('.').map(Number)
      const [cMaj, cMin, cPat] = parseVer(CURRENT)
      const [lMaj, lMin, lPat] = parseVer(latest)
      const has_update =
        lMaj > cMaj ||
        (lMaj === cMaj && lMin > cMin) ||
        (lMaj === cMaj && lMin === cMin && lPat > cPat)

      const payload = {
        current_version: CURRENT,
        latest_version:  latest,
        has_update,
        release_url: ghJson.html_url,
      }
      await redis.set(CACHE_KEY, JSON.stringify(payload), 'EX', 6 * 3600).catch(() => {})
      return reply.send(payload)
    } catch {
      return reply.send({ current_version: CURRENT, latest_version: null, has_update: false, release_url: null })
    }
  })

  // ── SMTP status + test ────────────────────────────────────────────────────

  app.get('/smtp/status', {
    preHandler: [rateLimit, adminOnly],
  }, async (_request, reply) => {
    return reply.send({
      configured: isSmtpConfigured(),
      host: process.env.SMTP_HOST ?? null,
      port: Number(process.env.SMTP_PORT ?? 587),
      from: process.env.SMTP_FROM ?? process.env.SMTP_USER ?? null,
    })
  })

  app.post('/smtp/test', {
    preHandler: [rateLimit, adminOnly],
    schema: { body: { type: 'object', required: ['to'], properties: { to: { type: 'string' } } } },
  }, async (request, reply) => {
    if (!isSmtpConfigured()) {
      return reply.code(503).send({
        error: 'SMTP non configuré. Ajoutez SMTP_HOST, SMTP_USER et SMTP_PASS dans le fichier .env.',
        code: 'SMTP_NOT_CONFIGURED',
        doc: 'https://github.com/Pokled/Nodyx/blob/main/docs/fr/EMAIL.md',
      })
    }

    const { to } = request.body as { to: string }

    try {
      await sendPasswordResetEmail({
        to,
        username: 'Admin',
        resetUrl: `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/reset-password/test-smtp`,
      })
      return reply.send({ success: true, message: `Email de test envoyé à ${to}` })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Erreur inconnue'
      return reply.code(500).send({
        error: `Échec de l'envoi : ${message}`,
        code: 'SMTP_SEND_FAILED',
        hint: `Vérifiez vos identifiants SMTP dans .env — voir docs/fr/EMAIL.md`,
      })
    }
  })

  // ── Announcements ─────────────────────────────────────────────────────────

  // GET  /admin/announcements — list all
  app.get('/announcements', { preHandler: [adminOnly] }, async (_request, reply) => {
    const { rows } = await db.query(
      `SELECT id, message, color, is_active, created_at, expires_at
       FROM system_announcements
       ORDER BY created_at DESC`
    )
    return reply.send({ announcements: rows })
  })

  // POST /admin/announcements — create
  app.post('/announcements', { preHandler: [adminOnly] }, async (request, reply) => {
    const adminUser = (request as any).user as { userId: string }
    const { message, color, expires_at } = request.body as {
      message: string; color?: string; expires_at?: string | null
    }
    if (!message?.trim()) return reply.code(400).send({ error: 'message requis' })

    const validColors = ['indigo', 'amber', 'green', 'red', 'sky', 'rose']
    const safeColor = validColors.includes(color ?? '') ? color : 'indigo'

    const { rows } = await db.query(
      `INSERT INTO system_announcements (message, color, expires_at)
       VALUES ($1, $2, $3)
       RETURNING id, message, color, is_active, created_at, expires_at`,
      [message.trim(), safeColor, expires_at ?? null]
    )
    logAction(adminUser.userId, 'create_announcement', 'announcement', rows[0].id,
      message.trim().slice(0, 60), { color: safeColor })
    return reply.code(201).send({ announcement: rows[0] })
  })

  // PATCH /admin/announcements/:id — toggle active / update
  app.patch('/announcements/:id', { preHandler: [adminOnly] }, async (request, reply) => {
    const adminUser = (request as any).user as { userId: string }
    const { id } = request.params as { id: string }
    const { is_active, message, color } = request.body as {
      is_active?: boolean; message?: string; color?: string
    }

    const sets: string[] = []
    const vals: unknown[] = []
    let idx = 1

    if (is_active !== undefined) { sets.push(`is_active = $${idx++}`); vals.push(is_active) }
    if (message)                 { sets.push(`message = $${idx++}`);   vals.push(message.trim()) }
    if (color)                   { sets.push(`color = $${idx++}`);     vals.push(color) }

    if (sets.length === 0) return reply.code(400).send({ error: 'rien à mettre à jour' })

    vals.push(id)
    const { rows } = await db.query(
      `UPDATE system_announcements SET ${sets.join(', ')}
       WHERE id = $${idx}
       RETURNING id, message, color, is_active, created_at, expires_at`,
      vals
    )
    if (!rows[0]) return reply.code(404).send({ error: 'not found' })
    logAction(adminUser.userId, 'update_announcement', 'announcement', id,
      rows[0].message?.slice(0, 60) ?? null, { is_active, color })
    return reply.send({ announcement: rows[0] })
  })

  // DELETE /admin/announcements/:id
  app.delete('/announcements/:id', { preHandler: [adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const adminUser = (request as any).user as { userId: string }
    const { rows: annRows } = await db.query(`SELECT message FROM system_announcements WHERE id = $1`, [id])
    await db.query(`DELETE FROM system_announcements WHERE id = $1`, [id])
    logAction(adminUser.userId, 'delete_announcement', 'announcement', id,
      annRows[0]?.message?.slice(0, 60) ?? null, {})
    return reply.send({ ok: true })
  })

  // ── Audit log ─────────────────────────────────────────────────────────────

  // GET /admin/audit-log
  app.get('/audit-log', { preHandler: [adminOnly] }, async (request, reply) => {
    const q = request.query as { limit?: string; offset?: string; action?: string; actor?: string }
    const limit  = Math.min(Number(q.limit  ?? 50), 200)
    const offset = Math.max(0, Math.min(Number(q.offset ?? 0), 100000))

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    // Troncature défensive pour éviter les ReDoS via ILIKE sur de longues chaînes
    if (q.action) { conditions.push(`action = $${idx++}`); params.push(String(q.action).slice(0, 100)) }
    if (q.actor)  { conditions.push(`actor_username ILIKE $${idx++}`); params.push(`%${String(q.actor).slice(0, 50)}%`) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const { rows } = await db.query(
      `SELECT id, actor_id, actor_username, action, target_type, target_id, target_label, metadata, created_at
       FROM admin_audit_log
       ${where}
       ORDER BY created_at DESC
       LIMIT $${idx++} OFFSET $${idx}`,
      [...params, limit, offset]
    )

    const { rows: countRows } = await db.query(
      `SELECT COUNT(*)::int AS total FROM admin_audit_log ${where}`,
      params
    )

    return reply.send({ entries: rows, total: countRows[0].total, limit, offset })
  })
}
