import { db } from '../config/database'

export interface MusicTrack {
  id:          string
  category_id: string
  title:       string
  description: string | null
  source_type: 'upload' | 'youtube'
  audio_url:   string | null
  youtube_id:  string | null
  artist:      string | null
  genre:       string | null
  image_url:   string | null
  likes:       number
  duration_seconds: number | null
  position:    number
  created_at:  string
  updated_at:  string
}

// audio_asset_id est optionnel depuis la migration 125 (source YouTube en
// alternative a un fichier uploade) : LEFT JOIN, jamais JOIN, sinon un
// morceau YouTube (audio_asset_id NULL) disparaitrait silencieusement des
// resultats. image_url retombe sur la miniature YouTube quand aucune image
// n'a ete uploadee pour ce morceau precis.
const SELECT = `
  SELECT
    mt.id, mt.category_id, mt.title, mt.description, mt.likes, mt.duration_seconds, mt.position,
    mt.source_type, mt.youtube_id, mt.artist, mt.genre,
    mt.created_at, mt.updated_at,
    CASE WHEN audio.file_path IS NOT NULL THEN '/uploads/' || audio.file_path END AS audio_url,
    CASE WHEN img.thumbnail_path IS NOT NULL THEN '/uploads/' || img.thumbnail_path
         WHEN img.file_path      IS NOT NULL THEN '/uploads/' || img.file_path
         WHEN mt.youtube_id      IS NOT NULL THEN 'https://img.youtube.com/vi/' || mt.youtube_id || '/hqdefault.jpg'
    END AS image_url
  FROM music_tracks mt
  LEFT JOIN community_assets audio ON audio.id = mt.audio_asset_id
  LEFT JOIN community_assets img ON img.id = mt.image_asset_id
`

export async function listByCategory(categoryId: string): Promise<MusicTrack[]> {
  const { rows } = await db.query<MusicTrack>(
    `${SELECT} WHERE mt.category_id = $1 ORDER BY mt.position ASC, mt.created_at ASC`,
    [categoryId]
  )
  return rows
}

export async function findById(id: string): Promise<MusicTrack | null> {
  const { rows } = await db.query<MusicTrack>(`${SELECT} WHERE mt.id = $1`, [id])
  return rows[0] ?? null
}

export async function create(data: {
  category_id:       string
  title:             string
  description?:      string | null
  source_type?:       'upload' | 'youtube'
  audio_asset_id?:    string | null
  youtube_id?:        string | null
  artist?:            string | null
  genre?:             string | null
  image_asset_id?:   string | null
  duration_seconds?: number | null
}): Promise<MusicTrack> {
  const sourceType = data.source_type ?? 'upload'
  const { rows: posRows } = await db.query<{ next: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM music_tracks WHERE category_id = $1`,
    [data.category_id]
  )
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO music_tracks
       (category_id, title, description, source_type, audio_asset_id, youtube_id, artist, genre, image_asset_id, duration_seconds, position)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [
      data.category_id, data.title, data.description ?? null, sourceType,
      data.audio_asset_id ?? null, data.youtube_id ?? null, data.artist ?? null, data.genre ?? null,
      data.image_asset_id ?? null, data.duration_seconds ?? null, posRows[0].next,
    ]
  )
  return (await findById(rows[0].id))!
}

export async function update(id: string, data: {
  title?:          string
  description?:    string | null
  image_asset_id?: string | null
  artist?:         string | null
  genre?:          string | null
  position?:       number
}): Promise<MusicTrack | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.title          !== undefined) { fields.push(`title = $${i++}`);          values.push(data.title) }
  if (data.description    !== undefined) { fields.push(`description = $${i++}`);    values.push(data.description) }
  if (data.image_asset_id !== undefined) { fields.push(`image_asset_id = $${i++}`); values.push(data.image_asset_id) }
  if (data.artist         !== undefined) { fields.push(`artist = $${i++}`);         values.push(data.artist) }
  if (data.genre          !== undefined) { fields.push(`genre = $${i++}`);          values.push(data.genre) }
  if (data.position       !== undefined) { fields.push(`position = $${i++}`);        values.push(data.position) }
  if (fields.length === 0) return findById(id)

  fields.push(`updated_at = NOW()`)
  values.push(id)
  await db.query(`UPDATE music_tracks SET ${fields.join(', ')} WHERE id = $${i}`, values)
  return findById(id)
}

export async function addLike(id: string): Promise<MusicTrack | null> {
  await db.query(`UPDATE music_tracks SET likes = likes + 1 WHERE id = $1`, [id])
  return findById(id)
}

export async function remove(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM music_tracks WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}
