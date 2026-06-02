// ─── Streamer Hub — Soundboard / bibliothèque audio (Phase A) ──────────────
// Gère les pistes audio que le streamer veut pouvoir déclencher depuis le
// Stream Deck ou directement depuis l'admin. Chaque entrée pointe sur un
// asset (système d'upload générique de Nodyx) et ajoute les métadonnées
// spécifiques au soundboard.
//
// Extraction des métadonnées ID3 (titre, artiste, durée, vignette embedded)
// via la lib `music-metadata`. Si l'extraction échoue (fichier corrompu,
// format sans tags), on tombe back sur le nom de l'asset comme titre.

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseFile } from 'music-metadata'
import { db } from '../../config/database'

// ── Types ──────────────────────────────────────────────────────────────────

export type AudioVisibility = 'private' | 'public'

export interface AudioTrack {
  id:              string
  ownerUserId:     string
  assetId:         string
  visibility:      AudioVisibility
  title:           string
  artist:          string | null
  album:           string | null
  durationMs:      number | null
  thumbnailUrl:    string | null
  fileUrl:         string                   // résolu depuis l'asset au moment du read
  mimeType:        string                   // idem
  volumeDefault:   number
  fadeInMs:        number
  fadeOutMs:       number
  loop:            boolean
  royaltyFree:     boolean | null
  tags:            string[]
  createdAt:       Date
  updatedAt:       Date
}

interface AudioTrackRow {
  id:                string
  owner_user_id:     string
  asset_id:          string
  visibility:        AudioVisibility
  title:             string
  artist:            string | null
  album:             string | null
  duration_ms:       number | null
  thumbnail_url:     string | null
  file_path:         string                 // joint depuis community_assets
  mime_type:         string                 // joint depuis community_assets
  volume_default:    string                 // pg renvoie REAL en string
  fade_in_ms:        number
  fade_out_ms:       number
  loop:              boolean
  royalty_free:      boolean | null
  tags:              string[]
  created_at:        Date
  updated_at:        Date
}

function rowToTrack(r: AudioTrackRow): AudioTrack {
  return {
    id:             r.id,
    ownerUserId:    r.owner_user_id,
    assetId:        r.asset_id,
    visibility:     r.visibility,
    title:          r.title,
    artist:         r.artist,
    album:          r.album,
    durationMs:     r.duration_ms,
    thumbnailUrl:   r.thumbnail_url,
    fileUrl:        `/uploads/${r.file_path}`,
    mimeType:       r.mime_type,
    volumeDefault:  parseFloat(r.volume_default) || 1,
    fadeInMs:       r.fade_in_ms,
    fadeOutMs:      r.fade_out_ms,
    loop:           r.loop,
    royaltyFree:    r.royalty_free,
    tags:           r.tags ?? [],
    createdAt:      r.created_at,
    updatedAt:      r.updated_at,
  }
}

const SELECT_COLS = `
  l.id, l.owner_user_id, l.asset_id, l.visibility,
  l.title, l.artist, l.album, l.duration_ms, l.thumbnail_url,
  l.volume_default::text AS volume_default,
  l.fade_in_ms, l.fade_out_ms, l.loop, l.royalty_free, l.tags,
  l.created_at, l.updated_at,
  a.file_path, a.mime_type
`

const JOIN_ASSET = `FROM streamer_audio_library l JOIN community_assets a ON a.id = l.asset_id`

// ── ID3 extraction ─────────────────────────────────────────────────────────
// On lit le fichier disque pour extraire titre/artiste/durée/cover. La
// vignette embedded (APIC) est sauvée dans uploads/audio_thumbs/<asset_id>.<ext>
// et son URL relative retournée.

interface ExtractedMeta {
  title:        string | null
  artist:       string | null
  album:        string | null
  durationMs:   number | null
  thumbnailUrl: string | null
}

const THUMBS_DIR = 'audio_thumbs'

async function ensureThumbsDir(): Promise<void> {
  const dir = path.join(process.cwd(), 'uploads', THUMBS_DIR)
  await fs.mkdir(dir, { recursive: true }).catch(() => {})
}

function pickExtFromMime(mime: string): string {
  if (mime === 'image/jpeg' || mime === 'image/jpg') return 'jpg'
  if (mime === 'image/png')  return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/gif')  return 'gif'
  return 'bin'
}

export async function extractAudioMetadata(absFilePath: string, assetId: string): Promise<ExtractedMeta> {
  try {
    const m = await parseFile(absFilePath, { duration: true, skipCovers: false })
    const common = m.common
    let thumbnailUrl: string | null = null

    // Cover art embedded (APIC ID3v2 ou équivalent format).
    const cover = (common.picture && common.picture[0]) ? common.picture[0] : null
    if (cover && cover.data && cover.data.length > 0) {
      await ensureThumbsDir()
      const ext = pickExtFromMime(cover.format)
      const safeAssetId = assetId.replace(/[^a-f0-9-]/gi, '')
      const fileName = `${safeAssetId}.${ext}`
      const diskPath = path.join(process.cwd(), 'uploads', THUMBS_DIR, fileName)
      await fs.writeFile(diskPath, Buffer.from(cover.data))
      thumbnailUrl = `/uploads/${THUMBS_DIR}/${fileName}`
    }

    return {
      title:        common.title  ?? null,
      artist:       common.artist ?? null,
      album:        common.album  ?? null,
      durationMs:   m.format.duration ? Math.round(m.format.duration * 1000) : null,
      thumbnailUrl,
    }
  } catch (err) {
    console.warn('[audioLibrary] metadata extraction failed', err)
    return { title: null, artist: null, album: null, durationMs: null, thumbnailUrl: null }
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export interface ListOptions {
  visibility?: AudioVisibility   // par défaut on combine private (owner) + public
  query?:      string             // recherche full text basique sur title/artist
  limit?:      number
}

export async function listTracksForOwner(ownerUserId: string, opts: ListOptions = {}): Promise<AudioTrack[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100))
  const params: unknown[] = [ownerUserId, limit]
  const where: string[] = [`(l.owner_user_id = $1 OR l.visibility = 'public')`]

  if (opts.visibility === 'private')      where.push(`l.visibility = 'private' AND l.owner_user_id = $1`)
  else if (opts.visibility === 'public')  where.push(`l.visibility = 'public'`)

  if (opts.query && opts.query.trim()) {
    const q = `%${opts.query.trim().toLowerCase()}%`
    params.push(q)
    where.push(`(LOWER(l.title) LIKE $${params.length} OR LOWER(COALESCE(l.artist,'')) LIKE $${params.length})`)
  }

  const r = await db.query<AudioTrackRow>(
    `SELECT ${SELECT_COLS} ${JOIN_ASSET}
     WHERE ${where.join(' AND ')}
     ORDER BY l.created_at DESC
     LIMIT $2`,
    params,
  )
  return r.rows.map(rowToTrack)
}

// Liste des tracks publiques d'un owner. Utilisé par la page publique
// /soundboard que les viewers consultent pour voir ce que le streamer met
// à disposition (et plus tard demander via !next sound).
export async function listPublicTracks(ownerUserId: string, opts: { limit?: number } = {}): Promise<AudioTrack[]> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 200))
  const r = await db.query<AudioTrackRow>(
    `SELECT ${SELECT_COLS} ${JOIN_ASSET}
     WHERE l.owner_user_id = $1 AND l.visibility = 'public'
     ORDER BY l.created_at DESC
     LIMIT $2`,
    [ownerUserId, limit],
  )
  return r.rows.map(rowToTrack)
}

export async function getTrack(id: string): Promise<AudioTrack | null> {
  const r = await db.query<AudioTrackRow>(
    `SELECT ${SELECT_COLS} ${JOIN_ASSET} WHERE l.id = $1`,
    [id],
  )
  return r.rows[0] ? rowToTrack(r.rows[0]) : null
}

export interface AddTrackInput {
  ownerUserId:   string
  assetId:       string
  visibility?:   AudioVisibility
  titleOverride?: string                 // sinon extrait ou fallback nom asset
}

export async function addTrackFromAsset(input: AddTrackInput): Promise<AudioTrack | null> {
  // Récupère le fichier disque pour extraction ID3
  const r = await db.query<{ file_path: string; name: string }>(
    `SELECT file_path, name FROM community_assets WHERE id = $1 AND asset_type = 'sound'`,
    [input.assetId],
  )
  if (r.rows.length === 0) return null

  const { file_path, name } = r.rows[0]
  const absPath = path.join(process.cwd(), 'uploads', file_path)
  const meta = await extractAudioMetadata(absPath, input.assetId)

  const title = (input.titleOverride?.trim()) || meta.title || stripExt(name) || 'Sans titre'

  try {
    const ins = await db.query<{ id: string }>(
      `INSERT INTO streamer_audio_library
         (owner_user_id, asset_id, visibility, title, artist, album, duration_ms, thumbnail_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        input.ownerUserId,
        input.assetId,
        input.visibility ?? 'private',
        title.slice(0, 200),
        meta.artist?.slice(0, 200) ?? null,
        meta.album?.slice(0, 200) ?? null,
        meta.durationMs,
        meta.thumbnailUrl,
      ],
    )
    return await getTrack(ins.rows[0].id)
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (msg.includes('duplicate key')) {
      // Cet asset est déjà dans la bibliothèque de cet owner : on renvoie l'existant.
      const existing = await db.query<{ id: string }>(
        `SELECT id FROM streamer_audio_library WHERE owner_user_id = $1 AND asset_id = $2`,
        [input.ownerUserId, input.assetId],
      )
      if (existing.rows[0]) return getTrack(existing.rows[0].id)
    }
    throw err
  }
}

function stripExt(name: string): string {
  return name.replace(/\.[a-z0-9]{2,5}$/i, '')
}

export interface UpdateTrackInput {
  title?:         string
  artist?:        string | null
  album?:         string | null
  visibility?:    AudioVisibility
  volumeDefault?: number
  fadeInMs?:      number
  fadeOutMs?:     number
  loop?:          boolean
  royaltyFree?:   boolean | null
  tags?:          string[]
  thumbnailUrl?:  string | null
}

export async function updateTrack(id: string, patch: UpdateTrackInput): Promise<AudioTrack | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  const push = (col: string, v: unknown): void => { sets.push(`${col} = $${idx++}`); vals.push(v) }

  if (patch.title         !== undefined) push('title',          patch.title.slice(0, 200))
  if (patch.artist        !== undefined) push('artist',         patch.artist?.slice(0, 200) ?? null)
  if (patch.album         !== undefined) push('album',          patch.album?.slice(0, 200)  ?? null)
  if (patch.visibility    !== undefined) push('visibility',     patch.visibility)
  if (patch.volumeDefault !== undefined) push('volume_default', Math.max(0, Math.min(2, patch.volumeDefault)))
  if (patch.fadeInMs      !== undefined) push('fade_in_ms',     Math.max(0, Math.min(10000, Math.floor(patch.fadeInMs))))
  if (patch.fadeOutMs     !== undefined) push('fade_out_ms',    Math.max(0, Math.min(10000, Math.floor(patch.fadeOutMs))))
  if (patch.loop          !== undefined) push('loop',           !!patch.loop)
  if (patch.royaltyFree   !== undefined) push('royalty_free',   patch.royaltyFree)
  if (patch.tags          !== undefined) push('tags',           patch.tags.slice(0, 32).map(t => t.slice(0, 40)))
  if (patch.thumbnailUrl  !== undefined) push('thumbnail_url',  patch.thumbnailUrl)

  if (sets.length === 0) return getTrack(id)

  sets.push(`updated_at = NOW()`)
  vals.push(id)
  await db.query(
    `UPDATE streamer_audio_library SET ${sets.join(', ')} WHERE id = $${idx}`,
    vals,
  )
  return getTrack(id)
}

export async function deleteTrack(id: string, ownerUserId: string): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM streamer_audio_library WHERE id = $1 AND owner_user_id = $2`,
    [id, ownerUserId],
  )
  return (r.rowCount ?? 0) > 0
}

/**
 * Helper utilisé par le dispatch deck `play_audio` : retrouve un track par
 * son id et vérifie qu'il existe encore (l'asset n'a pas été supprimé).
 */
export async function resolveTrackForPlay(id: string): Promise<AudioTrack | null> {
  return getTrack(id)
}

// Génère un identifiant aléatoire pour les uploads futurs (helper).
export function newPlayId(): string { return randomBytes(8).toString('hex') }
