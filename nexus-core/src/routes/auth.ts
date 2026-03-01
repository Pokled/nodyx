import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import { db, redis } from '../config/database'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as UserModel from '../models/user'

// Cache the community id for auto-join on register
let _defaultCommunityId: string | null = null
async function getDefaultCommunityId(): Promise<string | null> {
  if (_defaultCommunityId) return _defaultCommunityId
  const slug = process.env.NEXUS_COMMUNITY_SLUG
  const { rows } = await db.query<{ id: string }>(
    slug
      ? `SELECT id FROM communities WHERE slug = $1 LIMIT 1`
      : `SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`,
    slug ? [slug] : []
  )
  _defaultCommunityId = rows[0]?.id ?? null
  return _defaultCommunityId
}

const SESSION_TTL = 7 * 24 * 60 * 60 // 7 days in seconds

const RegisterBody = z.object({
  username: z.string().min(3).max(50),
  email:    z.string().email(),
  password: z.string().min(8).max(100),
})

const LoginBody = z.object({
  email:    z.string().email(),
  password: z.string().min(1),
})

function signToken(userId: string, username: string): string {
  return jwt.sign(
    { userId, username },
    process.env.JWT_SECRET!,
    { expiresIn: '7d' }
  )
}

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/register
  app.post('/register', {
    preHandler: [rateLimit, validate({ body: RegisterBody })],
  }, async (request, reply) => {
    const { username, email, password } = request.body as z.infer<typeof RegisterBody>

    const [existingEmail, existingUsername] = await Promise.all([
      UserModel.findByEmail(email),
      UserModel.findByUsername(username),
    ])

    if (existingEmail) {
      return reply.code(409).send({ error: 'Email already in use', code: 'EMAIL_TAKEN' })
    }
    if (existingUsername) {
      return reply.code(409).send({ error: 'Username already taken', code: 'USERNAME_TAKEN' })
    }

    const user  = await UserModel.create({ username, email, password })
    const token = signToken(user.id, user.username)
    await redis.set(`session:${token}`, user.id, 'EX', SESSION_TTL)

    // Auto-join the instance community as 'member'
    const communityId = await getDefaultCommunityId()
    if (communityId) {
      await db.query(
        `INSERT INTO community_members (community_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING`,
        [communityId, user.id]
      )
    }

    return reply.code(201).send({ token, user })
  })

  // POST /api/v1/auth/login
  app.post('/login', {
    preHandler: [rateLimit, validate({ body: LoginBody })],
  }, async (request, reply) => {
    const { email, password } = request.body as z.infer<typeof LoginBody>

    const user = await UserModel.findByEmail(email)
    if (!user) {
      return reply.code(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    const valid = await UserModel.verifyPassword(password, user.password)
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    const token = signToken(user.id, user.username)
    await redis.set(`session:${token}`, user.id, 'EX', SESSION_TTL)

    // Ensure user is in community_members (handles cases where auto-join
    // failed during registration, e.g. community wasn't created yet)
    const communityId = await getDefaultCommunityId()
    if (communityId) {
      await db.query(
        `INSERT INTO community_members (community_id, user_id, role)
         VALUES ($1, $2, 'member')
         ON CONFLICT DO NOTHING`,
        [communityId, user.id]
      )
    }

    const { password: _, ...publicUser } = user
    return reply.send({ token, user: publicUser })
  })

  // POST /api/v1/auth/logout
  app.post('/logout', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const token = request.headers.authorization!.slice(7)
    await redis.del(`session:${token}`)
    return reply.send({ message: 'Logged out' })
  })
}
