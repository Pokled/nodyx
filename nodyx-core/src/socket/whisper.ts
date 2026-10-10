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
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function sanitize(raw: string): string {
  return sanitizeHtml(raw, { allowedTags: [], allowedAttributes: {} }).trim()
}

export function registerWhisperHandlers(io: Server, socket: Socket): void {
  const { userId, username, avatar } = socket.data

  // ── whisper:join ────────────────────────────────────────────────────────────
  socket.on('whisper:join', async ({ roomId }: { roomId: string }) => {
    if (checkRateLimit(userId, 'whisper:join')) return
    // Sans ce garde, un roomId non-UUID part tel quel dans une requête sur une
    // colonne UUID : une erreur Postgres à chaque appel (trouvé en audit le
    // 16/09), inondation de logs et d'aller-retours DB sans aucun coût pour l'appelant.
    if (!isUuid(roomId)) return

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

      // Contrôle d'accès AVANT toute autre action, y compris la purge d'un
      // salon expiré : sans ça, n'importe qui connaissant l'UUID d'un salon
      // expiré pouvait le supprimer sans jamais y avoir eu accès (trouvé en
      // audit le 16/09).
      let authorized = room.creator_id === userId
      if (!authorized) {
        const { rows: wasParticipant } = await db.query(
          `SELECT 1 FROM whisper_messages WHERE room_id = $1 AND user_id = $2 LIMIT 1`,
          [roomId, userId]
        )
        authorized = wasParticipant.length > 0
      }
      if (!authorized) {
        socket.emit('whisper:expired', { roomId }); return
      }

      if (new Date(room.expires_at) < new Date()) {
        await db.query('DELETE FROM whisper_rooms WHERE id = $1', [roomId])
        socket.emit('whisper:expired', { roomId }); return
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
    if (!isUuid(roomId)) return
    // Sans ce garde, n'importe qui connaissant l'UUID d'un salon pouvait
    // injecter un faux "X a quitté" sans jamais y avoir eu accès (trouvé en
    // audit le 16/09).
    if (!socket.rooms.has(`whisper:${roomId}`)) return
    socket.leave(`whisper:${roomId}`)
    socket.to(`whisper:${roomId}`).emit('whisper:user_leave', { roomId, userId, username })
  })

  // ── whisper:message ─────────────────────────────────────────────────────────
  socket.on('whisper:message', async ({ roomId, content }: { roomId: string; content: string }) => {
    if (checkRateLimit(userId, 'whisper:message')) return
    if (!roomId || !content) return

    // Must have joined the room (whisper:join enforces creator-or-participant access).
    // Without this any auth socket could inject spoof messages into a whisper room
    // just by guessing the room id.
    if (!socket.rooms.has(`whisper:${roomId}`)) return

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
    if (!socket.rooms.has(`whisper:${roomId}`)) return
    socket.to(`whisper:${roomId}`).emit('whisper:typing', { roomId, userId, username })
  })

  // ── On disconnect: notify all whisper rooms the user was in ─────────────────
  // `disconnecting` : à `disconnect`, Socket.IO 4 a déjà vidé `socket.rooms`
  // et personne n'était prévenu du départ (même piège que voice.ts, 10/10/2026).
  socket.on('disconnecting', () => {
    for (const room of [...socket.rooms]) {
      if (room.startsWith('whisper:')) {
        const roomId = room.slice('whisper:'.length)
        socket.to(`whisper:${roomId}`).emit('whisper:user_leave', { roomId, userId, username })
      }
    }
  })
}
