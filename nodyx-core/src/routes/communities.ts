import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/adminOnly'
import * as CommunityModel from '../models/community'
import * as GradeModel from '../models/grade'
import { db } from '../config/database'
import {
  GRADE_PERMISSIONS, getAccess, invalidatePermissions, rankOf,
  type Permission, type MemberAccess,
} from '../services/permissions'

const GradePermissionsBody = z.object(
  Object.fromEntries(GRADE_PERMISSIONS.map(p => [p, z.boolean().optional()])) as Record<Permission, z.ZodOptional<z.ZodBoolean>>
)

const GradeBody = z.object({
  name:        z.string().min(1).max(100),
  color:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  position:    z.number().int().optional(),
  permissions: GradePermissionsBody.optional(),
})

// Permissions qu'un grade accorde (clés à true reconnues)
const ROLE_ADMIN_RANK = rankOf('admin')

function grantedBy(perms: Record<string, unknown> | null | undefined): Permission[] {
  return GRADE_PERMISSIONS.filter(p => perms?.[p] === true)
}

// Anti-escalade : on ne crée, ne modifie, ne supprime, n'attribue ni ne retire
// un grade qui accorde une permission que l'on n'a pas soi-même.
function exceeds(actor: MemberAccess, perms: Record<string, unknown> | null | undefined): Permission[] {
  return grantedBy(perms).filter(p => !actor.permissions.includes(p))
}

const PatchGradeBody = GradeBody.partial()

const AssignGradeBody = z.object({
  grade_id: z.string().uuid().nullable(),
})

const CreateBody = z.object({
  name:        z.string().min(2).max(100),
  slug:        z.string().min(2).max(100).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers and hyphens only'),
  description: z.string().max(1000).optional(),
  is_public:   z.boolean().optional(),
})

export default async function communityRoutes(app: FastifyInstance) {
  // GET /api/v1/communities
  app.get('/', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const communities = await CommunityModel.list({ public_only: true })
    return reply.send({ communities })
  })

  // POST /api/v1/communities
  // Réservé à l'admin de l'instance : Nodyx est "une instance = une
  // communauté, sans exception" (CLAUDE.md), et TOUT le reste du code
  // résout "la" communauté comme la plus ancienne (cf getInstanceCommunityId).
  // Ouvert à tout utilisateur authentifié jusqu'ici, ça ne servait aucun usage
  // légitime (la vraie création d'instance passe par scripts/seed.ts) et
  // permettait de se fabriquer un rôle 'owner' exploitable ailleurs (fils mis
  // en avant, wiki, trouvé en audit le 16/09).
  app.post('/', {
    preHandler: [rateLimit, adminOnly, validate({ body: CreateBody })],
  }, async (request, reply) => {
    const data = request.body as z.infer<typeof CreateBody>

    const existing = await CommunityModel.findBySlug(data.slug)
    if (existing) {
      return reply.code(409).send({ error: 'Slug already taken', code: 'SLUG_TAKEN' })
    }

    const community = await CommunityModel.create({ ...data, owner_id: request.user!.userId })
    await CommunityModel.addMember(community.id, request.user!.userId, 'owner')

    return reply.code(201).send({ community })
  })

  // GET /api/v1/communities/:slug
  app.get('/:slug', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    return reply.send({ community })
  })

  // POST /api/v1/communities/:slug/members  — join
  app.post('/:slug/members', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }
    if (!community.is_public) {
      return reply.code(403).send({ error: 'This community is private', code: 'FORBIDDEN' })
    }

    const existing = await CommunityModel.getMember(community.id, request.user!.userId)
    if (existing) {
      return reply.code(409).send({ error: 'Already a member', code: 'ALREADY_MEMBER' })
    }

    const { rows: banRows } = await db.query(
      `SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
      [community.id, request.user!.userId]
    )
    if (banRows.length > 0) {
      return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
    }

    await CommunityModel.addMember(community.id, request.user!.userId, 'member')
    return reply.code(201).send({ ok: true })
  })

  // DELETE /api/v1/communities/:slug/members  — leave
  app.delete('/:slug/members', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const member = await CommunityModel.getMember(community.id, request.user!.userId)
    if (!member) {
      return reply.code(404).send({ error: 'Not a member', code: 'NOT_FOUND' })
    }
    if (member.role === 'owner') {
      return reply.code(403).send({ error: 'Owner cannot leave their community', code: 'FORBIDDEN' })
    }

    await CommunityModel.removeMember(community.id, request.user!.userId)
    // Ses droits partent avec lui tout de suite (cache de 60 s sinon : un auteur parti gérait encore ses événements)
    await invalidatePermissions(community.id)
    return reply.code(204).send()
  })

  // GET /api/v1/communities/:slug/members
  app.get('/:slug/members', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const members = await CommunityModel.getMembers(community.id)
    return reply.send({ members })
  })

  // ── Grade routes ──────────────────────────────────────────

  // GET /api/v1/communities/:slug/grades
  app.get('/:slug/grades', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string }

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const grades = await GradeModel.listByCommunity(community.id)
    return reply.send({ grades })
  })

  // POST /api/v1/communities/:slug/grades
  app.post('/:slug/grades', {
    preHandler: [rateLimit, requireAuth, validate({ body: GradeBody })],
  }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const data = request.body as z.infer<typeof GradeBody>

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const actor = await getAccess(community.id, request.user!.userId)
    if (!actor.permissions.includes('manage_grades')) {
      return reply.code(403).send({ error: 'Missing permission: manage_grades', code: 'FORBIDDEN' })
    }
    if (exceeds(actor, data.permissions).length > 0) {
      return reply.code(403).send({ error: 'Cannot grant a permission you do not have', code: 'GRADE_ESCALATION' })
    }

    const grade = await GradeModel.create({ community_id: community.id, ...data })
    return reply.code(201).send({ grade })
  })

  // PATCH /api/v1/communities/:slug/grades/:id
  app.patch('/:slug/grades/:id', {
    preHandler: [rateLimit, requireAuth, validate({ body: PatchGradeBody })],
  }, async (request, reply) => {
    const { slug, id } = request.params as { slug: string; id: string }
    const data = request.body as z.infer<typeof PatchGradeBody>

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const actor = await getAccess(community.id, request.user!.userId)
    if (!actor.permissions.includes('manage_grades')) {
      return reply.code(403).send({ error: 'Missing permission: manage_grades', code: 'FORBIDDEN' })
    }
    const current = await GradeModel.findById(id)
    if (!current || current.community_id !== community.id) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }
    // Ni toucher à un grade plus puissant que soi, ni en fabriquer un
    if (exceeds(actor, current.permissions).length > 0 || exceeds(actor, data.permissions).length > 0) {
      return reply.code(403).send({ error: 'Cannot grant a permission you do not have', code: 'GRADE_ESCALATION' })
    }

    const grade = await GradeModel.update(id, community.id, data)
    if (!grade) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }
    if (data.permissions !== undefined) await invalidatePermissions(community.id)

    return reply.send({ grade })
  })

  // DELETE /api/v1/communities/:slug/grades/:id
  app.delete('/:slug/grades/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { slug, id } = request.params as { slug: string; id: string }

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const actor = await getAccess(community.id, request.user!.userId)
    if (!actor.permissions.includes('manage_grades')) {
      return reply.code(403).send({ error: 'Missing permission: manage_grades', code: 'FORBIDDEN' })
    }
    const current = await GradeModel.findById(id)
    if (!current || current.community_id !== community.id) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }
    if (exceeds(actor, current.permissions).length > 0) {
      return reply.code(403).send({ error: 'Cannot remove a grade more powerful than yours', code: 'GRADE_ESCALATION' })
    }

    const deleted = await GradeModel.remove(id, community.id)
    if (!deleted) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }
    await invalidatePermissions(community.id)

    return reply.code(204).send()
  })

  // PATCH /api/v1/communities/:slug/members/:userId/grade
  app.patch('/:slug/members/:userId/grade', {
    preHandler: [rateLimit, requireAuth, validate({ body: AssignGradeBody })],
  }, async (request, reply) => {
    const { slug, userId } = request.params as { slug: string; userId: string }
    const { grade_id } = request.body as z.infer<typeof AssignGradeBody>

    const community = await CommunityModel.findBySlug(slug)
    if (!community) {
      return reply.code(404).send({ error: 'Community not found', code: 'NOT_FOUND' })
    }

    const actor = await getAccess(community.id, request.user!.userId)
    if (!actor.permissions.includes('manage_grades')) {
      return reply.code(403).send({ error: 'Missing permission: manage_grades', code: 'FORBIDDEN' })
    }

    // La cible : son rang, et le grade qu'elle porte déjà
    const { rows: targetRows } = await db.query<{ role: string; permissions: Record<string, unknown> | null }>(
      `SELECT cm.role, cg.permissions
       FROM community_members cm
       LEFT JOIN community_grades cg ON cg.id = cm.grade_id
       WHERE cm.community_id = $1 AND cm.user_id = $2`,
      [community.id, userId]
    )
    if (!targetRows[0]) {
      return reply.code(404).send({ error: 'Member not found', code: 'NOT_FOUND' })
    }
    // Un modérateur ne touche pas au grade d'un admin ; entre admins (titres
    // honorifiques), c'est permis. On peut toujours se l'attribuer à soi.
    const self = userId === request.user!.userId
    if (!self && actor.rank < ROLE_ADMIN_RANK && rankOf(targetRows[0].role) >= actor.rank) {
      return reply.code(403).send({ error: 'Cannot change the grade of a member of equal or higher rank', code: 'RANK_TOO_LOW' })
    }
    // Ni retirer un grade plus puissant que soi, ni en donner un
    const next = grade_id ? await GradeModel.findById(grade_id) : null
    if (exceeds(actor, targetRows[0].permissions).length > 0 || exceeds(actor, next?.permissions).length > 0) {
      return reply.code(403).send({ error: 'Cannot grant or remove a permission you do not have', code: 'GRADE_ESCALATION' })
    }

    const result = await GradeModel.assignToMember(community.id, userId, grade_id)
    if (!result.found) {
      return reply.code(404).send({ error: 'Member not found', code: 'NOT_FOUND' })
    }
    if (!result.gradeValid) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }
    await invalidatePermissions(community.id)

    return reply.send({ ok: true })
  })
}
