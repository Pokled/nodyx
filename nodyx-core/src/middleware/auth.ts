import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { redis } from '../config/database'

// ── Types ────────────────────────────────────────────────────

export interface JwtPayload {
  userId:   string
  username: string
}

// Augment Fastify's request type so routes can access req.user
declare module 'fastify' {
  interface FastifyRequest {
    user?: JwtPayload
  }
}

// ── Helpers ──────────────────────────────────────────────────

function extractToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7)
}

// ── Middleware ───────────────────────────────────────────────

// Requires a valid session — rejects with 401 if missing or expired
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const token = extractToken(request)
  if (!token) {
    return reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
  }

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
  } catch {
    return reply.code(401).send({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' })
  }

  // Confirm session is still alive in Redis (check both Node.js and Rust session key prefixes)
  const [nodeSession, nodyx_session] = await Promise.all([
    redis.exists(`session:${token}`),
    redis.exists(`nodyx:session:${token}`),
  ])
  if (!nodeSession && !nodyx_session) {
    return reply.code(401).send({ error: 'Session expired', code: 'SESSION_EXPIRED' })
  }

  // Reject banned users immediately (check both Node.js and Rust ban key prefixes)
  const [isBannedNode, isBannedNodyx] = await Promise.all([
    redis.exists(`banned:${payload.userId}`),
    redis.exists(`nodyx:banned:${payload.userId}`),
  ])
  if (isBannedNode || isBannedNodyx) {
    return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
  }

  request.user = payload

  // Track online presence — fire-and-forget, 15-minute TTL per user
  redis.setex(`nodyx:heartbeat:${payload.userId}`, 900, '1').catch(() => {})
}

// Attaches user if a valid token is present, but never rejects
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractToken(request)
  if (!token) return

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
    const [nodeSession, nodyx_session] = await Promise.all([
      redis.exists(`session:${token}`),
      redis.exists(`nodyx:session:${token}`),
    ])
    if (nodeSession || nodyx_session) {
      request.user = payload
      redis.setex(`nodyx:heartbeat:${payload.userId}`, 900, '1').catch(() => {})
    }
  } catch {
    // Invalid token — silently ignored
  }
}
