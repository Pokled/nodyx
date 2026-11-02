// Garde des routes de l'équipe par PERMISSION (et non plus par rôle).
// Le calcul des droits vit dans services/permissions.ts (socle du rôle + grade).
// Remplace l'ancien checkPermission, qui n'était branché nulle part.

import { FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../config/database'
import { verifyStaffSession } from './adminOnly'
import { getInstanceAccess, type Permission, type MemberAccess } from '../services/permissions'

declare module 'fastify' {
  interface FastifyRequest {
    /** Droits de l'utilisateur dans la communauté de l'instance (posé par requirePermission). */
    access?: MemberAccess
  }
}

async function guard(
  request: FastifyRequest,
  reply: FastifyReply,
  allowed: (access: MemberAccess) => boolean,
): Promise<FastifyReply | void> {
  const payload = await verifyStaffSession(request, reply)
  // Réponse 401 déjà envoyée : rendre la reply arrête la chaîne Fastify
  if (!payload) return reply
  const access = await getInstanceAccess(payload.userId)
  if (!allowed(access)) {
    return reply.code(403).send({ error: 'Missing permission', code: 'FORBIDDEN' })
  }
  request.user = payload
  request.access = access
  redis.setex(`heartbeat:${payload.userId}`, 900, '1').catch(() => {})
}

/** La route exige CETTE permission dans la communauté de l'instance. */
export function requirePermission(permission: Permission) {
  return (request: FastifyRequest, reply: FastifyReply) =>
    guard(request, reply, a => a.permissions.includes(permission))
}

/** La route exige L'UNE de ces permissions. */
export function requireAnyPermission(...permissions: Permission[]) {
  return (request: FastifyRequest, reply: FastifyReply) =>
    guard(request, reply, a => permissions.some(p => a.permissions.includes(p)))
}

/** La route est ouverte à toute l'équipe (au moins une permission). */
export async function requireStaff(request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply | void> {
  return guard(request, reply, a => a.permissions.length > 0)
}
