/**
 * routes/geo.ts : « Trouver sur la carte » (services/geocode.ts).
 * GET /api/v1/geo/search?q=…&lang=fr : réservé aux comptes connectés, appelé sur un clic
 * (jamais à la frappe), limité, mis en cache. Le navigateur ne parle jamais au service.
 */
import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { geocodeSearch, langOf, GeoError, GEO_QUERY_MIN, GEO_QUERY_MAX, geocoderEnabled } from '../services/geocode'

export default async function geoRoutes(app: FastifyInstance) {
  // L'interface sait si le bouton a un sens ici (NODYX_GEOCODER=off : il n'apparaît pas)
  app.get('/status', { preHandler: [requireAuth] }, async (_req, reply) => reply.send({ enabled: geocoderEnabled() }))

  app.get('/search', { preHandler: [rateLimit, requireAuth] }, async (req, reply) => {
    const q = String((req.query as Record<string, unknown>).q ?? '').trim()
    if (q.length < GEO_QUERY_MIN || q.length > GEO_QUERY_MAX) {
      return reply.status(400).send({ error: 'Type between 3 and 200 characters', code: 'GEO_QUERY_INVALID' })
    }
    try {
      const results = await geocodeSearch(q, langOf((req.query as Record<string, unknown>).lang))
      return reply.send({ results, attribution: '© OpenStreetMap contributors' })
    } catch (err) {
      const code = err instanceof GeoError ? err.code : 'GEO_UNAVAILABLE'
      const status = code === 'GEO_DISABLED' ? 503 : code === 'GEO_BUSY' ? 429 : 502
      return reply.status(status).send({ error: 'Place search is unavailable', code })
    }
  })
}
