// ─── Streamer Hub — push events to Nodyx chat (#streamer-events / #twitch-chat) ─
// Deux channels auto-gérés par le Streamer Hub :
//
//   #streamer-events : lecture seule sauf mods (is_system_managed=TRUE).
//     Reçoit les notifications follow/sub/raid/cheer/live/poll formatées,
//     publiées par le user système "Nodyx".
//
//   #twitch-chat : read-write (Phase 2). Mirror du chat Twitch.
//     - Inbound : chaque message Twitch (channel.chat.message) est posté ici
//       par un user "Twitch ghost" auto-créé pour l'auteur Twitch (ou par le
//       user Nodyx du viewer s'il a Flow A).
//     - Outbound : chaque message écrit ici par un membre Nodyx est relayé
//       vers le chat Twitch via Helix POST /chat/messages (cf brique 2.4).

import { db } from '../../config/database'
import * as Channel from '../../models/channel'
import { io } from '../../socket/io'
import { renderChatMessage } from './emotes'
import { renderBadges } from './badges'
import type { ProviderId } from './providers/_types'

const STREAMER_EVENTS_SLUG = 'streamer-events'
const STREAMER_EVENTS_NAME = 'streamer-events'

const TWITCH_CHAT_SLUG     = 'twitch-chat'
const TWITCH_CHAT_NAME     = 'twitch-chat'

const SYSTEM_USERNAME       = 'Nodyx'
const SYSTEM_EMAIL          = 'system@nodyx.invalid'
// bcrypt hash invalide intentionnellement, jamais matchable côté login.
// Le check password fait par bcrypt.compare retournera toujours false.
const SYSTEM_PASSWORD_HASH  = '!system-no-login-' + 'x'.repeat(40)
const SYSTEM_AVATAR_URL     = '/icons/icon-192.png'   // logo Nodyx servi par le frontend
const SYSTEM_DISPLAY_NAME   = 'Nodyx'
const SYSTEM_NAME_COLOR     = '#7c3aed'               // purple Nodyx, cohérent MODULE_DISPLAY
const SYSTEM_NAME_GLOW      = '#9146ff'               // glow Twitch purple (subtile)
const SYSTEM_BIO            = 'Bot officiel du Streamer Hub. Publie automatiquement les follows, subs, raids, lives et polls de la chaîne. Ne peut pas être contacté.'

// ── Channel auto-create / find ──────────────────────────────────────────────

let _cachedChannelId: string | null = null

export async function ensureStreamerEventsChannel(communityId: string): Promise<string | null> {
  if (_cachedChannelId) return _cachedChannelId

  // Look up existing channel by community + slug
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM channels WHERE community_id = $1 AND slug = $2 AND type = 'text' LIMIT 1`,
    [communityId, STREAMER_EVENTS_SLUG],
  )
  if (rows[0]) {
    _cachedChannelId = rows[0].id
    return _cachedChannelId
  }

  // Create + mark as system-managed (lecture seule pour les non-mods,
  // cf migration 080). Channel.create n'expose pas is_system_managed dans
  // son interface publique, donc on UPDATE juste après l'INSERT.
  const channel = await Channel.create({
    community_id: communityId,
    name:         STREAMER_EVENTS_NAME,
    description:  'Activité live de la chaîne (follows, subs, raids, lives, polls). Auto-géré par le Streamer Hub.',
    type:         'text',
  })
  await db.query(
    `UPDATE channels SET is_system_managed = TRUE WHERE id = $1`,
    [channel.id],
  )
  _cachedChannelId = channel.id
  return _cachedChannelId
}

// ── #twitch-chat : channel mirror Twitch (read-write) ───────────────────────

let _cachedTwitchChatChannelId: string | null = null

export async function ensureTwitchChatChannel(communityId: string): Promise<string | null> {
  if (_cachedTwitchChatChannelId) return _cachedTwitchChatChannelId

  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM channels WHERE community_id = $1 AND slug = $2 AND type = 'text' LIMIT 1`,
    [communityId, TWITCH_CHAT_SLUG],
  )
  if (rows[0]) {
    _cachedTwitchChatChannelId = rows[0].id
    return _cachedTwitchChatChannelId
  }

  // Channel read-write par défaut (PAS is_system_managed) : les membres
  // peuvent écrire pour répondre dans le chat Twitch via le bridge outbound.
  const channel = await Channel.create({
    community_id: communityId,
    name:         TWITCH_CHAT_NAME,
    description:  'Mirror du chat Twitch en temps réel. Écris ici pour répondre dans le chat de la chaîne. Les messages partent en moins d\'1 s.',
    type:         'text',
  })
  _cachedTwitchChatChannelId = channel.id
  return _cachedTwitchChatChannelId
}

// ── System user "Nodyx" — author des messages auto-générés ──────────────────

let _cachedSystemUserId: string | null = null

export async function ensureSystemUser(communityId: string): Promise<string | null> {
  if (_cachedSystemUserId) return _cachedSystemUserId

  // 1. Find or create the user
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE username = $1 LIMIT 1`,
    [SYSTEM_USERNAME],
  )
  let userId: string
  let justCreated = false
  if (existing.rows[0]) {
    userId = existing.rows[0].id
  } else {
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (username, email, password, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [SYSTEM_USERNAME, SYSTEM_EMAIL, SYSTEM_PASSWORD_HASH, SYSTEM_AVATAR_URL],
    )
    if (created.rows[0]) {
      userId = created.rows[0].id
      justCreated = true
    } else {
      // Race : un autre thread l'a créé entre nos 2 queries — re-find
      const refind = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE username = $1 LIMIT 1`,
        [SYSTEM_USERNAME],
      )
      if (!refind.rows[0]) return null
      userId = refind.rows[0].id
    }
  }

  // 1.b. À la création seulement, set le profil custom (display_name, color,
  // glow, bio). On n'overwrite PAS si l'admin a déjà customisé le profil
  // après-coup (idempotent uniquement à la 1ère écriture).
  if (justCreated) {
    await db.query(
      `UPDATE user_profiles
       SET display_name        = $2,
           name_color          = $3,
           name_glow           = $4,
           name_glow_intensity = 8,
           bio                 = $5
       WHERE user_id = $1`,
      [userId, SYSTEM_DISPLAY_NAME, SYSTEM_NAME_COLOR, SYSTEM_NAME_GLOW, SYSTEM_BIO],
    )
  }

  // 2. Ensure community membership (idempotent, role member)
  await db.query(
    `INSERT INTO community_members (community_id, user_id, role)
     VALUES ($1, $2, 'member')
     ON CONFLICT (community_id, user_id) DO NOTHING`,
    [communityId, userId],
  )

  _cachedSystemUserId = userId
  return userId
}

// ── Resolve community id (NODYX_COMMUNITY_SLUG env or first community) ──────

let _cachedCommunityId: string | null = null

export async function getInstanceCommunityId(): Promise<string | null> {
  if (_cachedCommunityId) return _cachedCommunityId
  const slug = process.env.NODYX_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query<{ id: string }>(
      `SELECT id FROM communities WHERE slug = $1`,
      [slug],
    )
    if (rows[0]) { _cachedCommunityId = rows[0].id; return _cachedCommunityId }
  }
  const { rows } = await db.query<{ id: string }>(
    `SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`,
  )
  if (rows[0]) _cachedCommunityId = rows[0].id
  return _cachedCommunityId
}

// ── Format a human-readable message per event type ──────────────────────────

interface RawEventBody {
  event?: Record<string, unknown>
  subscription?: { type?: string }
}

export function formatEventMessage(eventType: string, payload: unknown): string | null {
  const body = payload as RawEventBody
  const evt  = body?.event ?? {}
  const get  = (k: string): string | undefined => {
    const v = (evt as Record<string, unknown>)[k]
    return typeof v === 'string' ? v : undefined
  }
  const num = (k: string): number | undefined => {
    const v = (evt as Record<string, unknown>)[k]
    return typeof v === 'number' ? v : undefined
  }

  switch (eventType) {
    case 'channel.follow': {
      const name = get('user_name') ?? get('user_login') ?? 'quelqu\'un'
      return `➕ **${name}** a follow la chaîne`
    }
    case 'channel.subscribe': {
      const name = get('user_name') ?? get('user_login') ?? 'quelqu\'un'
      const tier = get('tier') ?? '1000'
      const tierLabel = tier === '3000' ? 'Tier 3' : tier === '2000' ? 'Tier 2' : 'Tier 1'
      const isGift   = (evt as Record<string, unknown>).is_gift === true
      return isGift
        ? `🎁 **${name}** a reçu un sub ${tierLabel}`
        : `⭐ **${name}** a sub ${tierLabel}`
    }
    case 'channel.subscription.gift': {
      const name  = get('user_name') ?? get('user_login') ?? 'quelqu\'un'
      const total = num('total') ?? 1
      const tier  = get('tier') ?? '1000'
      const tierLabel = tier === '3000' ? 'Tier 3' : tier === '2000' ? 'Tier 2' : 'Tier 1'
      return `🎁 **${name}** a offert **${total} sub${total > 1 ? 's' : ''}** ${tierLabel} à la chaîne !`
    }
    case 'channel.cheer': {
      const name = (evt as Record<string, unknown>).is_anonymous === true
        ? 'Anonyme'
        : get('user_name') ?? get('user_login') ?? 'quelqu\'un'
      const bits = num('bits') ?? 0
      const message = get('message')
      const suffix  = message ? ` — *${message.slice(0, 100)}*` : ''
      return `💎 **${name}** a cheer **${bits} bits**${suffix}`
    }
    case 'channel.raid': {
      const fromName = get('from_broadcaster_user_name') ?? get('from_broadcaster_user_login') ?? 'un raider'
      const viewers  = num('viewers') ?? 0
      return `🚀 **${fromName}** arrive avec **${viewers} viewer${viewers > 1 ? 's' : ''}** !`
    }
    case 'channel.poll.begin': {
      const title = get('title') ?? 'un poll'
      return `📊 Poll lancé : **${title}**`
    }
    case 'channel.poll.end': {
      const title  = get('title') ?? 'le poll'
      const status = get('status') ?? 'completed'
      return `🏁 Poll terminé (${status}) : **${title}**`
    }
    case 'stream.online': {
      const startedAt = get('started_at')
      const fmt = startedAt ? new Date(startedAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : ''
      return `🎬 **Stream démarré**${fmt ? ` à ${fmt}` : ''}`
    }
    case 'stream.offline': {
      return `⏹️ Stream terminé`
    }
    default:
      return null  // Pas de message pour les events qu'on ne sait pas formater
  }
}

// ── Twitch ghost users : 1 user Nodyx par chatter Twitch non lié ───────────
// Pour qu'un message Twitch s'affiche avec son author, on a besoin d'un user
// Nodyx avec un username/avatar correspondants. Si le viewer a fait Flow A,
// on le retrouve via users.twitch_id. Sinon on auto-crée un user ghost :
//   - username = 'tw_<login>' (préfixe protège des collisions avec vrais users)
//   - email = 'ghost-<twitch_id>@twitch.invalid'
//   - password = hash impossible → login impossible
//   - twitch_id = NULL pour ne pas bloquer un futur Flow A du même viewer
//   - is_ghost = TRUE pour les distinguer dans l'UI/admin
//
// Cache mémoire : Map<twitch_user_id, nodyx_user_id>. Cap à 5000 entries pour
// ne pas exploser sur un stream géant.

const GHOST_PASSWORD_HASH    = '!ghost-no-login-' + 'x'.repeat(40)
const GHOST_NAME_COLOR       = '#9146ff'   // purple Twitch — distingue des vrais users
const GHOST_USERNAME_PREFIX  = 'tw_'
const GHOST_CACHE_MAX        = 5000

const _ghostCache = new Map<string, string>()  // twitchUserId → nodyxUserId

interface ResolveAuthorResult {
  userId:     string
  isGhost:    boolean
}

async function resolveTwitchAuthor(args: {
  communityId:     string
  twitchUserId:    string
  twitchUserLogin: string
  displayName:     string
  avatarUrl?:      string | null
}): Promise<ResolveAuthorResult | null> {
  // 1. Viewer lié via Flow A ?
  const linked = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE twitch_id = $1 LIMIT 1`,
    [args.twitchUserId],
  )
  if (linked.rows[0]) return { userId: linked.rows[0].id, isGhost: false }

  // 2. Ghost déjà cached ?
  const cached = _ghostCache.get(args.twitchUserId)
  if (cached) return { userId: cached, isGhost: true }

  // 3. Ghost déjà en DB ?
  const ghostUsername = `${GHOST_USERNAME_PREFIX}${args.twitchUserLogin}`
  const existing = await db.query<{ id: string }>(
    `SELECT id FROM users WHERE username = $1 LIMIT 1`,
    [ghostUsername],
  )
  let userId: string
  let justCreated = false
  if (existing.rows[0]) {
    userId = existing.rows[0].id
  } else {
    const ghostEmail = `ghost-${args.twitchUserId}@twitch.invalid`
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (username, email, password, avatar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [ghostUsername, ghostEmail, GHOST_PASSWORD_HASH, args.avatarUrl ?? null],
    )
    if (created.rows[0]) {
      userId = created.rows[0].id
      justCreated = true
    } else {
      // Race : refind
      const refind = await db.query<{ id: string }>(
        `SELECT id FROM users WHERE username = $1 LIMIT 1`,
        [ghostUsername],
      )
      if (!refind.rows[0]) return null
      userId = refind.rows[0].id
    }
  }

  // 4. À la création, set le profil ghost (display_name, name_color, bio)
  if (justCreated) {
    await db.query(
      `UPDATE user_profiles
       SET display_name = $2, name_color = $3, bio = $4
       WHERE user_id = $1`,
      [
        userId,
        args.displayName,
        GHOST_NAME_COLOR,
        `Compte ghost auto-créé pour le chatter Twitch @${args.twitchUserLogin}. Pour devenir un vrai membre, lie ton compte Twitch dans Paramètres > Comptes liés.`,
      ],
    )
    // Membership community en role 'member' (idempotent)
    await db.query(
      `INSERT INTO community_members (community_id, user_id, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT (community_id, user_id) DO NOTHING`,
      [args.communityId, userId],
    )
  }

  // 5. Cache (cap LRU-ish : on clear si trop gros)
  if (_ghostCache.size >= GHOST_CACHE_MAX) _ghostCache.clear()
  _ghostCache.set(args.twitchUserId, userId)
  return { userId, isGhost: true }
}

// ── Inbound : push un message Twitch chat dans #twitch-chat ────────────────

interface TwitchFragment {
  type:       'text' | 'cheermote' | 'emote' | 'mention'
  text:       string
  emote?:     { id: string; emote_set_id?: string; format?: string[] }
  cheermote?: { prefix?: string; bits?: number }
  mention?:   { user_id?: string; user_login?: string }
}

export async function pushTwitchChatMessage(args: {
  provider:      ProviderId  // toujours 'twitch' actuellement
  payload:       unknown
}): Promise<void> {
  const body = args.payload as {
    event?: {
      broadcaster_user_id?: string
      chatter_user_id?:     string
      chatter_user_login?:  string
      chatter_user_name?:   string
      message?:             { text?: string; fragments?: TwitchFragment[] }
      message_id?:          string
      badges?:              Array<{ set_id: string; id: string; info?: string }>
      color?:               string
    }
  }
  const evt = body?.event
  if (!evt?.chatter_user_id || !evt.chatter_user_login || !evt.broadcaster_user_id || !evt.message?.text) return

  const communityId = await getInstanceCommunityId()
  if (!communityId) return

  const channelId = await ensureTwitchChatChannel(communityId)
  if (!channelId) return

  const author = await resolveTwitchAuthor({
    communityId,
    twitchUserId:    evt.chatter_user_id,
    twitchUserLogin: evt.chatter_user_login,
    displayName:     evt.chatter_user_name ?? evt.chatter_user_login,
  })
  if (!author) return

  // Brique 2.5 : render le message en HTML avec emotes natives Twitch
  // (depuis fragments) + BTTV/FFZ/7TV (depuis cache Redis 24h).
  // Brique 2.6 : préfixe par les badges Twitch (sub, mod, vip, premium, etc).
  // Si le rendering échoue, on tombe en fallback sur le texte brut escaped.
  let content: string
  try {
    const [badgesHtml, bodyHtml] = await Promise.all([
      renderBadges({
        badges:        evt.badges,
        broadcasterId: evt.broadcaster_user_id,
      }),
      renderChatMessage({
        twitchBroadcasterId: evt.broadcaster_user_id,
        text:                evt.message.text,
        fragments:           evt.message.fragments,
      }),
    ])
    content = badgesHtml + bodyHtml
  } catch (err) {
    console.error('[streamerChat] renderChatMessage failed, falling back to plain text', err)
    content = evt.message.text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
  content = content.slice(0, 10000)  // limite avant addMessage

  const message = await Channel.addMessage({
    channel_id: channelId,
    author_id:  author.userId,
    content,
  })

  if (io) {
    io.to(`channel:${channelId}`).emit('chat:message', message)
  }
}

// ── Push event to chat ──────────────────────────────────────────────────────

export async function pushEventToChat(args: {
  provider:   ProviderId
  eventType:  string
  payload:    unknown
}): Promise<void> {
  const text = formatEventMessage(args.eventType, args.payload)
  if (!text) return

  const communityId = await getInstanceCommunityId()
  if (!communityId) return

  const [channelId, systemUserId] = await Promise.all([
    ensureStreamerEventsChannel(communityId),
    ensureSystemUser(communityId),
  ])
  if (!channelId || !systemUserId) return

  const message = await Channel.addMessage({
    channel_id: channelId,
    author_id:  systemUserId,
    content:    text,
  })

  // Broadcaster aux subscribers du channel via Socket.IO (même pattern que
  // le chat normal). Si io n'est pas dispo (boot précoce), on persiste juste,
  // les clients qui ouvrent le channel après verront le message au history load.
  if (io) {
    io.to(`channel:${channelId}`).emit('chat:message', message)
  }
}
