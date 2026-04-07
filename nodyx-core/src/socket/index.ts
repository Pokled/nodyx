import { registerVoiceHandlers, sendVoiceSnapshot } from './voice'
import { registerWhisperHandlers } from './whisper'
import { checkRateLimit } from './rateLimiter'
import { Server, Socket } from 'socket.io'
import jwt from 'jsonwebtoken'
import sanitizeHtml from 'sanitize-html'
import { db, redis } from '../config/database'
import * as ChannelModel from '../models/channel'
import * as NotificationModel from '../models/notification'
import { resolveMentions } from '../utils/mentions'
import { io } from './io'
import { sendPushToUser } from '../routes/notifications'
import { checkHtmlContent } from '../services/contentFilter'

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

// ── Sanitize ──────────────────────────────────────────────────────────────────

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

// ── Content security — images & links ─────────────────────────────────────────

// Seules les images hébergées sur ce serveur ou issues des CDN GIF sont autorisées.
// Tout <img src="https://site-externe.com/..."> est supprimé silencieusement.
const ALLOWED_IMG_HOSTS = new Set([
  'media.tenor.com', 'c.tenor.com', 'media1.tenor.com', 'tenor.com',
  'media.giphy.com', 'media0.giphy.com', 'media1.giphy.com',
  'media2.giphy.com', 'media3.giphy.com', 'i.giphy.com',
])

function isAllowedImgSrc(src: string): boolean {
  if (!src) return false
  if (src.startsWith('/uploads/')) return true
  if (src.startsWith('data:image/')) return true  // images collées depuis le presse-papiers
  try {
    return ALLOWED_IMG_HOSTS.has(new URL(src).hostname)
  } catch {
    return false
  }
}

// Domaines bloqués dans les liens <a href> (contenu illicite / adulte connu)
// L'admin peut étendre la liste via la variable d'environnement BLOCKED_LINK_DOMAINS
// (liste de domaines séparés par des virgules).
const _envBlocked = (process.env.BLOCKED_LINK_DOMAINS ?? '')
  .split(',').map(d => d.trim().toLowerCase()).filter(Boolean)

const BLOCKED_LINK_DOMAINS = new Set([
  'pornhub.com', 'xvideos.com', 'xhamster.com', 'xnxx.com',
  'redtube.com', 'youporn.com', 'tube8.com', 'spankbang.com',
  'tnaflix.com', 'drtuber.com', 'beeg.com', 'txxx.com',
  ..._envBlocked,
])

function isBlockedHref(href: string): boolean {
  if (!href) return false
  try {
    const hostname = new URL(href).hostname.toLowerCase().replace(/^www\./, '')
    return BLOCKED_LINK_DOMAINS.has(hostname)
  } catch {
    return false
  }
}

function sanitize(raw: string): string {
  return sanitizeHtml(raw, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRS,
    allowedIframeHostnames: [
      'www.youtube.com', 'youtube.com', 'www.youtube-nocookie.com',
      'player.vimeo.com', 'vimeo.com',
    ],
    // Supprime les <img> dont le src n'est pas sur ce serveur ou un CDN GIF autorisé
    // Supprime les <a> pointant vers des domaines illicites connus
    exclusiveFilter: (frame) => {
      if (frame.tag === 'img') return !isAllowedImgSrc(frame.attribs?.src ?? '')
      if (frame.tag === 'a')   return isBlockedHref(frame.attribs?.href ?? '')
      return false
    },
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
    payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    return next(new Error('Invalid token'))
  }

  // Confirm session is alive — ioredis keyPrefix 'nodyx:' applied automatically
  const alive = await redis.exists(`session:${token}`)
  if (!alive) {
    return next(new Error('Session expired'))
  }

  // Reject banned users before they join any room
  const isBanned = await redis.exists(`banned:${payload.userId}`)
  if (isBanned) {
    return next(new Error('Banned'))
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
      // Disconnect banned users immediately
      const { rows: banRows } = await db.query(
        `SELECT 1 FROM community_bans cb
         JOIN communities c ON c.id = cb.community_id
         WHERE cb.user_id = $1 LIMIT 1`,
        [userId]
      ).catch(() => ({ rows: [] }))
      if (banRows.length > 0) {
        socket.emit('banned', { message: 'You have been banned from this community.' })
        socket.disconnect(true)
        return
      }
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
      const savedStatus = await redis.get(`status:${userId}`).catch(() => null)
      try {
        socket.data.status = savedStatus ? JSON.parse(savedStatus) : null
      } catch {
        socket.data.status = null
      }

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

    // ── Periodic ban check — catches bans issued by Rust (nodyx-server) ─────────
    // Node.js bans kick immediately via io.in(); Rust bans only write Redis.
    // Every 30s we re-check the banned: key so no banned user stays connected.
    const banCheckInterval = setInterval(async () => {
      if (!socket.connected) { clearInterval(banCheckInterval); return }
      const stillBanned = await redis.exists(`banned:${userId}`).catch(() => 0)
      if (stillBanned) {
        clearInterval(banCheckInterval)
        socket.emit('banned', { message: 'You have been banned from this community.' })
        socket.disconnect(true)
      }
    }, 30_000)

    // Broadcast offline only when the user's last tab closes
    socket.on('disconnect', async () => {
      clearInterval(banCheckInterval)
      const remaining = await server.in('presence').fetchSockets()
      const stillOnline = remaining.some(s => s.data.userId === userId)
      if (!stillOnline) {
        server.to('presence').emit('presence:offline', { userId })
      }
    })

    // ── presence:set_status ────────────────────────────────────────────────────
    socket.on('presence:set_status', async (data: { emoji: string; text: string } | null) => {
      if (checkRateLimit(userId, 'presence:set_status')) return
      const status = data && (data.emoji || data.text)
        ? {
            emoji: (data.emoji ?? '').slice(0, 8),
            // Strip tout HTML du texte de statut avant broadcast
            text:  sanitizeHtml((data.text ?? '').slice(0, 60), { allowedTags: [], allowedAttributes: {} }),
          }
        : null

      // Persist in Redis with 24h TTL (survives reconnects in same day session)
      if (status) {
        await redis.set(`status:${userId}`, JSON.stringify(status), 'EX', 86400).catch(() => {})
      } else {
        await redis.del(`status:${userId}`).catch(() => {})
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

      // Contrôle d'accès : l'utilisateur doit être membre de la communauté du canal
      const { rows: access } = await db.query(
        `SELECT 1 FROM channels c
         JOIN community_members cm ON c.community_id = cm.community_id
         WHERE c.id = $1 AND cm.user_id = $2 LIMIT 1`,
        [channelId, userId]
      ).catch(() => ({ rows: [] as any[] }))
      if (!access.length) return

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

    // ── chat:watch ────────────────────────────────────────────────────────────
    // Join a channel room silently (no history) — used for unread notifications
    socket.on('chat:watch', async (channelIds: string | string[]) => {
      const ids = Array.isArray(channelIds) ? channelIds : [channelIds]
      const validIds = ids.filter(id => isUuid(id)).slice(0, 50)
      if (!validIds.length) return

      // Verify community membership once
      const { rows } = await db.query(
        `SELECT DISTINCT c.id FROM channels c
         JOIN community_members cm ON c.community_id = cm.community_id
         WHERE c.id = ANY($1) AND cm.user_id = $2`,
        [validIds, userId]
      ).catch(() => ({ rows: [] as any[] }))

      for (const row of rows) {
        socket.join(`channel:${row.id}`)
      }
    })

    // ── chat:send ─────────────────────────────────────────────────────────────
    socket.on('chat:send', async (data: { channelId: string; content: string; replyToId?: string | null }) => {
      const rateLimitMs = checkRateLimit(userId, 'chat:send')
      if (rateLimitMs) {
        socket.emit('chat:rate_limited', { retryAfter: rateLimitMs })
        return
      }
      const { channelId, content, replyToId } = data ?? {}
      if (!isUuid(channelId) || !isString(content)) return
      if (content.length > 20000) return  // limite avant sanitization (DoS)
      if (replyToId !== undefined && replyToId !== null && !isUuid(replyToId)) return

      // Contrôle d'accès : le socket doit avoir rejoint ce canal via chat:join (qui vérifie membership)
      // Double-check DB pour éviter les races après expulsion de la communauté
      if (!socket.rooms.has(`channel:${channelId}`)) return
      const { rows: memberCheck } = await db.query(
        `SELECT 1 FROM channels c
         JOIN community_members cm ON c.community_id = cm.community_id
         WHERE c.id = $1 AND cm.user_id = $2 LIMIT 1`,
        [channelId, userId]
      ).catch(() => ({ rows: [] as any[] }))
      if (!memberCheck.length) return

      const sanitized = sanitize(content.trim())
      if (!sanitized || sanitized.length > 10000) return

      const contentCheck = checkHtmlContent(sanitized)
      if (!contentCheck.ok) {
        socket.emit('chat:blocked', { reason: contentCheck.reason })
        return
      }

      try {
        // Check ban before writing message
        const { rows: banCheck } = await db.query(
          `SELECT 1 FROM community_bans cb
           JOIN channels ch ON ch.community_id = cb.community_id
           WHERE cb.user_id = $1 AND ch.id = $2 LIMIT 1`,
          [userId, channelId]
        )
        if (banCheck.length > 0) return

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
          // Web Push si l'utilisateur n'est pas connecté en temps réel
          sendPushToUser(notifiedUserId, {
            title: `@${username} vous a mentionné`,
            body:  sanitized.slice(0, 80),
            type:  'mention',
            tag:   'chat-mention',
            url:   '/chat',
          }).catch(() => {})
        }
      } catch {
        // Silently ignore DB errors (e.g. channel deleted)
      }
    })

    // ── chat:typing ───────────────────────────────────────────────────────────
    // Throttled by client — just broadcast to others in the room
    socket.on('chat:typing', (channelId: string) => {
      if (checkRateLimit(userId, 'chat:typing')) return
      if (!isUuid(channelId)) return
      if (!socket.rooms.has(`channel:${channelId}`)) return
      socket.to(`channel:${channelId}`).emit('chat:typing', { userId, username })
    })

    // ── chat:react ────────────────────────────────────────────────────────────
    socket.on('chat:react', async (data: { messageId: string; emoji: string }) => {
      if (checkRateLimit(userId, 'chat:react')) return
      const { messageId, emoji } = data ?? {}
      if (!isUuid(messageId) || !isString(emoji) || emoji.length > 64) return

      try {
        // Vérifier que l'utilisateur est membre du channel contenant ce message
        const msgInfo = await ChannelModel.findMessageById(messageId)
        if (!msgInfo) return
        if (!socket.rooms.has(`channel:${msgInfo.channel_id}`)) return

        const { reactions } = await ChannelModel.toggleReaction(messageId, userId, emoji)

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

    // ── chat:float_reaction — réactions flottantes Twitch-style ──────────────
    socket.on('chat:float_reaction', (data: { channelId: string; emoji: string; x: number }) => {
      if (checkRateLimit(userId, 'chat:float_reaction')) return
      const { channelId, emoji, x } = data ?? {}
      if (!isUuid(channelId) || !isString(emoji) || emoji.length > 64) return
      if (!socket.rooms.has(`channel:${channelId}`)) return
      if (!io) return
      io.to(`channel:${channelId}`).emit('chat:float_reaction', {
        emoji,
        x: typeof x === 'number' ? Math.max(0, Math.min(1, x)) : 0.5,
        username,
      })
    })

    // ── chat:edit ─────────────────────────────────────────────────────────────
    socket.on('chat:edit', async (data: { messageId: string; content: string }) => {
      if (checkRateLimit(userId, 'chat:edit')) return
      const { messageId, content } = data ?? {}
      if (!isUuid(messageId) || !isString(content)) return
      if (content.length > 20000) return

      const sanitized = sanitize(content.trim())
      if (!sanitized || sanitized.length > 10000) return

      const editCheck = checkHtmlContent(sanitized)
      if (!editCheck.ok) {
        socket.emit('chat:blocked', { reason: editCheck.reason })
        return
      }

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
        // Récupérer le channel du message pour scoper la vérification admin
        const msgInfo = await ChannelModel.findMessageById(messageId)
        if (!msgInfo) return

        // Vérifier admin/owner dans la communauté du channel spécifique (pas n'importe quelle communauté)
        const { rows: roleRows } = await db.query(
          `SELECT 1 FROM community_members cm
           JOIN channels c ON c.community_id = cm.community_id
           WHERE c.id = $1 AND cm.user_id = $2 AND cm.role IN ('admin', 'owner') LIMIT 1`,
          [msgInfo.channel_id, userId]
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
    socket.on('dm:send', async (data: {
      conversationId:   string
      content:          string
      is_encrypted?:    boolean
      encryption_nonce?: string
    }) => {
      if (checkRateLimit(userId, 'dm:send')) return
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

        const isEncrypted = data.is_encrypted === true
          && typeof data.encryption_nonce === 'string'
          && /^[A-Za-z0-9+\/=]{16,32}$/.test(data.encryption_nonce)  // nonce 12 bytes = 16 chars base64

        let clean: string
        if (isEncrypted) {
          // Message E2E : valider que le contenu est du base64 valide, ne pas sanitizer
          if (!/^[A-Za-z0-9+\/=\n]{1,20000}$/.test(raw)) return
          clean = raw
        } else {
          clean = sanitize(raw)
          const dmCheck = checkHtmlContent(clean)
          if (!dmCheck.ok) {
            socket.emit('chat:blocked', { reason: dmCheck.reason })
            return
          }
        }

        const { rows: [msg] } = await db.query<{
          id: string; conversation_id: string; sender_id: string;
          content: string; created_at: Date; is_encrypted: boolean; encryption_nonce: string | null;
        }>(`
          INSERT INTO dm_messages (conversation_id, sender_id, content, is_encrypted, encryption_nonce)
          VALUES ($1, $2, $3, $4, $5)
          RETURNING id, conversation_id, sender_id, content, created_at, is_encrypted, encryption_nonce
        `, [data.conversationId, userId, clean, isEncrypted, isEncrypted ? data.encryption_nonce : null])

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

    // dm:edit — modifier un message DM (sender uniquement, pas chiffré)
    socket.on('dm:edit', async (data: { msgId: string; content: string; encryption_nonce?: string }) => {
      if (checkRateLimit(userId, 'dm:edit')) return
      try {
        if (!isUuid(data?.msgId) || !isString(data?.content)) return
        const raw = data.content.trim()
        if (!raw || raw.length > 20000) return

        // Vérifier ownership + non chiffré + non supprimé
        const { rows: [msg] } = await db.query<{ sender_id: string; conversation_id: string; is_encrypted: boolean }>(
          `SELECT sender_id, conversation_id, is_encrypted FROM dm_messages WHERE id = $1 AND deleted_at IS NULL`,
          [data.msgId]
        )
        if (!msg || msg.sender_id !== userId) return

        let clean: string
        if (msg.is_encrypted) {
          // Message chiffré : valider base64, ne pas sanitizer
          if (!/^[A-Za-z0-9+\/=\n]{1,20000}$/.test(raw)) return
          clean = raw
        } else {
          clean = sanitize(raw)
          const dmCheck = checkHtmlContent(clean)
          if (!dmCheck.ok) return
        }

        if (msg.is_encrypted && typeof data.encryption_nonce === 'string'
            && /^[A-Za-z0-9+\/=]{16,32}$/.test(data.encryption_nonce)) {
          await db.query(
            `UPDATE dm_messages SET content = $1, encryption_nonce = $2, edited_at = now() WHERE id = $3`,
            [clean, data.encryption_nonce, data.msgId]
          )
        } else {
          await db.query(
            `UPDATE dm_messages SET content = $1, edited_at = now() WHERE id = $2`,
            [clean, data.msgId]
          )
        }

        // Notifier les participants
        const { rows: participants } = await db.query<{ user_id: string }>(
          `SELECT user_id FROM dm_participants WHERE conversation_id = $1`,
          [msg.conversation_id]
        )
        const newNonce = msg.is_encrypted && typeof data.encryption_nonce === 'string'
          ? data.encryption_nonce
          : undefined
        for (const p of participants) {
          server.to(`user:${p.user_id}`).emit('dm:edited', {
            msgId: data.msgId,
            content: clean,
            conversation_id: msg.conversation_id,
            encryption_nonce: newNonce,
          })
        }
      } catch (err) {
        console.error('[dm:edit] Error:', err)
      }
    })

    // dm:typing — indicateur de frappe (throttlé côté client)
    socket.on('dm:typing', (conversationId: string) => {
      if (checkRateLimit(userId, 'dm:typing')) return
      if (!isUuid(conversationId)) return
      db.query<{ user_id: string }>(
        // AND user_id = $2 vérifie que l'émetteur est bien participant de cette conversation
        `SELECT user_id FROM dm_participants WHERE conversation_id = $1 AND user_id != $2
         AND EXISTS (SELECT 1 FROM dm_participants WHERE conversation_id = $1 AND user_id = $2)`,
        [conversationId, userId]
      ).then(({ rows }) => {
        for (const p of rows) {
          server.to(`user:${p.user_id}`).emit('dm:typing', { conversationId, userId, username })
        }
      }).catch(() => {})
    })

    // dm:react — ajouter/retirer une réaction sur un message DM
    socket.on('dm:react', async (data: { messageId: string; emoji: string }) => {
      if (checkRateLimit(userId, 'dm:react')) return
      try {
        if (!isUuid(data?.messageId) || typeof data?.emoji !== 'string') return
        const emoji = data.emoji.trim()
        if (!emoji || emoji.length > 12) return

        // Vérifier que l'user est participant de la conversation contenant ce message
        const { rows: [access] } = await db.query<{ conversation_id: string }>(
          `SELECT m.conversation_id FROM dm_messages m
           JOIN dm_participants p ON p.conversation_id = m.conversation_id
           WHERE m.id = $1 AND p.user_id = $2 AND m.deleted_at IS NULL`,
          [data.messageId, userId]
        )
        if (!access) return

        // Toggle : si la réaction existe, on la supprime ; sinon on l'ajoute
        const { rows: [existing] } = await db.query(
          `SELECT id FROM dm_reactions WHERE message_id = $1 AND user_id = $2 AND emoji = $3`,
          [data.messageId, userId, emoji]
        )
        if (existing) {
          await db.query(`DELETE FROM dm_reactions WHERE id = $1`, [existing.id])
        } else {
          await db.query(
            `INSERT INTO dm_reactions (message_id, user_id, emoji) VALUES ($1, $2, $3)
             ON CONFLICT DO NOTHING`,
            [data.messageId, userId, emoji]
          )
        }

        // Récupérer le résumé des réactions pour ce message
        const { rows: summary } = await db.query<{ emoji: string; count: string; user_ids: string[]; usernames: string[] }>(
          `SELECT r.emoji,
                  COUNT(*) as count,
                  array_agg(r.user_id::text ORDER BY r.created_at) as user_ids,
                  array_agg(u.username    ORDER BY r.created_at) as usernames
           FROM dm_reactions r
           JOIN users u ON u.id = r.user_id
           WHERE r.message_id = $1
           GROUP BY r.emoji ORDER BY MIN(r.created_at)`,
          [data.messageId]
        )
        const reactions = summary.map(r => ({
          emoji:     r.emoji,
          count:     parseInt(r.count),
          userIds:   r.user_ids,
          usernames: r.usernames,
        }))

        // Broadcaster à tous les participants
        const { rows: participants } = await db.query<{ user_id: string }>(
          `SELECT user_id FROM dm_participants WHERE conversation_id = $1`,
          [access.conversation_id]
        )
        for (const p of participants) {
          server.to(`user:${p.user_id}`).emit('dm:reaction_update', {
            messageId: data.messageId,
            reactions,
          })
        }
      } catch (err) {
        console.error('[dm:react] Error:', err)
      }
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
