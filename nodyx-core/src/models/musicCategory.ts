import { db } from '../config/database'
import { generateCategorySlug } from './community'

export interface MusicCategory {
  id:           string
  community_id: string
  slug:         string
  title:        string
  description:  string | null
  license_note: string | null
  image_url:    string | null
  track_count:  number
  position:     number
  created_at:   string
  updated_at:   string
}

// image_url construit ici (pas de logique d'URL côté route) : le fichier
// vit dans community_assets, servi tel quel sous /uploads/<file_path>.
const SELECT = `
  SELECT
    mc.id, mc.community_id, mc.slug, mc.title, mc.description, mc.license_note, mc.position,
    mc.created_at, mc.updated_at,
    CASE WHEN a.file_path IS NOT NULL THEN '/uploads/' || a.file_path END AS image_url,
    COUNT(mt.id)::int AS track_count
  FROM music_categories mc
  LEFT JOIN community_assets a ON a.id = mc.image_asset_id
  LEFT JOIN music_tracks mt    ON mt.category_id = mc.id
`

export async function listByCommunity(communityId: string): Promise<MusicCategory[]> {
  const { rows } = await db.query<MusicCategory>(
    `${SELECT}
     WHERE mc.community_id = $1
     GROUP BY mc.id, a.file_path
     ORDER BY mc.position ASC, mc.created_at ASC`,
    [communityId]
  )
  return rows
}

export async function findBySlug(communityId: string, slug: string): Promise<MusicCategory | null> {
  const { rows } = await db.query<MusicCategory>(
    `${SELECT}
     WHERE mc.community_id = $1 AND mc.slug = $2
     GROUP BY mc.id, a.file_path`,
    [communityId, slug]
  )
  return rows[0] ?? null
}

export async function findById(id: string): Promise<MusicCategory | null> {
  const { rows } = await db.query<MusicCategory>(
    `${SELECT} WHERE mc.id = $1 GROUP BY mc.id, a.file_path`,
    [id]
  )
  return rows[0] ?? null
}

export async function create(data: {
  community_id: string
  title:        string
  description?: string | null
}): Promise<MusicCategory> {
  const baseSlug = generateCategorySlug(data.title)

  // Un titre déjà pris (ou qui slugifie pareil) reçoit un suffixe numérique,
  // jamais une collision silencieuse sur la contrainte UNIQUE(community_id, slug).
  let slug = baseSlug
  let n = 2
  while (true) {
    const { rows } = await db.query(
      `SELECT 1 FROM music_categories WHERE community_id = $1 AND slug = $2`,
      [data.community_id, slug]
    )
    if (rows.length === 0) break
    slug = `${baseSlug}-${n++}`
  }

  const { rows: posRows } = await db.query<{ next: number }>(
    `SELECT COALESCE(MAX(position), -1) + 1 AS next FROM music_categories WHERE community_id = $1`,
    [data.community_id]
  )

  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO music_categories (community_id, slug, title, description, position)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [data.community_id, slug, data.title, data.description ?? null, posRows[0].next]
  )
  return (await findById(rows[0].id))!
}

export async function update(id: string, data: {
  title?:          string
  description?:    string | null
  license_note?:   string | null
  image_asset_id?: string | null
  position?:       number
}): Promise<MusicCategory | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.title          !== undefined) { fields.push(`title = $${i++}`);          values.push(data.title) }
  if (data.description    !== undefined) { fields.push(`description = $${i++}`);    values.push(data.description) }
  if (data.license_note   !== undefined) { fields.push(`license_note = $${i++}`);   values.push(data.license_note) }
  if (data.image_asset_id !== undefined) { fields.push(`image_asset_id = $${i++}`); values.push(data.image_asset_id) }
  if (data.position       !== undefined) { fields.push(`position = $${i++}`);        values.push(data.position) }
  if (fields.length === 0) return findById(id)

  fields.push(`updated_at = NOW()`)
  values.push(id)
  await db.query(`UPDATE music_categories SET ${fields.join(', ')} WHERE id = $${i}`, values)
  return findById(id)
}

export async function remove(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM music_categories WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}
