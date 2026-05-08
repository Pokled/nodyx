// ─── Streamer Hub — push events to Nodyx chat (#streamer-events) ────────────
// Quand un event EventSub arrive, on persiste en DB (eventService.recordEvent)
// puis on pousse aussi un message système dans le chat Nodyx pour visibilité.
//
// Author = user système "Nodyx" auto-créé à la première écriture. Mot de passe
// impossible (hash bidon), email réservé @nodyx.invalid, donc impossible à
// usurper via login. Membre de la community en role 'member'.
//
// Channel #streamer-events auto-créé à la première écriture (idempotent),
// marqué is_system_managed=TRUE → lecture seule pour les non-mods.

import { db } from '../../config/database'
import * as Channel from '../../models/channel'
import { io } from '../../socket/io'
import type { ProviderId } from './providers/_types'

const STREAMER_EVENTS_SLUG = 'streamer-events'
const STREAMER_EVENTS_NAME = 'streamer-events'

const SYSTEM_USERNAME       = 'Nodyx'
const SYSTEM_EMAIL          = 'system@nodyx.invalid'
// bcrypt hash invalide intentionnellement, jamais matchable côté login.
// Le check password fait par bcrypt.compare retournera toujours false.
const SYSTEM_PASSWORD_HASH  = '!system-no-login-' + 'x'.repeat(40)

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
  if (existing.rows[0]) {
    userId = existing.rows[0].id
  } else {
    const created = await db.query<{ id: string }>(
      `INSERT INTO users (username, email, password)
       VALUES ($1, $2, $3)
       ON CONFLICT (username) DO NOTHING
       RETURNING id`,
      [SYSTEM_USERNAME, SYSTEM_EMAIL, SYSTEM_PASSWORD_HASH],
    )
    if (created.rows[0]) {
      userId = created.rows[0].id
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

async function getInstanceCommunityId(): Promise<string | null> {
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
