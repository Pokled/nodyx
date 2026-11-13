// « Nodyx relié » : GET /api/v1/links/resolve?url=…  →  { card }
// card = null : ce n'est pas un lien interne reconnu (il reste un lien ordinaire).
// card.type = 'unavailable' : lien interne, mais introuvable OU interdit à ce lecteur.
// Règles et sécurité : services/linkCards.ts.
import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { optionalAuth, requireAuth } from '../middleware/auth'
import { parseInternalLink, resolveCard } from '../services/linkCards'
import { searchLinks, LINK_KINDS, type LinkKind } from '../services/linkSearch'

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

  // GET /api/v1/links/search?q=…&types=thread,event,member,channel,wiki
  // Pour poser un lien interne depuis l'éditeur. Règles : services/linkSearch.ts.
  app.get('/search', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { q, types } = (request.query ?? {}) as { q?: unknown; types?: unknown }
    const text = typeof q === 'string' ? q.trim() : ''
    if (text.length < 1 || text.length > 100) {
      return reply.code(400).send({ error: 'Query must be 1 to 100 characters', code: 'LINK_QUERY_INVALID' })
    }
    const wanted = typeof types === 'string' && types
      ? types.split(',').map(t => t.trim()).filter((t): t is LinkKind => (LINK_KINDS as string[]).includes(t))
      : LINK_KINDS
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ results: wanted.length ? await searchLinks(text, wanted, request.user!.userId) : [] })
  })
}
