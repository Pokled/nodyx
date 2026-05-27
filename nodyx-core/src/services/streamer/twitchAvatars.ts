// ─── Streamer Hub — résolution batch des avatars Twitch ────────────────────
// Convertit une liste de twitch user_id en URL d'avatar via Helix /users?id=.
// Cache Redis 24h par user_id (les avatars changent rarement, on évite les
// appels répétés). Utilisé pour enrichir les events avant dispatch socket :
// chaque overlay reçoit l'avatarUrl directement dans le payload, zéro round-trip
// client.
//
// Helix /users accepte jusqu'à 100 ids par appel. On chunk si besoin.

import { redis } from '../../config/database'
import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { twitchProvider } from './providers/twitchProvider'

const TWITCH_HELIX     = 'https://api.twitch.tv/helix'
const CACHE_KEY        = (id: string) => `streamer:avatar:${id}`
const CACHE_TTL_SEC    = 86_400         // 24h, les avatars changent rarement
const HELIX_BATCH_SIZE = 100
// Marqueur "pas d'avatar trouvé" (user supprimé, ban, etc) pour ne pas re-hammer
// helix toutes les minutes. Stocké en cache avec un TTL plus court.
const SENTINEL_NONE    = '__none__'
const CACHE_TTL_NONE   = 3_600          // 1h pour les misses

interface HelixUsersResponse {
  data?: Array<{ id: string; profile_image_url: string }>
}

// ── Token freshness (même politique que les autres services) ───────────────

async function getStreamerToken(): Promise<string | null> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return null
  if (primary.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try { await refreshAndPersist({ provider: twitchProvider, rowId: primary.id }) }
    catch { return null }
  }
  const decrypted = await getDecryptedTokens(primary.id)
  return decrypted?.accessToken ?? null
}

// ── Helix fetch batch ──────────────────────────────────────────────────────

async function fetchHelixBatch(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out

  const token = await getStreamerToken()
  if (!token) return out
  const clientId = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!clientId) return out

  const url = `${TWITCH_HELIX}/users?${ids.map(id => `id=${encodeURIComponent(id)}`).join('&')}`
  try {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Client-Id':     clientId,
      },
    })
    if (!res.ok) return out
    const data = await res.json() as HelixUsersResponse
    for (const u of data?.data ?? []) {
      if (u.id && u.profile_image_url) {
        out.set(u.id, u.profile_image_url)
      }
    }
  } catch {
    // Network error, on retourne ce qu'on a (vide). Les events seront affichés
    // sans avatar, ce qui est acceptable.
  }
  return out
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Résout en lot les avatars Twitch pour un tableau de user_ids.
 * Retourne une Map qui peut être incomplète si helix échoue ou si certains
 * users sont introuvables. Les valeurs absentes signalent "pas d'avatar dispo".
 */
export async function resolveAvatars(userIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  if (userIds.length === 0) return result

  // Déduplique d'abord (même userId peut apparaitre dans plusieurs events)
  const unique = Array.from(new Set(userIds.filter(id => id && id.length > 0)))
  if (unique.length === 0) return result

  // 1. Lookup Redis cache (mget = 1 round-trip pour N keys)
  const cached = await redis.mget(unique.map(CACHE_KEY)).catch(() => null)
  const missing: string[] = []
  for (let i = 0; i < unique.length; i++) {
    const c = cached?.[i]
    if (c === SENTINEL_NONE) continue        // miss confirmé récemment, on skip
    if (c)                   result.set(unique[i], c)
    else                     missing.push(unique[i])
  }
  if (missing.length === 0) return result

  // 2. Fetch helix par chunks de 100
  const fetched = new Map<string, string>()
  for (let i = 0; i < missing.length; i += HELIX_BATCH_SIZE) {
    const chunk = missing.slice(i, i + HELIX_BATCH_SIZE)
    const batch = await fetchHelixBatch(chunk)
    batch.forEach((url, id) => fetched.set(id, url))
  }

  // 3. Cache positive hits + sentinel pour les misses (évite hammer helix)
  const cachePipe = redis.pipeline()
  for (const id of missing) {
    const url = fetched.get(id)
    if (url) {
      cachePipe.set(CACHE_KEY(id), url, 'EX', CACHE_TTL_SEC)
      result.set(id, url)
    } else {
      cachePipe.set(CACHE_KEY(id), SENTINEL_NONE, 'EX', CACHE_TTL_NONE)
    }
  }
  await cachePipe.exec().catch(() => {})

  return result
}

// ── Helper : extrait le user_id pertinent d'un event EventSub ──────────────
// L'avatar à montrer dépend du type d'event :
//   - follow / subscribe / cheer / gift : c'est user_id (le viewer qui agit)
//   - raid : c'est from_broadcaster_user_id (le streamer qui raid)
//   - cheer anonyme : pas d'user_id → pas d'avatar
//   - stream.online / poll / autres : pas d'avatar attendu

export function extractAvatarUserId(eventType: string, event: Record<string, unknown>): string | null {
  switch (eventType) {
    case 'channel.raid':
      return (event.from_broadcaster_user_id as string) ?? null
    case 'channel.cheer':
      if (event.is_anonymous === true) return null
      return (event.user_id as string) ?? null
    case 'channel.follow':
    case 'channel.subscribe':
    case 'channel.subscription.gift':
      return (event.user_id as string) ?? null
    default:
      return null
  }
}

/**
 * Enrichit un payload d'event avec l'avatarUrl correspondant (résolu via cache
 * ou helix). Si le user_id n'est pas extractible ou si helix ne retourne rien,
 * payload.event.avatarUrl reste undefined (le frontend tombe en fallback icon).
 */
export async function enrichEventWithAvatar(
  eventType: string,
  payload:   Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const event = (payload?.event ?? {}) as Record<string, unknown>
  const userId = extractAvatarUserId(eventType, event)
  if (!userId) return payload
  const map = await resolveAvatars([userId])
  const avatarUrl = map.get(userId)
  if (!avatarUrl) return payload
  // Injecte dans payload.event sans muter l'original
  return {
    ...payload,
    event: { ...event, avatarUrl },
  }
}
