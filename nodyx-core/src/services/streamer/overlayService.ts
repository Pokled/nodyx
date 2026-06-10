// ─── Streamer Hub — overlays service (CRUD + dispatch) ─────────────────────
// Gère le cycle de vie des overlays OBS : création (token random unguessable),
// listing admin, revoke, lookup par token (auth socket).
//
// Note : un overlay = 1 token = 1 URL à coller dans OBS. Le streamer peut en
// avoir plusieurs du même type (ex: 2 alert box, une pour follow/sub et une
// pour raid uniquement) avec des configs différentes.

import { randomBytes } from 'node:crypto'
import { db } from '../../config/database'

export type OverlayType =
  | 'alert_box'
  | 'goal_bar'
  | 'stream_timer'
  | 'event_ticker'
  | 'leaderboard'
  | 'clips_player'
  | 'soundboard'
  | 'playlist'

const VALID_TYPES: ReadonlySet<OverlayType> = new Set([
  'alert_box', 'goal_bar', 'stream_timer', 'event_ticker', 'leaderboard', 'clips_player', 'soundboard', 'playlist',
])

// ── Soundboard ──────────────────────────────────────────────────────────────
// L'overlay reçoit les events audio:play/stop/pause via la room
// soundboard:<ownerUserId> (cf socket/overlay.ts + deckService dispatch).
// Config minimale en V1 : position de l'OSD vignette/titre, master volume.

export type SoundboardOsdPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'hidden'
export const SOUNDBOARD_OSD_POSITIONS: readonly SoundboardOsdPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'hidden']

export interface SoundboardOverlayConfig {
  osdPosition:   SoundboardOsdPosition   // emplacement de la carte OSD ("hidden" = pas d'OSD)
  osdDurationMs: number                  // 0 = persistant tant que le son joue, sinon durée d'affichage min
  masterVolume:  number                  // multiplicateur global appliqué au volume par-piste, 0-1.5
}

const DEFAULT_SOUNDBOARD_CONFIG: SoundboardOverlayConfig = {
  osdPosition:   'bottom-right',
  osdDurationMs: 0,
  masterVolume:  1.0,
}

export function sanitizeSoundboardConfig(raw: unknown): SoundboardOverlayConfig {
  const r = (raw ?? {}) as Record<string, unknown>
  const pos = SOUNDBOARD_OSD_POSITIONS.includes(r.osdPosition as SoundboardOsdPosition)
    ? r.osdPosition as SoundboardOsdPosition
    : DEFAULT_SOUNDBOARD_CONFIG.osdPosition
  const dur = Number.isFinite(Number(r.osdDurationMs))
    ? Math.max(0, Math.min(30_000, Math.floor(Number(r.osdDurationMs))))
    : DEFAULT_SOUNDBOARD_CONFIG.osdDurationMs
  const vol = Number.isFinite(Number(r.masterVolume))
    ? Math.max(0, Math.min(1.5, Number(r.masterVolume)))
    : DEFAULT_SOUNDBOARD_CONFIG.masterVolume
  return { osdPosition: pos, osdDurationMs: dur, masterVolume: vol }
}

export function isOverlayType(s: string): s is OverlayType {
  return VALID_TYPES.has(s as OverlayType)
}

// ── Config schemas par type d'overlay ───────────────────────────────────────
// Stocké dans streamer_overlays.config (JSONB) avec une shape par type. La
// page overlay frontend lit cette config au boot et l'applique (theme, durée,
// templates de message). Le streamer édite via PATCH /overlays/:id.

export type AlertBoxTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'holographic' | 'minimal' | 'custom'
export const ALERT_BOX_THEMES: readonly AlertBoxTheme[] = ['cyber', 'soft', 'retro', 'neon', 'holographic', 'minimal', 'custom']

// ── Goal Bar ────────────────────────────────────────────────────────────────
// Barre de progression vers un objectif. 4 modes :
//   - followers_total   : helix /channels/followers → .total
//   - subs_session      : COUNT des channel.subscribe + subscription.gift
//                          depuis le started_at de la session ouverte
//   - bits_session      : SUM des bits de channel.cheer depuis la session
//   - custom            : current saisi manuellement par l'admin (cfg.customCurrent)

export type GoalType = 'followers_total' | 'subs_session' | 'bits_session' | 'custom'
export const GOAL_TYPES: readonly GoalType[] = ['followers_total', 'subs_session', 'bits_session', 'custom']

export type GoalBarTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
export const GOAL_BAR_THEMES: readonly GoalBarTheme[] = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom']

export interface GoalBarCustomTheme {
  bgColor?:     string | null
  textColor?:   string | null
  barBgColor?:  string | null    // arrière-plan de la barre vide
}

export interface GoalBarConfig {
  goalType:      GoalType
  target:        number
  label:         string        // ex: "100 followers ce mois", "Subathon goal"
  accentColor:   string        // hex, fallback cyan
  customCurrent: number        // utilisé uniquement si goalType === 'custom'
  theme:         GoalBarTheme
  customTheme?:  GoalBarCustomTheme
}

export const DEFAULT_GOAL_BAR_CONFIG: GoalBarConfig = {
  goalType:      'followers_total',
  target:        100,
  label:         'Objectif followers',
  accentColor:   '#06b6d4',
  customCurrent: 0,
  theme:         'cyber',
}

export function withGoalBarDefaults(raw: Record<string, unknown> | undefined): GoalBarConfig {
  const cfg = raw ?? {}
  const goalType = GOAL_TYPES.includes(cfg.goalType as GoalType)
    ? cfg.goalType as GoalType
    : DEFAULT_GOAL_BAR_CONFIG.goalType
  const target = typeof cfg.target === 'number' && cfg.target > 0
    ? Math.min(1_000_000_000, cfg.target)
    : DEFAULT_GOAL_BAR_CONFIG.target
  const label = typeof cfg.label === 'string' && cfg.label.trim().length > 0
    ? cfg.label.slice(0, 80)
    : DEFAULT_GOAL_BAR_CONFIG.label
  const accentColor = typeof cfg.accentColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(cfg.accentColor)
    ? cfg.accentColor
    : DEFAULT_GOAL_BAR_CONFIG.accentColor
  const customCurrent = typeof cfg.customCurrent === 'number' && cfg.customCurrent >= 0
    ? cfg.customCurrent
    : DEFAULT_GOAL_BAR_CONFIG.customCurrent
  const theme = GOAL_BAR_THEMES.includes(cfg.theme as GoalBarTheme)
    ? cfg.theme as GoalBarTheme
    : DEFAULT_GOAL_BAR_CONFIG.theme
  const ct = (cfg.customTheme ?? {}) as Partial<GoalBarCustomTheme>
  const customTheme: GoalBarCustomTheme = {
    bgColor:    typeof ct.bgColor    === 'string' ? ct.bgColor    : null,
    textColor:  typeof ct.textColor  === 'string' ? ct.textColor  : null,
    barBgColor: typeof ct.barBgColor === 'string' ? ct.barBgColor : null,
  }
  return { goalType, target, label, accentColor, customCurrent, theme, customTheme }
}

// ── Leaderboard ─────────────────────────────────────────────────────────────
// Podium top 3 + liste rang 4-10. 4 catégories : subs, bits, raids, chatteurs.
// 4 périodes : session ouverte, 7 jours, 30 jours, all-time.

export type LeaderboardCategory = 'subs' | 'bits' | 'raids' | 'chatters'
export const LEADERBOARD_CATEGORIES: readonly LeaderboardCategory[] = ['subs', 'bits', 'raids', 'chatters']

export type LeaderboardPeriod = 'session' | '7d' | '30d' | 'all'
export const LEADERBOARD_PERIODS: readonly LeaderboardPeriod[] = ['session', '7d', '30d', 'all']

export type LeaderboardTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
export const LEADERBOARD_THEMES: readonly LeaderboardTheme[] = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom']

export interface LeaderboardCustomTheme {
  bgColor?:   string | null
  textColor?: string | null
}

export interface LeaderboardConfig {
  category:        LeaderboardCategory
  period:          LeaderboardPeriod
  topN:            number              // 5 à 10, longueur de la liste sous le podium
  showOnOffline:   boolean             // mode "récap" : auto-trigger fullscreen quand stream.offline
  theme:           LeaderboardTheme
  customTheme?:    LeaderboardCustomTheme
}

export const DEFAULT_LEADERBOARD_CONFIG: LeaderboardConfig = {
  category:      'subs',
  period:        '7d',
  topN:          10,
  showOnOffline: true,
  theme:         'cyber',
}

export function withLeaderboardDefaults(raw: Record<string, unknown> | undefined): LeaderboardConfig {
  const cfg = raw ?? {}
  const category = LEADERBOARD_CATEGORIES.includes(cfg.category as LeaderboardCategory)
    ? cfg.category as LeaderboardCategory
    : DEFAULT_LEADERBOARD_CONFIG.category
  const period = LEADERBOARD_PERIODS.includes(cfg.period as LeaderboardPeriod)
    ? cfg.period as LeaderboardPeriod
    : DEFAULT_LEADERBOARD_CONFIG.period
  const topN = typeof cfg.topN === 'number' && cfg.topN >= 3 && cfg.topN <= 20
    ? Math.floor(cfg.topN)
    : DEFAULT_LEADERBOARD_CONFIG.topN
  const theme = LEADERBOARD_THEMES.includes(cfg.theme as LeaderboardTheme)
    ? cfg.theme as LeaderboardTheme
    : DEFAULT_LEADERBOARD_CONFIG.theme
  const ct = (cfg.customTheme ?? {}) as Partial<LeaderboardCustomTheme>
  const customTheme: LeaderboardCustomTheme = {
    bgColor:   typeof ct.bgColor   === 'string' ? ct.bgColor   : null,
    textColor: typeof ct.textColor === 'string' ? ct.textColor : null,
  }
  return {
    category,
    period,
    topN,
    showOnOffline: typeof cfg.showOnOffline === 'boolean' ? cfg.showOnOffline : DEFAULT_LEADERBOARD_CONFIG.showOnOffline,
    theme,
    customTheme,
  }
}

// ── Stream Timer ───────────────────────────────────────────────────────────
// Pillule chrono live. 6 thèmes pour cohérence avec les autres overlays,
// 5 positions (4 coins + centre), 3 formats d'affichage.

export type TimerTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
export const TIMER_THEMES: readonly TimerTheme[] = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom']

export type TimerPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'
export const TIMER_POSITIONS: readonly TimerPosition[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center']

export type TimerFormat = 'auto' | 'mm_ss' | 'h_mm_ss'
export const TIMER_FORMATS: readonly TimerFormat[] = ['auto', 'mm_ss', 'h_mm_ss']

export interface TimerCustomTheme {
  bgColor?:     string | null
  textColor?:   string | null
  accentColor?: string | null              // couleur du point pulsant
}

export interface TimerConfig {
  theme:        TimerTheme
  position:     TimerPosition
  format:       TimerFormat                // auto = h:mm:ss au-delà d'1h, mm:ss en dessous
  customTheme?: TimerCustomTheme
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  theme:    'cyber',
  position: 'top-left',
  format:   'auto',
}

export function withTimerDefaults(raw: Record<string, unknown> | undefined): TimerConfig {
  const cfg = raw ?? {}
  const theme = TIMER_THEMES.includes(cfg.theme as TimerTheme)
    ? cfg.theme as TimerTheme
    : DEFAULT_TIMER_CONFIG.theme
  const position = TIMER_POSITIONS.includes(cfg.position as TimerPosition)
    ? cfg.position as TimerPosition
    : DEFAULT_TIMER_CONFIG.position
  const format = TIMER_FORMATS.includes(cfg.format as TimerFormat)
    ? cfg.format as TimerFormat
    : DEFAULT_TIMER_CONFIG.format
  const ct = (cfg.customTheme ?? {}) as Partial<TimerCustomTheme>
  const customTheme: TimerCustomTheme = {
    bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
    textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
    accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
  }
  return { theme, position, format, customTheme }
}

// ── Event Ticker ───────────────────────────────────────────────────────────
// Bandeau défilant en bas d'écran qui montre les derniers events sous forme
// de tokens colorés (couleurs par event type, cohérent avec alert box).

export type TickerTheme = 'cyber' | 'soft' | 'retro' | 'neon' | 'minimal' | 'custom'
export const TICKER_THEMES: readonly TickerTheme[] = ['cyber', 'soft', 'retro', 'neon', 'minimal', 'custom']

export type TickerPeriod = 'recent' | 'session' | '24h'
export const TICKER_PERIODS: readonly TickerPeriod[] = ['recent', 'session', '24h']

export type TickerEventKey =
  | 'channel.follow'
  | 'channel.subscribe'
  | 'channel.subscription.gift'
  | 'channel.cheer'
  | 'channel.raid'

const ALL_TICKER_EVENTS: readonly TickerEventKey[] = [
  'channel.follow', 'channel.subscribe', 'channel.subscription.gift',
  'channel.cheer', 'channel.raid',
]

export interface TickerCustomTheme {
  bgColor?:   string | null
  textColor?: string | null
}

export interface TickerConfig {
  enabledEvents:  TickerEventKey[]    // sous-ensemble de ALL_TICKER_EVENTS
  period:         TickerPeriod        // recent (50 derniers) | session (depuis open) | 24h
  speedSeconds:   number              // 30-120, durée pour qu'un token traverse l'écran
  weighted:       boolean             // raid/cheer/gift restent plus longtemps que follow
  combo:          boolean             // 3+ events similaires en <10s deviennent un token BURST
  theme:          TickerTheme
  customTheme?:   TickerCustomTheme
}

export const DEFAULT_TICKER_CONFIG: TickerConfig = {
  enabledEvents: [...ALL_TICKER_EVENTS],
  period:        'recent',
  speedSeconds:  60,
  weighted:      true,
  combo:         true,
  theme:         'cyber',
}

export function withTickerDefaults(raw: Record<string, unknown> | undefined): TickerConfig {
  const cfg = raw ?? {}
  const enabledEventsRaw = Array.isArray(cfg.enabledEvents) ? cfg.enabledEvents as unknown[] : null
  const enabledEvents = enabledEventsRaw
    ? enabledEventsRaw.filter((e): e is TickerEventKey => ALL_TICKER_EVENTS.includes(e as TickerEventKey))
    : [...DEFAULT_TICKER_CONFIG.enabledEvents]
  const period = TICKER_PERIODS.includes(cfg.period as TickerPeriod)
    ? cfg.period as TickerPeriod : DEFAULT_TICKER_CONFIG.period
  const speedSeconds = typeof cfg.speedSeconds === 'number' && cfg.speedSeconds >= 20 && cfg.speedSeconds <= 180
    ? cfg.speedSeconds : DEFAULT_TICKER_CONFIG.speedSeconds
  const theme = TICKER_THEMES.includes(cfg.theme as TickerTheme)
    ? cfg.theme as TickerTheme : DEFAULT_TICKER_CONFIG.theme
  const ct = (cfg.customTheme ?? {}) as Partial<TickerCustomTheme>
  const customTheme: TickerCustomTheme = {
    bgColor:   typeof ct.bgColor   === 'string' ? ct.bgColor   : null,
    textColor: typeof ct.textColor === 'string' ? ct.textColor : null,
  }
  return {
    enabledEvents,
    period,
    speedSeconds,
    weighted: typeof cfg.weighted === 'boolean' ? cfg.weighted : DEFAULT_TICKER_CONFIG.weighted,
    combo:    typeof cfg.combo    === 'boolean' ? cfg.combo    : DEFAULT_TICKER_CONFIG.combo,
    theme,
    customTheme,
  }
}

export type AlertPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'center'
export const ALERT_POSITIONS: readonly AlertPosition[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'center']

export type AlertAnimation = 'slide-right' | 'slide-left' | 'slide-top' | 'slide-bottom' | 'scale' | 'bounce' | 'fade'
export const ALERT_ANIMATIONS: readonly AlertAnimation[] = ['slide-right', 'slide-left', 'slide-top', 'slide-bottom', 'scale', 'bounce', 'fade']

export type AlertEventKey =
  | 'channel.follow'
  | 'channel.subscribe'
  | 'channel.subscription.gift'
  | 'channel.cheer'
  | 'channel.raid'

export interface AlertEventCfg {
  enabled:   boolean
  template:  string                // "{user_name} a follow !" — variables {var_name}
  iconUrl?:  string | null         // optionnel pour le thème custom : icône à gauche du message
  soundUrl?: string | null         // URL d'un mp3/wav à jouer quand l'event arrive
}

export interface AlertBoxCustomTheme {
  bgImageUrl?:    string | null   // image de fond de la card (https://...)
  bgColor?:       string | null   // fallback / overlay si bgImage absent (#0f172a etc)
  accentColor?:   string | null   // surcharge la couleur d'accent (sinon palette par event)
  textColor?:     string | null   // couleur du message principal
}

export interface AlertBoxConfig {
  theme:        AlertBoxTheme
  position:     AlertPosition
  animation:    AlertAnimation
  durationMs:   number
  soundVolume:  number                  // 0 à 1, appliqué à tous les sons
  events:       Record<AlertEventKey, AlertEventCfg>
  customTheme?: AlertBoxCustomTheme    // uniquement utilisé si theme === 'custom'
}

// Config par défaut quand on crée un alert_box ou si l'admin n'a rien
// personnalisé. Tu peux toujours éditer ensuite via le panneau admin.
export const DEFAULT_ALERT_BOX_CONFIG: AlertBoxConfig = {
  theme:       'cyber',
  position:    'top-right',
  animation:   'slide-right',
  durationMs:  5000,
  soundVolume: 0.6,
  events: {
    'channel.follow':            { enabled: true, template: '{user_name} a follow !' },
    'channel.subscribe':         { enabled: true, template: '{user_name} s\'abonne (tier {tier}) !' },
    'channel.subscription.gift': { enabled: true, template: '{user_name} offre {total} sub{total_plural} !' },
    'channel.cheer':             { enabled: true, template: '{user_name} envoie {bits} bits !' },
    'channel.raid':              { enabled: true, template: 'Raid de {from_broadcaster_user_name} avec {viewers} viewers !' },
  },
}

// Merge config DB partielle avec les defaults (l'admin peut ne configurer
// que la moitié des events ; le reste tombe sur les defaults plutôt que
// de casser la page overlay).
export function withAlertBoxDefaults(raw: Record<string, unknown> | undefined): AlertBoxConfig {
  const cfg = raw ?? {}
  const events = { ...DEFAULT_ALERT_BOX_CONFIG.events }
  const rawEvents = (cfg.events ?? {}) as Record<string, Partial<AlertEventCfg>>
  for (const k of Object.keys(events) as AlertEventKey[]) {
    const incoming = rawEvents[k]
    if (incoming && typeof incoming === 'object') {
      events[k] = {
        enabled:  typeof incoming.enabled  === 'boolean' ? incoming.enabled  : events[k].enabled,
        template: typeof incoming.template === 'string'  ? incoming.template : events[k].template,
        iconUrl:  typeof incoming.iconUrl  === 'string'  ? incoming.iconUrl  : null,
        soundUrl: typeof incoming.soundUrl === 'string'  ? incoming.soundUrl : null,
      }
    }
  }
  const theme = ALERT_BOX_THEMES.includes(cfg.theme as AlertBoxTheme)
    ? cfg.theme as AlertBoxTheme
    : DEFAULT_ALERT_BOX_CONFIG.theme
  const position = ALERT_POSITIONS.includes(cfg.position as AlertPosition)
    ? cfg.position as AlertPosition
    : DEFAULT_ALERT_BOX_CONFIG.position
  const animation = ALERT_ANIMATIONS.includes(cfg.animation as AlertAnimation)
    ? cfg.animation as AlertAnimation
    : DEFAULT_ALERT_BOX_CONFIG.animation
  const durationMs = typeof cfg.durationMs === 'number' && cfg.durationMs >= 1000 && cfg.durationMs <= 30000
    ? cfg.durationMs
    : DEFAULT_ALERT_BOX_CONFIG.durationMs
  const soundVolume = typeof cfg.soundVolume === 'number' && cfg.soundVolume >= 0 && cfg.soundVolume <= 1
    ? cfg.soundVolume
    : DEFAULT_ALERT_BOX_CONFIG.soundVolume
  const ct = (cfg.customTheme ?? {}) as Partial<AlertBoxCustomTheme>
  const customTheme: AlertBoxCustomTheme = {
    bgImageUrl:  typeof ct.bgImageUrl  === 'string' ? ct.bgImageUrl  : null,
    bgColor:     typeof ct.bgColor     === 'string' ? ct.bgColor     : null,
    accentColor: typeof ct.accentColor === 'string' ? ct.accentColor : null,
    textColor:   typeof ct.textColor   === 'string' ? ct.textColor   : null,
  }
  return { theme, position, animation, durationMs, soundVolume, events, customTheme }
}

export interface OverlayRow {
  id:           string
  token:        string
  overlayType:  OverlayType
  label:        string | null
  config:       Record<string, unknown>
  createdBy:    string | null
  createdAt:    string
  updatedAt:    string
  revokedAt:    string | null
  lastSeenAt:   string | null
}

interface OverlayRowDb {
  id:            string
  token:         string
  overlay_type:  string
  label:         string | null
  config:        Record<string, unknown>
  created_by:    string | null
  created_at:    string
  updated_at:    string
  revoked_at:    string | null
  last_seen_at:  string | null
}

function rowToPublic(r: OverlayRowDb): OverlayRow {
  return {
    id:          r.id,
    token:       r.token,
    overlayType: r.overlay_type as OverlayType,
    label:       r.label,
    config:      r.config ?? {},
    createdBy:   r.created_by,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
    revokedAt:   r.revoked_at,
    lastSeenAt:  r.last_seen_at,
  }
}

// ── Token gen (43 chars base64url, ~256 bits d'entropie) ────────────────────
function generateToken(): string {
  // randomBytes(32) → base64url sans padding = 43 chars, URL-safe pour les
  // overlays embarquées dans OBS browser source.
  return randomBytes(32).toString('base64url')
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export async function createOverlay(args: {
  overlayType: OverlayType
  label?:      string | null
  config?:     Record<string, unknown>
  createdBy?:  string | null
}): Promise<OverlayRow> {
  const r = await db.query<OverlayRowDb>(
    `INSERT INTO streamer_overlays (token, overlay_type, label, config, created_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      generateToken(),
      args.overlayType,
      args.label ?? null,
      JSON.stringify(args.config ?? {}),
      args.createdBy ?? null,
    ],
  )
  return rowToPublic(r.rows[0])
}

export async function listOverlays(opts?: { includeRevoked?: boolean }): Promise<OverlayRow[]> {
  const r = opts?.includeRevoked
    ? await db.query<OverlayRowDb>(`SELECT * FROM streamer_overlays ORDER BY created_at DESC LIMIT 100`)
    : await db.query<OverlayRowDb>(`SELECT * FROM streamer_overlays WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 100`)
  return r.rows.map(rowToPublic)
}

export async function findOverlayByToken(token: string): Promise<OverlayRow | null> {
  if (!token || token.length < 16) return null     // garde-fou anti probe
  const r = await db.query<OverlayRowDb>(
    `SELECT * FROM streamer_overlays WHERE token = $1 AND revoked_at IS NULL LIMIT 1`,
    [token],
  )
  return r.rows[0] ? rowToPublic(r.rows[0]) : null
}

// Le premier overlay actif d'un type donné créé par un owner. Sert au pattern
// "ensure" : l'overlay playlist est unique par streamer (un seul token, qui
// permet d'embarquer N'IMPORTE laquelle de ses playlists via ?id=). On évite
// ainsi de polluer la liste des overlays avec une entrée par playlist.
export async function findOverlayByOwnerAndType(
  ownerUserId: string,
  overlayType: OverlayType,
): Promise<OverlayRow | null> {
  const r = await db.query<OverlayRowDb>(
    `SELECT * FROM streamer_overlays
     WHERE created_by = $1 AND overlay_type = $2 AND revoked_at IS NULL
     ORDER BY created_at ASC LIMIT 1`,
    [ownerUserId, overlayType],
  )
  return r.rows[0] ? rowToPublic(r.rows[0]) : null
}

export async function findOverlayById(id: string): Promise<OverlayRow | null> {
  const r = await db.query<OverlayRowDb>(`SELECT * FROM streamer_overlays WHERE id = $1 LIMIT 1`, [id])
  return r.rows[0] ? rowToPublic(r.rows[0]) : null
}

export async function updateOverlayConfig(args: {
  id:     string
  label?: string | null
  config?: Record<string, unknown>
}): Promise<OverlayRow | null> {
  const sets:   string[] = ['updated_at = NOW()']
  const values: unknown[] = []
  let i = 1
  if (args.label !== undefined)  { sets.push(`label = $${i++}`);  values.push(args.label) }
  if (args.config !== undefined) { sets.push(`config = $${i++}::jsonb`); values.push(JSON.stringify(args.config)) }
  if (values.length === 0) return findOverlayById(args.id)

  values.push(args.id)
  const r = await db.query<OverlayRowDb>(
    `UPDATE streamer_overlays SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`,
    values,
  )
  return r.rows[0] ? rowToPublic(r.rows[0]) : null
}

export async function revokeOverlay(id: string): Promise<boolean> {
  const r = await db.query<{ id: string }>(
    `UPDATE streamer_overlays SET revoked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND revoked_at IS NULL RETURNING id`,
    [id],
  )
  return r.rows.length > 0
}

export async function touchOverlayLastSeen(id: string): Promise<void> {
  await db.query(`UPDATE streamer_overlays SET last_seen_at = NOW() WHERE id = $1`, [id]).catch(() => {})
}
