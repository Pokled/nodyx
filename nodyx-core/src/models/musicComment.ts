import { db } from '../config/database'

export interface MusicComment {
  id:          string
  track_id:    string
  author_name: string
  body:        string
  created_at:  string
}

export async function listByTrack(trackId: string): Promise<MusicComment[]> {
  const { rows } = await db.query<MusicComment>(
    `SELECT id, track_id, author_name, body, created_at
     FROM music_track_comments
     WHERE track_id = $1
     ORDER BY created_at DESC`,
    [trackId]
  )
  return rows
}

export async function create(data: {
  track_id:    string
  author_name: string
  body:        string
}): Promise<MusicComment> {
  const { rows } = await db.query<MusicComment>(
    `INSERT INTO music_track_comments (track_id, author_name, body)
     VALUES ($1, $2, $3)
     RETURNING id, track_id, author_name, body, created_at`,
    [data.track_id, data.author_name, data.body]
  )
  return rows[0]
}

export async function remove(id: string): Promise<boolean> {
  const { rowCount } = await db.query(`DELETE FROM music_track_comments WHERE id = $1`, [id])
  return (rowCount ?? 0) > 0
}
