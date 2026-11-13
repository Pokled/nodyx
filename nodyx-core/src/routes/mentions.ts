// Mentions, vague 1 (SPECS/NODYX_MENTIONS_CDC.md, D49-D50).
//   GET /api/v1/mentions/suggest?q=&channel_id=|thread_id=  → propositions pendant la frappe
//   GET /api/v1/mentions/people?ids=a,b,c                   → les puces d'un contenu, à jour
import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { suggestPeople, peopleByIds } from '../services/mentionPeople'

export default async function mentionsRoutes(app: FastifyInstance) {
  app.get('/suggest', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const { q, channel_id, thread_id } = request.query as { q?: string; channel_id?: string; thread_id?: string }
    if (typeof q === 'string' && q.length > 60) {
      return reply.code(400).send({ error: 'Recherche trop longue', code: 'MENTION_QUERY_TOO_LONG' })
    }
    const people = await suggestPeople(request.user!.userId, q ?? '', {
      channelId: typeof channel_id === 'string' ? channel_id : undefined,
      threadId:  typeof thread_id === 'string' ? thread_id.slice(0, 300) : undefined,
    })
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ people })
  })

  // Lecture publique : une puce s'affiche aussi pour un visiteur d'un sujet public.
  // Seuls des champs publics (pseudo, nom affiché, avatar, grade) en sortent.
  app.get('/people', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    const { ids } = request.query as { ids?: string }
    if (typeof ids !== 'string' || !ids) {
      return reply.code(400).send({ error: 'Identifiants requis', code: 'MENTION_IDS_REQUIRED' })
    }
    const list = ids.split(',')
    if (list.length > 50) return reply.code(400).send({ error: 'Trop d’identifiants', code: 'MENTION_IDS_TOO_MANY' })
    reply.header('Cache-Control', 'private, max-age=30')
    return reply.send({ people: await peopleByIds(list) })
  })
}
