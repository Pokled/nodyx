/**
 * NODYX — Direct Messages routes (REST)
 * Socket.IO events sont dans src/socket/index.ts
 * Prefix: /api/v1/dm
 */

import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { db } from '../config/database'
import { io } from '../socket/io'
import sanitizeHtml from 'sanitize-html'

// ── Sanitize (texte brut uniquement pour les DMs) ─────────────────────────────

function sanitizeDM(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ['b', 'i', 'em', 'strong', 'code', 'br'],
    allowedAttributes: {},
  }).trim()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** Taille maximale d'un groupe de messages privés. */
export const DM_GROUP_MAX = 10

// ── Helpers DB ────────────────────────────────────────────────────────────────

/** Trouve ou crée une conversation 1:1 entre deux users. Retourne l'id. */
async function findOrCreateConversation(userA: string, userB: string): Promise<string> {
  // Cherche une conversation 1:1 existante (is_group = false, exactement ces deux participants)
  const { rows } = await db.query<{ id: string }>(`
    SELECT p1.conversation_id AS id
    FROM   dm_participants p1
    JOIN   dm_participants p2 ON p2.conversation_id = p1.conversation_id
    JOIN   dm_conversations c  ON c.id = p1.conversation_id
    WHERE  p1.user_id = $1
    AND    p2.user_id = $2
    AND    c.is_group = FALSE
    LIMIT  1
  `, [userA, userB])

  if (rows[0]) return rows[0].id

  // Crée la conversation 1:1 + les deux participants
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
        c.is_group,
        c.name        AS group_name,
        -- Tous les autres participants (pour affichage groupe et 1:1)
        (
          SELECT json_agg(json_build_object(
            'id',         u2.id,
            'username',   u2.username,
            'avatar',     u2.avatar,
            'name_color', up2.name_color
          ) ORDER BY u2.username)
          FROM   dm_participants p2
          JOIN   users u2 ON u2.id = p2.user_id
          LEFT JOIN user_profiles up2 ON up2.user_id = u2.id
          WHERE  p2.conversation_id = c.id AND p2.user_id != $1
        ) AS participants,
        -- Dernier message
        lm.id         AS last_message_id,
        lm.content    AS last_message_content,
        lm.is_encrypted AS last_message_encrypted,
        lm.sender_id  AS last_message_sender_id,
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
      JOIN   dm_participants p_me ON p_me.conversation_id = c.id AND p_me.user_id = $1
      LEFT JOIN LATERAL (
        SELECT id, content, is_encrypted, sender_id, created_at
        FROM   dm_messages
        WHERE  conversation_id = c.id AND deleted_at IS NULL
        ORDER  BY created_at DESC
        LIMIT  1
      ) lm ON true
      ORDER  BY COALESCE(lm.created_at, c.created_at) DESC
    `, [me])

    // Compat 1:1 : exposer other_id/other_username/other_avatar/other_name_color
    const conversations = rows.map((c: any) => {
      const first = c.participants?.[0] ?? null
      return {
        ...c,
        other_id:         first?.id         ?? null,
        other_username:   first?.username    ?? '[supprimé]',
        other_avatar:     first?.avatar      ?? null,
        other_name_color: first?.name_color  ?? null,
      }
    })

    return reply.send({ conversations })
  })

  // POST /api/v1/dm/conversations/:id/participants : inviter quelqu'un
  //
  // Une conversation ne gagne JAMAIS de membre : inviter crée un NOUVEAU groupe
  // (les participants actuels + l'invité), et la conversation d'origine reste
  // telle quelle. Avant le 08/11, l'invité était ajouté à la conversation
  // existante et lisait tout ce qui s'y était dit avant son arrivée, sans que
  // les autres aient rien demandé. Avec cette règle, chaque participant d'une
  // conversation est là depuis son premier message : l'historique, les
  // modifications, les réactions et les citations ne peuvent pas fuiter.
  app.post('/conversations/:id/participants', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId
    const { id } = request.params as { id: string }
    const { userId } = (request.body ?? {}) as { userId?: string }

    if (!UUID_RE.test(id) || typeof userId !== 'string' || !UUID_RE.test(userId)) {
      return reply.code(400).send({ error: 'Missing or invalid userId', code: 'INVALID_REQUEST' })
    }
    if (userId === me) return reply.code(400).send({ error: 'Cannot invite yourself', code: 'CANNOT_INVITE_SELF' })

    // Les participants actuels, et l'invitant doit en faire partie
    const { rows: members } = await db.query<{ user_id: string }>(
      `SELECT user_id FROM dm_participants WHERE conversation_id = $1`, [id]
    )
    if (!members.some(m => m.user_id === me)) return reply.code(403).send({ error: 'Not a participant', code: 'NOT_A_PARTICIPANT' })
    if (members.some(m => m.user_id === userId)) return reply.code(409).send({ error: 'Already a participant', code: 'ALREADY_PARTICIPANT' })
    if (members.length + 1 > DM_GROUP_MAX) {
      return reply.code(409).send({ error: 'Group is full', code: 'GROUP_FULL' })
    }

    const { rows: [target] } = await db.query<{ id: string; username: string; avatar: string | null }>(
      `SELECT id, username, avatar FROM users WHERE id = $1`, [userId]
    )
    if (!target) return reply.code(404).send({ error: 'User not found', code: 'USER_NOT_FOUND' })

    // Le nouveau groupe et tous ses membres en UNE requête : atomique
    const everyone = [...members.map(m => m.user_id), userId]
    const { rows: created } = await db.query<{ conversation_id: string }>(
      `WITH conv AS (INSERT INTO dm_conversations (is_group) VALUES (TRUE) RETURNING id)
       INSERT INTO dm_participants (conversation_id, user_id)
       SELECT conv.id, u FROM conv, unnest($1::uuid[]) AS u
       RETURNING conversation_id`,
      [everyone]
    )
    const conversationId = created[0].conversation_id

    const { rows: [inviter] } = await db.query<{ username: string }>(
      `SELECT username FROM users WHERE id = $1`, [me]
    )
    for (const uid of everyone) {
      io?.to(`user:${uid}`).emit('dm:group_created', {
        conversation_id: conversationId,
        invited: { id: target.id, username: target.username },
        invited_by: inviter?.username ?? null,
      })
    }

    return reply.code(201).send({ conversationId })
  })

  // GET /api/v1/dm/conversations/:id/messages — historique paginé
  app.get('/conversations/:id/messages', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const me = request.user!.userId
    const { id } = request.params as { id: string }
    const { limit = '50', before } = request.query as { limit?: string; before?: string }
    const lim = Math.min(Number(limit), 100)
    if (before !== undefined && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(before)) {
      return reply.code(400).send({ error: 'Invalid before parameter' })
    }

    // Vérifier que l'user est participant
    const { rows: [part] } = await db.query(
      `SELECT 1 FROM dm_participants WHERE conversation_id = $1 AND user_id = $2`, [id, me]
    )
    if (!part) return reply.code(403).send({ error: 'Not a participant' })

    const { rows: messages } = await db.query(`
      SELECT
        m.id, m.conversation_id, m.sender_id, m.content, m.created_at, m.deleted_at, m.edited_at,
        m.is_encrypted, m.encryption_nonce, m.reply_to_id,
        -- Snapshot du message cité (reply / quote) : id, auteur, preview 200 chars
        CASE WHEN m.reply_to_id IS NULL THEN NULL ELSE
          (SELECT json_build_object(
             'id',              rm.id,
             'sender_username', ru.username,
             'content',         LEFT(rm.content, 200),
             'is_encrypted',    rm.is_encrypted
           )
           FROM dm_messages rm JOIN users ru ON ru.id = rm.sender_id
           WHERE rm.id = m.reply_to_id)
        END AS reply_snapshot,
        u.username        AS sender_username,
        u.avatar          AS sender_avatar,
        up.name_color     AS sender_name_color,
        up.name_animation AS sender_name_animation,
        up.name_font_family AS sender_name_font_family,
        COALESCE((
          SELECT json_agg(json_build_object(
            'emoji',     r.emoji,
            'count',     r.cnt,
            'userIds',   r.user_ids,
            'usernames', r.usernames,
            'users',     r.users
          ) ORDER BY r.first_at)
          FROM (
            SELECT dr.emoji,
                   COUNT(*)::int                                       AS cnt,
                   array_agg(dr.user_id::text ORDER BY dr.created_at) AS user_ids,
                   array_agg(u.username       ORDER BY dr.created_at) AS usernames,
                   -- Nouveau shape (Layer 1 tooltip vivant) : objet par user
                   -- avec name_color + timestamp pour rendu temporel coloré.
                   json_agg(json_build_object(
                     'username',   u.username,
                     'name_color', up.name_color,
                     'created_at', dr.created_at
                   ) ORDER BY dr.created_at DESC)                      AS users,
                   MIN(dr.created_at)                                  AS first_at
            FROM dm_reactions dr
            JOIN users u ON u.id = dr.user_id
            LEFT JOIN user_profiles up ON up.user_id = dr.user_id
            WHERE dr.message_id = m.id
            GROUP BY dr.emoji
          ) r
        ), '[]') AS reactions
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

    const { rows: [msg] } = await db.query<{ sender_id: string; conversation_id: string }>(
      `SELECT sender_id, conversation_id FROM dm_messages WHERE id = $1 AND deleted_at IS NULL`, [msgId]
    )
    if (!msg) return reply.code(404).send({ error: 'Message not found' })
    if (msg.sender_id !== me) return reply.code(403).send({ error: 'Forbidden' })

    await db.query(
      `UPDATE dm_messages SET deleted_at = now(), content = '' WHERE id = $1`, [msgId]
    )

    // Notifier les participants en temps réel
    const { rows: participants } = await db.query<{ user_id: string }>(
      `SELECT user_id FROM dm_participants WHERE conversation_id = $1`, [msg.conversation_id]
    )
    for (const p of participants) {
      io?.to(`user:${p.user_id}`).emit('dm:deleted', {
        msgId,
        conversation_id: msg.conversation_id,
      })
    }

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
