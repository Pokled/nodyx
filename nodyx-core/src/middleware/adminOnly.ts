import { FastifyRequest, FastifyReply } from 'fastify'
import jwt from 'jsonwebtoken'
import { redis, db } from '../config/database'
import { JwtPayload } from './auth'

// Cache the instance community id — it never changes at runtime
let _communityId: string | null = null

// Exporté : c'est LE résolveur canonique de "la communauté de cette instance"
// (respecte NODYX_COMMUNITY_SLUG, sinon la plus ancienne). Plusieurs endroits
// du code réimplémentaient leur propre "SELECT ... ORDER BY created_at ASC
// LIMIT 1" ou pire, aucune restriction de communauté du tout, trouvé en
// audit le 16/09 (POST /communities non gardé + 3 vérifications de rôle non
// scopées à CETTE communauté, cf audit_securite_2026_09_15). Toujours passer
// par cette fonction plutôt que de réinventer la résolution.
export async function getInstanceCommunityId(): Promise<string | null> {
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

// Vérifie le jeton Bearer et la session Redis. Renvoie le payload, ou null
// après avoir déjà répondu 401. Partagé par adminOnly et requirePermission
// (middleware/permissions.ts) : une seule façon d'authentifier l'équipe.
export async function verifyStaffSession(request: FastifyRequest, reply: FastifyReply): Promise<JwtPayload | null> {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    reply.code(401).send({ error: 'Missing token', code: 'UNAUTHORIZED' })
    return null
  }
  const token = header.slice(7)

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] }) as JwtPayload
  } catch {
    reply.code(401).send({ error: 'Invalid or expired token', code: 'UNAUTHORIZED' })
    return null
  }

  // Confirm session is alive — ioredis keyPrefix 'nodyx:' applied automatically
  const alive = await redis.exists(`session:${token}`)
  if (!alive) {
    reply.code(401).send({ error: 'Session expired', code: 'SESSION_EXPIRED' })
    return null
  }
  return payload
}

// Requires the current user to be owner or admin of this instance's community
export async function adminOnly(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  const payload = await verifyStaffSession(request, reply)
  // Réponse 401 déjà envoyée : rendre la reply arrête la chaîne Fastify
  if (!payload) return reply

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
  redis.setex(`heartbeat:${payload.userId}`, 900, '1').catch(() => {})
}
