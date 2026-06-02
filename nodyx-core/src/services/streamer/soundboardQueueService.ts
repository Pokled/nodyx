// ─── Streamer Hub — Soundboard queue (Redis-backed FIFO) ────────────────────
// Permet aux viewers d'ajouter des sons à une queue qui se vide auto quand
// chaque son finit (event audio:ended côté overlay → pop next → emit play).
//
// Deux sources d'ajout :
//   1) Page publique /soundboard, bouton "+ Queue" → POST /soundboard/queue
//   2) Commande chat !next sound <nom> (Session D.2) → même service
//
// Garde-fous pour limiter le spam / l'abus :
//   - Toggle admin (clé Redis) : viewers_can_add ON/OFF (default ON)
//   - Rate limit par IP : 1 ajout / 30s
//   - Cap par IP : max 3 sons simultanés en queue depuis la même IP
//   - Dédup global : si le même trackId est déjà en queue, on ignore silencieusement
//
// Persistence : Redis. Si Redis tombe, queue perdue mais le streamer s'en
// remettra (la queue est éphémère par nature). Le keyPrefix 'nodyx:' s'applique
// automatiquement, on n'écrit pas le préfixe dans les helpers.

import { redis } from '../../config/database'
import { getTrack } from './audioLibraryService'

const QUEUE_KEY      = (ownerUserId: string) => `soundboard:queue:${ownerUserId}`
const RATELIMIT_KEY  = (ownerUserId: string, ip: string) => `soundboard:queue:rl:${ownerUserId}:${ip}`
const ENABLED_KEY    = (ownerUserId: string) => `soundboard:queue:enabled:${ownerUserId}`

const RATE_LIMIT_SEC      = 30
const MAX_SIMULT_PER_IP   = 3
const MAX_QUEUE_LENGTH    = 50

export interface QueueEntry {
  trackId:      string
  title:        string                      // dénormalisé pour pouvoir afficher sans re-fetch
  artist:       string | null
  thumbnailUrl: string | null
  durationMs:   number | null
  addedBy:      string                      // 'anonyme' (web) ou '@twitchUsername' (chat)
  addedFromIp:  string                      // jamais renvoyé par l'API publique
  addedAt:      number                      // ms epoch
  source:       'web' | 'chat'
}

// Renvoie une entrée "publique" sans l'IP (utilisée par toutes les API).
function toPublic(e: QueueEntry): Omit<QueueEntry, 'addedFromIp'> {
  const { addedFromIp: _, ...rest } = e
  void _
  return rest
}

// ── Settings : autoriser les viewers à ajouter ──────────────────────────────

export async function isViewerQueueEnabled(ownerUserId: string): Promise<boolean> {
  const v = await redis.get(ENABLED_KEY(ownerUserId)).catch(() => null)
  // Default ON : tant que le streamer ne l'a pas explicitement désactivé, c'est OK.
  if (v === null || v === undefined) return true
  return v === '1'
}

export async function setViewerQueueEnabled(ownerUserId: string, enabled: boolean): Promise<void> {
  await redis.set(ENABLED_KEY(ownerUserId), enabled ? '1' : '0')
}

// ── Read ────────────────────────────────────────────────────────────────────

export async function listQueue(ownerUserId: string): Promise<Array<Omit<QueueEntry, 'addedFromIp'>>> {
  const raws = await redis.lrange(QUEUE_KEY(ownerUserId), 0, -1).catch(() => [] as string[])
  const items: QueueEntry[] = []
  for (const raw of raws) {
    try { items.push(JSON.parse(raw) as QueueEntry) } catch { /* skip corrompu */ }
  }
  return items.map(toPublic)
}

// ── Add ─────────────────────────────────────────────────────────────────────

export type AddResult =
  | { ok: true;  entry: Omit<QueueEntry, 'addedFromIp'> }
  | { ok: false; reason: 'disabled' | 'rate_limit' | 'cap_per_ip' | 'queue_full' | 'duplicate' | 'track_not_found' | 'track_not_public' }

export interface AddInput {
  ownerUserId: string
  trackId:     string
  ip:          string
  addedBy:     string
  source:      'web' | 'chat'
}

export async function addToQueue(input: AddInput): Promise<AddResult> {
  // 1) Toggle "viewers autorisés" ?
  if (!(await isViewerQueueEnabled(input.ownerUserId))) {
    return { ok: false, reason: 'disabled' }
  }

  // 2) Track existe, visibility public, appartient bien à l'owner ?
  const track = await getTrack(input.trackId)
  if (!track || track.ownerUserId !== input.ownerUserId) {
    return { ok: false, reason: 'track_not_found' }
  }
  if (track.visibility !== 'public') {
    return { ok: false, reason: 'track_not_public' }
  }

  // 3) Rate limit par IP : la clé existe = on a posté il y a moins de 30s.
  const rlKey = RATELIMIT_KEY(input.ownerUserId, input.ip)
  const rlSet = await redis.set(rlKey, '1', 'EX', RATE_LIMIT_SEC, 'NX')
  if (rlSet !== 'OK') {
    return { ok: false, reason: 'rate_limit' }
  }

  // 4) Cap simultanés par IP + dédup global + cap queue total : on lit la
  //    queue actuelle. Petite (max 50), donc scan = cheap.
  const raws = await redis.lrange(QUEUE_KEY(input.ownerUserId), 0, -1).catch(() => [] as string[])
  let perIpCount = 0
  for (const raw of raws) {
    try {
      const e = JSON.parse(raw) as QueueEntry
      if (e.trackId === input.trackId)    return { ok: false, reason: 'duplicate' }
      if (e.addedFromIp === input.ip)     perIpCount++
    } catch { /* skip */ }
  }
  if (perIpCount >= MAX_SIMULT_PER_IP) {
    // On libère le rate limit pour pas double-pénaliser (le user a juste atteint son cap, pas spamé).
    await redis.del(rlKey).catch(() => 0)
    return { ok: false, reason: 'cap_per_ip' }
  }
  if (raws.length >= MAX_QUEUE_LENGTH) {
    await redis.del(rlKey).catch(() => 0)
    return { ok: false, reason: 'queue_full' }
  }

  // 5) Push à la fin de la liste (RPUSH = FIFO avec LPOP).
  const entry: QueueEntry = {
    trackId:      track.id,
    title:        track.title,
    artist:       track.artist,
    thumbnailUrl: track.thumbnailUrl,
    durationMs:   track.durationMs,
    addedBy:      input.addedBy.slice(0, 60),
    addedFromIp:  input.ip,
    addedAt:      Date.now(),
    source:       input.source,
  }
  await redis.rpush(QUEUE_KEY(input.ownerUserId), JSON.stringify(entry))
  return { ok: true, entry: toPublic(entry) }
}

// ── Pop (consumer = auto-play du suivant) ───────────────────────────────────

export async function popNext(ownerUserId: string): Promise<Omit<QueueEntry, 'addedFromIp'> | null> {
  const raw = await redis.lpop(QUEUE_KEY(ownerUserId)).catch(() => null)
  if (!raw) return null
  try {
    const entry = JSON.parse(raw) as QueueEntry
    return toPublic(entry)
  } catch {
    return null
  }
}

// ── Admin : remove un item / clear total ────────────────────────────────────

export async function removeFromQueue(ownerUserId: string, trackId: string): Promise<boolean> {
  const raws = await redis.lrange(QUEUE_KEY(ownerUserId), 0, -1).catch(() => [] as string[])
  for (const raw of raws) {
    try {
      const e = JSON.parse(raw) as QueueEntry
      if (e.trackId === trackId) {
        // LREM ne marche que par valeur exacte → on rejoue le payload exact.
        await redis.lrem(QUEUE_KEY(ownerUserId), 1, raw)
        return true
      }
    } catch { /* skip */ }
  }
  return false
}

export async function clearQueue(ownerUserId: string): Promise<number> {
  const len = await redis.llen(QUEUE_KEY(ownerUserId)).catch(() => 0)
  await redis.del(QUEUE_KEY(ownerUserId)).catch(() => 0)
  return len
}

export const QUEUE_LIMITS = {
  rateLimitSec:   RATE_LIMIT_SEC,
  maxSimultPerIp: MAX_SIMULT_PER_IP,
  maxQueueLength: MAX_QUEUE_LENGTH,
}
