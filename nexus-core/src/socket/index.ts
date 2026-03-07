import { registerVoiceHandlers, sendVoiceSnapshot } from './voice'
import { registerWhisperHandlers } from './whisper'
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
    userId:            string
    username:          string
    avatar?:           string | null
    nameColor?:        string | null
    nameGlow?:         string | null
    nameGlowIntensity?: number | null
    nameAnimation?:    string | null
    nameFontFamily?:   string | null
    nameFontUrl?:      string | null
    grade?:            { name: string; color: string } | null
    status?:           { emoji: string; text: string } | null
  }
}

// ── Input guards ─────────────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

function isString(v: unknown): v is string {
  return typeof v === 'string'
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
  '*':      ['class', 'data-align', 'data-type'],
  'span':   ['class', 'style', 'data-align', 'data-type'],  // TipTap highlights/colors sur spans uniquement
  'p':      ['class', 'style', 'data-align', 'data-type'],  // alignement de paragraphes
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
      // Fetch avatar + name_color + grade + restore status from Redis
      try {
        const { rows } = await db.query<{
          avatar: string | null
          name_color: string | null
          name_glow: string | null
          name_glow_intensity: number | null
          name_animation: string | null
          name_font_family: string | null
          name_font_url: string | null
          grade_name: string | null
          grade_color: string | null
        }>(
          `SELECT u.avatar, p.name_color, p.name_glow, p.name_glow_intensity,
                  p.name_animation, p.name_font_family, p.name_font_url,
                  g.name AS grade_name, g.color AS grade_color
           FROM users u
           LEFT JOIN user_profiles p ON p.user_id = u.id
           LEFT JOIN community_members cm ON cm.user_id = u.id
           LEFT JOIN community_grades g ON g.id = cm.grade_id
           WHERE u.id = $1`,
          [userId]
        )
        socket.data.avatar           = rows[0]?.avatar ?? null
        socket.data.nameColor        = rows[0]?.name_color ?? null
        socket.data.nameGlow         = rows[0]?.name_glow ?? null
        socket.data.nameGlowIntensity = rows[0]?.name_glow_intensity ?? null
        socket.data.nameAnimation    = rows[0]?.name_animation ?? null
        socket.data.nameFontFamily   = rows[0]?.name_font_family ?? null
        socket.data.nameFontUrl      = rows[0]?.name_font_url ?? null
        socket.data.grade            = rows[0]?.grade_name
          ? { name: rows[0].grade_name, color: rows[0].grade_color! }
          : null
      } catch {
        socket.data.avatar           = null
        socket.data.nameColor        = null
        socket.data.nameGlow         = null
        socket.data.nameGlowIntensity = null
        socket.data.nameAnimation    = null
        socket.data.nameFontFamily   = null
        socket.data.nameFontUrl      = null
        socket.data.grade            = null
      }

      // Restore status from Redis (persists across reconnects within session)
      const savedStatus = await redis.get(`nexus:status:${userId}`).catch(() => null)
      socket.data.status = savedStatus ? JSON.parse(savedStatus) : null

      socket.join('presence')

      // Send current voice channel states to the new socket (sidebar overview)
      await sendVoiceSnapshot(socket, server)

      // Send current online list (deduplicated by userId) to the new socket
      const allSockets = await server.in('presence').fetchSockets()
      const seen = new Set<string>()
      const onlineList = allSockets
        .map(s => ({
          userId:            s.data.userId,
          username:          s.data.username,
          avatar:            s.data.avatar ?? null,
          nameColor:         s.data.nameColor ?? null,
          nameGlow:          s.data.nameGlow ?? null,
          nameGlowIntensity: s.data.nameGlowIntensity ?? null,
          nameAnimation:     s.data.nameAnimation ?? null,
          nameFontFamily:    s.data.nameFontFamily ?? null,
          nameFontUrl:       s.data.nameFontUrl ?? null,
          grade:             s.data.grade ?? null,
          status:            s.data.status ?? null,
        }))
        .filter(m => { if (seen.has(m.userId)) return false; seen.add(m.userId); return true })
      socket.emit('presence:init', onlineList)

      // Broadcast online only if this is the user's first tab
      const isFirstTab = !allSockets.some(s => s.id !== socket.id && s.data.userId === userId)
      if (isFirstTab) {
        socket.broadcast.to('presence').emit('presence:online', {
          userId,
          username,
          avatar:            socket.data.avatar ?? null,
          nameColor:         socket.data.nameColor ?? null,
          nameGlow:          socket.data.nameGlow ?? null,
          nameGlowIntensity: socket.data.nameGlowIntensity ?? null,
          nameAnimation:     socket.data.nameAnimation ?? null,
          nameFontFamily:    socket.data.nameFontFamily ?? null,
          nameFontUrl:       socket.data.nameFontUrl ?? null,
          grade:             socket.data.grade ?? null,
          status:            socket.data.status ?? null,
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

    // ── presence:set_status ────────────────────────────────────────────────────
    socket.on('presence:set_status', async (data: { emoji: string; text: string } | null) => {
      const status = data && (data.emoji || data.text)
        ? { emoji: (data.emoji ?? '').slice(0, 8), text: (data.text ?? '').slice(0, 60) }
        : null

      // Persist in Redis with 24h TTL (survives reconnects in same day session)
      if (status) {
        await redis.set(`nexus:status:${userId}`, JSON.stringify(status), 'EX', 86400).catch(() => {})
      } else {
        await redis.del(`nexus:status:${userId}`).catch(() => {})
      }

      // Update all sockets of this user
      ;(await server.in('presence').fetchSockets())
        .filter(s => s.data.userId === userId)
        .forEach(s => { (s.data as any).status = status })

      // Broadcast to presence room
      server.to('presence').emit('presence:status_update', { userId, status })
    })

    // ── Whisper rooms ─────────────────────────────────────────────────────────
    registerWhisperHandlers(server, socket)

    // ── chat:join ─────────────────────────────────────────────────────────────
    socket.on('chat:join', async (channelId: string) => {
      if (!isUuid(channelId)) return

      const channel = await ChannelModel.findById(channelId).catch(() => null)
      if (!channel) return

      socket.join(`channel:${channelId}`)

      const [history, pinned] = await Promise.all([
        ChannelModel.getHistory(channelId, 50).catch(() => []),
        ChannelModel.getPinnedMessage(channelId).catch(() => null),
      ])
      socket.emit('chat:history', { channelId, messages: history })
      socket.emit('chat:pinned', { channelId, message: pinned })
    })

    // ── chat:leave ────────────────────────────────────────────────────────────
    socket.on('chat:leave', (channelId: string) => {
      if (isUuid(channelId)) socket.leave(`channel:${channelId}`)
    })

    // ── chat:send ─────────────────────────────────────────────────────────────
    socket.on('chat:send', async (data: { channelId: string; content: string; replyToId?: string | null }) => {
      const { channelId, content, replyToId } = data ?? {}
      if (!isUuid(channelId) || !isString(content)) return
      if (content.length > 20000) return  // limite avant sanitization (DoS)
      if (replyToId !== undefined && replyToId !== null && !isUuid(replyToId)) return

      const sanitized = sanitize(content.trim())
      if (!sanitized || sanitized.length > 10000) return

      try {
        const message = await ChannelModel.addMessage({
          channel_id:   channelId,
          author_id:    userId,
          content:      sanitized,
          reply_to_id:  replyToId ?? null,
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
            // Separate chat-specific mention badge (won't mix with forum notifications)
            io.to(`user:${notifiedUserId}`).emit('chat:mention')
          }
        }
      } catch {
        // Silently ignore DB errors (e.g. channel deleted)
      }
    })

    // ── chat:typing ───────────────────────────────────────────────────────────
    // Throttled by client — just broadcast to others in the room
    socket.on('chat:typing', (channelId: string) => {
      if (!isUuid(channelId)) return
      socket.to(`channel:${channelId}`).emit('chat:typing', { userId, username })
    })

    // ── chat:react ────────────────────────────────────────────────────────────
    socket.on('chat:react', async (data: { messageId: string; emoji: string }) => {
      const { messageId, emoji } = data ?? {}
      if (!isUuid(messageId) || !isString(emoji) || emoji.length > 64) return

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
      if (!isUuid(messageId) || !isString(content)) return
      if (content.length > 20000) return

      const sanitized = sanitize(content.trim())
      if (!sanitized || sanitized.length > 10000) return

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
      if (!isUuid(messageId)) return

      try {
        const { rows: roleRows } = await db.query(
          `SELECT 1 FROM community_members WHERE user_id = $1 AND role IN ('admin', 'owner') LIMIT 1`,
          [userId]
        )
        const byAdmin = roleRows.length > 0
        const { ok, channelId } = await ChannelModel.deleteMessage(messageId, userId, byAdmin)
        if (!ok || !channelId) return

        if (io) {
          io.to(`channel:${channelId}`).emit('chat:message_deleted', { messageId })
        }
      } catch {
        // ignore
      }
    })
    // ── chat:pin ──────────────────────────────────────────────────────────────
    socket.on('chat:pin', async (data: { channelId: string; messageId: string | null }) => {
      const { channelId, messageId } = data ?? {}
      if (!isUuid(channelId)) return
      if (messageId !== null && !isUuid(messageId)) return

      try {
        const { rows: roleRows } = await db.query(
          `SELECT 1 FROM community_members WHERE user_id = $1 AND role IN ('admin', 'owner') LIMIT 1`,
          [userId]
        )
        if (roleRows.length === 0) {
          console.warn(`[chat:pin] Denied for userId=${userId}`)
          return
        }

        await ChannelModel.setPinnedMessage(channelId, messageId ?? null)
        const pinned = messageId ? await ChannelModel.getPinnedMessage(channelId) : null
        const payload = { channelId, message: pinned }

        if (io) {
          io.to(`channel:${channelId}`).emit('chat:pinned', payload)
        } else {
          socket.emit('chat:pinned', payload)
        }
      } catch (err) {
        console.error('[chat:pin] Error:', err)
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

    // ── DM events ─────────────────────────────────────────────────────────────

    // dm:send — envoyer un message dans une conversation
    socket.on('dm:send', async (data: { conversationId: string; content: string }) => {
      try {
        if (!isUuid(data?.conversationId) || !isString(data?.content)) return
        const raw = data.content.trim()
        if (!raw || raw.length > 20000) return

        // Vérifier que l'user est participant
        const { rows: [part] } = await db.query(
          `SELECT 1 FROM dm_participants WHERE conversation_id = $1 AND user_id = $2`,
          [data.conversationId, userId]
        )
        if (!part) return

        const clean = sanitize(raw)

        const { rows: [msg] } = await db.query<{
          id: string; conversation_id: string; sender_id: string;
          content: string; created_at: Date;
        }>(`
          INSERT INTO dm_messages (conversation_id, sender_id, content)
          VALUES ($1, $2, $3)
          RETURNING id, conversation_id, sender_id, content, created_at
        `, [data.conversationId, userId, clean])

        const payload = {
          ...msg,
          sender_username:   username,
          sender_avatar:     socket.data.avatar ?? null,
          sender_name_color: socket.data.nameColor ?? null,
        }

        // Émettre à tous les participants via leurs rooms personnelles
        const { rows: participants } = await db.query<{ user_id: string }>(
          `SELECT user_id FROM dm_participants WHERE conversation_id = $1`,
          [data.conversationId]
        )
        for (const p of participants) {
          server.to(`user:${p.user_id}`).emit('dm:message', payload)
        }
      } catch (err) {
        console.error('[dm:send] Error:', err)
      }
    })

    // dm:typing — indicateur de frappe (throttlé côté client)
    socket.on('dm:typing', (conversationId: string) => {
      if (!isUuid(conversationId)) return
      db.query<{ user_id: string }>(
        `SELECT user_id FROM dm_participants WHERE conversation_id = $1 AND user_id != $2`,
        [conversationId, userId]
      ).then(({ rows }) => {
        for (const p of rows) {
          server.to(`user:${p.user_id}`).emit('dm:typing', { conversationId, userId, username })
        }
      }).catch(() => {})
    })

    // dm:read — marquer comme lu et confirmer
    socket.on('dm:read', async (conversationId: string) => {
      if (!isUuid(conversationId)) return
      try {
        await db.query(
          `UPDATE dm_participants SET last_read_at = now()
           WHERE conversation_id = $1 AND user_id = $2`,
          [conversationId, userId]
        )
        socket.emit('dm:read_ack', { conversationId })
      } catch (err) {
        console.error('[dm:read] Error:', err)
      }
    })
  })
}
