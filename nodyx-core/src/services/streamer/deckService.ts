// ─── Streamer Hub — Nodyx Deck service ─────────────────────────────────────
// CRUD sur les decks + exécution d'actions depuis la page mobile. Toutes les
// actions appellent les helpers existants (twitchStreamControl, chatBridge,
// overlay dispatch). Aucune logique métier n'est dupliquée ici.

import { randomBytes } from 'node:crypto'
import { db } from '../../config/database'

// ── Types ──────────────────────────────────────────────────────────────────

export type DeckActionType =
  | 'top_clips'
  | 'vod_marker'
  | 'chat_message'
  | 'trigger_command'
  | 'play_audio'
  | 'stop_audio'
  | 'pause_audio'
  | 'navigate_page'
  | 'playlist_control'
  | 'noop'

// Sous-commandes d'un bouton 'playlist_control'. 'play' optionnellement avec
// playlistId pour switcher l'overlay sur cette playlist en un clic ; sans id,
// reprend simplement la lecture en cours.
export type PlaylistControlCmd =
  | 'play'         // démarre / reprend (si playlistId fourni, switche dessus)
  | 'pause'
  | 'toggle'       // bascule play/pause (le plus utile au quotidien)
  | 'skip'         // suivant
  | 'prev'         // précédent
  | 'stop'         // arrêt + reset cursor
  | 'volume'       // ajuste le volume (delta négatif/positif ou absolu via mode)

export interface DeckButton {
  id:        string
  x:         number
  y:         number
  w:         number
  h:         number
  label:     string
  icon:      string             // emoji ou nom d'icône
  iconScale: number             // 1.0 = normal, 2.0 = double taille, etc. Clamped [1, 3] côté sanitize.
  gradient:  string             // preset name ou format 'hex/hex'
  action:    DeckActionPayload
}

export type DeckActionPayload =
  | { type: 'noop' }
  | { type: 'top_clips';        overlayId: string; period: '7d' | '30d' | 'all'; count: number }
  | { type: 'vod_marker';       description?: string }
  | { type: 'chat_message';     text: string }
  | { type: 'trigger_command';  commandName: string }                    // ex "!discord"
  | { type: 'play_audio';       trackId: string; trackTitle?: string }
  | { type: 'stop_audio' }
  | { type: 'pause_audio' }
  | { type: 'navigate_page';    targetPageId?: string; pageJump?: 'next' | 'prev' | 'home' }
  | {
      type:        'playlist_control'
      cmd:         PlaylistControlCmd
      playlistId?: string          // requis pour 'play' switch, optionnel pour le reste
      volumeMode?: 'delta' | 'absolute'  // pour 'volume' uniquement
      volumeValue?: number               // delta [-1,1] ou absolu [0,1]
    }

export interface DeckPage {
  id:      string
  name:    string
  color?:  string
  buttons: DeckButton[]
}

export interface DeckLayout {
  rows:    number
  cols:    number
  pages:   DeckPage[]
}

export interface Deck {
  id:          string
  token:       string
  label:       string
  layout:      DeckLayout
  createdAt:   Date
  updatedAt:   Date
  revokedAt:   Date | null
  lastSeenAt:  Date | null
}

interface DeckRow {
  id:           string
  token:        string
  label:        string
  layout:       DeckLayout
  created_at:   Date
  updated_at:   Date
  revoked_at:   Date | null
  last_seen_at: Date | null
}

function rowToDeck(r: DeckRow): Deck {
  return {
    id:          r.id,
    token:       r.token,
    label:       r.label,
    layout:      sanitizeLayout(r.layout),
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
    revokedAt:   r.revoked_at,
    lastSeenAt:  r.last_seen_at,
  }
}

// ── Sanitization du layout ─────────────────────────────────────────────────
// Le JSONB peut contenir n'importe quoi (vieille install, migration ratée).
// On force une forme valide à la sortie pour que les consumers n'aient pas
// à check chaque champ.

const VALID_GRADIENT_PRESETS = ['cyber', 'neon', 'inferno', 'forest', 'minimal', 'sunset', 'ocean', 'amber']

function isValidGradient(g: unknown): g is string {
  if (typeof g !== 'string') return false
  if (VALID_GRADIENT_PRESETS.includes(g)) return true
  // Custom : "from/to" en hex (#RRGGBB or RRGGBB)
  return /^#?[a-f0-9]{6}\/#?[a-f0-9]{6}$/i.test(g)
}

function isValidActionType(t: unknown): t is DeckActionType {
  return (
    t === 'top_clips' || t === 'vod_marker' || t === 'chat_message' ||
    t === 'trigger_command' || t === 'play_audio' || t === 'stop_audio' ||
    t === 'pause_audio' || t === 'navigate_page' ||
    t === 'playlist_control' || t === 'noop'
  )
}

function isValidPlaylistCmd(c: unknown): c is PlaylistControlCmd {
  return c === 'play' || c === 'pause' || c === 'toggle' ||
         c === 'skip' || c === 'prev'  || c === 'stop' || c === 'volume'
}

function isValidPageJump(j: unknown): j is 'next' | 'prev' | 'home' {
  return j === 'next' || j === 'prev' || j === 'home'
}

function sanitizeButton(raw: unknown): DeckButton | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const x = Number(r.x), y = Number(r.y)
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) return null

  const w = Math.max(1, Math.min(4, Math.floor(Number(r.w) || 1)))
  const h = Math.max(1, Math.min(4, Math.floor(Number(r.h) || 1)))
  const label    = typeof r.label === 'string'    ? r.label.slice(0, 40)    : ''
  const icon     = typeof r.icon === 'string'     ? r.icon.slice(0, 40)     : '⬜'
  const gradient = isValidGradient(r.gradient)    ? r.gradient              : 'cyber'
  const id       = typeof r.id === 'string'       ? r.id.slice(0, 64)       : randomBytes(8).toString('hex')
  // iconScale : multiplicateur appliqué à la taille par défaut côté frontend.
  // Clamp [1, 3] : en-dessous c'est microscopique, au-dessus ça déborde le bouton.
  const rawScale = Number(r.iconScale)
  const iconScale = Number.isFinite(rawScale) ? Math.max(1, Math.min(3, rawScale)) : 1

  const rawAction = (r.action ?? {}) as Record<string, unknown>
  const actType = isValidActionType(rawAction.type) ? rawAction.type : 'noop'
  let action: DeckActionPayload
  switch (actType) {
    case 'top_clips':
      action = {
        type:      'top_clips',
        overlayId: typeof rawAction.overlayId === 'string' ? rawAction.overlayId : '',
        period:    rawAction.period === '30d' || rawAction.period === 'all' ? rawAction.period : '7d',
        count:     Math.max(1, Math.min(20, Math.floor(Number(rawAction.count) || 5))),
      }
      break
    case 'vod_marker':
      action = {
        type:        'vod_marker',
        description: typeof rawAction.description === 'string' ? rawAction.description.slice(0, 140) : undefined,
      }
      break
    case 'chat_message':
      action = {
        type: 'chat_message',
        text: typeof rawAction.text === 'string' ? rawAction.text.slice(0, 500) : '',
      }
      break
    case 'trigger_command':
      action = {
        type:        'trigger_command',
        commandName: typeof rawAction.commandName === 'string' ? rawAction.commandName.slice(0, 40) : '',
      }
      break
    case 'play_audio':
      action = {
        type:       'play_audio',
        trackId:    typeof rawAction.trackId    === 'string' ? rawAction.trackId.slice(0, 64)     : '',
        trackTitle: typeof rawAction.trackTitle === 'string' ? rawAction.trackTitle.slice(0, 200) : undefined,
      }
      break
    case 'stop_audio':
      action = { type: 'stop_audio' }
      break
    case 'pause_audio':
      action = { type: 'pause_audio' }
      break
    case 'navigate_page': {
      const targetPageId = typeof rawAction.targetPageId === 'string' ? rawAction.targetPageId.slice(0, 64) : undefined
      const pageJump     = isValidPageJump(rawAction.pageJump) ? rawAction.pageJump : undefined
      action = { type: 'navigate_page', targetPageId, pageJump }
      break
    }
    case 'playlist_control': {
      const cmd = isValidPlaylistCmd(rawAction.cmd) ? rawAction.cmd : 'toggle'
      const playlistId = typeof rawAction.playlistId === 'string' && rawAction.playlistId.length > 0
        ? rawAction.playlistId.slice(0, 64)
        : undefined
      const volumeMode = rawAction.volumeMode === 'absolute' ? 'absolute' as const
                       : rawAction.volumeMode === 'delta'    ? 'delta'    as const
                       : undefined
      const rawVol = Number(rawAction.volumeValue)
      const volumeValue = Number.isFinite(rawVol) ? Math.max(-1, Math.min(1, rawVol)) : undefined
      action = { type: 'playlist_control', cmd, playlistId, volumeMode, volumeValue }
      break
    }
    default:
      action = { type: 'noop' }
  }

  return { id, x: Math.floor(x), y: Math.floor(y), w, h, label, icon, iconScale, gradient, action }
}

function defaultPageId(): string { return 'p_' + randomBytes(6).toString('hex') }

function sanitizePage(raw: unknown): DeckPage | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const id    = typeof r.id    === 'string' && r.id.length > 0 ? r.id.slice(0, 64) : defaultPageId()
  const name  = typeof r.name  === 'string' ? r.name.slice(0, 40) : 'Page'
  const color = typeof r.color === 'string' && /^#?[a-f0-9]{6}$/i.test(r.color) ? r.color : undefined
  const rawButtons = Array.isArray(r.buttons) ? r.buttons : []
  const buttons = rawButtons.map(sanitizeButton).filter((b): b is DeckButton => b !== null)
  return { id, name, color, buttons }
}

export function sanitizeLayout(raw: unknown): DeckLayout {
  const r = (raw ?? {}) as Record<string, unknown>
  const rows = Math.max(1, Math.min(8, Math.floor(Number(r.rows) || 3)))
  const cols = Math.max(1, Math.min(8, Math.floor(Number(r.cols) || 4)))

  // Forme V2 : pages[]. Forme V1 (legacy) : buttons[] à plat → on wrap.
  let pages: DeckPage[]
  if (Array.isArray(r.pages) && r.pages.length > 0) {
    pages = r.pages.map(sanitizePage).filter((p): p is DeckPage => p !== null).slice(0, 8)
  } else if (Array.isArray(r.buttons)) {
    const buttons = r.buttons.map(sanitizeButton).filter((b): b is DeckButton => b !== null)
    pages = [{ id: defaultPageId(), name: 'Principal', buttons }]
  } else {
    pages = []
  }
  if (pages.length === 0) {
    pages = [{ id: defaultPageId(), name: 'Principal', buttons: [] }]
  }
  return { rows, cols, pages }
}

// Helper : flatten cross-pages pour le dispatch (find a button by id).
export function findButtonInLayout(layout: DeckLayout, buttonId: string): { page: DeckPage; button: DeckButton } | null {
  for (const page of layout.pages) {
    const button = page.buttons.find(b => b.id === buttonId)
    if (button) return { page, button }
  }
  return null
}

// ── CRUD ───────────────────────────────────────────────────────────────────

const SELECT_COLS = `id, token, label, layout, created_at, updated_at, revoked_at, last_seen_at`

function generateToken(): string {
  // 32 random bytes → 43 chars base64url, exactement comme les overlays
  return randomBytes(32).toString('base64url')
}

export async function listDecks(): Promise<Deck[]> {
  const r = await db.query<DeckRow>(
    `SELECT ${SELECT_COLS} FROM streamer_decks WHERE revoked_at IS NULL ORDER BY created_at ASC`,
  )
  return r.rows.map(rowToDeck)
}

export async function getDeck(id: string): Promise<Deck | null> {
  const r = await db.query<DeckRow>(
    `SELECT ${SELECT_COLS} FROM streamer_decks WHERE id = $1`,
    [id],
  )
  return r.rows[0] ? rowToDeck(r.rows[0]) : null
}

export async function findDeckByToken(token: string): Promise<Deck | null> {
  const r = await db.query<DeckRow>(
    `SELECT ${SELECT_COLS} FROM streamer_decks WHERE token = $1 AND revoked_at IS NULL LIMIT 1`,
    [token],
  )
  return r.rows[0] ? rowToDeck(r.rows[0]) : null
}

export async function createDeck(args: { label: string; createdBy?: string | null }): Promise<Deck> {
  const token = generateToken()
  const r = await db.query<DeckRow>(
    `INSERT INTO streamer_decks (token, label, created_by)
     VALUES ($1, $2, $3)
     RETURNING ${SELECT_COLS}`,
    [token, args.label.slice(0, 100), args.createdBy ?? null],
  )
  return rowToDeck(r.rows[0])
}

export async function updateDeck(id: string, patch: { label?: string; layout?: unknown }): Promise<Deck | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  if (patch.label !== undefined) {
    sets.push(`label = $${idx++}`)
    vals.push(patch.label.slice(0, 100))
  }
  if (patch.layout !== undefined) {
    sets.push(`layout = $${idx++}::jsonb`)
    vals.push(JSON.stringify(sanitizeLayout(patch.layout)))
  }
  if (sets.length === 0) return getDeck(id)
  sets.push(`updated_at = NOW()`)
  vals.push(id)
  const r = await db.query<DeckRow>(
    `UPDATE streamer_decks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${SELECT_COLS}`,
    vals,
  )
  return r.rows[0] ? rowToDeck(r.rows[0]) : null
}

export async function revokeDeck(id: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE streamer_decks SET revoked_at = NOW() WHERE id = $1 AND revoked_at IS NULL`,
    [id],
  )
  return (r.rowCount ?? 0) > 0
}

export async function touchDeckSeen(id: string): Promise<void> {
  await db.query(`UPDATE streamer_decks SET last_seen_at = NOW() WHERE id = $1`, [id]).catch(() => {})
}

// ── Exécution d'actions ────────────────────────────────────────────────────
// Appelé par la route publique `/deck/:token/action`. Toutes les actions sont
// async + best-effort. Le frontend mobile attend juste un ack {ok, message?}
// pour afficher un toast de retour.

export interface ActionResult {
  ok:      boolean
  message: string                  // pour le toast côté mobile
}

export async function executeAction(action: DeckActionPayload, triggeredBy: string): Promise<ActionResult> {
  switch (action.type) {
    case 'noop':
      return { ok: false, message: 'Bouton non configuré' }

    case 'top_clips': {
      const [{ listOwnTopClips }, { getClipMp4Url }, { io }] = await Promise.all([
        import('./twitchClips'),
        import('./twitchClipExtraction'),
        import('../../socket/io'),
      ])
      const clips = await listOwnTopClips(action.period, action.count)
      if (clips.length === 0) return { ok: false, message: 'Aucun clip trouvé pour cette période' }
      if (!io) return { ok: false, message: 'Service socket indisponible' }

      const enriched = await Promise.all(clips.map(async c => ({
        id:           c.id,
        embedUrl:     c.embedUrl,
        title:        c.title,
        creatorName:  c.creatorName,
        duration:     c.duration,
        thumbnailUrl: c.thumbnailUrl,
        viewCount:    c.viewCount,
        mp4Url:       await getClipMp4Url(c.id),
      })))

      io.of('/overlay').to(`overlay:${action.overlayId}`).emit('clips:play', { clips: enriched })
      console.log(`[deck] top_clips → overlay ${action.overlayId}, ${enriched.length} clips (by ${triggeredBy})`)
      return { ok: true, message: `${enriched.length} clips envoyés à l'overlay` }
    }

    case 'vod_marker': {
      const { createMarker } = await import('./twitchStreamControl')
      const description = action.description?.trim() || `Highlight via Deck (${triggeredBy})`
      const r = await createMarker({ description })
      if (!r.ok) {
        if (r.status === 404) return { ok: false, message: 'Pas de stream en cours' }
        if (r.status === 403) return { ok: false, message: 'Scope manquant (channel:manage:broadcast)' }
        return { ok: false, message: `Échec marker (HTTP ${r.status})` }
      }
      const m = Math.floor(r.data.positionSeconds / 60)
      const s = Math.floor(r.data.positionSeconds % 60)
      return { ok: true, message: `Marker placé à ${m}:${s.toString().padStart(2, '0')}` }
    }

    case 'chat_message': {
      const text = action.text.trim()
      if (!text) return { ok: false, message: 'Message vide' }
      const { relayMessageToTwitch } = await import('./twitchChatBridge')
      const r = await relayMessageToTwitch({
        provider:       'twitch',
        authorUsername: 'Nodyx',
        authorUserId:   null,
        text,
      })
      if (!r.ok) {
        if (r.reason === 'stream_offline') return { ok: false, message: 'Stream offline, message non envoyé' }
        return { ok: false, message: `Échec envoi (${r.reason ?? 'inconnu'})` }
      }
      return { ok: true, message: 'Message envoyé' }
    }

    case 'trigger_command': {
      const name = action.commandName.trim().toLowerCase()
      if (!name.startsWith('!')) return { ok: false, message: 'Nom de commande invalide' }
      // On simule le déclenchement en postant directement le résultat de la
      // command custom (les commands hardcoded ont leur propre logique : on
      // les supporte uniquement si le streamer veut leur réponse texte).
      const { findCustomCommand } = await import('./chatCommandsService')
      const custom = await findCustomCommand(name)
      if (!custom) return { ok: false, message: `Commande "${name}" inconnue` }
      const { previewTimer } = await import('./chatTimersService')
      const rendered = (await previewTimer(custom.responseTemplate).catch(() => '')).trim()
      if (!rendered) return { ok: false, message: 'Template vide' }
      const { relayMessageToTwitch } = await import('./twitchChatBridge')
      const r = await relayMessageToTwitch({
        provider:       'twitch',
        authorUsername: 'Nodyx',
        authorUserId:   null,
        text:           rendered,
      })
      if (!r.ok) return { ok: false, message: `Échec relay (${r.reason ?? 'inconnu'})` }
      return { ok: true, message: `Commande ${name} déclenchée` }
    }

    case 'play_audio': {
      if (!action.trackId) return { ok: false, message: 'Aucun son sélectionné' }
      const [{ resolveTrackForPlay }, { io }] = await Promise.all([
        import('./audioLibraryService'),
        import('../../socket/io'),
      ])
      const track = await resolveTrackForPlay(action.trackId)
      if (!track) return { ok: false, message: 'Son introuvable (supprimé ?)' }
      if (!io) return { ok: false, message: 'Service socket indisponible' }
      // L'overlay soundboard du streamer écoute la room `soundboard:<ownerUserId>`.
      // En l'absence d'écouteur (overlay pas encore ouvert), l'émission est un
      // no-op silencieux : ack OK quand même côté Deck pour ne pas frustrer.
      io.of('/overlay').to(`soundboard:${track.ownerUserId}`).emit('audio:play', {
        trackId:      track.id,
        fileUrl:      track.fileUrl,
        mimeType:     track.mimeType,
        title:        track.title,
        artist:       track.artist,
        thumbnailUrl: track.thumbnailUrl,
        durationMs:   track.durationMs,
        volume:       track.volumeDefault,
        fadeInMs:     track.fadeInMs,
        fadeOutMs:    track.fadeOutMs,
        loop:         track.loop,
      })
      // Persiste le "now playing" en Redis pour la page publique /soundboard.
      // Polling toutes les 2s côté viewers, TTL généreux pour qu'un son qui dépasse
      // sa durée annoncée (live mix, mauvais ID3) reste affiché.
      try {
        const { redis } = await import('../../config/database')
        const ttlSec = Math.max(60, Math.min(3600, Math.ceil(((track.durationMs ?? 0) / 1000) + 30)))
        await redis.setex(
          `soundboard:nowplaying:${track.ownerUserId}`,
          ttlSec,
          JSON.stringify({
            trackId:      track.id,
            title:        track.title,
            artist:       track.artist,
            thumbnailUrl: track.thumbnailUrl,
            durationMs:   track.durationMs,
            loop:         track.loop,
            startedAt:    Date.now(),
          }),
        )
      } catch (err) { console.warn('[deck] redis nowplaying set failed', err) }
      console.log(`[deck] play_audio → ${track.title} (by ${triggeredBy})`)
      return { ok: true, message: `▶ ${track.title}` }
    }

    case 'stop_audio': {
      const [{ listStreamers }, { io }, { redis }] = await Promise.all([
        import('./tokenService'),
        import('../../socket/io'),
        import('../../config/database'),
      ])
      const streamers = await listStreamers('twitch').catch(() => [])
      const ownerUserId = streamers[0]?.userId
      if (!ownerUserId || !io) return { ok: true, message: 'Stop envoyé' }
      io.of('/overlay').to(`soundboard:${ownerUserId}`).emit('audio:stop')
      await redis.del(`soundboard:nowplaying:${ownerUserId}`).catch(() => 0)
      return { ok: true, message: 'Son coupé' }
    }

    case 'pause_audio': {
      const [{ listStreamers }, { io }] = await Promise.all([
        import('./tokenService'),
        import('../../socket/io'),
      ])
      const streamers = await listStreamers('twitch').catch(() => [])
      const ownerUserId = streamers[0]?.userId
      if (!ownerUserId || !io) return { ok: true, message: 'Pause envoyée' }
      io.of('/overlay').to(`soundboard:${ownerUserId}`).emit('audio:pause')
      // Pause : on garde la clé Redis intacte (la page publique continue à afficher
      // le son comme "en cours"). Si Preston veut un état "pause" différencié plus
      // tard, on rajoutera un flag dans la payload Redis.
      return { ok: true, message: 'Son en pause' }
    }

    case 'navigate_page': {
      // Navigation pilotée par le mobile (le client intercepte avant d'appeler
      // le backend). Si on arrive ici, c'est un fallback : ack vide.
      return { ok: true, message: '' }
    }

    case 'playlist_control': {
      // Tous les overlays playlist du streamer écoutent la room
      // `playlist:<ownerUserId>`. On émet la commande dessus, l'overlay
      // l'applique localement (play/pause/skip/volume/switch). En l'absence
      // d'overlay connecté, no-op silencieux comme pour audio:play.
      const [{ listStreamers }, { io }] = await Promise.all([
        import('./tokenService'),
        import('../../socket/io'),
      ])
      const streamers = await listStreamers('twitch').catch(() => [])
      const ownerUserId = streamers[0]?.userId
      if (!ownerUserId || !io) return { ok: false, message: 'Stream non lié' }

      io.of('/overlay').to(`playlist:${ownerUserId}`).emit('playlist:control', {
        cmd:         action.cmd,
        playlistId:  action.playlistId,
        volumeMode:  action.volumeMode,
        volumeValue: action.volumeValue,
      })

      const label = action.cmd === 'play'   ? '▶ Playlist'
                  : action.cmd === 'pause'  ? '⏸ Pause'
                  : action.cmd === 'toggle' ? '⏯ Toggle'
                  : action.cmd === 'skip'   ? '⏭ Suivant'
                  : action.cmd === 'prev'   ? '⏮ Précédent'
                  : action.cmd === 'stop'   ? '⏹ Stop'
                  : '🔊 Volume'
      console.log(`[deck] playlist_control ${action.cmd} (by ${triggeredBy})`)
      return { ok: true, message: label }
    }
  }
}
