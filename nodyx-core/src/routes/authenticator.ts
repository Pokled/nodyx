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
import { trackSession } from './auth'
import { getClientIp } from '../utils/clientIp'

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

    // Décode la signature base64url (Node.js 18+ natif)
    const sigBuffer = Buffer.from(signatureBase64url, 'base64url')

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
  const key = `auth_approve_rate:${getClientIp(request)}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60)
  if (count > 10) {  // 10/min — assez pour les tests + usage normal
    return reply.code(429).send({ error: 'Trop de tentatives', code: 'RATE_LIMITED' })
  }
}

// 3 tentatives max par IP sur 5 minutes — l'espace de 256 bits du token le rend
// non-bruteforçable par définition, mais sans rate limit un attaquant pourrait
// inonder la DB et les logs.
async function enrollRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const key = `auth_enroll_rate:${getClientIp(request)}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 300) // fenêtre 5 min
  if (count > 3) {
    return reply.code(429).send({ error: 'Trop de tentatives d\'enregistrement', code: 'RATE_LIMITED' })
  }
}

// N'existait pas avant l'audit du 15/09 : ce endpoint est public par nécessité
// (le navigateur qui initie une connexion n'est pas encore authentifié), mais
// sans aucune limite il devenait un levier de harcèlement (flood de demandes
// d'approbation vers l'appareil d'un `username` ciblé, qui fait sonner la PWA
// à chaque appel) et de croissance de table non bornée.
async function createChallengeRateLimit(request: FastifyRequest, reply: FastifyReply) {
  const key = `auth_create_challenge_rate:${getClientIp(request)}`
  const count = await redis.incr(key)
  if (count === 1) await redis.expire(key, 60)
  if (count > 15) {  // 15/min, large pour l'usage normal (polling de reconnexion inclus)
    return reply.code(429).send({ error: 'Trop de tentatives', code: 'RATE_LIMITED' })
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

  // ── Enrollment tokens ────────────────────────────────────────────────────
  // Tout utilisateur connecté peut s'en générer un pour enrôler SON PROPRE
  // nouvel appareil (le token est lié à `request.user!.userId`, jamais à un
  // id fourni par la requête), ce n'est PAS une action admin, le commentaire
  // précédent l'affirmait à tort alors que le code ne l'a jamais imposé.

  /** Génère un token d'enregistrement à usage unique (15 min), pour son propre compte */
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

    // Générer le device_token (secret utilisé par l'app pour les appels suivants)
    const deviceToken = crypto.randomBytes(32).toString('hex')

    // Valider ET consommer le token d'enregistrement, geste atomique
    // (UPDATE ... WHERE used_at IS NULL RETURNING) plutôt qu'un SELECT puis un
    // UPDATE séparés : deux requêtes concurrentes avec le même token ne
    // doivent pas pouvoir consommer le même jeton deux fois (TOCTOU trouvé en
    // audit le 15/09, même geste déjà correct sur reset-password dans auth.ts).
    const { rows: consumed } = await db.query(
      `UPDATE authenticator_enrollment_tokens SET used_at = NOW()
       WHERE token = $1 AND used_at IS NULL AND expires_at > NOW()
       RETURNING user_id`,
      [enrollmentToken]
    )
    if (!consumed[0]) {
      return reply.code(401).send({ error: 'Invalid or expired enrollment token', code: 'INVALID_TOKEN' })
    }
    const userId = consumed[0].user_id

    // `deviceId` est choisi par le CLIENT (UUID libre) : sans le `WHERE`,
    // enregistrer un deviceId qui appartient DÉJÀ à quelqu'un d'autre écrase
    // sa clé publique et son device_token tout en laissant la ligne rattachée
    // à SON compte à lui, prise de compte complète (même racine que le bug
    // de approve-cross, trouvée dans le même audit du 15/09, sur ce même
    // fichier). Le `WHERE` fait que sur collision avec un autre propriétaire,
    // l'UPDATE ne touche aucune ligne : on le détecte via `rowCount` et on
    // refuse, on ne raconte JAMAIS un succès sur une ligne qui n'est pas
    // devenue la nôtre.
    const { rowCount } = await db.query(
      `INSERT INTO authenticator_devices (id, user_id, label, public_key, device_token)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE
         SET label = EXCLUDED.label,
             public_key = EXCLUDED.public_key,
             device_token = EXCLUDED.device_token
         WHERE authenticator_devices.user_id = EXCLUDED.user_id`,
      [deviceId, userId, deviceLabel, JSON.stringify(publicKey), deviceToken]
    )
    if (!rowCount) {
      return reply.code(409).send({ error: 'This device ID is already registered to a different account', code: 'DEVICE_ID_CONFLICT' })
    }

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
  app.post('/challenges/create', { preHandler: createChallengeRateLimit }, async (request: FastifyRequest, reply: FastifyReply) => {
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
    const sourceIp = getClientIp(request)

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

    // 2. Chercher si un device avec ce deviceId existe déjà sur cette instance
    const { rows: existingDevice } = await db.query(
      `SELECT d.*, u.username
       FROM authenticator_devices d
       JOIN users u ON u.id = d.user_id
       WHERE d.id = $1`,
      [deviceId]
    )

    // 3. Vérifier la signature ECDSA — CONTRE LA CLÉ DÉJÀ ENREGISTRÉE quand
    // l'appareil est connu, jamais contre la pubkey fournie dans le body.
    // `deviceId` n'est pas un secret (il transite en clair vers chaque
    // instance visitée, par construction du flow cross-instance) : accepter
    // ici la pubkey du client permettrait à quiconque connaît le deviceId
    // d'un appareil existant de se forger sa propre paire de clés, de se
    // signer lui-même le challenge, et de se faire passer pour le
    // propriétaire du compte — prise de compte complète, sans jamais prouver
    // la possession de la clé privée d'origine. Trouvé en audit le 15/09.
    const referenceKey = existingDevice[0]
      ? (existingDevice[0].public_key as { algorithm: string; key: JwkPublicKey }).key
      : (pubkey.key as JwkPublicKey)  // appareil inconnu : rien à comparer, la pubkey fournie EST l'identité qu'on crée
    const valid = await verifyEcdsaSignature(referenceKey, signature, challenge)
    if (!valid) {
      return reply.code(401).send({ error: 'Invalid signature', code: 'INVALID_SIGNATURE' })
    }

    let userId: string
    let username: string

    if (existingDevice[0]) {
      // Appareil connu → login direct. Pas de rotation de clé ici : une
      // rotation légitime doit passer par un flow explicitement authentifié
      // (déjà connecté ou nouvel enrôlement via jeton admin), jamais par une
      // simple repétition de cet endpoint anonyme.
      userId   = existingDevice[0].user_id
      username = existingDevice[0].username
      await db.query(
        `UPDATE authenticator_devices SET last_used_at = NOW() WHERE id = $1`,
        [deviceId]
      )
    } else {
      // Appareil inconnu → vérifier le rate limit de création de compte (3/IP/heure)
      const creationKey = `account_creation:${getClientIp(request)}`
      const creationCount = await redis.incr(creationKey)
      if (creationCount === 1) await redis.expire(creationKey, 3600)
      if (creationCount > 3) {
        return reply.code(429).send({ error: 'Trop de créations de compte. Réessaie dans une heure.', code: 'RATE_LIMITED' })
      }

      // Créer un compte automatiquement.
      // Le username est tiré au hasard, PAS dérivé du deviceId : celui-ci est
      // le même sur toutes les instances visitées par cet appareil (par
      // construction du flow cross-instance), donc publier 32 de ses bits
      // dans un pseudo public le rendrait cherchable/corrélable d'une
      // communauté à l'autre à la simple lecture d'une liste de membres
      // (trouvé en audit le 15/09).
      const baseUsername = `user_${crypto.randomBytes(4).toString('hex')}`
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
      // Une vague d'inscriptions peut annoncer un raid (bouclier anti-raid, lot 6)
      void import('../services/octoguard/shield').then((m) => m.recordSignup()).catch(() => {})

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
    if (!rows[0].poll_nonce || rows[0].poll_nonce !== nonce) {
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

    // Si approuvé, récupérer le token de manière atomique (évite la race condition)
    if (row.status === 'approved') {
      const { rows: tokenRows } = await db.query(
        `UPDATE authenticator_challenges
         SET session_token = NULL
         WHERE id = $1 AND session_token IS NOT NULL
         RETURNING session_token`,
        [challengeId]
      )
      if (tokenRows[0]) response.token = tokenRows[0].session_token
    }

    return reply.send(response)
  })
}
