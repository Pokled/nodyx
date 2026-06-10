// ─── Streamer Hub — Scènes OBS pilotées depuis Nodyx ─────────────────────────
// Service CRUD pour les scènes du compositeur visuel. Une scène = un layout
// 1920x1080 contenant N sources positionnées (overlays Nodyx ou URLs Browser
// libres). Le streamer compose visuellement dans le hub puis colle les URLs
// dans OBS (Phase A), ou laisse Nodyx pousser tout via OBS WebSocket (Phase B+).
//
// Voir migration 102_streamer_obs_scenes.sql pour la shape DB et le format
// JSONB du layout. Le sanitize ci-dessous est l'unique point d'entrée qui
// décide ce qui rentre en DB : si un client envoie un layout farfelu, on le
// nettoie avant persistence (pas d'XSS sur les URLs Browser, pas de tailles
// négatives, etc.).

import { randomBytes } from 'node:crypto'
import { db } from '../../config/database'

// ── Types ──────────────────────────────────────────────────────────────────

// Types de sources qu'on peut placer dans une scène. Mappés 1:1 sur les
// overlays Nodyx token-gated, plus 'browser_source' (URL libre) et
// 'placeholder_video' (cam/capture jeu : on les positionne en Phase A,
// elles seront liées aux vraies sources OBS en Phase B/C).
export type ObsSceneSourceType =
  | 'alert_box'
  | 'ticker'
  | 'playlist'
  | 'soundboard_osd'
  | 'goal_bar'
  | 'leaderboard'
  | 'clips_player'
  | 'stream_timer'
  | 'browser_source'
  | 'placeholder_video'

const VALID_TYPES: ReadonlySet<ObsSceneSourceType> = new Set([
  'alert_box', 'ticker', 'playlist', 'soundboard_osd',
  'goal_bar', 'leaderboard', 'clips_player', 'stream_timer',
  'browser_source', 'placeholder_video',
])

// Canvas de référence : 1920x1080 (16:9 1080p) côté backend. Le frontend
// scale visuellement, mais on stocke en pixels absolus pour que Phase B
// puisse pousser tel quel à OBS (qui travaille aussi en pixels absolus).
export const CANVAS_WIDTH  = 1920
export const CANVAS_HEIGHT = 1080

export interface ObsSceneSource {
  id:      string
  type:    ObsSceneSourceType
  label:   string
  x:       number          // 0..CANVAS_WIDTH
  y:       number          // 0..CANVAS_HEIGHT
  w:       number          // 1..CANVAS_WIDTH
  h:       number          // 1..CANVAS_HEIGHT
  z:       number          // ordre de stack : plus grand = devant
  visible: boolean
  locked:  boolean
  config:  Record<string, unknown>   // varie par type, validé client-side
}

// Fond de scène : couleur unie ou image (URL HTTPS), comme OBS qui laisse
// poser une "Color Source" ou "Image Source" en arrière-plan. Optionnel :
// si `kind = 'none'` la scène est transparente (sera composée sur l'OBS
// canvas en Phase B+).
export interface ObsSceneBackground {
  kind:   'none' | 'color' | 'image'
  color?: string       // hex #RRGGBB, requis si kind='color'
  url?:   string       // URL HTTPS, requis si kind='image'
}

export interface ObsSceneLayout {
  sources:     ObsSceneSource[]
  background?: ObsSceneBackground
}

export interface ObsScene {
  id:           string
  ownerUserId:  string
  name:         string
  color:        string | null
  layout:       ObsSceneLayout
  position:     number
  createdAt:    Date
  updatedAt:    Date
}

interface ObsSceneRow {
  id:             string
  owner_user_id:  string
  name:           string
  color:          string | null
  layout:         unknown
  position:       number
  created_at:     Date
  updated_at:     Date
}

function rowToScene(r: ObsSceneRow): ObsScene {
  return {
    id:          r.id,
    ownerUserId: r.owner_user_id,
    name:        r.name,
    color:       r.color,
    layout:      sanitizeLayout(r.layout),
    position:    r.position,
    createdAt:   r.created_at,
    updatedAt:   r.updated_at,
  }
}

// ── Sanitize ───────────────────────────────────────────────────────────────

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.max(lo, Math.min(hi, Math.floor(n)))
}

// URL Browser Source : on accepte http/https uniquement. Pas de javascript:,
// pas de data:, pas de file:. Tronquée à 2KB (raisonnable pour des URLs de
// widget OBS classiques avec query params).
function sanitizeBrowserUrl(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const trimmed = raw.trim().slice(0, 2000)
  if (!/^https?:\/\//i.test(trimmed)) return ''
  return trimmed
}

function sanitizeSourceConfig(type: ObsSceneSourceType, raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  switch (type) {
    case 'alert_box':
    case 'ticker':
    case 'soundboard_osd':
    case 'goal_bar':
    case 'leaderboard':
    case 'clips_player':
    case 'stream_timer':
      // Ces sources sont des overlays Nodyx token-gated. On garde
      // l'overlayToken si fourni : le frontend résoudra l'URL preview à
      // partir du token (et le bridge OBS Phase B+ poussera l'URL réelle).
      return {
        overlayToken: typeof r.overlayToken === 'string' ? r.overlayToken.slice(0, 64) : undefined,
      }
    case 'playlist':
      return {
        overlayToken: typeof r.overlayToken === 'string' ? r.overlayToken.slice(0, 64) : undefined,
        playlistId:   typeof r.playlistId   === 'string' ? r.playlistId.slice(0, 64)   : undefined,
        shuffle:      r.shuffle === true,
        volume:       Number.isFinite(Number(r.volume)) ? Math.max(0, Math.min(1, Number(r.volume))) : undefined,
      }
    case 'browser_source':
      return { url: sanitizeBrowserUrl(r.url) }
    case 'placeholder_video':
      // Hint visuel pour l'admin (cam / capture / image). On stocke juste un
      // label de catégorie ; le bridge OBS choisira la vraie source plus tard.
      return {
        kind: r.kind === 'webcam' || r.kind === 'capture' || r.kind === 'image' ? r.kind : 'webcam',
      }
  }
}

function sanitizeSource(raw: unknown): ObsSceneSource | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.type !== 'string' || !VALID_TYPES.has(r.type as ObsSceneSourceType)) return null
  const type = r.type as ObsSceneSourceType

  const x = clampInt(r.x, 0, CANVAS_WIDTH  - 1, 0)
  const y = clampInt(r.y, 0, CANVAS_HEIGHT - 1, 0)
  const w = clampInt(r.w, 1, CANVAS_WIDTH,  320)
  const h = clampInt(r.h, 1, CANVAS_HEIGHT, 180)
  const z = clampInt(r.z, 0, 999, 0)

  const id      = typeof r.id    === 'string' && r.id.length > 0 ? r.id.slice(0, 64) : 'src_' + randomBytes(6).toString('hex')
  const label   = typeof r.label === 'string' ? r.label.slice(0, 60) : ''
  const visible = r.visible !== false
  const locked  = r.locked  === true
  const config  = sanitizeSourceConfig(type, r.config)

  return { id, type, label, x, y, w, h, z, visible, locked, config }
}

function sanitizeBackground(raw: unknown): ObsSceneBackground | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const kind = r.kind === 'color' || r.kind === 'image' ? r.kind : 'none'
  if (kind === 'none') return { kind: 'none' }
  if (kind === 'color') {
    const color = typeof r.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(r.color) ? r.color : '#000000'
    return { kind: 'color', color }
  }
  // image : URL HTTPS uniquement, même garde-fou que browser_source.
  const url = typeof r.url === 'string' && /^https?:\/\//i.test(r.url.trim()) ? r.url.trim().slice(0, 2000) : ''
  if (!url) return { kind: 'none' }
  return { kind: 'image', url }
}

export function sanitizeLayout(raw: unknown): ObsSceneLayout {
  if (!raw || typeof raw !== 'object') return { sources: [] }
  const r = raw as Record<string, unknown>
  const rawSources = Array.isArray(r.sources) ? r.sources : []
  // Cap dur sur le nombre de sources par scène : 32 c'est large pour un
  // streamer typique (5-10 sources/scène), évite un layout pathologique
  // qui ralentirait le rendu preview iframes.
  const sources = rawSources
    .slice(0, 32)
    .map(sanitizeSource)
    .filter((s): s is ObsSceneSource => s !== null)
  const background = sanitizeBackground(r.background)
  return background ? { sources, background } : { sources }
}

// ── List / get ─────────────────────────────────────────────────────────────

export async function listScenesForOwner(ownerUserId: string): Promise<ObsScene[]> {
  const r = await db.query<ObsSceneRow>(
    `SELECT id, owner_user_id, name, color, layout, position, created_at, updated_at
       FROM streamer_obs_scenes
      WHERE owner_user_id = $1
      ORDER BY position ASC, created_at ASC`,
    [ownerUserId],
  )
  return r.rows.map(rowToScene)
}

export async function getScene(id: string): Promise<ObsScene | null> {
  const r = await db.query<ObsSceneRow>(
    `SELECT id, owner_user_id, name, color, layout, position, created_at, updated_at
       FROM streamer_obs_scenes WHERE id = $1`,
    [id],
  )
  return r.rows[0] ? rowToScene(r.rows[0]) : null
}

// ── Create / update / delete ───────────────────────────────────────────────

export interface CreateSceneInput {
  ownerUserId: string
  name:        string
  color?:      string | null
  layout?:     unknown
}

export async function createScene(input: CreateSceneInput): Promise<ObsScene | null> {
  const maxR = await db.query<{ max_pos: number | null }>(
    `SELECT MAX(position) AS max_pos FROM streamer_obs_scenes WHERE owner_user_id = $1`,
    [input.ownerUserId],
  )
  const nextPos = (maxR.rows[0]?.max_pos ?? -1) + 1
  const layout  = sanitizeLayout(input.layout)

  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO streamer_obs_scenes (owner_user_id, name, color, layout, position)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [
        input.ownerUserId,
        input.name.slice(0, 80),
        input.color ?? null,
        JSON.stringify(layout),
        nextPos,
      ],
    )
    return getScene(r.rows[0].id)
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (msg.includes('duplicate key') && msg.includes('owner_user_id_name_key')) {
      throw new Error('scene_name_taken')
    }
    throw err
  }
}

export interface UpdateSceneInput {
  name?:   string
  color?:  string | null
  layout?: unknown
}

export async function updateScene(id: string, patch: UpdateSceneInput): Promise<ObsScene | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  const push = (col: string, v: unknown): void => { sets.push(`${col} = $${idx++}`); vals.push(v) }

  if (patch.name   !== undefined) push('name',  patch.name.slice(0, 80))
  if (patch.color  !== undefined) push('color', patch.color)
  if (patch.layout !== undefined) push('layout', JSON.stringify(sanitizeLayout(patch.layout)))

  if (sets.length === 0) return getScene(id)

  sets.push(`updated_at = NOW()`)
  vals.push(id)
  try {
    await db.query(
      `UPDATE streamer_obs_scenes SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals,
    )
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (msg.includes('duplicate key') && msg.includes('owner_user_id_name_key')) {
      throw new Error('scene_name_taken')
    }
    throw err
  }
  return getScene(id)
}

export async function deleteScene(id: string, ownerUserId: string): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM streamer_obs_scenes WHERE id = $1 AND owner_user_id = $2`,
    [id, ownerUserId],
  )
  return (r.rowCount ?? 0) > 0
}

// Duplique une scène (utile : "Nouvelle scène basée sur Dev"). Le nom est
// suffixé par un compteur si "X (copie)" est déjà pris.
export async function duplicateScene(id: string, ownerUserId: string): Promise<ObsScene | null> {
  const src = await getScene(id)
  if (!src || src.ownerUserId !== ownerUserId) return null
  let candidate = `${src.name} (copie)`.slice(0, 80)
  for (let i = 2; i < 99; i++) {
    try {
      return await createScene({
        ownerUserId,
        name:   candidate,
        color:  src.color,
        layout: src.layout,
      })
    } catch (err) {
      if ((err as Error).message !== 'scene_name_taken') throw err
      candidate = `${src.name} (copie ${i})`.slice(0, 80)
    }
  }
  return null
}

// Réordonne les scènes dans la sidebar. Pattern transactionnel partagé avec
// reorderPlaylists : on autorise des positions intermédiaires en doublon
// pendant la séquence d'UPDATE pour éviter une contrainte tueuse.
export async function reorderScenes(ownerUserId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db.query('BEGIN')
  try {
    for (let i = 0; i < ids.length; i++) {
      await db.query(
        `UPDATE streamer_obs_scenes
            SET position = $1, updated_at = NOW()
          WHERE id = $2 AND owner_user_id = $3`,
        [i, ids[i], ownerUserId],
      )
    }
    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
}
