import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as NotificationModel from '../models/notification'

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
