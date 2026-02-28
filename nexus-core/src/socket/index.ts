import { registerVoiceHandlers, sendVoiceSnapshot } from './voice'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import sanitizeHtml from 'sanitize-html'
import { db, redis } from '../config/database'
import * as ChannelModel from '../models/channel'
import * as NotificationModel from '../models/notification'
import { resolveMentions } from '../utils/mentions'
import { io } from './io'

interface JwtPayload {
  userId:   string
  username: string
}

// Extend SocketData for typed socket.data
declare module 'socket.io' {
  interface SocketData {
    userId:   string
    username: string
    avatar?:  string | null
  }
}

// ── Sanitize (same config as forums.ts) ───────────────────────────────────────

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
  '*':      ['class', 'style', 'data-align', 'data-type'],
  'a':      ['href', 'target', 'rel'],
  'img':    ['src', 'alt', 'width', 'height'],
  'iframe': ['src', 'width', 'height', 'frameborder', 'allowfullscreen', 'allow'],
  'th':     ['rowspan', 'colspan'],
  'td':     ['rowspan', 'colspan'],
}

function sanitize(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedIframeHostnames: [
      'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
      'player.vimeo.com', 'vimeo.com',
    ],
  })
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async function authenticateSocket(socket: Socket, next: (err?: Error) => void) {
  const token = socket.handshake.auth?.token as string | undefined
  if (!token) {
    return next(new Error('Missing token'))
  }

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  } catch {
    return next(new Error('Invalid token'))
  }

  const alive = await redis.exists(`session:${token}`)
  if (!alive) {
    return next(new Error('Session expired'))
  }

  socket.data.userId   = payload.userId
  socket.data.username = payload.username
  next()
}

// ── Handler registration ──────────────────────────────────────────────────────

export function registerSocketIO(server: Server): void {
  server.use(authenticateSocket)

  server.on('connection', (socket: Socket) => {
    const { userId, username } = socket.data

    // Join personal room for push notifications (sync — needed immediately)
    socket.join(`user:${userId}`)

    // ── Presence tracking (async init) ────────────────────────────────────────
    ;(async () => {
      // Fetch avatar for the presence sidebar
      try {
        const { rows } = await db.query<{ avatar: string | null }>(
          `SELECT avatar FROM users WHERE id = $1`, [userId]
        )
        socket.data.avatar = rows[0]?.avatar ?? null
      } catch {
        socket.data.avatar = null
      }

      socket.join('presence')

      // Send current voice channel states to the new socket (sidebar overview)
      await sendVoiceSnapshot(socket, server)

      // Send current online list (deduplicated by userId) to the new socket
      const allSockets = await server.in('presence').fetchSockets()
      const seen = new Set<string>()
      const onlineList = allSockets
        .map(s => ({ userId: s.data.userId, username: s.data.username, avatar: s.data.avatar ?? null }))
        .filter(m => { if (seen.has(m.userId)) return false; seen.add(m.userId); return true })
      socket.emit('presence:init', onlineList)

      // Broadcast online only if this is the user's first tab
      const isFirstTab = !allSockets.some(s => s.id !== socket.id && s.data.userId === userId)
      if (isFirstTab) {
        socket.broadcast.to('presence').emit('presence:online', {
          userId, username, avatar: socket.data.avatar ?? null,
        })
      }
    })().catch(() => {})

    // Broadcast offline only when the user's last tab closes
    socket.on('disconnect', async () => {
      const remaining = await server.in('presence').fetchSockets()
      const stillOnline = remaining.some(s => s.data.userId === userId)
      if (!stillOnline) {
        server.to('presence').emit('presence:offline', { userId })
      }
    })

    // ── chat:join ─────────────────────────────────────────────────────────────
    socket.on('chat:join', async (channelId: string) => {
      if (!channelId) return

      const channel = await ChannelModel.findById(channelId).catch(() => null)
      if (!channel) return

      socket.join(`channel:${channelId}`)

      const history = await ChannelModel.getHistory(channelId, 50).catch(() => [])
      socket.emit('chat:history', { channelId, messages: history })
    })

    // ── chat:leave ────────────────────────────────────────────────────────────
    socket.on('chat:leave', (channelId: string) => {
      if (channelId) socket.leave(`channel:${channelId}`)
    })

    // ── chat:send ─────────────────────────────────────────────────────────────
    socket.on('chat:send', async (data: { channelId: string; content: string }) => {
      const { channelId, content } = data ?? {}
      if (!channelId || !content?.trim()) return

      const sanitized = sanitize(content.trim())
      if (!sanitized || sanitized.length > 4000) return

      try {
        const message = await ChannelModel.addMessage({
          channel_id: channelId,
          author_id:  userId,
          content:    sanitized,
        })
        if (io) {
          io.to(`channel:${channelId}`).emit('chat:message', message)
        }

        // Push notifications for @mentions
        const mentionedIds = await resolveMentions(sanitized).catch(() => [])
        for (const notifiedUserId of mentionedIds) {
          if (notifiedUserId === userId) continue
          await NotificationModel.create({
            user_id:   notifiedUserId,
            type:      'mention',
            actor_id:  userId,
            thread_id: null,
            post_id:   null,
          }).catch(() => {})
          if (io) {
            const count = await NotificationModel.getUnreadCount(notifiedUserId).catch(() => 0)
            io.to(`user:${notifiedUserId}`).emit('notification:new', { unreadCount: count })
          }
        }
      } catch {
        // Silently ignore DB errors (e.g. channel deleted)
      }
    })

    // ── chat:typing ───────────────────────────────────────────────────────────
    // Throttled by client — just broadcast to others in the room
    socket.on('chat:typing', (channelId: string) => {
      if (!channelId) return
      socket.to(`channel:${channelId}`).emit('chat:typing', { userId, username })
    })

    // ── chat:react ────────────────────────────────────────────────────────────
    socket.on('chat:react', async (data: { messageId: string; emoji: string }) => {
      const { messageId, emoji } = data ?? {}
      if (!messageId || !emoji) return

      try {
        const { reactions } = await ChannelModel.toggleReaction(messageId, userId, emoji)
        const msgInfo = await ChannelModel.findMessageById(messageId)
        if (!msgInfo) return

        if (io) {
          io.to(`channel:${msgInfo.channel_id}`).emit('chat:reaction_update', {
            messageId,
            reactions,
          })
        }
      } catch {
        // ignore
      }
    })

    // ── chat:edit ─────────────────────────────────────────────────────────────
    socket.on('chat:edit', async (data: { messageId: string; content: string }) => {
      const { messageId, content } = data ?? {}
      if (!messageId || !content?.trim()) return

      const sanitized = sanitize(content.trim())
      if (!sanitized || sanitized.length > 4000) return

      try {
        const updated = await ChannelModel.editMessage(messageId, userId, sanitized)
        if (!updated) return

        if (io) {
          io.to(`channel:${updated.channel_id}`).emit('chat:message_edited', {
            messageId,
            content:  sanitized,
            editedAt: updated.edited_at,
          })
        }
      } catch {
        // ignore
      }
    })

    // ── chat:delete ───────────────────────────────────────────────────────────
    socket.on('chat:delete', async (data: { messageId: string }) => {
      const { messageId } = data ?? {}
      if (!messageId) return

      try {
        const { ok, channelId } = await ChannelModel.deleteMessage(messageId, userId)
        if (!ok || !channelId) return

        if (io) {
          io.to(`channel:${channelId}`).emit('chat:message_deleted', { messageId })
        }
      } catch {
        // ignore
      }
    })
    // ── voice:request_snapshot — re-envoie le snapshot des canaux vocaux ────────
    // Utile quand le client navigue vers la page chat alors que le socket était
    // déjà connecté (le snapshot initial a été envoyé avant que le listener soit monté).
    socket.on('voice:request_snapshot', async () => {
      await sendVoiceSnapshot(socket, server)
    })

    // ── Voice (WebRTC signaling) ───────────────────────────────────────────────
    registerVoiceHandlers(socket, server)
  })
}
