/**
 * Whisper rooms — ephemeral Socket.IO chat (v0.7)
 *
 * Events client → server:
 *   whisper:join    { roomId }   — join room, get history
 *   whisper:leave   { roomId }   — leave room
 *   whisper:message { roomId, content } — send a message
 *   whisper:typing  { roomId }   — broadcast typing indicator
 *
 * Events server → client:
 *   whisper:history    { roomId, messages, room }    — history on join
 *   whisper:message    { roomId, message }           — new message
 *   whisper:typing     { roomId, userId, username }  — someone is typing
 *   whisper:user_join  { roomId, userId, username }  — user joined
 *   whisper:user_leave { roomId, userId, username }  — user left
 *   whisper:expired    { roomId }                    — room has expired
 */
import { Server, Socket } from 'socket.io'
import sanitizeHtml from 'sanitize-html'
import { db } from '../config/database'
import { checkRateLimit } from './rateLimiter'

const MAX_CONTENT_LENGTH = 2000

function sanitize(raw: string): string {
  return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} }).trim()
}

export function registerWhisperHandlers(io: Server, socket: Socket): void {
  const { userId, username, avatar } = socket.data

  // ── whisper:join ────────────────────────────────────────────────────────────
  socket.on('whisper:join', async ({ roomId }: { roomId: string }) => {
    if (!roomId) return

    try {
      const { rows } = await db.query(
        `SELECT id, creator_id, context_type, context_id, context_label, name,
                last_activity, created_at, expires_at
         FROM whisper_rooms WHERE id = $1`,
        [roomId]
      )

      if (rows.length === 0) {
        socket.emit('whisper:expired', { roomId }); return
      }

      const room = rows[0]
      if (new Date(room.expires_at) < new Date()) {
        await db.query('DELETE FROM whisper_rooms WHERE id = $1', [roomId])
        socket.emit('whisper:expired', { roomId }); return
      }

      // Contrôle d'accès : seul le créateur ou un participant existant peut accéder
      if (room.creator_id !== userId) {
        const { rows: wasParticipant } = await db.query(
          `SELECT 1 FROM whisper_messages WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
          [roomId, userId]
        )
        if (!wasParticipant.length) {
          socket.emit('whisper:expired', { roomId }); return
        }
      }

      socket.join(`whisper:${roomId}`)

      // History (last 50)
      const { rows: messages } = await db.query(
        `SELECT id, user_id, username, avatar, content, created_at
         FROM whisper_messages WHERE room_id = $1
         ORDER BY created_at ASC LIMIT 50`,
        [roomId]
      )

      socket.emit('whisper:history', { roomId, room, messages })

      // Notify others
      socket.to(`whisper:${roomId}`).emit('whisper:user_join', { roomId, userId, username })
    } catch (err) {
      console.error('[Whisper] join error:', err)
    }
  })

  // ── whisper:leave ───────────────────────────────────────────────────────────
  socket.on('whisper:leave', ({ roomId }: { roomId: string }) => {
    if (!roomId) return
    socket.leave(`whisper:${roomId}`)
    socket.to(`whisper:${roomId}`).emit('whisper:user_leave', { roomId, userId, username })
  })

  // ── whisper:message ─────────────────────────────────────────────────────────
  socket.on('whisper:message', async ({ roomId, content }: { roomId: string; content: string }) => {
    if (checkRateLimit(userId, 'whisper:message')) return
    if (!roomId || !content) return

    const clean = sanitize(content)
    if (!clean || clean.length > MAX_CONTENT_LENGTH) return

    try {
      // Check room exists and isn't expired
      const { rows } = await db.query(
        `SELECT id, expires_at FROM whisper_rooms WHERE id = $1`, [roomId]
      )
      if (rows.length === 0 || new Date(rows[0].expires_at) < new Date()) {
        socket.emit('whisper:expired', { roomId }); return
      }

      // Insert message
      const { rows: [msg] } = await db.query(
        `INSERT INTO whisper_messages (room_id, user_id, username, avatar, content)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, user_id, username, avatar, content, created_at`,
        [roomId, userId, username, avatar ?? null, clean]
      )

      // Refresh expiry (+1h from now)
      await db.query(
        `UPDATE whisper_rooms
         SET last_activity = NOW(), expires_at = NOW() + INTERVAL '1 hour'
         WHERE id = $1`,
        [roomId]
      )

      // Broadcast to everyone in the room (including sender)
      io.to(`whisper:${roomId}`).emit('whisper:message', { roomId, message: msg })
    } catch (err) {
      console.error('[Whisper] message error:', err)
    }
  })

  // ── whisper:typing ──────────────────────────────────────────────────────────
  socket.on('whisper:typing', ({ roomId }: { roomId: string }) => {
    if (checkRateLimit(userId, 'whisper:typing')) return
    if (!roomId) return
    socket.to(`whisper:${roomId}`).emit('whisper:typing', { roomId, userId, username })
  })

  // ── On disconnect: notify all whisper rooms the user was in ─────────────────
  socket.on('disconnect', () => {
    // Socket.IO automatically removes the socket from all rooms on disconnect.
    // We just emit leave to all whisper rooms it was in.
    for (const room of socket.rooms) {
      if (room.startsWith('whisper:')) {
        const roomId = room.slice('whisper:'.length)
        socket.to(`whisper:${roomId}`).emit('whisper:user_leave', { roomId, userId, username })
      }
    }
  })
}
