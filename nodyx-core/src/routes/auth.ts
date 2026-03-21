import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import bcrypt from 'bcrypt'
import fs from 'fs'
import { db, redis } from '../config/database'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as UserModel from '../models/user'
import { isSmtpConfigured, sendPasswordResetEmail, sendVerificationEmail } from '../services/emailService'
import { getUserTotp, TOTP_PENDING_TTL } from './totp'

// ── Discord security alerts ───────────────────────────────────────────────────

async function sendSecurityAlert(embed: object): Promise<void> {
  const url = process.env.SECURITY_DISCORD_WEBHOOK
  if (!url) return
  fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ embeds: [embed] }),
  }).catch(() => {})
}

// Cache the community id for auto-join on register
let _defaultCommunityId: string | null = null
async function getDefaultCommunityId(): Promise<string | null> {
  if (_defaultCommunityId) return _defaultCommunityId
  const slug = process.env.NODYX_COMMUNITY_SLUG
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

// Rate limit strict pour login : 5 tentatives / 15 min / IP
async function loginRateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const key   = `login_rate:${request.ip}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 15 * 60)
  if (count > 5) {
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

// ── Index inversé sessions : user_sessions:<userId> → Set de tokens ──────────
// Évite le SCAN itératif sur toutes les clés session:* au moment d'un ban/reset.

export async function trackSession(userId: string, token: string): Promise<void> {
  const indexKey = `user_sessions:${userId}`
  await redis.sadd(indexKey, token)
  await redis.expire(indexKey, SESSION_TTL)
}

export async function invalidateUserSessions(userId: string): Promise<void> {
  const indexKey = `user_sessions:${userId}`
  const tokens = await redis.smembers(indexKey)
  if (tokens.length > 0) {
    await redis.del(...tokens.map((t: string) => `session:${t}`), indexKey)
  } else {
    await redis.del(indexKey)
  }
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
    { expiresIn: '7d', algorithm: 'HS256' }
  )
}

export default async function authRoutes(app: FastifyInstance) {
  // POST /api/v1/auth/register
  app.post('/register', {
    preHandler: [rateLimit, registerRateLimit, validate({ body: RegisterBody })],
  }, async (request, reply) => {
    const { username, email, password } = request.body as z.infer<typeof RegisterBody>

    const clientIp = request.ip

    const maxMembers = process.env.NODYX_MAX_MEMBERS ? parseInt(process.env.NODYX_MAX_MEMBERS, 10) : null

    const [existingEmail, existingUsername, ipBan, emailBan, memberCount] = await Promise.all([
      UserModel.findByEmail(email),
      UserModel.findByUsername(username),
      db.query(`SELECT 1 FROM ip_bans WHERE ip = $1::inet LIMIT 1`, [clientIp]),
      db.query(
        `SELECT 1 FROM email_bans
         WHERE $1 = email OR split_part($1, '@', 2) = email
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

    // Alerte Discord nouvelle inscription
    sendSecurityAlert({
      title:  '👤 Nouvelle inscription',
      color:  0x57f287,
      fields: [
        { name: 'Pseudo',  value: `**${username}**`,   inline: true  },
        { name: 'Email',   value: email,                inline: true  },
        { name: 'IP',      value: `\`${clientIp}\``,   inline: false },
      ],
      timestamp: new Date().toISOString(),
      footer:    { text: 'nodyx-security-monitor' },
    })

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

    // Email verification — only when SMTP is configured
    if (isSmtpConfigured()) {
      const verificationToken = crypto.randomBytes(32).toString('hex')
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24h
      await db.query(
        `UPDATE users SET email_verified = false, email_verification_token = $1 WHERE id = $2`,
        [verificationToken, user.id]
      )
      const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
      const verifyUrl = `${frontendUrl}/auth/verify-email/${verificationToken}`
      sendVerificationEmail({ to: email, username, verifyUrl }).catch(() => {})
      return reply.code(201).send({ pending_verification: true })
    }

    const token = signToken(user.id, user.username)
    await redis.set(`session:${token}`, user.id, 'EX', SESSION_TTL)
    await trackSession(user.id, token)
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

    // Rehash silencieux bcrypt → argon2id au premier login réussi
    if (user && valid && (user.password.startsWith('$2b$') || user.password.startsWith('$2a$'))) {
      UserModel.hashPassword(password)
        .then(newHash => db.query('UPDATE users SET password = $1 WHERE id = $2', [newHash, user.id]))
        .catch(() => {})
    }

    if (!user || !valid) {
      const realIp = (request.headers['cf-connecting-ip'] as string) || request.ip
      const logLine = `${new Date().toISOString()} INVALID_CREDENTIALS ip=${realIp}\n`
      fs.appendFile('/var/log/nodyx-auth.log', logLine, () => {})

      // Alerte brute force : compteur par email ciblé, alerte au 3ème échec
      if (user) {
        const bfKey   = `bf:${user.id}`
        const bfCount = await redis.incr(bfKey)
        if (bfCount === 1) await redis.expire(bfKey, 900) // fenêtre 15 min
        if (bfCount === 3) {
          sendSecurityAlert({
            title:  '⚠️ Brute force détecté',
            color:  0xff9900,
            fields: [
              { name: 'Compte ciblé', value: `**${user.username}** (${email})`, inline: false },
              { name: 'IP',           value: `\`${realIp}\``,                   inline: true  },
              { name: 'Tentatives',   value: `${bfCount} en 15 min`,           inline: true  },
            ],
            timestamp: new Date().toISOString(),
            footer:    { text: 'nodyx-security-monitor' },
          })
        }
      }

      return reply.code(401).send({ error: 'Invalid credentials', code: 'INVALID_CREDENTIALS' })
    }

    // Block login if email not verified
    if (user.email_verified === false) {
      return reply.code(403).send({ error: 'Veuillez confirmer votre adresse email avant de vous connecter.', code: 'EMAIL_NOT_VERIFIED' })
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

    // ── 2FA Signet — prioritaire sur TOTP ────────────────────────────────────
    // Si l'user a au moins un appareil Signet enregistré, on délègue le 2ème
    // facteur à Signet (plus fort qu'un TOTP code) — même flow que le login
    // passwordless mais déclenché automatiquement après vérification password.
    const { rows: signetDevices } = await db.query<{ id: string }>(
      `SELECT id FROM authenticator_devices WHERE user_id = $1 LIMIT 1`,
      [user.id]
    )
    if (signetDevices.length > 0) {
      return reply.send({ requires_signet: true, username: user.username })
    }

    // ── 2FA TOTP — si activé, on émet un token pending au lieu du vrai token ──
    const { totp_enabled } = await getUserTotp(user.id)
    if (totp_enabled) {
      const token       = signToken(user.id, user.username)
      const pendingId   = crypto.randomUUID()
      await redis.set(
        `totp_pending:${pendingId}`,
        JSON.stringify({ userId: user.id, token }),
        'EX', TOTP_PENDING_TTL
      )
      return reply.send({ requires_totp: true, totp_pending: pendingId })
    }

    const token = signToken(user.id, user.username)
    await redis.set(`session:${token}`, user.id, 'EX', SESSION_TTL)
    await trackSession(user.id, token)

    // Détection connexion depuis une nouvelle IP
    const loginIp    = (request.headers['cf-connecting-ip'] as string) || request.ip
    const knownIpKey = `known_ip:${user.id}`
    const knownIp    = await redis.get(knownIpKey)
    await redis.set(knownIpKey, loginIp, 'EX', 60 * 60 * 24 * 30) // 30 jours
    if (knownIp && knownIp !== loginIp) {
      sendSecurityAlert({
        title:  '🌍 Connexion depuis une nouvelle IP',
        color:  0xffa500,
        fields: [
          { name: 'Compte',      value: `**${user.username}**`, inline: false },
          { name: 'IP connue',   value: `\`${knownIp}\``,       inline: true  },
          { name: 'Nouvelle IP', value: `\`${loginIp}\``,       inline: true  },
        ],
        timestamp: new Date().toISOString(),
        footer:    { text: 'nodyx-security-monitor' },
      })
    }

    // Ensure user is in community_members — only if not banned
    const communityId = await getDefaultCommunityId()
    if (communityId) {
      const { rows: stillBanned } = await db.query(
        `SELECT 1 FROM community_bans WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
        [communityId, user.id]
      )
      if (stillBanned.length === 0) {
        await db.query(
          `INSERT INTO community_members (community_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT DO NOTHING`,
          [communityId, user.id]
        )
      }
    }

    const { password: _, ...publicUser } = user

    // Alerte connexion admin/owner
    const realIpLogin = (request.headers['cf-connecting-ip'] as string) || request.ip
    db.query(
      `SELECT role FROM community_members
       WHERE user_id = $1 AND role IN ('admin', 'owner') LIMIT 1`,
      [user.id]
    ).then(({ rows }) => {
      if (rows.length > 0) {
        sendSecurityAlert({
          title:  '🔑 Connexion admin',
          color:  0x5865f2,
          fields: [
            { name: 'Compte', value: `**${user.username}** (${rows[0].role})`, inline: true },
            { name: 'IP',     value: `\`${realIpLogin}\``,                     inline: true },
          ],
          timestamp: new Date().toISOString(),
          footer:    { text: 'nodyx-security-monitor' },
        })
      }
    }).catch(() => {})

    return reply.send({ token, user: publicUser })
  })

  // POST /api/v1/auth/logout
  app.post('/logout', {
    preHandler: [requireAuth],
  }, async (request, reply) => {
    const token  = request.headers.authorization!.slice(7)
    const userId = (request as any).user.userId
    await Promise.all([
      redis.del(`session:${token}`),
      redis.srem(`user_sessions:${userId}`, token),
    ])
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

  // ── Vérification email ────────────────────────────────────────────────────

  // GET /api/v1/auth/verify-email/:token
  app.get('/verify-email/:token', async (request, reply) => {
    const { token } = request.params as { token: string }

    const { rows } = await db.query<{ id: string; username: string; email: string }>(
      `UPDATE users
       SET email_verified = true, email_verification_token = NULL
       WHERE email_verification_token = $1
         AND email_verified = false
       RETURNING id, username, email`,
      [token]
    )

    if (!rows[0]) {
      return reply.code(400).send({ error: 'Lien invalide ou déjà utilisé.', code: 'INVALID_TOKEN' })
    }

    const { id, username } = rows[0]
    const jwtToken = signToken(id, username)
    await redis.set(`session:${jwtToken}`, id, 'EX', SESSION_TTL)
    await trackSession(id, jwtToken)

    return reply.send({ token: jwtToken })
  })

  // POST /api/v1/auth/resend-verification
  app.post('/resend-verification', {
    preHandler: [rateLimit, validate({ body: z.object({ email: z.string().email() }) })],
  }, async (request, reply) => {
    const { email } = request.body as { email: string }

    // Rate limit : 1 renvoi / 5 min / email ET 3 / 5 min / IP
    const rateLimitKey = `resend_verify:${email.toLowerCase()}`
    const rateLimitIp  = `resend_verify_ip:${request.ip}`
    const [countEmail, countIp] = await Promise.all([
      redis.incr(rateLimitKey),
      redis.incr(rateLimitIp),
    ])
    if (countEmail === 1) await redis.expire(rateLimitKey, 5 * 60)
    if (countIp === 1)    await redis.expire(rateLimitIp, 5 * 60)
    if (countEmail > 1 || countIp > 3) {
      return reply.code(429).send({ error: 'Un email a déjà été envoyé récemment. Attendez 5 minutes.', code: 'RATE_LIMITED' })
    }

    const user = await UserModel.findByEmail(email)

    // Réponse identique qu'un compte existe ou non (anti-énumération)
    if (!user || user.email_verified) {
      return reply.send({ message: 'Si ce compte existe et n\'est pas vérifié, un email a été envoyé.' })
    }

    const verificationToken = crypto.randomBytes(32).toString('hex')
    await db.query(
      `UPDATE users SET email_verification_token = $1 WHERE id = $2`,
      [verificationToken, user.id]
    )

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173'
    const verifyUrl = `${frontendUrl}/auth/verify-email/${verificationToken}`
    sendVerificationEmail({ to: user.email, username: user.username, verifyUrl }).catch(() => {})

    return reply.send({ message: 'Si ce compte existe et n\'est pas vérifié, un email a été envoyé.' })
  })
}
