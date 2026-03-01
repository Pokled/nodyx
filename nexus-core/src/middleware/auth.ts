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

  // Confirm session is still alive in Redis
  const sessionKey = `session:${token}`
  const alive = await redis.exists(sessionKey)
  if (!alive) {
    return reply.code(401).send({ error: 'Session expired', code: 'SESSION_EXPIRED' })
  }

  request.user = payload

  // Track online presence — fire-and-forget, 15-minute TTL per user
  redis.setex(`nexus:heartbeat:${payload.userId}`, 900, '1').catch(() => {})
}

// Attaches user if a valid token is present, but never rejects
export async function optionalAuth(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
  const token = extractToken(request)
  if (!token) return

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as JwtPayload
    const alive = await redis.exists(`session:${token}`)
    if (alive) {
      request.user = payload
      redis.setex(`nexus:heartbeat:${payload.userId}`, 900, '1').catch(() => {})
    }
  } catch {
    // Invalid token — silently ignored
  }
}
