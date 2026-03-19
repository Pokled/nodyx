import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as CommunityModel from '../models/community'
import * as GradeModel from '../models/grade'
import { db } from '../config/database'

const GradeBody = z.object({
  name:        z.string().min(1).max(100),
  color:       z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  position:    z.number().int().optional(),
  permissions: z.object({
    can_post:            z.boolean().optional(),
    can_create_thread:   z.boolean().optional(),
    can_create_category: z.boolean().optional(),
    can_moderate:        z.boolean().optional(),
    can_manage_members:  z.boolean().optional(),
    can_manage_grades:   z.boolean().optional(),
  }).optional(),
})

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
  app.post('/', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateBody })],
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

    const member = await CommunityModel.getMember(community.id, request.user!.userId)
    if (!member || !['owner', 'admin'].includes(member.role)) {
      return reply.code(403).send({ error: 'Admin required', code: 'FORBIDDEN' })
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

    const member = await CommunityModel.getMember(community.id, request.user!.userId)
    if (!member || !['owner', 'admin'].includes(member.role)) {
      return reply.code(403).send({ error: 'Admin required', code: 'FORBIDDEN' })
    }

    const grade = await GradeModel.update(id, community.id, data)
    if (!grade) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }

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

    const member = await CommunityModel.getMember(community.id, request.user!.userId)
    if (!member || !['owner', 'admin'].includes(member.role)) {
      return reply.code(403).send({ error: 'Admin required', code: 'FORBIDDEN' })
    }

    const deleted = await GradeModel.remove(id, community.id)
    if (!deleted) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }

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

    const actor = await CommunityModel.getMember(community.id, request.user!.userId)
    if (!actor || !['owner', 'admin'].includes(actor.role)) {
      return reply.code(403).send({ error: 'Admin required', code: 'FORBIDDEN' })
    }

    const result = await GradeModel.assignToMember(community.id, userId, grade_id)
    if (!result.found) {
      return reply.code(404).send({ error: 'Member not found', code: 'NOT_FOUND' })
    }
    if (!result.gradeValid) {
      return reply.code(404).send({ error: 'Grade not found', code: 'NOT_FOUND' })
    }

    return reply.send({ ok: true })
  })
}
