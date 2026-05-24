// ─── Streamer Hub — profil Twitch enrichi pour le dashboard admin ──────────
// Aggrège helix/users (avatar, vues, type de chaine) + helix/streams (live
// state) + helix/channels/followers (compteur abonnés) en un seul payload.
// Cache Redis 60s pour ne pas hammer Twitch à chaque rechargement de page.

import { redis } from '../../config/database'
import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { twitchProvider } from './providers/twitchProvider'

const TWITCH_HELIX = 'https://api.twitch.tv/helix'
const CACHE_KEY    = 'streamer:twitch:profile'
const CACHE_TTL    = 60   // 60s, équilibre fraicheur / API quota

export interface TwitchProfile {
  user: {
    id:                string
    login:             string
    displayName:       string
    avatarUrl:         string
    profileBannerUrl:  string | null
    description:       string
    broadcasterType:   'partner' | 'affiliate' | ''  // '' = chaine standard
    accountCreatedAt:  string
    totalViewCount:    number | null  // helix retourne 0 si caché, on garde tel quel
  }
  stream: {
    isLive:       boolean
    gameName:     string | null
    title:        string | null
    viewerCount:  number | null
    startedAt:    string | null
    thumbnailUrl: string | null
    language:     string | null
  }
  followers: {
    total: number | null   // null si helix renvoie une erreur de scope
  }
  fetchedAt: string
}

// ── Token freshness (même politique que twitchChatBridge) ───────────────────
async function getValidStreamerAccessToken(): Promise<{ token: string; broadcasterId: string } | null> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return null
  const REFRESH_MARGIN_MS = 5 * 60 * 1000
  if (primary.expiresAt.getTime() - Date.now() < REFRESH_MARGIN_MS) {
    try { await refreshAndPersist({ provider: twitchProvider, rowId: primary.id }) }
    catch { return null }
  }
  const decrypted = await getDecryptedTokens(primary.id)
  if (!decrypted) return null
  return { token: decrypted.accessToken, broadcasterId: primary.externalId }
}

async function helixGetRaw<T>(path: string, accessToken: string): Promise<T | null> {
  const clientId = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!clientId) return null
  try {
    const res = await fetch(`${TWITCH_HELIX}${path}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id':     clientId,
      },
    })
    if (!res.ok) return null
    return await res.json() as T
  } catch {
    return null
  }
}

interface HelixUsersResponse {
  data?: Array<{
    id:                  string
    login:               string
    display_name:        string
    type:                string
    broadcaster_type:    'partner' | 'affiliate' | ''
    description:         string
    profile_image_url:   string
    offline_image_url:   string
    view_count:          number
    created_at:          string
  }>
}

interface HelixStreamsResponse {
  data?: Array<{
    id:            string
    user_id:       string
    user_name:     string
    game_name:     string
    type:          string
    title:         string
    viewer_count:  number
    started_at:    string
    language:      string
    thumbnail_url: string
  }>
}

interface HelixFollowersResponse {
  total?: number
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function getTwitchProfile(options?: { forceRefresh?: boolean }): Promise<TwitchProfile | null> {
  if (!options?.forceRefresh) {
    const cached = await redis.get(CACHE_KEY).catch(() => null)
    if (cached) {
      try { return JSON.parse(cached) as TwitchProfile } catch { /* fallthrough */ }
    }
  }

  const tok = await getValidStreamerAccessToken()
  if (!tok) return null

  const [users, streams, followers] = await Promise.all([
    helixGetRaw<HelixUsersResponse>(`/users?id=${tok.broadcasterId}`, tok.token),
    helixGetRaw<HelixStreamsResponse>(`/streams?user_id=${tok.broadcasterId}`, tok.token),
    helixGetRaw<HelixFollowersResponse>(
      `/channels/followers?broadcaster_id=${tok.broadcasterId}&first=1`,
      tok.token,
    ),
  ])

  const u = users?.data?.[0]
  if (!u) return null

  const s = streams?.data?.[0] ?? null

  const profile: TwitchProfile = {
    user: {
      id:                u.id,
      login:             u.login,
      displayName:       u.display_name,
      avatarUrl:         u.profile_image_url,
      profileBannerUrl:  u.offline_image_url || null,
      description:       u.description ?? '',
      broadcasterType:   u.broadcaster_type ?? '',
      accountCreatedAt:  u.created_at,
      totalViewCount:    typeof u.view_count === 'number' ? u.view_count : null,
    },
    stream: {
      isLive:       !!s,
      gameName:     s?.game_name ?? null,
      title:        s?.title ?? null,
      viewerCount:  s?.viewer_count ?? null,
      startedAt:    s?.started_at ?? null,
      // Twitch retourne une URL avec placeholders {width}x{height}. On résout en 640x360.
      thumbnailUrl: s?.thumbnail_url
        ? s.thumbnail_url.replace('{width}', '640').replace('{height}', '360')
        : null,
      language:     s?.language ?? null,
    },
    followers: {
      total: typeof followers?.total === 'number' ? followers.total : null,
    },
    fetchedAt: new Date().toISOString(),
  }

  await redis.set(CACHE_KEY, JSON.stringify(profile), 'EX', CACHE_TTL).catch(() => {})
  return profile
}

export async function invalidateTwitchProfileCache(): Promise<void> {
  await redis.del(CACHE_KEY).catch(() => {})
}
