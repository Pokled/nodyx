import bcrypt from 'bcrypt'
import { db } from '../config/database'

const BCRYPT_ROUNDS = 12

// ── Types ────────────────────────────────────────────────────

export interface User {
  id:         string
  username:   string
  email:      string
  password:   string
  avatar:     string | null
  bio:        string | null
  points:     number
  created_at: Date
  updated_at: Date
}

// Password excluded — safe to send to clients
export type PublicUser = Omit<User, 'password'>

// ── Queries ──────────────────────────────────────────────────

export async function findById(id: string): Promise<PublicUser | null> {
  const { rows } = await db.query<PublicUser>(
    `SELECT id, username, email, avatar, bio, points, created_at, updated_at, linked_instances
     FROM users WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function findByEmail(email: string): Promise<User | null> {
  const { rows } = await db.query<User>(
    `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  )
  return rows[0] ?? null
}

export async function findByUsername(username: string): Promise<PublicUser | null> {
  const { rows } = await db.query<PublicUser>(
    `SELECT id, username, email, avatar, bio, points, created_at, updated_at
     FROM users WHERE username = $1`,
    [username]
  )
  return rows[0] ?? null
}

export async function create(data: {
  username: string
  email:    string
  password: string
}): Promise<PublicUser> {
  const hashed = await bcrypt.hash(data.password, BCRYPT_ROUNDS)
  const { rows } = await db.query<PublicUser>(
    `INSERT INTO users (username, email, password)
     VALUES ($1, $2, $3)
     RETURNING id, username, email, avatar, bio, points, created_at, updated_at`,
    [data.username, data.email.toLowerCase(), hashed]
  )
  return rows[0]
}

export async function update(id: string, data: {
  username?: string
  avatar?:   string
  bio?:      string
}): Promise<PublicUser | null> {
  const fields: string[] = []
  const values: unknown[] = []
  let i = 1

  if (data.username !== undefined) { fields.push(`username = $${i++}`); values.push(data.username) }
  if (data.avatar   !== undefined) { fields.push(`avatar = $${i++}`);   values.push(data.avatar)   }
  if (data.bio      !== undefined) { fields.push(`bio = $${i++}`);      values.push(data.bio)      }

  if (fields.length === 0) return findById(id)

  values.push(id)
  const { rows } = await db.query<PublicUser>(
    `UPDATE users SET ${fields.join(', ')}
     WHERE id = $${i}
     RETURNING id, username, email, avatar, bio, points, created_at, updated_at`,
    values
  )
  return rows[0] ?? null
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return bcrypt.compare(plain, hashed)
}
