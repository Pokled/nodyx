/**
 * routes/events.ts — Calendrier communautaire
 * CRUD complet pour les événements + RSVP.
 * Les événements publics sont annoncés au réseau via le Gossip Protocol (scheduler).
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import sanitizeHtml from 'sanitize-html'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { db } from '../config/database'
import { io } from '../socket/io'

const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
  'h1', 'h2', 'h3', 'blockquote', 'ul', 'ol', 'li', 'a',
]

function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags:       ALLOWED_TAGS,
    allowedAttributes: { a: ['href', 'target', 'rel'] },
  })
}

// -- Schemas -------------------------------------------------------------------

const CreateEventSchema = z.object({
  title:           z.string().min(3).max(200),
  description:     z.string().max(50000).optional().default(''),
  location:        z.string().max(500).nullable().optional(),
  location_lat:    z.number().nullable().optional(),
  location_lng:    z.number().nullable().optional(),
  starts_at:       z.string().datetime(),
  ends_at:         z.string().datetime().nullable().optional(),
  is_all_day:      z.boolean().optional().default(false),
  is_public:       z.boolean().optional().default(true),
  cover_url:       z.string().nullable().optional(),
  tags:            z.array(z.string().max(50)).max(10).optional().default([]),
  rsvp_enabled:    z.boolean().optional().default(false),
  max_attendees:   z.number().int().positive().nullable().optional(),
  ticket_price:    z.number().nonnegative().nullable().optional(),
  ticket_currency: z.string().length(3).optional().default('EUR'),
  ticket_url:      z.string().nullable().optional(),
})

const UpdateEventSchema = CreateEventSchema.partial().extend({
  is_cancelled: z.boolean().optional(),
})

const RsvpSchema = z.object({
  status: z.enum(['going', 'maybe', 'not_going']),
})

// -- Helper: authz -------------------------------------------------------------

async function canManageEvent(userId: string, eventId: string): Promise<boolean> {
  const { rows } = await db.query<{ author_id: string; community_id: string }>(
    `SELECT e.author_id, e.community_id FROM events e WHERE e.id = $1 LIMIT 1`,
    [eventId]
  )
  if (!rows[0]) return false
  if (rows[0].author_id === userId) return true

  const { rows: mods } = await db.query<{ role: string }>(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
    [rows[0].community_id, userId]
  )
  const role = mods[0]?.role
  return role === 'owner' || role === 'admin' || role === 'moderator'
}

// -- Routes -------------------------------------------------------------------

export default async function eventsRoutes(app: FastifyInstance) {

  // GET /events
  app.get('/', { preHandler: [optionalAuth] }, async (req, reply) => {
    const q = req.query as Record<string, string>
    const limit   = Math.min(parseInt(q.limit  ?? '20', 10) || 20, 50)
    const offset  = parseInt(q.offset ?? '0', 10) || 0
    const userId  = (req as any).user?.userId ?? null
    const showPast = q.past === 'true'
    const filterTags: string[] = q.tags ? q.tags.split(',').map((t: string) => t.trim()).filter(Boolean) : []

    let where = showPast ? `e.starts_at < NOW()` : `e.starts_at >= NOW()`
    const params: any[] = [limit, offset]

    where += ` AND (e.is_public = true OR e.community_id IN (
      SELECT community_id FROM community_members WHERE user_id = $${params.length + 1}
    ))`
    params.push(userId)

    if (filterTags.length > 0) {
      where += ` AND e.tags && $${params.length + 1}::text[]`
      params.push(filterTags)
    }

    const order = showPast ? 'DESC' : 'ASC'

    const { rows: events } = await db.query(
      `SELECT e.id, e.title, e.description, e.location, e.location_lat, e.location_lng,
              e.starts_at, e.ends_at, e.is_all_day, e.is_public, e.cover_url, e.tags, e.is_cancelled,
              e.rsvp_enabled, e.max_attendees, e.ticket_price, e.ticket_currency, e.ticket_url,
              e.created_at, e.updated_at,
              u.id AS author_id, u.username AS author_name, u.avatar_url AS author_avatar,
              (SELECT COUNT(*)::int FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going') AS going_count,
              (SELECT er2.status FROM event_rsvps er2 WHERE er2.event_id = e.id AND er2.user_id = $3 LIMIT 1) AS my_rsvp
       FROM events e
       LEFT JOIN users u ON u.id = e.author_id
       WHERE ${where} AND e.is_cancelled = false
       ORDER BY e.starts_at ${order}
       LIMIT $1 OFFSET $2`,
      params
    )

    return reply.send({ events })
  })

  // GET /events/:id
  app.get<{ Params: { id: string } }>('/:id', { preHandler: [optionalAuth] }, async (req, reply) => {
    const userId = (req as any).user?.userId ?? null
    const { rows } = await db.query(
      `SELECT e.id, e.title, e.description, e.location, e.location_lat, e.location_lng,
              e.starts_at, e.ends_at, e.is_all_day, e.is_public, e.cover_url, e.tags, e.is_cancelled,
              e.rsvp_enabled, e.max_attendees, e.ticket_price, e.ticket_currency, e.ticket_url,
              e.created_at, e.updated_at,
              u.id AS author_id, u.username AS author_name, u.avatar_url AS author_avatar,
              (SELECT COUNT(*)::int FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going')    AS going_count,
              (SELECT COUNT(*)::int FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'maybe')   AS maybe_count,
              (SELECT er2.status FROM event_rsvps er2 WHERE er2.event_id = e.id AND er2.user_id = $2 LIMIT 1) AS my_rsvp
       FROM events e
       LEFT JOIN users u ON u.id = e.author_id
       WHERE e.id = $1`,
      [req.params.id, userId]
    )
    if (!rows[0]) return reply.status(404).send({ error: 'Evenement introuvable' })

    let attendees: any[] = []
    if (rows[0].rsvp_enabled) {
      const { rows: rsvps } = await db.query(
        `SELECT er.status, u.id, u.username, u.avatar_url
         FROM event_rsvps er JOIN users u ON u.id = er.user_id
         WHERE er.event_id = $1 ORDER BY er.created_at ASC`,
        [req.params.id]
      )
      attendees = rsvps
    }

    const canManage = userId ? await canManageEvent(userId, req.params.id) : false
    return reply.send({ event: { ...rows[0], can_manage: canManage }, attendees })
  })

  // POST /events
  app.post<{ Body: z.infer<typeof CreateEventSchema> }>(
    '/',
    { preHandler: [rateLimit, requireAuth, validate({ body: CreateEventSchema })] },
    async (req, reply) => {
      const userId = (req as any).user.userId
      const body   = req.body

      const { rows: comm } = await db.query(
        `SELECT community_id FROM community_members WHERE user_id = $1 LIMIT 1`,
        [userId]
      )
      if (!comm[0]) return reply.status(400).send({ error: "Vous devez faire partie d'une communaute" })

      const description = sanitize(body.description ?? '')

      const { rows } = await db.query(
        `INSERT INTO events
           (community_id, author_id, title, description, location, location_lat, location_lng,
            starts_at, ends_at, is_all_day, is_public, cover_url, tags,
            rsvp_enabled, max_attendees, ticket_price, ticket_currency, ticket_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10,$11,$12,$13::text[],$14,$15,$16,$17,$18)
         RETURNING *`,
        [
          comm[0].community_id, userId,
          body.title.trim(), description,
          body.location ?? null,
          body.location_lat ?? null, body.location_lng ?? null,
          body.starts_at, body.ends_at ?? null,
          body.is_all_day, body.is_public,
          body.cover_url ?? null,
          body.tags ?? [],
          body.rsvp_enabled, body.max_attendees ?? null,
          body.ticket_price ?? null,
          body.ticket_currency ?? 'EUR',
          body.ticket_url ?? null,
        ]
      )

      io?.emit('event:created', { event: rows[0] })
      return reply.status(201).send({ event: rows[0] })
    }
  )

  // PATCH /events/:id
  app.patch<{ Params: { id: string }; Body: z.infer<typeof UpdateEventSchema> }>(
    '/:id',
    { preHandler: [rateLimit, requireAuth, validate({ body: UpdateEventSchema })] },
    async (req, reply) => {
      const userId = (req as any).user.userId
      if (!(await canManageEvent(userId, req.params.id))) {
        return reply.status(403).send({ error: 'Non autorise' })
      }

      const body = req.body
      const sets: string[] = []
      const vals: any[]    = []

      const addField = (col: string, val: unknown) => {
        vals.push(val)
        sets.push(`${col} = $${vals.length}`)
      }

      if (body.title           !== undefined) addField('title',           body.title?.trim())
      if (body.description     !== undefined) addField('description',     sanitize(body.description ?? ''))
      if (body.location        !== undefined) addField('location',        body.location)
      if (body.location_lat    !== undefined) addField('location_lat',    body.location_lat)
      if (body.location_lng    !== undefined) addField('location_lng',    body.location_lng)
      if (body.starts_at       !== undefined) addField('starts_at',       body.starts_at)
      if (body.ends_at         !== undefined) addField('ends_at',         body.ends_at)
      if (body.is_all_day      !== undefined) addField('is_all_day',      body.is_all_day)
      if (body.is_public       !== undefined) addField('is_public',       body.is_public)
      if (body.cover_url       !== undefined) addField('cover_url',       body.cover_url)
      if (body.tags            !== undefined) addField('tags',            body.tags)
      if (body.is_cancelled    !== undefined) addField('is_cancelled',    body.is_cancelled)
      if (body.rsvp_enabled    !== undefined) addField('rsvp_enabled',    body.rsvp_enabled)
      if (body.max_attendees   !== undefined) addField('max_attendees',   body.max_attendees)
      if (body.ticket_price    !== undefined) addField('ticket_price',    body.ticket_price)
      if (body.ticket_currency !== undefined) addField('ticket_currency', body.ticket_currency)
      if (body.ticket_url      !== undefined) addField('ticket_url',      body.ticket_url)

      if (sets.length === 0) return reply.status(400).send({ error: 'Aucun champ a modifier' })

      sets.push('updated_at = NOW()', 'last_indexed_at = NULL')
      vals.push(req.params.id)

      const { rows } = await db.query(
        `UPDATE events SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
        vals
      )

      io?.emit('event:updated', { event: rows[0] })
      return reply.send({ event: rows[0] })
    }
  )

  // DELETE /events/:id
  app.delete<{ Params: { id: string } }>(
    '/:id',
    { preHandler: [rateLimit, requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user.userId
      if (!(await canManageEvent(userId, req.params.id))) {
        return reply.status(403).send({ error: 'Non autorise' })
      }

      await db.query(`DELETE FROM events WHERE id = $1`, [req.params.id])
      io?.emit('event:deleted', { eventId: req.params.id })
      return reply.status(204).send()
    }
  )

  // POST /events/:id/rsvp
  app.post<{ Params: { id: string }; Body: z.infer<typeof RsvpSchema> }>(
    '/:id/rsvp',
    { preHandler: [rateLimit, requireAuth, validate({ body: RsvpSchema })] },
    async (req, reply) => {
      const userId = (req as any).user.userId

      const { rows: ev } = await db.query(
        `SELECT id, rsvp_enabled, max_attendees,
                (SELECT COUNT(*)::int FROM event_rsvps WHERE event_id = $1 AND status = 'going') AS going_count
         FROM events WHERE id = $1`,
        [req.params.id]
      )
      if (!ev[0]) return reply.status(404).send({ error: 'Evenement introuvable' })
      if (!ev[0].rsvp_enabled) return reply.status(400).send({ error: 'Les RSVPs ne sont pas actives' })

      if (req.body.status === 'going' && ev[0].max_attendees !== null) {
        const { rows: existing } = await db.query(
          `SELECT status FROM event_rsvps WHERE event_id = $1 AND user_id = $2`,
          [req.params.id, userId]
        )
        const alreadyGoing = existing[0]?.status === 'going'
        if (!alreadyGoing && ev[0].going_count >= ev[0].max_attendees) {
          return reply.status(400).send({ error: "L'evenement est complet" })
        }
      }

      await db.query(
        `INSERT INTO event_rsvps (event_id, user_id, status)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, created_at = NOW()`,
        [req.params.id, userId, req.body.status]
      )

      const { rows: userData } = await db.query(
        `SELECT id, username, avatar_url FROM users WHERE id = $1`,
        [userId]
      )
      io?.emit('event:rsvp', { eventId: req.params.id, user: userData[0], status: req.body.status })
      return reply.send({ ok: true })
    }
  )

  // DELETE /events/:id/rsvp
  app.delete<{ Params: { id: string } }>(
    '/:id/rsvp',
    { preHandler: [rateLimit, requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user.userId
      await db.query(
        `DELETE FROM event_rsvps WHERE event_id = $1 AND user_id = $2`,
        [req.params.id, userId]
      )
      return reply.send({ ok: true })
    }
  )
}
