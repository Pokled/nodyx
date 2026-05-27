// ─── Streamer Hub — Twitch Clip mp4 URL extraction ──────────────────────────
// L'iframe Twitch refuse l'autoplay cross-origin (style visibility check qui
// fail dans tous les contextes). Pour avoir une vraie autoplay, on extrait
// l'URL mp4 signée via le endpoint GraphQL public utilisé par twitch.tv lui-
// même. Pas documenté officiellement mais stable depuis 5+ ans, utilisé par
// TwitchDownloader, clipr et tous les outils open-source de gestion de clips.
//
// Persisted query VideoAccessToken_Clip → renvoie signature + token + liste
// des qualités mp4 disponibles avec leurs sourceURL. On prend la meilleure
// qualité dispo et on construit l'URL finale signée.
//
// Cache Redis 25 min (la signature est valid ~30 min, on cache un peu en
// dessous pour ne pas servir un URL expiré).

import { redis } from '../../config/database'

const GQL_URL          = 'https://gql.twitch.tv/gql'
// Client-Id public utilisé par twitch.tv en JS côté browser. Pas un secret,
// hardcodé partout dans la communauté tooling Twitch.
const GQL_CLIENT_ID    = 'kimne78kx3ncx6brgo4mv6wki5h1ko'
// SHA256 du persisted query VideoAccessToken_Clip. Twitch persist les queries
// côté serveur pour réduire le payload sur les requêtes répétées.
const PERSISTED_HASH   = '36b89d2507fce29e5ca551df756d27c1cfe079e2609642b4390aa4c35796eb11'

const CACHE_TTL_OK     = 1500           // 25 min (signature valid ~30 min)
const CACHE_TTL_MISS   = 300            // 5 min pour les misses (clip privé, supprimé, etc)
const SENTINEL_NONE    = '__none__'
const CACHE_KEY        = (slug: string) => `streamer:clip:mp4:${slug}`

interface GqlAccessToken {
  signature: string
  value:     string
}
interface GqlQuality {
  frameRate:  number
  quality:    string         // "1080", "720", "480" etc
  sourceURL:  string         // mp4 base URL
}
interface GqlResponse {
  data?: {
    clip?: {
      playbackAccessToken?: GqlAccessToken
      videoQualities?:      GqlQuality[]
    }
  }
}

/**
 * Récupère l'URL mp4 signée pour un clip Twitch via l'endpoint GraphQL
 * public. Retourne null en cas d'erreur (clip inaccessible, GQL down, etc).
 */
export async function getClipMp4Url(clipSlug: string): Promise<string | null> {
  if (!clipSlug) return null
  const key = CACHE_KEY(clipSlug)

  // Cache lookup
  const cached = await redis.get(key).catch(() => null)
  if (cached) return cached === SENTINEL_NONE ? null : cached

  try {
    const res = await fetch(GQL_URL, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Client-Id':    GQL_CLIENT_ID,
      },
      body: JSON.stringify({
        operationName: 'VideoAccessToken_Clip',
        variables:     { slug: clipSlug },
        extensions: {
          persistedQuery: {
            version:    1,
            sha256Hash: PERSISTED_HASH,
          },
        },
      }),
    })

    if (!res.ok) {
      await redis.set(key, SENTINEL_NONE, 'EX', CACHE_TTL_MISS).catch(() => {})
      return null
    }

    const data = await res.json() as GqlResponse
    const clip = data?.data?.clip
    if (!clip) {
      await redis.set(key, SENTINEL_NONE, 'EX', CACHE_TTL_MISS).catch(() => {})
      return null
    }

    const qualities = clip.videoQualities ?? []
    if (qualities.length === 0 || !clip.playbackAccessToken) {
      await redis.set(key, SENTINEL_NONE, 'EX', CACHE_TTL_MISS).catch(() => {})
      return null
    }

    // Trie par quality numérique desc, puis frame rate desc
    const sorted = [...qualities].sort((a, b) => {
      const qa = parseInt(a.quality, 10) || 0
      const qb = parseInt(b.quality, 10) || 0
      if (qa !== qb) return qb - qa
      return b.frameRate - a.frameRate
    })
    const best = sorted[0]

    const { signature, value } = clip.playbackAccessToken
    const finalUrl = `${best.sourceURL}?sig=${encodeURIComponent(signature)}&token=${encodeURIComponent(value)}`

    await redis.set(key, finalUrl, 'EX', CACHE_TTL_OK).catch(() => {})
    return finalUrl
  } catch {
    return null
  }
}
