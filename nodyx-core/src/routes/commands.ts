// GET /api/v1/commands/bang : les commandes « ! » réellement utilisables par la
// personne (C6, D58). Sans compte : seulement celles du chat Twitch, publiques.
import type { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { optionalAuth } from '../middleware/auth'
import { bangCommands } from '../services/bangCommands'

export default async function commandsRoutes(app: FastifyInstance) {
  app.get('/bang', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store')
    return reply.send(await bangCommands((request as any).user?.userId ?? null))
  })
}
