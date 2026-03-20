import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { redis, db } from '../config/database'
import { JwtPayload } from './auth'

// Cache the instance community id — it never changes at runtime
let _communityId: string | null = null

async function getInstanceCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId

  const slug = process.env.NODYX_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId }
  }

  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  if (rows[0]) { _communityId = rows[0].id; return _communityId }

  return null
}

// Requires the current user to be owner or admin of this instance's community
export async function adminOnly(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
  }
  const token = header.slice(7)

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' })
  }

  // Accept both Node.js-issued (session:) and Rust-issued (nodyx:session:) sessions
  const [nodeSession, nodyx_session] = await Promise.all([
    redis.exists(`session:${token}`),
    redis.exists(`nodyx:session:${token}`),
  ])
  if (!nodeSession && !nodyx_session) {
    return reply.code(401).send({ error: 'Session expired', code: 'SESSION_EXPIRED' })
  }

  const communityId = await getInstanceCommunityId()
  if (!communityId) {
    return reply.code(500).send({ error: 'Instance not configured', code: 'SERVER_ERROR' })
  }

  const { rows } = await db.query(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2`,
    [communityId, payload.userId]
  )

  if (!rows[0] || !['owner', 'admin'].includes(rows[0].role)) {
    return reply.code(403).send({ error: 'Admin access required', code: 'FORBIDDEN' })
  }

  request.user = payload
  redis.setex(`nodyx:heartbeat:${payload.userId}`, 900, '1').catch(() => {})
}
