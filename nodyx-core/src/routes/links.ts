// « Nodyx relié » : GET /api/v1/links/resolve?url=…  →  { card }
// card = null : ce n'est pas un lien interne reconnu (il reste un lien ordinaire).
// card.type = 'unavailable' : lien interne, mais introuvable OU interdit à ce lecteur.
// Règles et sécurité : services/linkCards.ts.
import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { optionalAuth, requireAuth } from '../middleware/auth'
import { parseInternalLink, resolveCard } from '../services/linkCards'
import { searchLinks, LINK_KINDS, type LinkKind } from '../services/linkSearch'
import { suggestPlaces, resolvePlaces, PLACE_VALUE } from '../services/places'

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

  // GET /api/v1/links/places?q=… : « # » (lot C4). Endroits que CE compte peut ouvrir,
  // dans l'ordre de D59, 8 au plus. q vide : les mêmes, sans filtre.
  app.get('/places', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { q } = (request.query ?? {}) as { q?: unknown }
    const text = typeof q === 'string' ? q.trim() : ''
    if (text.length > 64) return reply.code(400).send({ error: 'Query must be 64 characters at most', code: 'PLACE_QUERY_INVALID' })
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ places: await suggestPlaces(text, request.user!.userId) })
  })

  // POST /api/v1/links/places/resolve { refs: ["event:<id>", …] } : le nom à jour de
  // chaque endroit marqué, POUR CE LECTEUR (même sans compte : un sujet du forum est
  // public). Introuvable ou interdit : { ok: false }, sans rien révéler. 50 au plus.
  app.post('/places/resolve', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    const { refs } = (request.body ?? {}) as { refs?: unknown }
    if (!Array.isArray(refs) || refs.length < 1 || refs.length > 50 || !refs.every(r => typeof r === 'string' && PLACE_VALUE.test(r))) {
      return reply.code(400).send({ error: 'refs must be 1 to 50 place references', code: 'PLACE_REFS_INVALID' })
    }
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ places: await resolvePlaces(refs as string[], (request as any).user?.userId ?? null) })
  })
}
