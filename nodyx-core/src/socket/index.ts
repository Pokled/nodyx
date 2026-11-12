import { registerVoiceHandlers, sendVoiceSnapshot } from './voice'
import { registerVoiceSfuHandlers } from './voiceSfu'
import { registerWhisperHandlers } from './whisper'
import { registerCanvasHandlers }  from './canvas'
import { registerActivityHandlers } from './activity'
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
import { resolveServerLocale, pushStrings } from '../i18n/serverStrings'
import { checkHtmlContent } from '../services/contentFilter'
import { runPipeline, isOctoGuardEnabled, isUserMuted, tryHandleCommand } from '../services/octoguard'
import { fileAutoReport } from '../services/octoguard/autoReport'
import { buildUserCtx } from '../services/octoguard/moderate'
import { holdContent, forAuthor, holdRefusal } from '../services/octoguard/held'
import { getInstanceCommunityId } from '../middleware/adminOnly'
import { getAccess, outranks, rankOf } from '../services/permissions'
import { sanitizeChat } from '../utils/chatSanitize'

interface JwtPayload {
  userId:   string
  username: string
}

// Extend SocketData for typed socket.data
declare module 'socket.io' {
  interface SocketData {
    userId:            string
    username:          string
    activeChannel?:    string | null   // channel texte que cet onglet regarde activement (chat:join)
    avatar?:           string | null
    nameColor?:        string | null
    nameGlow?:         string | null
    nameGlowIntensity?: number | null
    nameAnimation?:    string | null
    nameFontFamily?:   string | null
    nameFontUrl?:      string | null
    grade?:            { name: string; color: string } | null
    status?:           { emoji: string; text: string } | null
    /** État vocal volatile (muet / sourd / partage d'écran), publié par le client
     *  via `voice:state`. Sert à enrichir le roster d'un canal vocal
     *  (`voice:channel_update`) : sans lui, l'écran d'un canal qu'on n'a PAS
     *  rejoint ne peut pas montrer qui est muet, sourd ou en train de partager.
     *  Volatile par nature : rien en base, remis à zéro à chaque `voice:join`. */
    voiceState?:       { muted: boolean; deafened: boolean; sharing: boolean } | null
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

// Assainissement : utils/chatSanitize.ts (partagé avec la pré-vérification)
const sanitize = sanitizeChat

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

    // ── Canvas boards ─────────────────────────────────────────────────────────
    registerCanvasHandlers(server, socket)

    // ── Streamer Hub admin live feed ─────────────────────────────────────────
    // Admin-only room that receives every EventSub-derived event in real time
    // (see services/streamer/streamerHubService.ts ingestEvent). The role check
    // happens once on join so subsequent emits don't need to re-verify.
    socket.on('streamer-hub:join', async () => {
      if (checkRateLimit(userId, 'streamer-hub:join')) return
      // Scopé à LA communauté de l'instance (trouvé en audit le 16/09) : sans
      // ce scope, un owner d'une communauté auto-créée par lui-même (avant que
      // POST /communities passe admin-only) rejoignait cette room admin et
      // recevait le flux EventSub admin.
      const communityId = await getInstanceCommunityId()
      if (!communityId) return
      const { rows } = await db.query<{ role: string }>(
        `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
        [communityId, userId],
      ).catch(() => ({ rows: [] as { role: string }[] }))
      const role = rows[0]?.role
      if (role !== 'owner' && role !== 'admin') return
      socket.join('admin:streamer-hub')
    })
    socket.on('streamer-hub:leave', () => {
      socket.leave('admin:streamer-hub')
    })

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
      socket.data.activeChannel = channelId   // cet onglet regarde ce channel -> pas de notif de mention dessus

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
      if (socket.data.activeChannel === channelId) socket.data.activeChannel = null
    })

    // ── chat:watch ────────────────────────────────────────────────────────────
    // Join a channel room silently (no history) — used for unread notifications
    socket.on('chat:watch', async (channelIds: string | string[]) => {
      if (checkRateLimit(userId, 'chat:watch')) return
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
      const { rows: memberCheck } = await db.query<{ role: string; is_system_managed: boolean; grade_id: string | null; community_id: string; account_age_days: number }>(
        `SELECT cm.role, c.is_system_managed, cm.grade_id, c.community_id,
                EXTRACT(EPOCH FROM (NOW() - u.created_at)) / 86400 AS account_age_days
         FROM channels c
         JOIN community_members cm ON c.community_id = cm.community_id
         JOIN users u ON u.id = cm.user_id
         WHERE c.id = $1 AND cm.user_id = $2 LIMIT 1`,
        [channelId, userId]
      ).catch(() => ({ rows: [] as { role: string; is_system_managed: boolean; grade_id: string | null; community_id: string; account_age_days: number }[] }))
      if (!memberCheck.length) return

      // Channel system-managed (ex: #streamer-events auto-créé) : seuls
      // owners/admins/moderators peuvent y écrire. Les messages système
      // (Streamer Hub, bots) bypass ce socket handler et passent par
      // Channel.addMessage() direct, donc rien à filtrer pour eux ici.
      if (memberCheck[0].is_system_managed && !['owner', 'admin', 'moderator'].includes(memberCheck[0].role)) {
        socket.emit('chat:blocked', { reason: 'channel_read_only' })
        return
      }

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

        // Sourdine : vérifiée TOUJOURS, OctoGuard allumé ou non. Une sourdine
        // posée par l'équipe est de la modération humaine ; jusqu'au
        // 02/11/2026 elle n'était lue que si OctoGuard tournait, donc jamais
        // (éteint partout depuis août) : elle ne faisait rien.
        {
          const muteState = await isUserMuted(userId, channelId)
          if (muteState.muted) {
            socket.emit('chat:blocked', {
              reason:    'muted',
              octoguard: {
                i18n_key:    'octoguard.mute.active',
                expires_at:  muteState.expires_at ?? null,
                reason_text: muteState.reason ?? null,
                channel_id:  muteState.channel_id ?? null,
              },
            })
            return
          }
        }

        // Cran « signaler » d'une règle : dossier ouvert après l'enregistrement (D13)
        let ogReport: { rule_name: string; excerpt: string } | undefined

        // ▼ OCTOGUARD HOOK (Sessions B + C, cf docs/specs/016-Octoguard/)
        if (isOctoGuardEnabled()) {

          // 2. Détection de commandes custom (Module 3, Session C).
          //    Si "!cmd" en début de message → on poste la réponse bot et
          //    on supprime le message original. Si commande inconnue ou
          //    pas une commande, le pipeline continue normalement.
          const cmdOutcome = await tryHandleCommand({
            content:    sanitized,
            userId,
            username:   socket.data.username,
            userRole:   memberCheck[0].role,
            channelId,
          })
          if (cmdOutcome.handled && cmdOutcome.blocked) {
            // Le message d'origine du user est supprimé silencieusement
            // (la réponse bot a déjà été broadcastée par tryHandleCommand).
            return
          }

          // 3. Pipeline auto-mod (Module 1, Session B).
          const og = await runPipeline({
            content:   sanitized,
            userCtx:   {
              userId,
              role:     memberCheck[0].role,
              gradeIds: memberCheck[0].grade_id ? [memberCheck[0].grade_id] : [],
              accountAgeDays: Number(memberCheck[0].account_age_days),
            },
            surface:   'chat',
            channelId,
          })
          ogReport = og.report
          // Cran « retenir » : le message n'est PAS écrit. Seul son auteur le
          // voit, « en attente de validation » (CDC E4h, lot 2).
          if (og.hold) {
            const held = await holdContent({
              kind: 'chat', authorId: userId, channelId,
              payload: { content: sanitized, reply_to_id: replyToId ?? null }, rule: og.hold,
            })
            if (held.ok) {
              io?.to(`user:${userId}`).emit('octoguard:held', forAuthor(held.row))
            } else {
              const refusal = holdRefusal(held.code)
              socket.emit('chat:blocked', { reason: refusal.code, octoguard: { i18n_key: refusal.i18n_key } })
            }
            // Retenu ou refus : dans les deux cas, RIEN n'est publié
            return
          }
          if (og.blocked) {
            socket.emit('chat:blocked', {
              reason:    og.reason ?? 'octoguard',
              octoguard: {
                i18n_key: og.i18n_key,
                event_id: og.event_id,
              },
            })
            return
          }
        }
        // ▲ FIN OCTOGUARD HOOK

        // ── Streamer Hub bridge outbound (Phase 2 §6.4) ──────────────────
        // Si le message a été posté dans #twitch-chat ET que l'auteur est
        // le streamer lié, on prépend le badge "broadcaster" pour qu'on le
        // voie sur Nodyx comme sur Twitch (le badge venait avant de l'echo
        // EventSub, maintenant suppressé pour anti-doublon).
        const { rows: chCheck } = await db.query<{ slug: string }>(
          `SELECT slug FROM channels WHERE id = $1 LIMIT 1`,
          [channelId],
        ).catch(() => ({ rows: [] as { slug: string }[] }))
        const isTwitchChat = chCheck[0]?.slug === 'twitch-chat'

        let finalContent = sanitized
        if (isTwitchChat) {
          finalContent = await import('../services/streamer/twitchChatBridge')
            .then(({ applyBroadcasterBadgeIfOwner }) => applyBroadcasterBadgeIfOwner(userId, sanitized))
            .catch(() => sanitized)
        }

        const message = await ChannelModel.addMessage({
          channel_id:   channelId,
          author_id:    userId,
          content:      finalContent,
          reply_to_id:  replyToId ?? null,
        })
        if (ogReport) void fileAutoReport({ targetType: 'message', targetId: message.id, ruleName: ogReport.rule_name, excerpt: ogReport.excerpt })
        if (io) {
          io.to(`channel:${channelId}`).emit('chat:message', message)
        }

        if (isTwitchChat) {
          import('../services/streamer/twitchChatBridge')
            .then(({ relayMessageToTwitch }) =>
              relayMessageToTwitch({
                provider:       'twitch',
                authorUsername: username,
                authorUserId:   userId,
                text:           content.replace(/<[^>]+>/g, '').trim(),
                                // strip HTML pour Twitch chat (texte brut)
              }))
            .then(r => {
              if (!r.ok && r.reason !== 'stream_offline') {
                console.warn('[chat:send] twitch relay failed', { reason: r.reason })
              }
            })
            .catch(err => console.error('[chat:send] twitch relay error', err))
        }

        // Push notifications for @mentions
        const mentionedIds = await resolveMentions(sanitized, memberCheck[0].community_id).catch(() => [])
        for (const notifiedUserId of mentionedIds) {
          if (notifiedUserId === userId) continue
          // Déjà en train de regarder ce channel (onglet actif) ? Il lit le message
          // en direct -> aucune notif (cloche/badge/push) nécessaire.
          if (io) {
            const userSockets = await io.in(`user:${notifiedUserId}`).fetchSockets().catch(() => [])
            if (userSockets.some(s => s.data.activeChannel === channelId)) continue
          }
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
          // Web Push si l'utilisateur n'est pas connecté en temps réel.
          // Contrairement à une erreur API, un push envoyé n'est plus retraduisible
          // une fois reçu (le service worker l'affiche tel quel) : on résout la
          // langue du destinataire, pas celle de l'auteur du message.
          const { rows: localeRows } = await db.query<{ locale: string | null }>(
            `SELECT locale FROM users WHERE id = $1`, [notifiedUserId]
          ).catch(() => ({ rows: [] }))
          const pushLocale = resolveServerLocale(localeRows[0]?.locale, process.env.NODYX_COMMUNITY_LANGUAGE)
          sendPushToUser(notifiedUserId, {
            title: pushStrings(pushLocale).mentionTitle(username),
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
        // Une modification passe par les mêmes contrôles qu'un envoi (lot 3,
        // OctoGuard 2). Avant : ni sourdine ni règles, donc on publiait propre
        // puis on modifiait en spam ou en insulte, et une sourdine n'empêchait
        // pas de réécrire ses anciens messages.
        const target = await ChannelModel.findMessageById(messageId)
        if (!target || target.author_id !== userId) return
        const muteState = await isUserMuted(userId, target.channel_id)
        if (muteState.muted) {
          socket.emit('chat:blocked', { reason: 'muted', octoguard: { i18n_key: 'octoguard.mute.active', expires_at: muteState.expires_at ?? null } })
          return
        }
        let editReport: { rule_name: string; excerpt: string } | undefined
        if (isOctoGuardEnabled()) {
          const og = await runPipeline({ content: sanitized, userCtx: await buildUserCtx(userId), surface: 'chat', channelId: target.channel_id })
          if (og.blocked) {
            socket.emit('chat:blocked', { reason: og.reason ?? 'octoguard', octoguard: { i18n_key: og.i18n_key, event_id: og.event_id } })
            return
          }
          // Retenir une modification du chat n'a pas d'attente : elle est refusée,
          // l'ancien texte reste (jamais publiée sans relecture).
          if (og.hold) {
            socket.emit('chat:blocked', { reason: 'held_edit', octoguard: { i18n_key: 'octoguard.held_edit' } })
            return
          }
          editReport = og.report
        }

        const updated = await ChannelModel.editMessage(messageId, userId, sanitized)
        if (!updated) return
        if (editReport) void fileAutoReport({ targetType: 'message', targetId: messageId, ruleName: editReport.rule_name, excerpt: editReport.excerpt })

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
      if (checkRateLimit(userId, 'chat:delete')) return
      const { messageId } = data ?? {}
      if (!isUuid(messageId)) return

      try {
        // Le message, sa communauté (celle de SON canal, pas n'importe laquelle)
        // et son auteur : la permission et le rang se vérifient là.
        const { rows: msgRows } = await db.query<{ community_id: string; author_id: string }>(
          `SELECT c.community_id, m.author_id
           FROM channel_messages m JOIN channels c ON c.id = m.channel_id
           WHERE m.id = $1`,
          [messageId]
        )
        if (!msgRows[0]) return

        // Supprimer le message d'un autre = moderate_content (socle modérateur
        // + grade), et jamais celui de quelqu'un de rang égal ou supérieur,
        // sauf pour un admin. Son propre message : toujours (deleteMessage le
        // vérifie quand byModerator est faux).
        let byModerator = false
        if (msgRows[0].author_id !== userId) {
          const actor = await getAccess(msgRows[0].community_id, userId)
          if (actor.permissions.includes('moderate_content')) {
            byModerator = actor.rank >= rankOf('admin')
              || outranks(actor, (await getAccess(msgRows[0].community_id, msgRows[0].author_id)).role)
          }
        }
        const { ok, channelId } = await ChannelModel.deleteMessage(messageId, userId, byModerator)
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
      if (checkRateLimit(userId, 'chat:pin')) return
      const { channelId, messageId } = data ?? {}
      if (!isUuid(channelId)) return
      if (messageId !== null && !isUuid(messageId)) return

      try {
        // Rôle scopé à la COMMUNAUTÉ DE CE CANAL, pas admin/owner de n'importe
        // quelle communauté (trouvé en audit le 16/09 : la requête précédente
        // ne joignait jamais sur le canal ciblé).
        // Épingler = moderate_content (socle modérateur + grade), avant le
        // 02/11/2026 réservé aux admins.
        const { rows: chanRows } = await db.query<{ community_id: string }>(
          `SELECT community_id FROM channels WHERE id = $1`, [channelId]
        )
        if (!chanRows[0] || !(await getAccess(chanRows[0].community_id, userId)).permissions.includes('moderate_content')) {
          console.warn(`[chat:pin] Denied for userId=${userId}`)
          return
        }

        // Le message épinglé doit appartenir à CE canal : sans ce contrôle, un
        // admin pouvait épingler dans un canal le contenu d'un message venu
        // d'un tout autre canal (trouvé en audit le 16/09).
        if (messageId !== null) {
          const msgInfo = await ChannelModel.findMessageById(messageId)
          if (!msgInfo || msgInfo.channel_id !== channelId) return
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
      if (checkRateLimit(userId, 'voice:request_snapshot')) return
      await sendVoiceSnapshot(socket, server)
    })

    // ── Voice (WebRTC signaling) ───────────────────────────────────────────────
    registerVoiceHandlers(socket, server)
    // SFU (relais vers nodyx-sfud, DORMANT sans VOICE_SFU_URL — CDC SFU §17)
    registerVoiceSfuHandlers(socket, server)
    // Nodyx Activities : relais temps-réel d'une activité dans le canal vocal
    // (CDC SPECS/NODYX_ACTIVITIES_CDC.md §3). Inerte tant qu'aucune activité
    // n'est montée côté client : ce ne sont que trois `socket.on`.
    registerActivityHandlers(socket, server)

    // ── DM events ─────────────────────────────────────────────────────────────

    // dm:send — envoyer un message dans une conversation
    socket.on('dm:send', async (data: {
      conversationId:   string
      content:          string
      is_encrypted?:    boolean
      encryption_nonce?: string
      reply_to_id?:     string  // Reply / quote (Layer 7)
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

        // Reply : valider que le message cité appartient à la même conv (pas
        // de cross-conversation leaks). Si invalide, on ignore le reply_to_id
        // mais on envoie quand même le message.
        let replyToId: string | null = null
        if (data.reply_to_id && isUuid(data.reply_to_id)) {
          const { rows: [target] } = await db.query<{ id: string }>(
            `SELECT id FROM dm_messages
             WHERE id = $1 AND conversation_id = $2 AND deleted_at IS NULL
             LIMIT 1`,
            [data.reply_to_id, data.conversationId],
          )
          if (target) replyToId = target.id
        }

        const { rows: [msg] } = await db.query<{
          id: string; conversation_id: string; sender_id: string;
          content: string; created_at: Date; is_encrypted: boolean; encryption_nonce: string | null;
          reply_to_id: string | null;
        }>(`
          INSERT INTO dm_messages (conversation_id, sender_id, content, is_encrypted, encryption_nonce, reply_to_id)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, conversation_id, sender_id, content, created_at, is_encrypted, encryption_nonce, reply_to_id
        `, [data.conversationId, userId, clean, isEncrypted, isEncrypted ? data.encryption_nonce : null, replyToId])

        // Si reply, on fetch un snapshot du message cité (auteur + preview)
        // pour le payload : évite au frontend une 2e requête au moment du
        // rendering. Le content est tronqué à 200 chars (preview).
        let replySnapshot: { id: string; sender_username: string; content: string; is_encrypted: boolean } | null = null
        if (replyToId) {
          const { rows: [r] } = await db.query<{
            id: string; sender_username: string; content: string; is_encrypted: boolean
          }>(
            `SELECT m.id, u.username AS sender_username,
                    LEFT(m.content, 200) AS content, m.is_encrypted
             FROM dm_messages m JOIN users u ON u.id = m.sender_id
             WHERE m.id = $1`,
            [replyToId],
          )
          if (r) replySnapshot = r
        }

        const payload = {
          ...msg,
          sender_username:   username,
          sender_avatar:     socket.data.avatar ?? null,
          sender_name_color: socket.data.nameColor ?? null,
          reply_snapshot:    replySnapshot,
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

        // Layer 2 — floating reaction : si la réaction vient d'être AJOUTÉE
        // (pas retirée), on diffuse un float pour que les participants voient
        // l'emoji monter en temps réel. Position aléatoire pour éviter
        // l'effet "colonne" si plusieurs réactions arrivent en rafale.
        if (!existing) {
          const x = 0.2 + Math.random() * 0.6
          for (const p of participants) {
            server.to(`user:${p.user_id}`).emit('dm:float_reaction', {
              emoji,
              username,
              x,
            })
          }
        }
      } catch (err) {
        console.error('[dm:react] Error:', err)
      }
    })

    // dm:read — marquer comme lu et confirmer
    socket.on('dm:read', async (conversationId: string) => {
      if (checkRateLimit(userId, 'dm:read')) return
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
