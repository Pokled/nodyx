import { FastifyInstance } from 'fastify'
import { generateSecret, generateURI, verify } from 'otplib'
import QRCode from 'qrcode'
import crypto from 'crypto'
import { db, redis } from '../config/database.js'
import { requireAuth } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'

// ── Config TOTP ───────────────────────────────────────────────────────────────

const APP_NAME = process.env.NODYX_COMMUNITY_NAME || 'Nodyx'

// TTL session TOTP pending (après password OK, avant code TOTP) : 5 minutes
const TOTP_PENDING_TTL = 300

// Tolérance de ±30s (1 step de chaque côté)
const EPOCH_TOLERANCE = 30

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getUserTotp(userId: string): Promise<{ totp_enabled: boolean; totp_secret: string | null }> {
  const { rows } = await db.query<{ totp_enabled: boolean; totp_secret: string | null }>(
    `SELECT totp_enabled, totp_secret FROM users WHERE id = $1`,
    [userId]
  )
  return rows[0] ?? { totp_enabled: false, totp_secret: null }
}

async function verifyTotp(token: string, secret: string): Promise<boolean> {
  const result = await verify({ token, secret, epochTolerance: EPOCH_TOLERANCE })
  return result.valid
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function totpRoutes(fastify: FastifyInstance) {

  // POST /api/v1/auth/totp/setup
  // Génère un nouveau secret TOTP + QR code (sans l'activer encore)
  fastify.post('/setup', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const userId = (request.user as any).userId

    const { totp_enabled } = await getUserTotp(userId)
    if (totp_enabled) {
      return reply.code(400).send({ error: '2FA déjà activé sur ce compte.', code: 'TOTP_ALREADY_ENABLED' })
    }

    const { rows } = await db.query<{ username: string; email: string }>(
      `SELECT username, email FROM users WHERE id = $1`, [userId]
    )
    const { username, email } = rows[0]

    const secret = generateSecret()
    const otpauth = generateURI({ issuer: APP_NAME, label: email, secret })
    const qrDataUrl = await QRCode.toDataURL(otpauth, { width: 200, margin: 2 })

    // Stocke le secret temporairement dans Redis (pas encore en DB — l'user doit confirmer)
    await redis.set(`totp_setup:${userId}`, secret, 'EX', 600) // 10 min

    return reply.send({
      secret,    // pour saisie manuelle
      qr:        qrDataUrl,
      username,
    })
  })

  // POST /api/v1/auth/totp/confirm
  // Vérifie le premier code TOTP et active le 2FA
  fastify.post('/confirm', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const userId = (request.user as any).userId
    const { code } = request.body as { code?: string }

    if (!code || !/^\d{6}$/.test(code)) {
      return reply.code(400).send({ error: 'Code invalide.', code: 'INVALID_CODE' })
    }

    const secret = await redis.get(`totp_setup:${userId}`)
    if (!secret) {
      return reply.code(400).send({ error: 'Session setup expirée. Recommencez.', code: 'SETUP_EXPIRED' })
    }

    const valid = await verifyTotp(code, secret)
    if (!valid) {
      return reply.code(400).send({ error: 'Code incorrect.', code: 'INVALID_CODE' })
    }

    await db.query(
      `UPDATE users SET totp_secret = $1, totp_enabled = true WHERE id = $2`,
      [secret, userId]
    )
    await redis.del(`totp_setup:${userId}`)

    return reply.send({ ok: true, message: '2FA activé avec succès.' })
  })

  // POST /api/v1/auth/totp/disable
  // Désactive le 2FA (requiert le code TOTP pour confirmer)
  fastify.post('/disable', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const userId = (request.user as any).userId
    const { code } = request.body as { code?: string }

    if (!code || !/^\d{6}$/.test(code)) {
      return reply.code(400).send({ error: 'Code requis pour désactiver le 2FA.', code: 'INVALID_CODE' })
    }

    const { totp_enabled, totp_secret } = await getUserTotp(userId)
    if (!totp_enabled || !totp_secret) {
      return reply.code(400).send({ error: '2FA non activé sur ce compte.', code: 'TOTP_NOT_ENABLED' })
    }

    const valid = await verifyTotp(code, totp_secret)
    if (!valid) {
      return reply.code(400).send({ error: 'Code incorrect.', code: 'INVALID_CODE' })
    }

    await db.query(
      `UPDATE users SET totp_secret = NULL, totp_enabled = false WHERE id = $1`,
      [userId]
    )

    return reply.send({ ok: true, message: '2FA désactivé.' })
  })

  // POST /api/v1/auth/totp/validate
  // Valide le code TOTP après la première étape du login (password OK)
  // Body: { totp_pending: string, code: string }
  fastify.post('/validate', {
    preHandler: [rateLimit],
  }, async (request, reply) => {
    const { totp_pending, code } = request.body as { totp_pending?: string; code?: string }

    if (!totp_pending || !code || !/^\d{6}$/.test(code)) {
      return reply.code(400).send({ error: 'Paramètres manquants.', code: 'INVALID_PARAMS' })
    }

    // Récupère la session pending depuis Redis
    const pendingData = await redis.get(`totp_pending:${totp_pending}`)
    if (!pendingData) {
      return reply.code(401).send({ error: 'Session expirée. Reconnectez-vous.', code: 'SESSION_EXPIRED' })
    }

    const { userId, token } = JSON.parse(pendingData) as { userId: string; token: string }

    const { totp_secret } = await getUserTotp(userId)
    if (!totp_secret) {
      return reply.code(500).send({ error: 'Erreur interne.', code: 'INTERNAL_ERROR' })
    }

    const valid = await verifyTotp(code, totp_secret)
    if (!valid) {
      return reply.code(401).send({ error: 'Code incorrect.', code: 'INVALID_TOTP' })
    }

    // Code valide — supprime la session pending, retourne le vrai token JWT
    await redis.del(`totp_pending:${totp_pending}`)

    return reply.send({ token })
  })

  // GET /api/v1/auth/totp/status
  // Retourne si le 2FA est activé sur le compte connecté
  fastify.get('/status', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const userId = (request.user as any).userId
    const { totp_enabled } = await getUserTotp(userId)
    return reply.send({ totp_enabled })
  })
}

// ── Helpers exportés pour auth.ts ─────────────────────────────────────────────

export { getUserTotp, TOTP_PENDING_TTL }
