// Les chartes (lot 7, services/charter.ts ; CDC §E4j).
//
// Côté membre (/api/v1/charter) :
//   GET  /status               dois-je signer la charte des membres ? celle de l'équipe ?
//   GET  /:audience            la charte à lire (ouvre la lecture : le chrono part de là)
//   POST /:audience/progress   jusqu'où j'ai lu (ne fait que monter)
//   POST /:audience/sign       signer
//
// Côté équipe (/api/v1/admin/charter) : lire = manage_octoguard ou moderate_members,
// écrire = manage_octoguard.
//   GET  /:audience            réglages, brouillon, versions, « prête à allumer ? »
//   PUT  /:audience/settings   allumer, ton de la case, signer à la main
//   PUT  /:audience/draft      enregistrer le brouillon (nettoyé)
//   POST /:audience/publish    publier le brouillon ({ important })
//   GET  /:audience/overview   chiffres, parcours des 30 jours, où l'on abandonne
//   GET  /:audience/people     ?tab=recent|pending|bots&q=
//   GET  /:audience/journal    les dernières entrées du journal (signatures, robots, versions)
import type { FastifyInstance, FastifyReply } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { requirePermission, requireAnyPermission } from '../middleware/permissions'
import { instanceCommunityId } from '../services/mentionPeople'
import { getAccess } from '../services/permissions'
import {
  isAudience, mustSign, openCharter, recordProgress, signCharter, CharterError, type Audience, releasePendingWelcome,
  charterAdmin, updateCharterSettings, saveCharterDraft, publishCharter, charterOverview, charterPeople, charterJournal,
} from '../services/charter'

function fail(reply: FastifyReply, e: unknown) {
  if (e instanceof CharterError) return reply.code(e.status).send({ error: e.message, code: e.code })
  throw e
}
function audienceOf(params: unknown, reply: FastifyReply): Audience | null {
  const a = (params as { audience?: string }).audience
  if (isAudience(a)) return a
  reply.code(404).send({ error: 'Unknown charter', code: 'CHARTER_NOT_FOUND' })
  return null
}
const userIdOf = (request: unknown) => (request as { user: { userId: string } }).user.userId

/** La charte de l'équipe ne se lit que par l'équipe (propriétaire compris). */
async function mayRead(aud: Audience, userId: string): Promise<boolean> {
  if (aud === 'members') return true
  const communityId = await instanceCommunityId()
  if (!communityId) return false
  return (await getAccess(communityId, userId)).permissions.length > 0
}

export async function charterRoutes(app: FastifyInstance) {
  app.get('/status', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const userId = userIdOf(request)
    reply.header('Cache-Control', 'private, no-store')
    const members = await mustSign('members', userId)
    // Plus rien à signer (charte éteinte entre-temps) : l'accueil en attente part maintenant
    if (!members) void releasePendingWelcome(userId)
    return reply.send({ members, team: await mustSign('team', userId) })
  })

  app.get('/:audience', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    const userId = userIdOf(request)
    if (!(await mayRead(aud, userId))) return reply.code(403).send({ error: 'Team only', code: 'CHARTER_TEAM_ONLY' })
    reply.header('Cache-Control', 'private, no-store')
    return reply.send(await openCharter(aud, userId))
  })

  app.post('/:audience/progress', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    const b = (request.body ?? {}) as { version?: unknown; pct?: unknown; section?: unknown; bottom?: unknown }
    if (!Number.isInteger(b.version) || typeof b.pct !== 'number' || !Number.isFinite(b.pct)
      || (b.section !== undefined && (typeof b.section !== 'number' || !Number.isFinite(b.section)))) {
      return reply.code(400).send({ error: 'version (integer) and pct (number) are required', code: 'CHARTER_PROGRESS_INVALID' })
    }
    return reply.send(await recordProgress(aud, userIdOf(request), {
      version: b.version as number, pct: b.pct, section: (b.section as number | undefined) ?? 0, bottom: b.bottom === true,
    }))
  })

  app.post('/:audience/sign', { preHandler: [rateLimit, requireAuth] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    const userId = userIdOf(request)
    if (!(await mayRead(aud, userId))) return reply.code(403).send({ error: 'Team only', code: 'CHARTER_TEAM_ONLY' })
    // La fausse case arrive sous un nom ordinaire (human_check) : rien, dans ce qui passe
    // sur le réseau, ne doit trahir le piège. « decoy » reste accepté.
    const b = (request.body ?? {}) as { version?: unknown; way?: unknown; pledge?: unknown; decoy?: unknown; human_check?: unknown; typed?: unknown }
    const trap = b.human_check !== undefined ? b.human_check : b.decoy
    if (!Number.isInteger(b.version) || (b.way !== 'hand' && b.way !== 'phrase')) {
      return reply.code(400).send({ error: 'version and way (hand | phrase) are required', code: 'CHARTER_SIGN_INVALID' })
    }
    try {
      return reply.send(await signCharter(aud, userId, {
        version: b.version as number, way: b.way, pledge: b.pledge === true,
        // La fausse case : toute valeur « vraie » compte (un robot coche comme il peut)
        decoy: trap === true || trap === 'on' || trap === 1 || trap === '1',
        typed: typeof b.typed === 'number' && Number.isFinite(b.typed) ? b.typed : 0,
      }))
    } catch (e) { return fail(reply, e) }
  })
}

export async function charterAdminRoutes(app: FastifyInstance) {
  const read = requireAnyPermission('manage_octoguard', 'moderate_members')
  const write = requirePermission('manage_octoguard')

  app.get('/:audience', { preHandler: [rateLimit, read] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    reply.header('Cache-Control', 'private, no-store')
    return reply.send(await charterAdmin(aud))
  })

  app.put('/:audience/settings', { preHandler: [rateLimit, write] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    try { return reply.send(await updateCharterSettings(aud, userIdOf(request), (request.body ?? {}) as Record<string, unknown>)) }
    catch (e) { return fail(reply, e) }
  })

  app.put('/:audience/draft', { preHandler: [rateLimit, write] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    try { return reply.send(await saveCharterDraft(aud, userIdOf(request), ((request.body ?? {}) as { html?: unknown }).html)) }
    catch (e) { return fail(reply, e) }
  })

  app.post('/:audience/publish', { preHandler: [rateLimit, write] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    try { return reply.code(201).send(await publishCharter(aud, userIdOf(request), ((request.body ?? {}) as { important?: unknown }).important)) }
    catch (e) { return fail(reply, e) }
  })

  app.get('/:audience/overview', { preHandler: [rateLimit, read] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    reply.header('Cache-Control', 'private, no-store')
    return reply.send(await charterOverview(aud))
  })

  app.get('/:audience/journal', { preHandler: [rateLimit, read] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ entries: await charterJournal(aud) })
  })

  app.get('/:audience/people', { preHandler: [rateLimit, read] }, async (request, reply) => {
    const aud = audienceOf(request.params, reply); if (!aud) return
    const { tab, q } = (request.query ?? {}) as { tab?: string; q?: string }
    if (tab !== 'recent' && tab !== 'pending' && tab !== 'bots') {
      return reply.code(400).send({ error: 'tab must be recent, pending or bots', code: 'CHARTER_TAB_INVALID' })
    }
    reply.header('Cache-Control', 'private, no-store')
    return reply.send({ people: await charterPeople(aud, tab, typeof q === 'string' ? q.trim().slice(0, 64) : '') })
  })
}
