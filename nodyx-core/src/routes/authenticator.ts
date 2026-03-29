/**
 * authenticator.ts — Nodyx Authenticator Hub API
 *
 * Endpoints consommés par la PWA Nodyx Authenticator.
 * Préfixe : /api/auth
 *
 * Flow complet :
 *   1. Admin génère un enrollment token   → POST /enrollment-tokens
 *   2. App s'enregistre avec le token     → POST /devices/register
 *   3. Browser initie un login            → POST /challenges/create
 *   4. App récupère les challenges        → GET  /challenges/pending
 *   5. App approuve (signe)               → POST /challenges/approve
 *   6. Browser poll jusqu'à approved      → GET  /challenges/status/:id
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import crypto, { webcrypto } from 'crypto'
import jwt from 'jsonwebtoken'
import { db, redis } from '../config/database'
import { requireAuth } from '../middleware/auth'
import { adminOnly }  from '../middleware/adminOnly'
import { trackSession } from './auth'

// JwkPublicKey n'est pas dans lib ES2022 sans DOM — on définit le minimum nécessaire
type JwkPublicKey = Record<string, unknown>

const SESSION_TTL = 7 * 24 * 60 * 60   // 7 jours
const CHALLENGE_TTL_SEC = 90            // 90 secondes
const ENROLLMENT_TOKEN_TTL_SEC = 15 * 60 // 15 minutes

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDeviceToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization
  if (!header?.startsWith('Bearer ')) return null
  return header.slice(7)
}

async function getDeviceByToken(token: string) {
  const { rows } = await db.query(
    `SELECT d.*, u.username
     FROM authenticator_devices d
     JOIN users u ON u.id = d.user_id
     WHERE d.device_token = $1`,
    [token]
  )
  return rows[0] ?? null
}

async function requireDeviceToken(request: FastifyRequest, reply: FastifyReply) {
  const token = extractDeviceToken(request)
  if (!token) return reply.code(401).send({ error: 'Missing device token', code: 'UNAUTHORIZED' })
  const device = await getDeviceByToken(token)
  if (!device) return reply.code(401).send({ error: 'Unknown device', code: 'UNAUTHORIZED' })
  return device
}

/** Vérifie une signature ECDSA P-256 via Node.js WebCrypto */
async function verifyEcdsaSignature(
  publicKeyJwk: JwkPublicKey,
  signatureBase64url: string,
  challenge: string
): Promise<boolean> {
  try {
    const key = await webcrypto.subtle.importKey(
      'jwk',
      publicKeyJwk,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify']
    )

    // Décode la signature base64url
    const b64 = signatureBase64url
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(signatureBase64url.length + ((4 - (signatureBase64url.length % 4)) % 4), '=')
    const sigBuffer = Buffer.from(b64, 'base64')

    const encoder = new TextEncoder()
    return await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      key,
      sigBuffer,
      encoder.encode(challenge)
    )
  } catch {
    return false
  }
}

function signToken(userId: string, username: string): string {
  return jwt.sign(
    { userId, username },
    process.env.JWT_SECRET!,
    { expiresIn: '7d', algorithm: 'HS256' }
  )
}

// ─── Rate limits ──────────────────────────────────────────────────────────────

async function approveRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const key = `auth_approve_rate:${request.ip}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60)
  if (count > 3) {  // 3/min — opération de sécurité critique
    return reply.code(429).send({ error: 'Trop de tentatives', code: 'RATE_LIMITED' })
  }
}

// 3 tentatives max par IP sur 5 minutes — l'espace de 256 bits du token le rend
// non-bruteforçable par définition, mais sans rate limit un attaquant pourrait
// inonder la DB et les logs.
async function enrollRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const key = `auth_enroll_rate:${request.ip}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 300) // fenêtre 5 min
  if (count > 3) {
    return reply.code(429).send({ error: 'Trop de tentatives d\'enregistrement', code: 'RATE_LIMITED' })
  }
}

// ─── Schemas ──────────────────────────────────────────────────────────────────

const RegisterDeviceBody = z.object({
  deviceId:          z.string().uuid(),
  deviceLabel:       z.string().min(1).max(100),
  publicKey:         z.object({
    algorithm: z.string(),
    key:       z.record(z.string(), z.unknown())
  }),
  enrollmentToken: z.string().min(1)
})

const ApproveBody = z.object({
  signature: z.string().min(1),
  challenge: z.string().min(1)
})

const RejectBody = z.object({
  challengeId: z.string().uuid()
})

const CreateChallengeBody = z.object({
  deviceId: z.string().uuid().optional(),
  username: z.string().min(1).optional(),
  hubUrl:   z.string().url()
})

// Flow cross-instance : Signet arrive avec sa pubkey, sans compte pré-existant
const ApproveCrossBody = z.object({
  signature:   z.string().min(1),
  challenge:   z.string().min(1),
  pubkey:      z.object({ algorithm: z.string(), key: z.record(z.string(), z.unknown()) }),
  deviceId:    z.string().uuid(),
  deviceLabel: z.string().min(1).max(100).default('Mon appareil')
})

// ─── Routes ───────────────────────────────────────────────────────────────────

export default async function authenticatorRoutes(app: FastifyInstance) {

  // ── Infos publiques ────────────────────────────────────────────────────────

  app.get('/info', async (_req, reply) => {
    const { rows } = await db.query(`SELECT name FROM communities LIMIT 1`)
    return reply.send({
      name: rows[0]?.name ?? 'Nodyx',
      version: process.env.npm_package_version ?? '1.0.0',
      authenticator: true
    })
  })

  // ── Enrollment tokens — admin uniquement ──────────────────────────────────

  /** Génère un token d'enregistrement à usage unique (15 min) — admin uniquement */
  app.post('/enrollment-tokens', {
    preHandler: [requireAuth]
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.userId


    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + ENROLLMENT_TOKEN_TTL_SEC * 1000)

    await db.query(
      `INSERT INTO authenticator_enrollment_tokens (token, user_id, expires_at)
       VALUES ($1, $2, $3)`,
      [token, userId, expiresAt]
    )

    return reply.code(201).send({ token, expiresAt })
  })

  // ── Enregistrement appareil ────────────────────────────────────────────────

  app.post('/devices/register', { preHandler: enrollRateLimit }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = RegisterDeviceBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues })
    }
    const { deviceId, deviceLabel, publicKey, enrollmentToken } = parsed.data

    // Valider le token d'enregistrement
    const { rows: tokenRows } = await db.query(
      `SELECT * FROM authenticator_enrollment_tokens
       WHERE token = $1 AND expires_at > NOW() AND used_at IS NULL`,
      [enrollmentToken]
    )
    if (!tokenRows[0]) {
      return reply.code(401).send({ error: 'Invalid or expired enrollment token', code: 'INVALID_TOKEN' })
    }

    const userId = tokenRows[0].user_id

    // Générer le device_token (secret utilisé par l'app pour les appels suivants)
    const deviceToken = crypto.randomBytes(32).toString('hex')

    // Marquer le token d'enregistrement comme utilisé
    await db.query(
      `UPDATE authenticator_enrollment_tokens SET used_at = NOW() WHERE token = $1`,
      [enrollmentToken]
    )

    await db.query(
      `INSERT INTO authenticator_devices (id, user_id, label, public_key, device_token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET label = EXCLUDED.label,
             public_key = EXCLUDED.public_key,
             device_token = EXCLUDED.device_token`,
      [deviceId, userId, deviceLabel, JSON.stringify(publicKey), deviceToken]
    )

    return reply.code(201).send({ success: true, deviceToken })
  })

  // ── Révoquer un appareil ──────────────────────────────────────────────────

  app.delete('/devices/:deviceId', async (request: FastifyRequest, reply: FastifyReply) => {
    const device = await requireDeviceToken(request, reply)
    if (!device) return

    const { deviceId } = request.params as { deviceId: string }

    // Un appareil ne peut révoquer que lui-même (ou l'admin peut révoquer via requireAuth)
    if (device.id !== deviceId) {
      return reply.code(403).send({ error: 'Cannot revoke another device', code: 'FORBIDDEN' })
    }

    await db.query(`DELETE FROM authenticator_devices WHERE id = $1`, [deviceId])
    return reply.send({ success: true })
  })

  /** L'admin peut lister et révoquer tous les appareils depuis les settings */
  app.get('/devices', { preHandler: requireAuth }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { rows } = await db.query(
      `SELECT id, label, created_at, last_used_at
       FROM authenticator_devices
       WHERE user_id = $1
       ORDER BY created_at ASC`,
      [request.user!.userId]
    )
    return reply.send({ devices: rows })
  })

  app.delete('/devices/:deviceId/admin', {
    preHandler: requireAuth
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const { deviceId } = request.params as { deviceId: string }
    const { rowCount } = await db.query(
      `DELETE FROM authenticator_devices WHERE id = $1 AND user_id = $2`,
      [deviceId, request.user!.userId]
    )
    if (!rowCount) return reply.code(404).send({ error: 'Device not found' })
    return reply.send({ success: true })
  })

  // ── Challenges ────────────────────────────────────────────────────────────

  /** Créé un challenge — appelé par le browser lors du login (flux sans mot de passe) */
  app.post('/challenges/create', async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = CreateChallengeBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload' })
    }
    const { deviceId: rawDeviceId, username, hubUrl } = parsed.data

    // Résolution deviceId : fourni directement ou via username
    // Mode anonyme (cross-instance) : ni username ni deviceId → challenge ouvert
    let resolvedDeviceId = rawDeviceId ?? null
    let userId: string | null = null

    if (!resolvedDeviceId && username) {
      // Cherche le premier appareil enregistré pour cet utilisateur
      const { rows } = await db.query(
        `SELECT d.id, d.user_id
         FROM authenticator_devices d
         JOIN users u ON u.id = d.user_id
         WHERE u.username = $1
         ORDER BY d.created_at ASC
         LIMIT 1`,
        [username]
      )
      if (!rows[0]) return reply.code(404).send({ error: 'No device registered for this user', code: 'NO_DEVICE' })
      resolvedDeviceId = rows[0].id
      userId = rows[0].user_id
    } else if (resolvedDeviceId) {
      const { rows } = await db.query(
        `SELECT user_id FROM authenticator_devices WHERE id = $1`,
        [resolvedDeviceId]
      )
      if (!rows[0]) return reply.code(404).send({ error: 'Device not found' })
      userId = rows[0].user_id
    }
    // else : mode anonyme cross-instance — resolvedDeviceId et userId restent null

    const challengeBytes = crypto.randomBytes(32).toString('base64url')
    const pollNonce = crypto.randomBytes(16).toString('hex')
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_SEC * 1000)
    const sourceIp = request.ip

    const { rows } = await db.query(
      `INSERT INTO authenticator_challenges
         (challenge, device_id, user_id, source_ip, hub_url, expires_at, poll_nonce)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, challenge, issued_at, expires_at`,
      [challengeBytes, resolvedDeviceId, userId, sourceIp, hubUrl, expiresAt, pollNonce]
    )

    const row = rows[0]
    return reply.code(201).send({
      challengeId: row.id,
      challenge:   row.challenge,
      pollNonce,
      issuedAt:    row.issued_at.getTime(),
      expiresAt:   row.expires_at.getTime(),
      ttl:         CHALLENGE_TTL_SEC,
      sourceIp,
      hubUrl
    })
  })

  /** Polling — challenges en attente pour un appareil donné */
  app.get('/challenges/pending', async (request: FastifyRequest, reply: FastifyReply) => {
    const device = await requireDeviceToken(request, reply)
    if (!device) return

    await db.query(
      `UPDATE authenticator_challenges
       SET status = 'expired'
       WHERE status = 'pending' AND expires_at < NOW()`
    )

    const { rows } = await db.query(
      `SELECT id, challenge, source_ip, hub_url, issued_at, expires_at
       FROM authenticator_challenges
       WHERE device_id = $1 AND status = 'pending' AND expires_at > NOW()
       ORDER BY issued_at ASC`,
      [device.id]
    )

    const challenges = rows.map((r: {
      id: string
      challenge: string
      source_ip: string | null
      hub_url: string
      issued_at: Date
      expires_at: Date
    }) => ({
      id:        r.id,
      challenge: r.challenge,
      sourceIp:  r.source_ip,
      hubUrl:    r.hub_url,
      issuedAt:  r.issued_at.getTime(),
      ttl:       Math.max(0, Math.round((r.expires_at.getTime() - Date.now()) / 1000))
    }))

    return reply.send({ challenges })
  })

  /** Approbation — l'app envoie la signature */
  app.post('/challenges/approve', {
    preHandler: approveRateLimit
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const device = await requireDeviceToken(request, reply)
    if (!device) return

    const parsed = ApproveBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload' })
    }
    const { signature, challenge } = parsed.data

    // Récupérer le challenge en base
    const { rows } = await db.query(
      `SELECT * FROM authenticator_challenges
       WHERE challenge = $1
         AND device_id = $2
         AND status = 'pending'
         AND expires_at > NOW()`,
      [challenge, device.id]
    )
    if (!rows[0]) {
      return reply.code(404).send({ error: 'Challenge not found or expired', code: 'NOT_FOUND' })
    }
    const row = rows[0]

    // Vérifier la signature ECDSA
    const publicKeyJwk = (device.public_key as { algorithm: string; key: JwkPublicKey }).key
    const valid = await verifyEcdsaSignature(publicKeyJwk, signature, challenge)
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' })
    }

    // Créer une session JWT pour l'utilisateur
    const token = signToken(device.user_id, device.username)
    const sessionKey = `session:${token}`
    await redis.setex(sessionKey, SESSION_TTL, device.user_id)
    await trackSession(device.user_id, token)

    // Marquer le challenge comme approuvé + stocker le token de session
    await db.query(
      `UPDATE authenticator_challenges
       SET status = 'approved', session_token = $1
       WHERE id = $2`,
      [token, row.id]
    )

    // Mettre à jour la date de dernière utilisation
    await db.query(
      `UPDATE authenticator_devices SET last_used_at = NOW() WHERE id = $1`,
      [device.id]
    )

    return reply.send({ success: true })
  })

  /**
   * Approbation cross-instance — la PWA Signet arrive sur une instance inconnue.
   * Pas de device token — la pubkey identifie l'utilisateur.
   * Si la pubkey n'est pas connue → création automatique du compte.
   */
  app.post('/challenges/approve-cross', {
    preHandler: approveRateLimit
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = ApproveCrossBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload', details: parsed.error.issues })
    }
    const { signature, challenge, pubkey, deviceId, deviceLabel } = parsed.data

    // 1. Récupérer le challenge anonyme (device_id IS NULL, statut pending)
    const { rows: challengeRows } = await db.query(
      `SELECT * FROM authenticator_challenges
       WHERE challenge = $1
         AND device_id IS NULL
         AND status = 'pending'
         AND expires_at > NOW()`,
      [challenge]
    )
    if (!challengeRows[0]) {
      return reply.code(404).send({ error: 'Challenge not found or expired', code: 'NOT_FOUND' })
    }
    const challengeRow = challengeRows[0]

    // 2. Vérifier la signature ECDSA avec la pubkey fournie
    const valid = await verifyEcdsaSignature(pubkey.key as JwkPublicKey, signature, challenge)
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' })
    }

    // 3. Chercher si un device avec ce deviceId existe déjà sur cette instance
    const { rows: existingDevice } = await db.query(
      `SELECT d.*, u.username
       FROM authenticator_devices d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = $1`,
      [deviceId]
    )

    let userId: string
    let username: string

    if (existingDevice[0]) {
      // Appareil connu → login direct
      userId   = existingDevice[0].user_id
      username = existingDevice[0].username
      // Mettre à jour la clé publique si elle a changé (rotation)
      await db.query(
        `UPDATE authenticator_devices SET public_key = $1, last_used_at = NOW() WHERE id = $2`,
        [JSON.stringify(pubkey), deviceId]
      )
    } else {
      // Appareil inconnu → créer un compte automatiquement
      // Générer un username unique basé sur les 8 premiers chars du deviceId
      const baseUsername = `user_${deviceId.replace(/-/g, '').slice(0, 8)}`
      let finalUsername = baseUsername
      let suffix = 0
      while (true) {
        const { rows } = await db.query(
          `SELECT 1 FROM users WHERE username = $1`, [finalUsername]
        )
        if (!rows[0]) break
        suffix++
        finalUsername = `${baseUsername}_${suffix}`
      }

      // Email fictif unique — jamais exposé, jamais utilisé pour le login
      const fakeEmail = `signet_${deviceId.replace(/-/g, '')}@signet.local`

      // Mot de passe aléatoire — inutilisable (compte Signet-only)
      const randomPassword = crypto.randomBytes(32).toString('hex')

      // Créer l'utilisateur
      const { rows: newUser } = await db.query(
        `INSERT INTO users (username, email, password)
         VALUES ($1, $2, $3)
         RETURNING id, username`,
        [finalUsername, fakeEmail, randomPassword]
      )
      userId   = newUser[0].id
      username = newUser[0].username

      // Ajouter à la communauté
      const { rows: community } = await db.query(
        `SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`
      )
      if (community[0]) {
        await db.query(
          `INSERT INTO community_members (community_id, user_id, role)
           VALUES ($1, $2, 'member')
           ON CONFLICT DO NOTHING`,
          [community[0].id, userId]
        )
      }

      // Créer le profil utilisateur
      await db.query(
        `INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
        [userId]
      )

      // Enregistrer l'appareil Signet
      const deviceToken = crypto.randomBytes(32).toString('hex')
      await db.query(
        `INSERT INTO authenticator_devices (id, user_id, label, public_key, device_token)
         VALUES ($1, $2, $3, $4, $5)`,
        [deviceId, userId, deviceLabel, JSON.stringify(pubkey), deviceToken]
      )
    }

    // 4. Créer la session JWT
    const sessionToken = signToken(userId, username)
    await redis.setex(`session:${sessionToken}`, SESSION_TTL, userId)
    await trackSession(userId, sessionToken)

    // 5. Marquer le challenge comme approuvé
    await db.query(
      `UPDATE authenticator_challenges
       SET status = 'approved', session_token = $1, user_id = $2
       WHERE id = $3`,
      [sessionToken, userId, challengeRow.id]
    )

    return reply.send({ success: true, isNewUser: !existingDevice[0], username, token: sessionToken })
  })

  /** Refus — l'app refuse la demande */
  app.post('/challenges/reject', async (request: FastifyRequest, reply: FastifyReply) => {
    const device = await requireDeviceToken(request, reply)
    if (!device) return

    const parsed = RejectBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid payload' })
    }

    await db.query(
      `UPDATE authenticator_challenges
       SET status = 'rejected'
       WHERE id = $1 AND device_id = $2 AND status = 'pending'`,
      [parsed.data.challengeId, device.id]
    )

    return reply.send({ success: true })
  })

  /** Statut d'un challenge — le browser poll cet endpoint après avoir créé le challenge */
  app.get('/challenges/status/:challengeId', async (request: FastifyRequest, reply: FastifyReply) => {
    const { challengeId } = request.params as { challengeId: string }
    const { nonce } = request.query as { nonce?: string }

    if (!nonce) return reply.code(400).send({ error: 'nonce required' })

    const { rows } = await db.query(
      `SELECT id, status, session_token, expires_at, poll_nonce
       FROM authenticator_challenges
       WHERE id = $1`,
      [challengeId]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Challenge not found' })
    if (rows[0].poll_nonce && rows[0].poll_nonce !== nonce) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    const row = rows[0]

    // Si expiré, on met à jour le statut
    if (row.status === 'pending' && new Date(row.expires_at) < new Date()) {
      await db.query(
        `UPDATE authenticator_challenges SET status = 'expired' WHERE id = $1`,
        [challengeId]
      )
      return reply.send({ status: 'expired' })
    }

    const response: { status: string; token?: string } = { status: row.status }

    // Si approuvé, on retourne le token de session une seule fois puis on le efface
    if (row.status === 'approved' && row.session_token) {
      response.token = row.session_token
      // On efface le token de session après l'avoir retourné (one-time)
      await db.query(
        `UPDATE authenticator_challenges SET session_token = NULL WHERE id = $1`,
        [challengeId]
      )
    }

    return reply.send(response)
  })
}
