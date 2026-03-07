/**
 * NEXUS — Direct Messages routes (REST)
 * Socket.IO events sont dans src/socket/index.ts
 * Prefix: /api/v1/dm
 */

import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { db } from '../config/database'
import sanitizeHtml from 'sanitize-html'

// ── Sanitize (texte brut uniquement pour les DMs) ─────────────────────────────

function sanitizeDM(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ['b', 'i', 'em', 'strong', 'code', 'br'],
    allowedAttributes: {},
  }).trim()
}

// ── Helpers DB ────────────────────────────────────────────────────────────────

/** Trouve ou crée une conversation 1:1 entre deux users. Retourne l'id. */
async function findOrCreateConversation(userA: string, userB: string): Promise<string> {
  // Cherche une conversation existante où les deux users sont participants
  const { rows } = await db.query<{ id: string }>(`
    SELECT p1.conversation_id AS id
    FROM   dm_participants p1
    JOIN   dm_participants p2 ON p2.conversation_id = p1.conversation_id
    WHERE  p1.user_id = $1
    AND    p2.user_id = $2
    LIMIT  1
  `, [userA, userB])

  if (rows[0]) return rows[0].id

  // Crée la conversation + les deux participants
  const { rows: [conv] } = await db.query<{ id: string }>(
    `INSERT INTO dm_conversations DEFAULT VALUES RETURNING id`
  )
  await db.query(
    `INSERT INTO dm_participants (conversation_id, user_id) VALUES ($1,$2),($1,$3)`,
    [conv.id, userA, userB]
  )
  return conv.id
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function dmRoutes(app: FastifyInstance) {

  // POST /api/v1/dm/conversations — ouvrir/trouver une conversation avec un user
  app.post('/conversations', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId
    const { userId } = request.body as { userId?: string }
    if (!userId) return reply.code(400).send({ error: 'Missing userId' })
    if (userId === me) return reply.code(400).send({ error: 'Cannot DM yourself' })

    // Vérifier que l'autre user existe
    const { rows: [target] } = await db.query(
      `SELECT id, username, avatar FROM users WHERE id = $1`, [userId]
    )
    if (!target) return reply.code(404).send({ error: 'User not found' })

    const conversationId = await findOrCreateConversation(me, userId)
    return reply.send({ conversationId })
  })

  // GET /api/v1/dm/conversations — liste des conversations avec dernier message + non-lus
  app.get('/conversations', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId

    const { rows } = await db.query(`
      SELECT
        c.id,
        c.created_at,
        -- L'autre participant
        u.id          AS other_id,
        u.username    AS other_username,
        u.avatar      AS other_avatar,
        up.name_color AS other_name_color,
        -- Dernier message
        lm.id        AS last_message_id,
        lm.content   AS last_message_content,
        lm.sender_id AS last_message_sender_id,
        lm.created_at AS last_message_at,
        -- Nombre de messages non-lus
        (
          SELECT COUNT(*)
          FROM   dm_messages m2
          WHERE  m2.conversation_id = c.id
          AND    m2.created_at > p_me.last_read_at
          AND    m2.sender_id  != $1
          AND    m2.deleted_at IS NULL
        ) AS unread_count
      FROM   dm_conversations c
      JOIN   dm_participants  p_me    ON p_me.conversation_id  = c.id AND p_me.user_id = $1
      JOIN   dm_participants  p_other ON p_other.conversation_id = c.id AND p_other.user_id != $1
      JOIN   users u ON u.id = p_other.user_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      LEFT JOIN LATERAL (
        SELECT id, content, sender_id, created_at
        FROM   dm_messages
        WHERE  conversation_id = c.id AND deleted_at IS NULL
        ORDER  BY created_at DESC
        LIMIT  1
      ) lm ON true
      ORDER  BY COALESCE(lm.created_at, c.created_at) DESC
    `, [me])

    return reply.send({ conversations: rows })
  })

  // GET /api/v1/dm/conversations/:id/messages — historique paginé
  app.get('/conversations/:id/messages', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId
    const { id } = request.params as { id: string }
    const { limit = '50', before } = request.query as { limit?: string; before?: string }
    const lim = Math.min(Number(limit), 100)

    // Vérifier que l'user est participant
    const { rows: [part] } = await db.query(
      `SELECT 1 FROM dm_participants WHERE conversation_id = $1 AND user_id = $2`, [id, me]
    )
    if (!part) return reply.code(403).send({ error: 'Not a participant' })

    const { rows: messages } = await db.query(`
      SELECT
        m.id, m.conversation_id, m.sender_id, m.content, m.created_at, m.deleted_at,
        u.username        AS sender_username,
        u.avatar          AS sender_avatar,
        up.name_color     AS sender_name_color,
        up.name_animation AS sender_name_animation,
        up.name_font_family AS sender_name_font_family
      FROM   dm_messages m
      JOIN   users u ON u.id = m.sender_id
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE  m.conversation_id = $1
      ${before ? 'AND m.created_at < $3' : ''}
      ORDER  BY m.created_at DESC
      LIMIT  $2
    `, before ? [id, lim, before] : [id, lim])

    return reply.send({ messages: messages.reverse() })
  })

  // PATCH /api/v1/dm/conversations/:id/read — marquer comme lu
  app.patch('/conversations/:id/read', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId
    const { id } = request.params as { id: string }

    await db.query(
      `UPDATE dm_participants SET last_read_at = now()
       WHERE conversation_id = $1 AND user_id = $2`,
      [id, me]
    )
    return reply.code(204).send()
  })

  // DELETE /api/v1/dm/messages/:msgId — suppression douce (sender uniquement)
  app.delete('/messages/:msgId', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId
    const { msgId } = request.params as { msgId: string }

    const { rows: [msg] } = await db.query(
      `SELECT sender_id FROM dm_messages WHERE id = $1 AND deleted_at IS NULL`, [msgId]
    )
    if (!msg) return reply.code(404).send({ error: 'Message not found' })
    if (msg.sender_id !== me) return reply.code(403).send({ error: 'Forbidden' })

    await db.query(
      `UPDATE dm_messages SET deleted_at = now(), content = '' WHERE id = $1`, [msgId]
    )
    return reply.code(204).send()
  })

  // GET /api/v1/dm/unread-count — total non-lus (pour le badge nav)
  app.get('/unread-count', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId

    const { rows: [row] } = await db.query<{ count: string }>(`
      SELECT COUNT(*) AS count
      FROM   dm_messages m
      JOIN   dm_participants p ON p.conversation_id = m.conversation_id AND p.user_id = $1
      WHERE  m.sender_id  != $1
      AND    m.created_at >  p.last_read_at
      AND    m.deleted_at IS NULL
    `, [me])

    return reply.send({ count: parseInt(row.count, 10) })
  })
}
