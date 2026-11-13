// « Nodyx relié » : GET /api/v1/links/resolve?url=…  →  { card }
// card = null : ce n'est pas un lien interne reconnu (il reste un lien ordinaire).
// card.type = 'unavailable' : lien interne, mais introuvable OU interdit à ce lecteur.
// Règles et sécurité : services/linkCards.ts.
import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { optionalAuth } from '../middleware/auth'
import { parseInternalLink, resolveCard } from '../services/linkCards'

export default async function linksRoutes(app: FastifyInstance) {
  app.get('/resolve', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    const { url } = (request.query ?? {}) as { url?: unknown }
    if (typeof url !== 'string' || !url) {
      return reply.code(400).send({ error: 'Missing url', code: 'LINK_URL_REQUIRED' })
    }
    const ref = parseInternalLink(url)
    if (!ref) return reply.send({ card: null })
    const viewerId = (request as any).user?.userId ?? null
    // Une carte dépend du lecteur (droits, « je participe ») : jamais en cache partagé.
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ card: await resolveCard(ref, viewerId) })
  })
}
