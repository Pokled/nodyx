import { db } from '../config/database'

export interface MusicTrack {
  id:          string
  category_id: string
  title:       string
  description: string | null
  audio_url:   string
  image_url:   string | null
  position:    number
  created_at:  string
  updated_at:  string
}

const SELECT = `
  SELECT
    mt.id, mt.category_id, mt.title, mt.description, mt.position,
    mt.created_at, mt.updated_at,
    '/uploads/' || audio.file_path AS audio_url,
    CASE WHEN img.thumbnail_path IS NOT NULL THEN '/uploads/' || img.thumbnail_path
         WHEN img.file_path      IS NOT NULL THEN '/uploads/' || img.file_path
    END AS image_url
  FROM music_tracks mt
  JOIN community_assets audio ON audio.id = mt.audio_asset_id
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
  category_id:     string
  title:           string
  description?:    string | null
  audio_asset_id:  string
  image_asset_id?: string | null
}): Promise<MusicTrack> {
  const { rows: posRows } = await db.query<{ next: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM music_tracks WHERE category_id = $1`,
    [data.category_id]
  )
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO music_tracks (category_id, title, description, audio_asset_id, image_asset_id, position)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [data.category_id, data.title, data.description ?? null, data.audio_asset_id, data.image_asset_id ?? null, posRows[0].next]
  )
  return (await findById(rows[0].id))!
}

export async function update(id: string, data: {
  title?:          string
  description?:    string | null
  image_asset_id?: string | null
  position?:       number
}): Promise<MusicTrack | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.title          !== undefined) { fields.push(`title = $${i++}`);          values.push(data.title) }
  if (data.description    !== undefined) { fields.push(`description = $${i++}`);    values.push(data.description) }
  if (data.image_asset_id !== undefined) { fields.push(`image_asset_id = $${i++}`); values.push(data.image_asset_id) }
  if (data.position       !== undefined) { fields.push(`position = $${i++}`);        values.push(data.position) }
  if (fields.length === 0) return findById(id)

  fields.push(`updated_at = NOW()`)
  values.push(id)
  await db.query(`UPDATE music_tracks SET ${fields.join(', ')} WHERE id = $${i}`, values)
  return findById(id)
}

export async function remove(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM music_tracks WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}
