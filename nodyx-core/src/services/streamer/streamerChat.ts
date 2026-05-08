// ─── Streamer Hub — push events to Nodyx chat (#streamer-events) ────────────
// Quand un event EventSub arrive, on persiste en DB (eventService.recordEvent)
// puis on pousse aussi un message système dans le chat Nodyx pour visibilité.
//
// Phase 1 : l'author_id du message est le user Nodyx qui a OAuth-connecté Twitch
// (le primary streamer côté Nodyx). En Phase futur on pourra créer un compte
// "nodyx-system" dédié pour les messages bot, mais ça apporte de la complexité
// (gérer les bans, les permissions, etc.) — pas Phase 1.
//
// Le channel #streamer-events est auto-créé à la première écriture, idempotent.

import { db } from '../../config/database'
import * as Channel from '../../models/channel'
import { io } from '../../socket/io'
import type { ProviderId } from './providers/_types'

const STREAMER_EVENTS_SLUG = 'streamer-events'
const STREAMER_EVENTS_NAME = 'streamer-events'

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

  // Create
  const channel = await Channel.create({
    community_id: communityId,
    name:         STREAMER_EVENTS_NAME,
    description:  'Activité live de la chaîne (follows, subs, raids, lives, polls). Auto-géré par le Streamer Hub.',
    type:         'text',
  })
  _cachedChannelId = channel.id
  return _cachedChannelId
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
  authorId:   string  // user Nodyx qui a OAuth-connecté (le primary streamer)
}): Promise<void> {
  const text = formatEventMessage(args.eventType, args.payload)
  if (!text) return

  const communityId = await getInstanceCommunityId()
  if (!communityId) return

  const channelId = await ensureStreamerEventsChannel(communityId)
  if (!channelId) return

  const message = await Channel.addMessage({
    channel_id: channelId,
    author_id:  args.authorId,
    content:    text,
  })

  // Broadcaster aux subscribers du channel via Socket.IO (même pattern que
  // le chat normal). Si io n'est pas dispo (boot précoce), on persiste juste,
  // les clients qui ouvrent le channel après verront le message au history load.
  if (io) {
    io.to(`channel:${channelId}`).emit('chat:message', message)
  }
}
