// GET /uploads/_w/<largeur>[s]/<chemin> : la vignette d'une image téléversée
// (services/thumbnails.ts). Passe par le même chemin que /uploads/* (Caddy → cœur).
import type { FastifyInstance } from 'fastify'
import { createReadStream } from 'node:fs'
import { parseThumb, ensureThumb } from '../services/thumbnails'

export default async function thumbnailRoutes(app: FastifyInstance) {
  app.get<{ Params: { w: string; '*': string } }>('/uploads/_w/:w/*', async (request, reply) => {
    const t = parseThumb(request.params.w, request.params['*'] ?? '')
    if (!t) return reply.code(404).send({ error: 'Image introuvable', code: 'THUMB_NOT_FOUND' })
    const file = await ensureThumb(t)
    if (!file) return reply.code(404).send({ error: 'Image introuvable', code: 'THUMB_NOT_FOUND' })
    // Les noms téléversés sont uniques (identifiant ou empreinte) : une vignette ne change jamais
    reply.header('Cache-Control', 'public, max-age=31536000, immutable')
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.type('image/webp')
    return reply.send(createReadStream(file))
  })
}
