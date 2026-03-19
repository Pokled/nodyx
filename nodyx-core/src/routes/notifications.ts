import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as NotificationModel from '../models/notification'
import { db } from '../config/database'
import webpush from 'web-push'

// ── VAPID setup ───────────────────────────────────────────────────────────────
// Clés générées une fois via : npx web-push generate-vapid-keys
// À mettre dans .env : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT

const VAPID_OK = !!(
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY &&
  process.env.VAPID_SUBJECT
)

if (VAPID_OK) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  )
}

// ── Envoi push à un utilisateur ───────────────────────────────────────────────
// Appelé depuis socket/index.ts et routes/forums.ts lors d'une nouvelle notif.

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; type: string; url?: string; tag?: string }
): Promise<void> {
  if (!VAPID_OK) return

  const { rows } = await db.query(
    `SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1`,
    [userId]
  )

  const data = JSON.stringify(payload)

  await Promise.allSettled(
    rows.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          data
        )
        // Mise à jour last_used_at
        await db.query(
          `UPDATE push_subscriptions SET last_used_at = NOW() WHERE endpoint = $1`,
          [sub.endpoint]
        )
      } catch (err: any) {
        // 410 Gone = abonnement expiré → on supprime
        if (err?.statusCode === 410) {
          await db.query(
            `DELETE FROM push_subscriptions WHERE endpoint = $1`,
            [sub.endpoint]
          )
        }
      }
    })
  )
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function notificationRoutes(app: FastifyInstance) {

  // GET /api/v1/notifications
  app.get('/', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const userId  = request.user!.userId
    const notifications = await NotificationModel.listForUser(userId, 50)
    return reply.send({ notifications })
  })

  // GET /api/v1/notifications/unread-count
  app.get('/unread-count', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const count = await NotificationModel.getUnreadCount(request.user!.userId)
    return reply.send({ count })
  })

  // GET /api/v1/notifications/vapid-public-key — clé publique pour le frontend
  app.get('/vapid-public-key', async (_request, reply) => {
    if (!VAPID_OK) return reply.code(503).send({ error: 'Push notifications not configured' })
    return reply.send({ publicKey: process.env.VAPID_PUBLIC_KEY })
  })

  // POST /api/v1/notifications/subscribe — enregistrer un abonnement push
  app.post('/subscribe', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    if (!VAPID_OK) return reply.code(503).send({ error: 'Push notifications not configured' })

    const userId = request.user!.userId
    const body   = request.body as any

    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return reply.code(400).send({ error: 'Invalid subscription object' })
    }

    const endpoint = String(body.endpoint).slice(0, 500)
    const p256dh   = String(body.keys.p256dh).slice(0, 200)
    const auth     = String(body.keys.auth).slice(0, 100)
    const ua       = (request.headers['user-agent'] ?? '').slice(0, 300)

    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, endpoint)
       DO UPDATE SET p256dh = $3, auth = $4, last_used_at = NOW()`,
      [userId, endpoint, p256dh, auth, ua]
    )

    return reply.code(201).send({ ok: true })
  })

  // DELETE /api/v1/notifications/subscribe — désabonnement
  app.delete('/subscribe', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const userId = request.user!.userId
    const body   = request.body as any
    if (!body?.endpoint) return reply.code(400).send({ error: 'Missing endpoint' })

    await db.query(
      `DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2`,
      [userId, String(body.endpoint)]
    )
    return reply.code(204).send()
  })

  // PATCH /api/v1/notifications/:id/read
  app.patch('/:id/read', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    await NotificationModel.markAsRead(id, request.user!.userId)
    return reply.code(204).send()
  })

  // PATCH /api/v1/notifications/read-all
  app.patch('/read-all', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    await NotificationModel.markAllAsRead(request.user!.userId)
    return reply.code(204).send()
  })

  // DELETE /api/v1/notifications/read — supprime toutes les notifications lues
  app.delete('/read', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const deleted = await NotificationModel.deleteAllRead(request.user!.userId)
    return reply.send({ deleted })
  })
}
