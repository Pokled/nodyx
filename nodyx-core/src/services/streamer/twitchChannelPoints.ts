// ─── Streamer Hub — Channel Points Custom Rewards ──────────────────────────
// Wrappers helix pour gérer les rewards Twitch depuis Nodyx. Restriction
// importante côté Twitch : la chaine DOIT être Affiliate ou Partner, sinon
// Helix renvoie 403 même avec les bons scopes. Le frontend gate ça via
// broadcasterType du profil pour éviter de cliquer pour rien.
//
// Scope user requis : channel:manage:redemptions (à demander à l'OAuth,
// déjà inclus dans STREAMER_HUB_SCOPES depuis 2026-05-27).

import { findPrimaryStreamer, getDecryptedTokens, refreshAndPersist } from './tokenService'
import { twitchProvider } from './providers/twitchProvider'

const TWITCH_HELIX     = 'https://api.twitch.tv/helix'
const REDEMPTIONS_SCOPE = 'channel:manage:redemptions'

// ── Token + scope check ────────────────────────────────────────────────────

interface TokenCtx {
  token:         string
  broadcasterId: string
  scopes:        string[]
}

async function getStreamerCtx(): Promise<TokenCtx | null> {
  const primary = await findPrimaryStreamer('twitch')
  if (!primary) return null
  if (primary.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    try { await refreshAndPersist({ provider: twitchProvider, rowId: primary.id }) }
    catch { return null }
  }
  const decrypted = await getDecryptedTokens(primary.id)
  if (!decrypted) return null
  return {
    token:         decrypted.accessToken,
    broadcasterId: primary.externalId,
    scopes:        primary.scopes ?? [],
  }
}

export async function hasRedemptionsScope(): Promise<boolean> {
  const ctx = await getStreamerCtx()
  return !!ctx && ctx.scopes.includes(REDEMPTIONS_SCOPE)
}

// ── Helix fetch helper ──────────────────────────────────────────────────────

type HelixResult<T> =
  | { ok: true;  data: T }
  | { ok: false; status: number; reason: string }

async function helix<T>(
  path: string,
  init: { method: 'GET' | 'POST' | 'PATCH' | 'DELETE'; token: string; body?: unknown },
): Promise<HelixResult<T>> {
  const cid = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!cid) return { ok: false, status: 500, reason: 'no_client_id' }
  try {
    const res = await fetch(`${TWITCH_HELIX}${path}`, {
      method:  init.method,
      headers: {
        'Authorization': `Bearer ${init.token}`,
        'Client-Id':     cid,
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    })
    if (res.status === 204) return { ok: true, data: undefined as unknown as T }
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, status: res.status, reason: text.slice(0, 280) || `http_${res.status}` }
    }
    if (init.method === 'PATCH' || init.method === 'DELETE') {
      const txt = await res.text().catch(() => '')
      if (!txt) return { ok: true, data: undefined as unknown as T }
      try { return { ok: true, data: JSON.parse(txt) as T } } catch { return { ok: true, data: undefined as unknown as T } }
    }
    const data = await res.json() as T
    return { ok: true, data }
  } catch (err) {
    return { ok: false, status: 0, reason: (err as Error).message.slice(0, 200) }
  }
}

// ── Types publics ───────────────────────────────────────────────────────────

export interface CustomReward {
  id:                                 string
  title:                              string
  prompt:                             string
  cost:                               number
  isEnabled:                          boolean
  isPaused:                           boolean
  isInStock:                          boolean
  isUserInputRequired:                boolean
  shouldRedemptionsSkipRequestQueue:  boolean
  backgroundColor:                    string                       // hex format #RRGGBB
  cooldownSeconds:                    number | null                // global_cooldown_setting.global_cooldown_seconds
  isGlobalCooldownEnabled:            boolean
  maxPerStreamCount:                  number | null
  isMaxPerStreamEnabled:              boolean
  maxPerUserPerStreamCount:           number | null
  isMaxPerUserPerStreamEnabled:       boolean
  imageUrls: {
    url_1x: string | null
    url_2x: string | null
    url_4x: string | null
  }
}

interface HelixRewardRaw {
  id:                                  string
  title:                               string
  prompt:                              string
  cost:                                number
  is_enabled:                          boolean
  is_paused:                           boolean
  is_in_stock:                         boolean
  is_user_input_required:              boolean
  should_redemptions_skip_request_queue: boolean
  background_color:                    string
  global_cooldown_setting:             { is_enabled: boolean; global_cooldown_seconds: number }
  max_per_stream_setting:              { is_enabled: boolean; max_per_stream: number }
  max_per_user_per_stream_setting:     { is_enabled: boolean; max_per_user_per_stream: number }
  image:                               { url_1x: string; url_2x: string; url_4x: string } | null
  default_image:                       { url_1x: string; url_2x: string; url_4x: string }
}

interface HelixRewardsResponse { data?: HelixRewardRaw[] }

function mapReward(r: HelixRewardRaw): CustomReward {
  const img = r.image ?? r.default_image
  return {
    id:                                 r.id,
    title:                              r.title,
    prompt:                             r.prompt ?? '',
    cost:                               r.cost,
    isEnabled:                          r.is_enabled,
    isPaused:                           r.is_paused,
    isInStock:                          r.is_in_stock,
    isUserInputRequired:                r.is_user_input_required,
    shouldRedemptionsSkipRequestQueue:  r.should_redemptions_skip_request_queue,
    backgroundColor:                    r.background_color,
    cooldownSeconds:                    r.global_cooldown_setting?.is_enabled ? r.global_cooldown_setting.global_cooldown_seconds : null,
    isGlobalCooldownEnabled:            r.global_cooldown_setting?.is_enabled ?? false,
    maxPerStreamCount:                  r.max_per_stream_setting?.is_enabled ? r.max_per_stream_setting.max_per_stream : null,
    isMaxPerStreamEnabled:              r.max_per_stream_setting?.is_enabled ?? false,
    maxPerUserPerStreamCount:           r.max_per_user_per_stream_setting?.is_enabled ? r.max_per_user_per_stream_setting.max_per_user_per_stream : null,
    isMaxPerUserPerStreamEnabled:       r.max_per_user_per_stream_setting?.is_enabled ?? false,
    imageUrls: {
      url_1x: img?.url_1x ?? null,
      url_2x: img?.url_2x ?? null,
      url_4x: img?.url_4x ?? null,
    },
  }
}

// ── CRUD ────────────────────────────────────────────────────────────────────

// IMPORTANT : Helix GET /custom_rewards retourne SEULEMENT les rewards créés
// par l'application courante (cf clientId) par défaut. Pour avoir ceux créés
// par le streamer via le dashboard Twitch, il faut passer only_manageable_rewards=true
// SAUF que Twitch ne nous laisse jamais éditer ceux d'autres apps. On lit
// donc juste les nôtres, ce qui est conforme à l'attente : on gère ce qu'on
// a créé via Nodyx.

export async function listRewards(opts?: { onlyManageable?: boolean }): Promise<HelixResult<CustomReward[]>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }

  const manageable = opts?.onlyManageable !== false ? '&only_manageable_rewards=true' : ''
  const r = await helix<HelixRewardsResponse>(
    `/channel_points/custom_rewards?broadcaster_id=${ctx.broadcasterId}${manageable}`,
    { method: 'GET', token: ctx.token },
  )
  if (!r.ok) return r
  return { ok: true, data: (r.data.data ?? []).map(mapReward) }
}

export interface CreateRewardArgs {
  title:                   string                  // requis, ≤ 45 chars
  cost:                    number                  // requis, > 0
  prompt?:                 string                  // ≤ 200 chars
  isEnabled?:              boolean                 // default true
  backgroundColor?:        string                  // hex #RRGGBB
  isUserInputRequired?:    boolean
  cooldownSeconds?:        number                  // 1-604800 si défini
  maxPerStream?:           number                  // 1-N si défini
  maxPerUserPerStream?:    number
}

export async function createReward(args: CreateRewardArgs): Promise<HelixResult<CustomReward>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(REDEMPTIONS_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_redemptions' }
  if (!args.title || args.title.trim().length === 0) return { ok: false, status: 400, reason: 'title_required' }
  if (typeof args.cost !== 'number' || args.cost < 1) return { ok: false, status: 400, reason: 'cost_must_be_positive' }

  const body: Record<string, unknown> = {
    title: args.title.slice(0, 45),
    cost:  Math.floor(args.cost),
  }
  if (args.prompt)              body.prompt = args.prompt.slice(0, 200)
  if (args.isEnabled === false) body.is_enabled = false
  if (args.backgroundColor && /^#[0-9a-fA-F]{6}$/.test(args.backgroundColor)) body.background_color = args.backgroundColor
  if (args.isUserInputRequired) body.is_user_input_required = true
  if (typeof args.cooldownSeconds === 'number' && args.cooldownSeconds >= 1) {
    body.is_global_cooldown_enabled = true
    body.global_cooldown_seconds    = Math.min(604800, Math.floor(args.cooldownSeconds))
  }
  if (typeof args.maxPerStream === 'number' && args.maxPerStream >= 1) {
    body.is_max_per_stream_enabled = true
    body.max_per_stream            = Math.floor(args.maxPerStream)
  }
  if (typeof args.maxPerUserPerStream === 'number' && args.maxPerUserPerStream >= 1) {
    body.is_max_per_user_per_stream_enabled = true
    body.max_per_user_per_stream            = Math.floor(args.maxPerUserPerStream)
  }

  const r = await helix<HelixRewardsResponse>(
    `/channel_points/custom_rewards?broadcaster_id=${ctx.broadcasterId}`,
    { method: 'POST', token: ctx.token, body },
  )
  if (!r.ok) return r
  const reward = r.data.data?.[0]
  if (!reward) return { ok: false, status: 502, reason: 'empty_response' }
  return { ok: true, data: mapReward(reward) }
}

export interface UpdateRewardArgs {
  rewardId:              string
  title?:                string
  prompt?:               string
  cost?:                 number
  isEnabled?:            boolean
  isPaused?:             boolean
  backgroundColor?:      string
  cooldownSeconds?:      number | null     // null pour disable, sinon nouvelle valeur
  maxPerStream?:         number | null
  maxPerUserPerStream?:  number | null
}

export async function updateReward(args: UpdateRewardArgs): Promise<HelixResult<CustomReward>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(REDEMPTIONS_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_redemptions' }

  const body: Record<string, unknown> = {}
  if (typeof args.title  === 'string') body.title  = args.title.slice(0, 45)
  if (typeof args.prompt === 'string') body.prompt = args.prompt.slice(0, 200)
  if (typeof args.cost   === 'number') body.cost   = Math.max(1, Math.floor(args.cost))
  if (typeof args.isEnabled === 'boolean') body.is_enabled = args.isEnabled
  if (typeof args.isPaused  === 'boolean') body.is_paused  = args.isPaused
  if (args.backgroundColor && /^#[0-9a-fA-F]{6}$/.test(args.backgroundColor)) body.background_color = args.backgroundColor
  if (args.cooldownSeconds === null) {
    body.is_global_cooldown_enabled = false
  } else if (typeof args.cooldownSeconds === 'number') {
    body.is_global_cooldown_enabled = true
    body.global_cooldown_seconds    = Math.min(604800, Math.max(1, Math.floor(args.cooldownSeconds)))
  }
  if (args.maxPerStream === null) {
    body.is_max_per_stream_enabled = false
  } else if (typeof args.maxPerStream === 'number') {
    body.is_max_per_stream_enabled = true
    body.max_per_stream            = Math.max(1, Math.floor(args.maxPerStream))
  }
  if (args.maxPerUserPerStream === null) {
    body.is_max_per_user_per_stream_enabled = false
  } else if (typeof args.maxPerUserPerStream === 'number') {
    body.is_max_per_user_per_stream_enabled = true
    body.max_per_user_per_stream            = Math.max(1, Math.floor(args.maxPerUserPerStream))
  }
  if (Object.keys(body).length === 0) return { ok: false, status: 400, reason: 'empty_patch' }

  const r = await helix<HelixRewardsResponse>(
    `/channel_points/custom_rewards?broadcaster_id=${ctx.broadcasterId}&id=${encodeURIComponent(args.rewardId)}`,
    { method: 'PATCH', token: ctx.token, body },
  )
  if (!r.ok) return r
  const reward = r.data.data?.[0]
  if (!reward) return { ok: false, status: 502, reason: 'empty_response' }
  return { ok: true, data: mapReward(reward) }
}

export async function deleteReward(rewardId: string): Promise<HelixResult<void>> {
  const ctx = await getStreamerCtx()
  if (!ctx) return { ok: false, status: 401, reason: 'no_streamer' }
  if (!ctx.scopes.includes(REDEMPTIONS_SCOPE)) return { ok: false, status: 403, reason: 'missing_scope_manage_redemptions' }

  return helix<void>(
    `/channel_points/custom_rewards?broadcaster_id=${ctx.broadcasterId}&id=${encodeURIComponent(rewardId)}`,
    { method: 'DELETE', token: ctx.token },
  )
}
