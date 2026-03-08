import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import { db, redis } from '../config/database'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as UserModel from '../models/user'
import { isSmtpConfigured, sendPasswordResetEmail } from '../services/emailService'

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

const SESSION_TTL   = 7 * 24 * 60 * 60 // 7 days in seconds
const RESET_TTL_SEC = 60 * 60           // 1 hour
const BCRYPT_ROUNDS = 12

// ── Helpers ──────────────────────────────────────────────────────────────────

// Rate limit strict pour forgot-password : 3 req / 15 min / IP
async function forgotPasswordRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key   = `reset_rate:${request.ip}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 15 * 60)
  if (count > 3) {
    reply.header('Retry-After', String(15 * 60))
    return reply.code(429).send({
      error: 'Trop de tentatives. Réessayez dans 15 minutes.',
      code:  'RATE_LIMITED',
    })
  }
}

// Rate limit strict pour login : 10 tentatives / 15 min / IP
async function loginRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key   = `login_rate:${request.ip}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 15 * 60)
  if (count > 10) {
    const ttl = await redis.ttl(key)
    reply.header('Retry-After', String(ttl))
    return reply.code(429).send({
      error: 'Trop de tentatives de connexion. Réessayez dans 15 minutes.',
      code:  'RATE_LIMITED',
    })
  }
}

// Rate limit pour register : 5 comptes / heure / IP
async function registerRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key   = `register_rate:${request.ip}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60 * 60)
  if (count > 5) {
    reply.header('Retry-After', String(60 * 60))
    return reply.code(429).send({
      error: 'Trop de créations de compte depuis cette IP. Réessayez dans une heure.',
      code:  'RATE_LIMITED',
    })
  }
}

// Supprime toutes les sessions Redis d'un utilisateur (invalidation post-reset)
async function invalidateUserSessions(userId: string): Promise<void> {
  let cursor = '0'
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', 'session:*', 'COUNT', '200')
    cursor = next
    if (keys.length > 0) {
      const values = await Promise.all(keys.map((k: string) => redis.get(k)))
      const toDelete = keys.filter((_: string, i: number) => values[i] === userId)
      if (toDelete.length > 0) await redis.del(...toDelete)
    }
  } while (cursor !== '0')
}

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
    preHandler: [rateLimit, registerRateLimit, validate({ body: RegisterBody })],
  }, async (request, reply) => {
    const { username, email, password } = request.body as z.infer<typeof RegisterBody>

    const clientIp = request.ip

    const maxMembers = process.env.NEXUS_MAX_MEMBERS ? parseInt(process.env.NEXUS_MAX_MEMBERS, 10) : null

    const [existingEmail, existingUsername, ipBan, emailBan, memberCount] = await Promise.all([
      UserModel.findByEmail(email),
      UserModel.findByUsername(username),
      db.query(`SELECT 1 FROM ip_bans WHERE ip = $1::inet LIMIT 1`, [clientIp]),
      db.query(
        `SELECT 1 FROM email_bans
         WHERE $1 = email OR $1 LIKE '%@' || email
         LIMIT 1`,
        [email]
      ),
      maxMembers
        ? db.query<{ count: number }>(
            `SELECT COUNT(*)::int AS count FROM users u
             WHERE NOT EXISTS (
               SELECT 1 FROM community_bans cb
               JOIN communities c ON c.id = cb.community_id
               WHERE cb.user_id = u.id LIMIT 1
             )`
          )
        : Promise.resolve(null),
    ])

    if (existingEmail) {
      return reply.code(409).send({ error: 'Email already in use', code: 'EMAIL_TAKEN' })
    }
    if (existingUsername) {
      return reply.code(409).send({ error: 'Username already taken', code: 'USERNAME_TAKEN' })
    }
    if (ipBan.rows.length > 0) {
      return reply.code(403).send({ error: 'Registration not allowed', code: 'FORBIDDEN' })
    }
    if (emailBan.rows.length > 0) {
      return reply.code(403).send({ error: 'Registration not allowed', code: 'FORBIDDEN' })
    }
    if (maxMembers !== null && memberCount && memberCount.rows[0].count >= maxMembers) {
      return reply.code(403).send({ error: 'This instance has reached its member limit', code: 'INSTANCE_FULL' })
    }

    const user  = await UserModel.create({ username, email, password })
    // Store registration IP
    await db.query(`UPDATE users SET registration_ip = $1::inet WHERE id = $2`, [clientIp, user.id]).catch(() => {})

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
    preHandler: [rateLimit, loginRateLimit, validate({ body: LoginBody })],
  }, async (request, reply) => {
    const { email, password } = request.body as z.infer<typeof LoginBody>

    const [user, ipBanRes] = await Promise.all([
      UserModel.findByEmail(email),
      db.query(`SELECT 1 FROM ip_bans WHERE ip = $1::inet LIMIT 1`, [request.ip]),
    ])

    if (ipBanRes.rows.length > 0) {
      return reply.code(403).send({ error: 'Access denied', code: 'FORBIDDEN' })
    }

    // Toujours exécuter bcrypt pour éviter les timing attacks par énumération d'emails
    const DUMMY_HASH = '$2b$12$invalidhashusedtopreventimaginarytimingattacksXXXXXXXXXX'
    const valid = await UserModel.verifyPassword(password, user?.password ?? DUMMY_HASH)

    if (!user || !valid) {
      return reply.code(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    // Block banned users — check Redis first (fast), then DB as fallback for pre-existing bans
    const redisBanned = await redis.exists(`banned:${user.id}`)
    if (redisBanned) {
      return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
    }
    const loginCommunityId = await getDefaultCommunityId()
    if (loginCommunityId) {
      const { rows: banRows } = await db.query(
        `SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
        [loginCommunityId, user.id]
      )
      if (banRows.length > 0) {
        // Populate Redis cache for future checks
        await redis.set(`banned:${user.id}`, '1')
        return reply.code(403).send({ error: 'You are banned from this community', code: 'BANNED' })
      }
    }

    const token = signToken(user.id, user.username)
    await redis.set(`session:${token}`, user.id, 'EX', SESSION_TTL)

    // Ensure user is in community_members — only if not banned
    const communityId = await getDefaultCommunityId()
    if (communityId) {
      await db.query(
        `INSERT INTO community_members (community_id, user_id, role)
         SELECT $1, $2, 'member'
         WHERE NOT EXISTS (
           SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2
         )
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

  // ── Mot de passe oublié ───────────────────────────────────────────────────

  // POST /api/v1/auth/forgot-password
  // Anti-énumération : réponse identique qu'un compte existe ou non.
  app.post('/forgot-password', {
    preHandler: [forgotPasswordRateLimit, validate({ body: z.object({ email: z.string().email() }) })],
  }, async (request, reply) => {
    const { email } = request.body as { email: string }

    const user = await UserModel.findByEmail(email)

    if (user) {
      // Invalider les tokens existants non utilisés (one active reset at a time)
      await db.query(
        `DELETE FROM password_resets WHERE user_id = $1 AND used_at IS NULL`,
        [user.id]
      )

      // Générer un token 256 bits — seul le hash SHA-256 est stocké
      const rawToken  = crypto.randomBytes(32).toString('hex')
      const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex')
      const expiresAt = new Date(Date.now() + RESET_TTL_SEC * 1000)

      await db.query(
        `INSERT INTO password_resets (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)`,
        [user.id, tokenHash, expiresAt, request.ip, request.headers['user-agent'] ?? null]
      )

      const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${rawToken}`

      if (isSmtpConfigured()) {
        try {
          await sendPasswordResetEmail({ to: user.email, username: user.username, resetUrl })
        } catch (err) {
          request.log.error({ err }, 'Failed to send password reset email')
          // Ne pas exposer l'erreur SMTP à l'utilisateur
        }
      }
      // Si SMTP non configuré : token créé, l'admin peut le générer via /admin/members
    }

    // Toujours la même réponse (anti-énumération)
    return reply.send({
      message: 'Si cet email est enregistré, vous recevrez un lien de réinitialisation.',
    })
  })

  // GET /api/v1/auth/verify-reset/:token
  // Vérifie qu'un token est valide avant d'afficher le formulaire.
  app.get('/verify-reset/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')

    const { rows } = await db.query<{ username: string }>(
      `SELECT u.username
       FROM password_resets pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = $1
         AND pr.used_at IS NULL
         AND pr.expires_at > NOW()`,
      [tokenHash]
    )

    if (!rows[0]) {
      return reply.code(404).send({ error: 'Lien invalide ou expiré.', code: 'INVALID_TOKEN' })
    }

    return reply.send({ username: rows[0].username })
  })

  // POST /api/v1/auth/reset-password/:token
  // Change le mot de passe et invalide toutes les sessions actives.
  app.post('/reset-password/:token', {
    preHandler: [rateLimit, validate({ body: z.object({ password: z.string().min(8).max(100) }) })],
  }, async (request, reply) => {
    const { token }    = request.params as { token: string }
    const { password } = request.body as { password: string }
    const tokenHash    = crypto.createHash('sha256').update(token).digest('hex')

    // Marquer le token comme utilisé de façon atomique (UPDATE … RETURNING)
    const { rows } = await db.query<{ user_id: string }>(
      `UPDATE password_resets
       SET used_at = NOW()
       WHERE token_hash = $1
         AND used_at IS NULL
         AND expires_at > NOW()
       RETURNING user_id`,
      [tokenHash]
    )

    if (!rows[0]) {
      return reply.code(400).send({ error: 'Lien invalide ou expiré.', code: 'INVALID_TOKEN' })
    }

    const userId        = rows[0].user_id
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS)

    await db.query(
      `UPDATE users SET password = $1, updated_at = NOW() WHERE id = $2`,
      [hashedPassword, userId]
    )

    // Invalider toutes les sessions actives de l'utilisateur
    await invalidateUserSessions(userId)

    return reply.send({ message: 'Mot de passe réinitialisé. Vous pouvez vous connecter.' })
  })
}
