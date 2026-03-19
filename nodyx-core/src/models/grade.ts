import { db } from '../config/database'

// ── Types ────────────────────────────────────────────────────

export interface Permissions {
  can_post:             boolean
  can_create_thread:    boolean
  can_create_category:  boolean
  can_moderate:         boolean
  can_manage_members:   boolean
  can_manage_grades:    boolean
}

export interface Grade {
  id:           string
  community_id: string
  name:         string
  color:        string
  position:     number
  permissions:  Permissions
  created_at:   Date
}

// Grade with member assignment info
export interface MemberGrade extends Grade {
  member_user_id: string
}

// ── Queries ──────────────────────────────────────────────────

export async function listByCommunity(communityId: string): Promise<Grade[]> {
  const { rows } = await db.query<Grade>(
    `SELECT * FROM community_grades
     WHERE community_id = $1
     ORDER BY position ASC, created_at ASC`,
    [communityId]
  )
  return rows
}

export async function findById(id: string): Promise<Grade | null> {
  const { rows } = await db.query<Grade>(
    `SELECT * FROM community_grades WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function create(data: {
  community_id: string
  name:         string
  color?:       string
  position?:    number
  permissions?: Partial<Permissions>
}): Promise<Grade> {
  const { rows } = await db.query<Grade>(
    `INSERT INTO community_grades (community_id, name, color, position, permissions)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      data.community_id,
      data.name,
      data.color       ?? '#99AAB5',
      data.position    ?? 0,
      JSON.stringify(data.permissions ?? {}),
    ]
  )
  return rows[0]
}

export async function update(id: string, communityId: string, data: {
  name?:        string
  color?:       string
  position?:    number
  permissions?: Partial<Permissions>
}): Promise<Grade | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.name        !== undefined) { fields.push(`name = $${i++}`);        values.push(data.name)        }
  if (data.color       !== undefined) { fields.push(`color = $${i++}`);       values.push(data.color)       }
  if (data.position    !== undefined) { fields.push(`position = $${i++}`);    values.push(data.position)    }
  if (data.permissions !== undefined) { fields.push(`permissions = $${i++}`); values.push(JSON.stringify(data.permissions)) }

  if (fields.length === 0) return findById(id)

  values.push(id, communityId)
  const { rows } = await db.query<Grade>(
    `UPDATE community_grades SET ${fields.join(', ')}
     WHERE id = $${i} AND community_id = $${i + 1}
     RETURNING *`,
    values
  )
  return rows[0] ?? null
}

export async function remove(id: string, communityId: string): Promise<boolean> {
  const { rowCount } = await db.query(
    `DELETE FROM community_grades WHERE id = $1 AND community_id = $2`,
    [id, communityId]
  )
  return (rowCount ?? 0) > 0
}

export async function assignToMember(
  communityId: string,
  userId: string,
  gradeId: string | null
): Promise<{ found: boolean; gradeValid: boolean }> {
  // Atomic: verify grade belongs to this community in the same statement
  const { rowCount } = await db.query(
    `UPDATE community_members SET grade_id = $1
     WHERE community_id = $2 AND user_id = $3
     AND (
       $1 IS NULL
       OR EXISTS (SELECT 1 FROM community_grades WHERE id = $1 AND community_id = $2)
     )`,
    [gradeId, communityId, userId]
  )
  if ((rowCount ?? 0) > 0) return { found: true, gradeValid: true }

  // Distinguish "grade not in community" from "member not found"
  const { rows } = await db.query(
    `SELECT 1 FROM community_members WHERE community_id = $1 AND user_id = $2`,
    [communityId, userId]
  )
  const found = rows.length > 0
  return { found, gradeValid: !found } // if member found, grade was invalid
}
