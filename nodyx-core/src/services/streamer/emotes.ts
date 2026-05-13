// ─── Streamer Hub — emotes (Twitch natives + BTTV + FFZ + 7TV) ─────────────
//
// À l'inbound chat (channel.chat.message), Twitch nous fournit déjà les
// fragments du message avec les emote IDs Twitch natives. On enrichit avec :
//   - emotes natives Twitch  : URL CDN `static-cdn.jtvnw.net`
//   - BTTV (BetterTTV)       : api.betterttv.net
//   - FFZ (FrankerFaceZ)     : api.frankerfacez.com
//   - 7TV                    : 7tv.io
//
// Cache Redis 24h par channel pour BTTV/FFZ/7TV (les emotes natives Twitch
// sont dans le payload, pas besoin de fetch).
//
// Render côté Nodyx : on remplace les emote patterns par des <img> inline
// avec class CSS `streamer-emote`. Le frontend chat applique un style pour
// que ça s'affiche bien (taille, alignement vertical, etc).

import { redis } from '../../config/database'

const TTL_SECONDS = 24 * 3600
const KEY_PREFIX  = 'streamer:emotes:'

// ── Twitch native emote URL builder ─────────────────────────────────────────

const TWITCH_EMOTE_CDN = 'https://static-cdn.jtvnw.net/emoticons/v2'

function twitchEmoteUrl(emoteId: string, size: '1.0' | '2.0' | '3.0' = '2.0'): string {
  return `${TWITCH_EMOTE_CDN}/${emoteId}/default/dark/${size}`
}

// ── BTTV / FFZ / 7TV fetchers (channel-scoped) ──────────────────────────────

interface ProviderEmote {
  code: string  // ex: 'KEKW', 'pepega'
  url:  string  // CDN URL 2x
}

async function fetchBttv(twitchUserId: string): Promise<ProviderEmote[]> {
  try {
    const res = await fetch(`https://api.betterttv.net/3/cached/users/twitch/${twitchUserId}`)
    if (!res.ok) return []
    const data = await res.json() as {
      channelEmotes?: Array<{ id: string; code: string }>
      sharedEmotes?:  Array<{ id: string; code: string }>
    }
    const all = [...(data.channelEmotes ?? []), ...(data.sharedEmotes ?? [])]
    return all.map(e => ({
      code: e.code,
      url:  `https://cdn.betterttv.net/emote/${e.id}/2x.webp`,
    }))
  } catch { return [] }
}

async function fetchFfz(twitchUserId: string): Promise<ProviderEmote[]> {
  try {
    const res = await fetch(`https://api.frankerfacez.com/v1/room/id/${twitchUserId}`)
    if (!res.ok) return []
    const data = await res.json() as {
      sets?: Record<string, { emoticons?: Array<{ name: string; urls: Record<string, string> }> }>
    }
    const out: ProviderEmote[] = []
    for (const setKey in data.sets ?? {}) {
      const set = data.sets![setKey]
      for (const e of set.emoticons ?? []) {
        const url = e.urls['2'] ?? e.urls['1']
        if (url) out.push({ code: e.name, url: url.startsWith('//') ? `https:${url}` : url })
      }
    }
    return out
  } catch { return [] }
}

async function fetchSeventv(twitchUserId: string): Promise<ProviderEmote[]> {
  try {
    const res = await fetch(`https://7tv.io/v3/users/twitch/${twitchUserId}`)
    if (!res.ok) return []
    const data = await res.json() as {
      emote_set?: { emotes?: Array<{ name: string; data?: { id: string } }> }
    }
    const emotes = data.emote_set?.emotes ?? []
    return emotes.map(e => ({
      code: e.name,
      url:  `https://cdn.7tv.app/emote/${e.data?.id ?? ''}/2x.webp`,
    })).filter(e => e.url.includes('//cdn.7tv.app/emote/'))
  } catch { return [] }
}

// ── Cache + aggregate (par broadcaster Twitch) ─────────────────────────────

interface ChannelEmoteSet {
  byCode: Record<string, string>  // 'KEKW' → CDN URL
  fetchedAt: number               // epoch ms
}

async function loadChannelEmoteSet(twitchUserId: string): Promise<ChannelEmoteSet> {
  const key = KEY_PREFIX + 'ch:' + twitchUserId
  const cached = await redis.get(key).catch(() => null)
  if (cached) {
    try { return JSON.parse(cached) as ChannelEmoteSet } catch { /* fall through */ }
  }

  // Fetch en parallèle les 3 providers tiers (les natives Twitch sont dans
  // le payload, pas besoin de fetch séparé).
  const [bttv, ffz, sevenTv] = await Promise.all([
    fetchBttv(twitchUserId),
    fetchFfz(twitchUserId),
    fetchSeventv(twitchUserId),
  ])

  // Précédence : 7TV > FFZ > BTTV (l'ordre du spread écrase). En pratique
  // les codes peuvent coexister (ex: 'pepega' BTTV ≠ 'pepega' 7TV) mais on
  // ne peut afficher qu'une URL par code → on prend la dernière du spread.
  const byCode: Record<string, string> = {}
  for (const e of [...bttv, ...ffz, ...sevenTv]) byCode[e.code] = e.url

  const set: ChannelEmoteSet = { byCode, fetchedAt: Date.now() }
  await redis.set(key, JSON.stringify(set), 'EX', TTL_SECONDS).catch(() => {})
  return set
}

// ── Render : message Twitch payload → HTML pour Nodyx chat ─────────────────
//
// Twitch fournit `message.fragments` : array d'objets `{ type, text, ?emote, ?cheermote }`
// où `type` est l'un de : 'text', 'cheermote', 'emote', 'mention'.
// On rend chaque fragment dans l'ordre, en remplaçant les emote IDs par des
// <img>. Pour les fragments 'text', on cherche les emotes BTTV/FFZ/7TV par
// match exact mot par mot.

interface RawFragment {
  type:  'text' | 'cheermote' | 'emote' | 'mention'
  text:  string
  emote?:    { id: string; emote_set_id?: string; format?: string[] }
  cheermote?: { prefix?: string; bits?: number }
  mention?:  { user_id?: string; user_login?: string }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderEmoteImg(url: string, code: string): string {
  return `<img src="${escapeHtml(url)}" alt="${escapeHtml(code)}" title="${escapeHtml(code)}" class="streamer-emote" />`
}

// Pour les segments 'text', on split par espaces et on remplace les tokens
// qui matchent un code emote BTTV/FFZ/7TV. Préserve les espaces.
function renderTextWithProviderEmotes(text: string, byCode: Record<string, string>): string {
  if (!text) return ''
  const parts = text.split(/(\s+)/)  // capture les whitespace séparateurs
  return parts.map(part => {
    if (/^\s+$/.test(part)) return part  // whitespace passe-through
    const url = byCode[part]
    return url ? renderEmoteImg(url, part) : escapeHtml(part)
  }).join('')
}

export async function renderChatMessage(args: {
  twitchBroadcasterId: string
  text:                string
  fragments?:          RawFragment[]
}): Promise<string> {
  const { byCode } = await loadChannelEmoteSet(args.twitchBroadcasterId)

  // Si on a les fragments, on les rend en respectant les types Twitch
  // (priorité à l'info structurée). Sinon on tombe en fallback sur le
  // text brut + match BTTV/FFZ/7TV.
  if (Array.isArray(args.fragments) && args.fragments.length > 0) {
    return args.fragments.map(f => {
      if (f.type === 'emote' && f.emote?.id) {
        return renderEmoteImg(twitchEmoteUrl(f.emote.id, '2.0'), f.text || '?')
      }
      // 'text', 'mention', 'cheermote' : on traite le texte avec les
      // providers tiers. On ne fait pas de rendering spécial sur les
      // mentions Twitch ou les cheermotes pour l'instant (Phase futur).
      return renderTextWithProviderEmotes(f.text, byCode)
    }).join('')
  }

  return renderTextWithProviderEmotes(args.text, byCode)
}

// Invalide le cache emotes d'une chaîne (ex: si l'admin re-sync les emotes).
export async function invalidateChannelEmotes(twitchUserId: string): Promise<void> {
  await redis.del(KEY_PREFIX + 'ch:' + twitchUserId).catch(() => {})
}
