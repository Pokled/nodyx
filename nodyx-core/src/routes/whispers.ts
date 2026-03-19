import { FastifyInstance } from 'fastify'
import { db } from '../config/database'
import { requireAuth } from '../middleware/auth'

export default async function whisperRoutes(app: FastifyInstance) {

  // POST /api/v1/whispers — create a new whisper room
  app.post<{
    Body: {
      context_type?: string
      context_id?:   string
      context_label?: string
      name?:         string
    }
  }>('/', { preHandler: [requireAuth] }, async (req, reply) => {
    const userId = (req as any).user!.userId
    const { context_type, context_id, context_label, name } = req.body ?? {}

    const { rows } = await db.query(
      `INSERT INTO whisper_rooms (creator_id, context_type, context_id, context_label, name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, creator_id, context_type, context_id, context_label, name,
                 last_activity, created_at, expires_at`,
      [userId, context_type ?? null, context_id ?? null, context_label ?? null, name ?? null]
    )

    return reply.status(201).send({ room: rows[0] })
  })

  // GET /api/v1/whispers/:id — get room info + last 50 messages
  app.get<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params
      const userId = (req as any).user!.userId

      const { rows: rooms } = await db.query(
        `SELECT id, creator_id, context_type, context_id, context_label, name,
                last_activity, created_at, expires_at
         FROM whisper_rooms WHERE id = $1`,
        [id]
      )

      if (rooms.length === 0) {
        return reply.status(404).send({ error: 'Room not found or expired' })
      }

      const room = rooms[0]

      // Contrôle d'accès : seul le créateur peut accéder à la room
      if (room.creator_id !== userId) {
        return reply.status(403).send({ error: 'Access denied', code: 'FORBIDDEN' })
      }

      // Check if expired
      if (new Date(room.expires_at) < new Date()) {
        // Clean up and return 404
        await db.query('DELETE FROM whisper_rooms WHERE id = $1', [id])
        return reply.status(404).send({ error: 'Room has expired' })
      }

      const { rows: messages } = await db.query(
        `SELECT id, user_id, username, avatar, content, created_at
         FROM whisper_messages
         WHERE room_id = $1
         ORDER BY created_at ASC
         LIMIT 50`,
        [id]
      )

      return reply.send({ room, messages })
    }
  )

  // DELETE /api/v1/whispers/:id — close room (creator only)
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [requireAuth] },
    async (req, reply) => {
      const { id } = req.params
      const userId = (req as any).user!.userId

      const { rowCount } = await db.query(
        `DELETE FROM whisper_rooms WHERE id = $1 AND creator_id = $2`,
        [id, userId]
      )

      if (!rowCount) {
        return reply.status(403).send({ error: 'Not the room creator or room not found' })
      }

      return reply.send({ ok: true })
    }
  )
}
