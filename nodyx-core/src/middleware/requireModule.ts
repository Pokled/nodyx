/**
 * requireModule(moduleId) — Fastify preHandler factory.
 *
 * Returns a preHandler that blocks the route with 503 if the given module
 * is disabled on this instance. Module state is Redis-cached (60 s TTL)
 * and invalidated immediately when an admin toggles the module.
 *
 * Usage:
 *   app.get('/wiki', { preHandler: [requireAuth, requireModule('wiki')] }, handler)
 */

import { FastifyRequest, FastifyReply } from 'fastify'
import { db, redis } from '../config/database.js'

const CACHE_TTL_SECONDS = 60

export function requireModule(moduleId: string) {
  return async function (_req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
      const cacheKey = `module:${moduleId}:enabled`
      const cached   = await redis.get(cacheKey)

      if (cached !== null) {
        if (cached === '0') {
          reply.code(503).send({
            error:   'module_disabled',
            message: `Le module "${moduleId}" n'est pas activé sur cette instance.`,
            module:  moduleId,
          })
        }
        return // '1' → enabled, continue
      }

      // Cache miss — hit the DB
      const { rows } = await db.query(
        `SELECT enabled FROM modules WHERE id = $1`,
        [moduleId]
      )
      const enabled = rows[0]?.enabled ?? false

      await redis.setex(cacheKey, CACHE_TTL_SECONDS, enabled ? '1' : '0')

      if (!enabled) {
        reply.code(503).send({
          error:   'module_disabled',
          message: `Le module "${moduleId}" n'est pas activé sur cette instance.`,
          module:  moduleId,
        })
      }
    } catch {
      // Redis/DB failure → fail open (never block legitimate traffic)
    }
  }
}
