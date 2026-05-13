// ─── Streamer Hub — badges Twitch (sub, mod, vip, premium, etc.) ────────────
//
// Spec §6.3. À chaque message channel.chat.message, le payload contient un
// array `badges` du type `[{ set_id: 'subscriber', id: '0', info: '12' }, ...]`.
// On résout chaque tuple (set_id, id) en URL CDN via Helix :
//   - GET /chat/badges/global             → badges globaux Twitch
//   - GET /chat/badges/channel?broadcaster_id=X → badges custom de la chaîne
//
// Précédence : channel override global (le badge subscriber d'un channel a
// souvent une image custom). Caches Redis :
//   - streamer:badges:global  (TTL 7 jours, mute change rarement)
//   - streamer:badges:ch:<id> (TTL 24h, peut changer si streamer update)
//   - streamer:badges:app_token (TTL 50 jours, App Token Twitch dure 60j)

import { redis } from '../../config/database'
import { twitchProvider } from './providers/twitchProvider'

const HELIX_BASE      = 'https://api.twitch.tv/helix'
const GLOBAL_KEY      = 'streamer:badges:global'
const CHANNEL_PREFIX  = 'streamer:badges:ch:'
const APP_TOKEN_KEY   = 'streamer:badges:app_token'

const GLOBAL_TTL_SECONDS  = 7  * 24 * 3600
const CHANNEL_TTL_SECONDS = 24 * 3600
const APP_TOKEN_TTL_S     = 50 * 24 * 3600

interface BadgeVersion {
  id:           string
  image_url_1x: string
  image_url_2x: string
  image_url_4x: string
  title:        string
}

interface BadgeSet {
  set_id:   string
  versions: BadgeVersion[]
}

interface HelixBadgesResponse {
  data?: BadgeSet[]
}

// Map clé "set_id:version_id" → { url, title }
export type BadgeMap = Record<string, { url: string; title: string }>

function flatten(sets: BadgeSet[]): BadgeMap {
  const out: BadgeMap = {}
  for (const s of sets) {
    for (const v of s.versions ?? []) {
      out[`${s.set_id}:${v.id}`] = { url: v.image_url_2x, title: v.title }
    }
  }
  return out
}

// ── App Access Token (cache Redis 50j) ──────────────────────────────────────

async function getCachedAppToken(): Promise<string | null> {
  try {
    const cached = await redis.get(APP_TOKEN_KEY)
    if (cached) return cached
    const tok = await twitchProvider.getAppAccessToken()
    await redis.set(APP_TOKEN_KEY, tok, 'EX', APP_TOKEN_TTL_S)
    return tok
  } catch (err) {
    console.error('[streamer/badges] getAppAccessToken failed', err)
    return null
  }
}

// ── Fetch helpers ───────────────────────────────────────────────────────────

async function fetchBadges(url: string, appToken: string): Promise<BadgeSet[]> {
  const clientId = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!clientId) return []
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${appToken}`,
        'Client-Id':     clientId,
      },
    })
    if (!res.ok) return []
    const data = await res.json() as HelixBadgesResponse
    return data.data ?? []
  } catch {
    return []
  }
}

async function loadGlobalBadges(appToken: string): Promise<BadgeMap> {
  const cached = await redis.get(GLOBAL_KEY).catch(() => null)
  if (cached) {
    try { return JSON.parse(cached) as BadgeMap } catch { /* fall through */ }
  }
  const sets = await fetchBadges(`${HELIX_BASE}/chat/badges/global`, appToken)
  const map  = flatten(sets)
  await redis.set(GLOBAL_KEY, JSON.stringify(map), 'EX', GLOBAL_TTL_SECONDS).catch(() => {})
  return map
}

async function loadChannelBadges(appToken: string, broadcasterId: string): Promise<BadgeMap> {
  const key = CHANNEL_PREFIX + broadcasterId
  const cached = await redis.get(key).catch(() => null)
  if (cached) {
    try { return JSON.parse(cached) as BadgeMap } catch { /* fall through */ }
  }
  const sets = await fetchBadges(
    `${HELIX_BASE}/chat/badges/channel?broadcaster_id=${broadcasterId}`,
    appToken,
  )
  const map = flatten(sets)
  await redis.set(key, JSON.stringify(map), 'EX', CHANNEL_TTL_SECONDS).catch(() => {})
  return map
}

// ── Public API ──────────────────────────────────────────────────────────────

interface PayloadBadge {
  set_id: string
  id:     string
  info?:  string  // ex: '12' pour 12 mois de sub
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function renderBadges(args: {
  badges:        PayloadBadge[] | undefined
  broadcasterId: string
}): Promise<string> {
  if (!args.badges || args.badges.length === 0) return ''
  const appToken = await getCachedAppToken()
  if (!appToken) return ''

  const [global, channel] = await Promise.all([
    loadGlobalBadges(appToken),
    loadChannelBadges(appToken, args.broadcasterId),
  ])

  // Channel override global (badges custom > globaux)
  const merged: BadgeMap = { ...global, ...channel }

  const imgs: string[] = []
  for (const b of args.badges) {
    const key = `${b.set_id}:${b.id}`
    const found = merged[key]
    if (!found) continue
    const title = b.info ? `${found.title} (${b.info})` : found.title
    imgs.push(
      `<img class="streamer-badge" src="${escapeHtml(found.url)}" alt="${escapeHtml(found.title)}" title="${escapeHtml(title)}" />`,
    )
  }
  if (imgs.length === 0) return ''
  return `<span class="twitch-badges">${imgs.join('')}</span> `
}

export async function invalidateBadgesCache(broadcasterId?: string): Promise<void> {
  if (broadcasterId) {
    await redis.del(CHANNEL_PREFIX + broadcasterId).catch(() => {})
  } else {
    await redis.del(GLOBAL_KEY).catch(() => {})
  }
}

export const _testInternals = { GLOBAL_KEY, CHANNEL_PREFIX, APP_TOKEN_KEY, flatten }
