// ─── Streamer Hub — Soundboard playlists service ────────────────────────────
// CRUD playlists + gestion des tracks (add/remove/reorder). Les playlists
// permettent au streamer de grouper ses sons par contexte (intro, dev,
// discussion, hype...) au lieu d'une liste plate. Un track peut être dans
// plusieurs playlists, et les playlists ont leur propre visibilité (publique
// = exposée sur /soundboard pour les viewers, privée = admin only).
//
// Lien avec audioLibraryService : les playlists pointent vers des tracks
// via streamer_audio_playlist_tracks. Si un track est supprimé, ON DELETE
// CASCADE le retire de toutes les playlists automatiquement.

import { db } from '../../config/database'
import type { AudioTrack } from './audioLibraryService'

// ── Types ──────────────────────────────────────────────────────────────────

export type PlaylistVisibility = 'private' | 'public'

export interface AudioPlaylist {
  id:           string
  ownerUserId:  string
  name:         string
  description:  string | null
  color:        string | null
  visibility:   PlaylistVisibility
  position:     number
  trackCount:   number
  createdAt:    Date
  updatedAt:    Date
}

interface AudioPlaylistRow {
  id:             string
  owner_user_id:  string
  name:           string
  description:    string | null
  color:          string | null
  visibility:     PlaylistVisibility
  position:       number
  track_count:    string             // pg COUNT() retourne en string
  created_at:     Date
  updated_at:     Date
}

function rowToPlaylist(r: AudioPlaylistRow): AudioPlaylist {
  return {
    id:           r.id,
    ownerUserId:  r.owner_user_id,
    name:         r.name,
    description:  r.description,
    color:        r.color,
    visibility:   r.visibility,
    position:     r.position,
    trackCount:   parseInt(r.track_count, 10) || 0,
    createdAt:    r.created_at,
    updatedAt:    r.updated_at,
  }
}

const SELECT_COLS = `
  p.id, p.owner_user_id, p.name, p.description, p.color,
  p.visibility, p.position, p.created_at, p.updated_at,
  (SELECT COUNT(*)::text FROM streamer_audio_playlist_tracks pt WHERE pt.playlist_id = p.id) AS track_count
`

// ── List / get ─────────────────────────────────────────────────────────────

export async function listPlaylistsForOwner(ownerUserId: string): Promise<AudioPlaylist[]> {
  const r = await db.query<AudioPlaylistRow>(
    `SELECT ${SELECT_COLS} FROM streamer_audio_playlists p
     WHERE p.owner_user_id = $1
     ORDER BY p.position ASC, p.created_at ASC`,
    [ownerUserId],
  )
  return r.rows.map(rowToPlaylist)
}

// Pour la page publique /soundboard : retourne uniquement les playlists
// publiques d'un owner, dans l'ordre choisi par celui-ci.
export async function listPublicPlaylists(ownerUserId: string): Promise<AudioPlaylist[]> {
  const r = await db.query<AudioPlaylistRow>(
    `SELECT ${SELECT_COLS} FROM streamer_audio_playlists p
     WHERE p.owner_user_id = $1 AND p.visibility = 'public'
     ORDER BY p.position ASC, p.created_at ASC`,
    [ownerUserId],
  )
  return r.rows.map(rowToPlaylist)
}

export async function getPlaylist(id: string): Promise<AudioPlaylist | null> {
  const r = await db.query<AudioPlaylistRow>(
    `SELECT ${SELECT_COLS} FROM streamer_audio_playlists p WHERE p.id = $1`,
    [id],
  )
  return r.rows[0] ? rowToPlaylist(r.rows[0]) : null
}

// ── Create / update / delete ───────────────────────────────────────────────

export interface CreatePlaylistInput {
  ownerUserId:  string
  name:         string
  description?: string
  color?:       string
  visibility?:  PlaylistVisibility
}

export async function createPlaylist(input: CreatePlaylistInput): Promise<AudioPlaylist | null> {
  // Position = max actuel + 1 pour mettre la nouvelle playlist en fin de liste.
  const maxR = await db.query<{ max_pos: number | null }>(
    `SELECT MAX(position) AS max_pos FROM streamer_audio_playlists WHERE owner_user_id = $1`,
    [input.ownerUserId],
  )
  const nextPos = (maxR.rows[0]?.max_pos ?? -1) + 1

  try {
    const r = await db.query<{ id: string }>(
      `INSERT INTO streamer_audio_playlists
         (owner_user_id, name, description, color, visibility, position)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        input.ownerUserId,
        input.name.slice(0, 100),
        input.description?.slice(0, 500) ?? null,
        input.color ?? null,
        input.visibility ?? 'private',
        nextPos,
      ],
    )
    return getPlaylist(r.rows[0].id)
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (msg.includes('duplicate key') && msg.includes('owner_user_id_name_key')) {
      // Nom déjà pris pour cet owner. On laisse remonter pour que la route
      // renvoie une 409 explicite.
      throw new Error('playlist_name_taken')
    }
    throw err
  }
}

export interface UpdatePlaylistInput {
  name?:        string
  description?: string | null
  color?:       string | null
  visibility?:  PlaylistVisibility
}

export async function updatePlaylist(id: string, patch: UpdatePlaylistInput): Promise<AudioPlaylist | null> {
  const sets: string[] = []
  const vals: unknown[] = []
  let idx = 1
  const push = (col: string, v: unknown): void => { sets.push(`${col} = $${idx++}`); vals.push(v) }

  if (patch.name        !== undefined) push('name',        patch.name.slice(0, 100))
  if (patch.description !== undefined) push('description', patch.description?.slice(0, 500) ?? null)
  if (patch.color       !== undefined) push('color',       patch.color)
  if (patch.visibility  !== undefined) push('visibility',  patch.visibility)

  if (sets.length === 0) return getPlaylist(id)

  sets.push(`updated_at = NOW()`)
  vals.push(id)
  try {
    await db.query(
      `UPDATE streamer_audio_playlists SET ${sets.join(', ')} WHERE id = $${idx}`,
      vals,
    )
  } catch (err) {
    const msg = (err as { message?: string }).message ?? ''
    if (msg.includes('duplicate key') && msg.includes('owner_user_id_name_key')) {
      throw new Error('playlist_name_taken')
    }
    throw err
  }
  return getPlaylist(id)
}

export async function deletePlaylist(id: string, ownerUserId: string): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM streamer_audio_playlists WHERE id = $1 AND owner_user_id = $2`,
    [id, ownerUserId],
  )
  return (r.rowCount ?? 0) > 0
}

// Réordonne la sidebar des playlists. ids = ordre désiré, on les remet de
// 0 à N-1. Filtre côté caller pour ne pas accepter des ids d'autres owners.
export async function reorderPlaylists(ownerUserId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  await db.query('BEGIN')
  try {
    for (let i = 0; i < ids.length; i++) {
      await db.query(
        `UPDATE streamer_audio_playlists
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

// ── Tracks management ──────────────────────────────────────────────────────

// Ajoute un track à une playlist. Position = fin de liste (max + 1).
// Idempotent : si déjà présent, no-op silencieux (pas d'erreur).
export async function addTrackToPlaylist(playlistId: string, trackId: string): Promise<boolean> {
  const maxR = await db.query<{ max_pos: number | null }>(
    `SELECT MAX(position) AS max_pos FROM streamer_audio_playlist_tracks WHERE playlist_id = $1`,
    [playlistId],
  )
  const nextPos = (maxR.rows[0]?.max_pos ?? -1) + 1

  const r = await db.query(
    `INSERT INTO streamer_audio_playlist_tracks (playlist_id, track_id, position)
     VALUES ($1, $2, $3)
     ON CONFLICT (playlist_id, track_id) DO NOTHING`,
    [playlistId, trackId, nextPos],
  )
  return (r.rowCount ?? 0) > 0
}

export async function removeTrackFromPlaylist(playlistId: string, trackId: string): Promise<boolean> {
  const r = await db.query(
    `DELETE FROM streamer_audio_playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
    [playlistId, trackId],
  )
  return (r.rowCount ?? 0) > 0
}

// Réordonne les tracks dans une playlist. Même pattern que reorderPlaylists.
export async function reorderTracksInPlaylist(playlistId: string, trackIds: string[]): Promise<void> {
  if (trackIds.length === 0) return
  await db.query('BEGIN')
  try {
    for (let i = 0; i < trackIds.length; i++) {
      await db.query(
        `UPDATE streamer_audio_playlist_tracks
           SET position = $1
         WHERE playlist_id = $2 AND track_id = $3`,
        [i, playlistId, trackIds[i]],
      )
    }
    await db.query('COMMIT')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  }
}

// Liste les tracks d'une playlist, dans l'ordre, avec les colonnes complètes
// du track (joint avec streamer_audio_library + community_assets pour les
// file_path/mime_type, comme fait audioLibraryService).
export async function listTracksInPlaylist(playlistId: string): Promise<AudioTrack[]> {
  const r = await db.query(
    `SELECT
       l.id, l.owner_user_id, l.asset_id, l.visibility,
       l.title, l.artist, l.album, l.duration_ms, l.thumbnail_url,
       l.volume_default::text AS volume_default,
       l.fade_in_ms, l.fade_out_ms, l.loop, l.royalty_free, l.tags,
       l.created_at, l.updated_at,
       a.file_path, a.mime_type
     FROM streamer_audio_playlist_tracks pt
     JOIN streamer_audio_library l ON l.id = pt.track_id
     JOIN community_assets a ON a.id = l.asset_id
     WHERE pt.playlist_id = $1
     ORDER BY pt.position ASC, pt.added_at ASC`,
    [playlistId],
  )
  // On reformatage minimal en AudioTrack pour matcher la shape attendue.
  return r.rows.map((row): AudioTrack => ({
    id:             row.id,
    ownerUserId:    row.owner_user_id,
    assetId:        row.asset_id,
    visibility:     row.visibility,
    title:          row.title,
    artist:         row.artist,
    album:          row.album,
    durationMs:     row.duration_ms,
    thumbnailUrl:   row.thumbnail_url,
    fileUrl:        `/uploads/${row.file_path}`,
    mimeType:       row.mime_type,
    volumeDefault:  parseFloat(row.volume_default) || 1,
    fadeInMs:       row.fade_in_ms,
    fadeOutMs:      row.fade_out_ms,
    loop:           row.loop,
    royaltyFree:    row.royalty_free,
    tags:           row.tags ?? [],
    createdAt:      row.created_at,
    updatedAt:      row.updated_at,
  }))
}

// Liste les ids des playlists auxquelles appartient un track donné. Utile
// pour afficher "ce track est dans 3 playlists" dans l'éditeur de track.
export async function listPlaylistIdsForTrack(trackId: string): Promise<string[]> {
  const r = await db.query<{ playlist_id: string }>(
    `SELECT playlist_id FROM streamer_audio_playlist_tracks WHERE track_id = $1`,
    [trackId],
  )
  return r.rows.map(x => x.playlist_id)
}
