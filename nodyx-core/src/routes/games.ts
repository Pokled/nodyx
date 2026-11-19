// Le catalogue de jeux de la communauté (§10 du CDC des mentions, D66).
//   GET    /games?q=          les jeux du catalogue (membres)
//   GET    /games/status      Steam disponible ? la personne peut-elle gérer le catalogue ?
//   POST   /games             ajouter un jeu avec sa jaquette téléversée (équipe)
//   GET    /games/steam?q=    chercher sur Steam (équipe ; le serveur interroge, pas le navigateur)
//   POST   /games/steam       copier la jaquette Steam sur l'instance (équipe)
//   DELETE /games/:id         retirer un jeu (équipe)
import type { FastifyInstance, FastifyReply } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { instanceCommunityId } from '../services/mentionPeople'
import { isTeam } from '../services/mentionGroups'
import { listGames, addUploadedGame, steamSearch, importSteamGame, deleteGame, steamEnabled, GameError } from '../services/eventGames'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof GameError) return reply.code(e.status).send({ error: e.message, code: e.code })
  throw e
}

export default async function gamesRoutes(app: FastifyInstance) {
  async function member(request: any, reply: FastifyReply): Promise<string | null> {
    const communityId = await instanceCommunityId()
    if (!communityId) { reply.code(404).send({ error: 'Communauté introuvable', code: 'COMMUNITY_NOT_FOUND' }); return null }
    return communityId
  }
  async function team(request: any, reply: FastifyReply): Promise<string | null> {
    const communityId = await member(request, reply)
    if (!communityId) return null
    if (!(await isTeam(communityId, request.user.userId))) {
      reply.code(403).send({ error: "Seule l'équipe gère le catalogue de jeux", code: 'GAME_TEAM_ONLY' }); return null
    }
    return communityId
  }

  app.get('/', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await member(request, reply); if (!communityId) return
    const { q } = (request.query ?? {}) as { q?: string }
    return reply.send({ games: await listGames(communityId, typeof q === 'string' ? q : '') })
  })

  app.get('/status', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await member(request, reply); if (!communityId) return
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ steam: steamEnabled(), can_manage: await isTeam(communityId, (request as any).user.userId) })
  })

  app.post('/', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await team(request, reply); if (!communityId) return
    let name: unknown = null, buf: Buffer | null = null, mime = ''
    try {
      for await (const part of (request as any).parts({ limits: { fileSize: 5 * 1024 * 1024 + 1, files: 1, fields: 4 } })) {
        if (part.type === 'file') { mime = part.mimetype; buf = await part.toBuffer() }
        else if (part.fieldname === 'name') name = part.value
      }
    } catch {
      return reply.code(400).send({ error: 'Envoi illisible ou trop lourd (5 Mo au plus)', code: 'GAME_COVER_SIZE' })
    }
    if (!buf) return reply.code(400).send({ error: 'Jaquette requise', code: 'GAME_COVER_REQUIRED' })
    try { return reply.code(201).send({ game: await addUploadedGame(communityId, (request as any).user.userId, name, buf, mime) }) }
    catch (e) { return fail(reply, e) }
  })

  app.get('/steam', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    if (!(await team(request, reply))) return
    const { q } = (request.query ?? {}) as { q?: string }
    try { return reply.send({ results: await steamSearch(typeof q === 'string' ? q : '') }) }
    catch (e) { return fail(reply, e) }
  })

  app.post('/steam', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await team(request, reply); if (!communityId) return
    const { appid, name } = (request.body ?? {}) as { appid?: unknown; name?: unknown }
    try { return reply.code(201).send({ game: await importSteamGame(communityId, (request as any).user.userId, appid, name) }) }
    catch (e) { return fail(reply, e) }
  })

  app.delete<{ Params: { id: string } }>('/:id', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const communityId = await team(request, reply); if (!communityId) return
    if (!UUID.test(request.params.id) || !(await deleteGame(communityId, request.params.id))) {
      return reply.code(404).send({ error: 'Jeu introuvable', code: 'GAME_NOT_FOUND' })
    }
    return reply.send({ ok: true })
  })
}
