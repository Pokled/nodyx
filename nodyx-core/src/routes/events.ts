/**
 * routes/events.ts — Calendrier communautaire
 * CRUD complet pour les événements + RSVP.
 * Les événements publics sont annoncés au réseau via le Gossip Protocol (scheduler).
 */
import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { validate } from '../middleware/validate'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth, optionalAuth } from '../middleware/auth'
import { db } from '../config/database'
import { io } from '../socket/io'
import { announceCalendarEvent } from '../services/webhooks/announce'
import { sanitize } from '../utils/sanitize'
import { rehostExternalImages } from '../services/inlineImageRehost'
import { isContainedUploadPath } from '../utils/uploadPath'
import { canReadEvent } from '../services/eventAccess'
import { ownOrigins } from '../utils/instanceOrigins'
import { getAccess, rankOf, outranks } from '../services/permissions'

// La description d'un événement vient de NodyxEditor, comme un message du forum :
// même nettoyeur (utils/sanitize) et même recopie des images externes. Avant, une
// liste locale sans filtre d'images ni de domaines bloqués laissait une image
// d'un autre site en place : chaque lecteur la chargeait chez ce site, qui voyait
// son adresse IP. Une seule règle pour tous les outils, sinon ils divergent.
async function cleanDescription(raw: string): Promise<string> {
  if (!raw) return ''
  const rehost = await rehostExternalImages(raw)
  return sanitize(rehost.html)
}

// L'image de couverture est un fichier envoyé SUR l'instance : l'interface l'écrit
// `${PUBLIC_API_URL}/uploads/...`. Rien d'autre n'est accepté, sinon un appel
// direct à l'API pose l'image d'un autre site, chargée par chaque lecteur (son
// adresse IP part chez ce site). Adresse complète acceptée seulement sur l'origine
// de l'instance (FRONTEND_URL, SELF_URL, et PUBLIC_API_URL quand l'API vit sur un
// autre domaine que le site : l'image est alors servie par ce domaine-là).
export function isOwnUploadUrl(value: string): boolean {
  if (isContainedUploadPath(value)) return true
  let u: URL
  try { u = new URL(value) } catch { return false }
  if (u.username || u.password) return false
  return ownOrigins().has(u.origin) && isContainedUploadPath(u.pathname)
}

const COVER_INVALID = { error: 'The cover image must be a file uploaded to this instance', code: 'COVER_URL_INVALID' }

// -- Schemas -------------------------------------------------------------------

// Les champs d'un événement, SANS valeur par défaut. Les défauts ne valent qu'à la
// création : en zod 4, `.partial()` les garde, et une modification partielle les
// réécrivait. Jusqu'au 13/11/2026, « Annuler l'événement » (qui n'envoie que
// is_cancelled) rendait un événement privé PUBLIC, vidait sa description et ses tags,
// coupait les inscriptions et remettait « toute la journée » et la devise par défaut.
// Lien d'achat : une vraie adresse https, rien d'autre (un `javascript:` enregistré
// devenait un lien sur la page ; la CSP en bloquait l'exécution, mais la règle est ici).
const HttpsUrl = z.string().max(2048).refine((v) => {
  try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password } catch { return false }
}, { message: 'TICKET_URL_INVALID' })

const EventFields = {
  title:           z.string().min(3).max(200),
  description:     z.string().max(50000),
  location:        z.string().max(500).nullable(),
  // Bornes réelles : une valeur absurde cassait la carte
  location_lat:    z.number().min(-90).max(90).nullable(),
  location_lng:    z.number().min(-180).max(180).nullable(),
  starts_at:       z.string().datetime(),
  ends_at:         z.string().datetime().nullable(),
  is_all_day:      z.boolean(),
  is_public:       z.boolean(),
  cover_url:       z.string().max(2048).nullable(),
  tags:            z.array(z.string().max(50)).max(10),
  rsvp_enabled:    z.boolean(),
  max_attendees:   z.number().int().positive().nullable(),
  ticket_price:    z.number().nonnegative().nullable(),
  ticket_currency: z.string().length(3),
  ticket_url:      HttpsUrl.nullable(),
}

const CreateEventSchema = z.object({
  ...EventFields,
  description:     EventFields.description.optional().default(''),
  location:        EventFields.location.optional(),
  location_lat:    EventFields.location_lat.optional(),
  location_lng:    EventFields.location_lng.optional(),
  ends_at:         EventFields.ends_at.optional(),
  is_all_day:      EventFields.is_all_day.optional().default(false),
  is_public:       EventFields.is_public.optional().default(true),
  cover_url:       EventFields.cover_url.optional(),
  tags:            EventFields.tags.optional().default([]),
  rsvp_enabled:    EventFields.rsvp_enabled.optional().default(false),
  max_attendees:   EventFields.max_attendees.optional(),
  ticket_price:    EventFields.ticket_price.optional(),
  ticket_currency: EventFields.ticket_currency.optional().default('EUR'),
  ticket_url:      EventFields.ticket_url.optional(),
}).refine(b => !b.ends_at || new Date(b.ends_at) >= new Date(b.starts_at), { message: 'EVENT_ENDS_BEFORE_START', path: ['ends_at'] })

// Modification : seuls les champs ENVOYÉS changent.
const UpdateEventSchema = z.object(EventFields).partial().extend({
  is_cancelled: z.boolean().optional(),
})

const RsvpSchema = z.object({
  status: z.enum(['going', 'maybe', 'not_going']),
})

// -- Helper: authz -------------------------------------------------------------

// Annonces en direct (Socket.IO). `io.emit` part vers TOUTES les connexions, membres ou
// non (un compte retiré de la communauté garde sa session). Avant le 13/11/2026, un
// événement privé y passait en entier (titre, description, lieu), avec ses inscriptions.
// Règle : seul un événement PUBLIC est annoncé, et sans identifiant de communauté (comme
// sa page). Un privé n'est annoncé à personne ; sa page relit tout en base, avec les
// droits du lecteur.
function announcePublic(name: string, ev: { is_public?: boolean } | undefined, payload: Record<string, unknown>) {
  if (ev?.is_public === true) io?.emit(name, payload)
}

function withoutCommunity<T extends Record<string, unknown>>(row: T): Omit<T, 'community_id'> {
  const { community_id: _community, ...rest } = row
  return rest
}

// Qui gère un événement : la même règle que le reste de la modération (rôle +
// grade, via getAccess), plus son auteur TANT QU'IL EST MEMBRE. Avant le 14/11/2026 :
// rôle seul (un grade « Modérer » ne servait à rien ici), et un auteur parti ou
// banni gardait la main sur ses événements. Garde-fou de rang comme au forum :
// un modérateur ne touche pas l'événement de quelqu'un de rang égal ou supérieur.
async function canManageEvent(userId: string, eventId: string): Promise<boolean> {
  const { rows } = await db.query<{ author_id: string | null; community_id: string }>(
    `SELECT e.author_id, e.community_id FROM events e WHERE e.id = $1 LIMIT 1`,
    [eventId]
  )
  if (!rows[0]) return false
  const actor = await getAccess(rows[0].community_id, userId)
  if (actor.role === null) return false                       // plus membre : plus rien
  if (rows[0].author_id === userId) return true
  if (!actor.permissions.includes('moderate_content')) return false
  if (actor.rank >= rankOf('admin') || !rows[0].author_id) return true
  const author = await getAccess(rows[0].community_id, rows[0].author_id)
  return outranks(actor, author.role)
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

    // Whitelist assertion — jamais de valeur utilisateur dans ORDER BY
    const safeOrder: 'ASC' | 'DESC' = showPast ? 'DESC' : 'ASC'

    const { rows: events } = safeOrder === 'DESC'
      ? await db.query(
          `SELECT e.id, e.title, e.description, e.location, e.location_lat, e.location_lng,
                  e.starts_at, e.ends_at, e.is_all_day, e.is_public, e.cover_url, e.tags, e.is_cancelled,
                  e.rsvp_enabled, e.max_attendees, e.ticket_price::float8 AS ticket_price, e.ticket_currency, e.ticket_url,
                  e.created_at, e.updated_at,
                  u.id AS author_id, u.username AS author_name, u.avatar AS author_avatar,
                  (SELECT COUNT(*)::int FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going') AS going_count,
                  (SELECT er2.status FROM event_rsvps er2 WHERE er2.event_id = e.id AND er2.user_id = $3 LIMIT 1) AS my_rsvp
           FROM events e
           LEFT JOIN users u ON u.id = e.author_id
           WHERE ${where} AND e.is_cancelled = false
           ORDER BY e.starts_at DESC
           LIMIT $1 OFFSET $2`,
          params
        )
      : await db.query(
          `SELECT e.id, e.title, e.description, e.location, e.location_lat, e.location_lng,
                  e.starts_at, e.ends_at, e.is_all_day, e.is_public, e.cover_url, e.tags, e.is_cancelled,
                  e.rsvp_enabled, e.max_attendees, e.ticket_price::float8 AS ticket_price, e.ticket_currency, e.ticket_url,
                  e.created_at, e.updated_at,
                  u.id AS author_id, u.username AS author_name, u.avatar AS author_avatar,
                  (SELECT COUNT(*)::int FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going') AS going_count,
                  (SELECT er2.status FROM event_rsvps er2 WHERE er2.event_id = e.id AND er2.user_id = $3 LIMIT 1) AS my_rsvp
           FROM events e
           LEFT JOIN users u ON u.id = e.author_id
           WHERE ${where} AND e.is_cancelled = false
           ORDER BY e.starts_at ASC
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
              e.rsvp_enabled, e.max_attendees, e.ticket_price::float8 AS ticket_price, e.ticket_currency, e.ticket_url,
              e.created_at, e.updated_at, e.community_id,
              u.id AS author_id, u.username AS author_name, u.avatar AS author_avatar,
              (SELECT COUNT(*)::int FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'going')    AS going_count,
              (SELECT COUNT(*)::int FROM event_rsvps er WHERE er.event_id = e.id AND er.status = 'maybe')   AS maybe_count,
              (SELECT er2.status FROM event_rsvps er2 WHERE er2.event_id = e.id AND er2.user_id = $2 LIMIT 1) AS my_rsvp
       FROM events e
       LEFT JOIN users u ON u.id = e.author_id
       WHERE e.id = $1`,
      [req.params.id, userId]
    )
    // Privé et lecteur non membre : 404 comme un événement inexistant, pour ne pas
    // confirmer qu'il existe.
    if (!rows[0] || !(await canReadEvent(rows[0], userId))) {
      return reply.status(404).send({ error: 'Evenement introuvable', code: 'EVENT_NOT_FOUND' })
    }
    const { community_id: _community, ...event } = rows[0]

    let attendees: any[] = []
    if (rows[0].rsvp_enabled) {
      const { rows: rsvps } = await db.query(
        `SELECT er.status, u.id, u.username, u.avatar
         FROM event_rsvps er JOIN users u ON u.id = er.user_id
         WHERE er.event_id = $1 ORDER BY er.created_at ASC`,
        [req.params.id]
      )
      attendees = rsvps
    }

    const canManage = userId ? await canManageEvent(userId, req.params.id) : false
    return reply.send({ event: { ...event, can_manage: canManage }, attendees })
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
      if (!comm[0]) return reply.status(400).send({ error: "Tu dois faire partie d'une communauté", code: 'NOT_A_MEMBER' })

      if (body.cover_url && !isOwnUploadUrl(body.cover_url)) return reply.status(400).send(COVER_INVALID)

      const description = await cleanDescription(body.description ?? '')

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

      announcePublic('event:created', rows[0], { event: withoutCommunity(rows[0]) })
      // Webhooks : seulement un événement public (relu en base par announceCalendarEvent)
      announceCalendarEvent(rows[0].id)
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
        return reply.status(403).send({ error: 'Non autorise', code: 'EVENT_FORBIDDEN' })
      }

      const body = req.body
      // Couverture vérifiée AVANT tout travail (recopie des images de la description).
      // Le formulaire renvoie toujours la couverture actuelle : une ancienne couverture
      // posée avant cette règle (autre domaine de l'instance, par exemple) reste acceptée
      // tant qu'on n'y touche pas, sinon modifier le vieil événement deviendrait impossible.
      if (body.cover_url && !isOwnUploadUrl(body.cover_url)) {
        const { rows: cur } = await db.query<{ cover_url: string | null }>(
          `SELECT cover_url FROM events WHERE id = $1`, [req.params.id])
        if (cur[0]?.cover_url !== body.cover_url) return reply.status(400).send(COVER_INVALID)
      }
      const sets: string[] = []
      const vals: any[]    = []

      const addField = (col: string, val: unknown) => {
        vals.push(val)
        sets.push(`${col} = $${vals.length}`)
      }

      if (body.title           !== undefined) addField('title',           body.title?.trim())
      if (body.description     !== undefined) addField('description',     await cleanDescription(body.description ?? ''))
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

      if (sets.length === 0) return reply.status(400).send({ error: 'Aucun champ a modifier', code: 'EVENT_NOTHING_TO_UPDATE' })

      // La fin ne précède jamais le début, même si un seul des deux change
      if (body.starts_at !== undefined || body.ends_at !== undefined) {
        const { rows: cur } = await db.query<{ starts_at: string; ends_at: string | null }>(
          `SELECT starts_at, ends_at FROM events WHERE id = $1`, [req.params.id])
        const st = body.starts_at ?? cur[0]?.starts_at
        const en = body.ends_at !== undefined ? body.ends_at : cur[0]?.ends_at
        if (st && en && new Date(en) < new Date(st)) {
          return reply.status(400).send({ error: 'The end is before the start', code: 'EVENT_ENDS_BEFORE_START' })
        }
      }

      sets.push('updated_at = NOW()', 'last_indexed_at = NULL')
      vals.push(req.params.id)

      const { rows } = await db.query(
        `UPDATE events SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`,
        vals
      )

      announcePublic('event:updated', rows[0], { event: withoutCommunity(rows[0]) })
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
        return reply.status(403).send({ error: 'Non autorise', code: 'EVENT_FORBIDDEN' })
      }

      const { rows: gone } = await db.query<{ is_public: boolean }>(
        `DELETE FROM events WHERE id = $1 RETURNING is_public`, [req.params.id])
      announcePublic('event:deleted', gone[0], { eventId: req.params.id })
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
        `SELECT id, rsvp_enabled, max_attendees, is_public, community_id, is_cancelled, starts_at
         FROM events WHERE id = $1`,
        [req.params.id]
      )
      if (!ev[0] || !(await canReadEvent(ev[0], userId))) {
        return reply.status(404).send({ error: 'Evenement introuvable', code: 'EVENT_NOT_FOUND' })
      }
      if (!ev[0].rsvp_enabled) return reply.status(400).send({ error: 'Les RSVPs ne sont pas actives', code: 'RSVP_DISABLED' })
      if (ev[0].is_cancelled) return reply.status(400).send({ error: 'This event is cancelled', code: 'EVENT_CANCELLED' })
      if (new Date(ev[0].starts_at) < new Date()) return reply.status(400).send({ error: 'This event has already started', code: 'EVENT_PAST' })

      // La dernière place : compter PUIS inscrire laissait passer deux personnes en
      // même temps. On verrouille la ligne de l'événement le temps de recompter et
      // d'inscrire (transaction) : la seconde attend, recompte, et trouve complet.
      const client = await (db as any).connect()
      try {
        await client.query('BEGIN')
        const { rows: locked } = await client.query(
          `SELECT max_attendees FROM events WHERE id = $1 FOR UPDATE`, [req.params.id])
        if (req.body.status === 'going' && locked[0]?.max_attendees != null) {
          const { rows: cnt } = await client.query(
            `SELECT COUNT(*) FILTER (WHERE status = 'going')::int AS going,
                    COUNT(*) FILTER (WHERE status = 'going' AND user_id = $2)::int AS mine
               FROM event_rsvps WHERE event_id = $1`, [req.params.id, userId])
          if (!cnt[0]?.mine && cnt[0]?.going >= locked[0].max_attendees) {
            await client.query('ROLLBACK')
            return reply.status(400).send({ error: "L'evenement est complet", code: 'EVENT_FULL' })
          }
        }
        await client.query(
          `INSERT INTO event_rsvps (event_id, user_id, status)
           VALUES ($1, $2, $3)
           ON CONFLICT (event_id, user_id) DO UPDATE SET status = EXCLUDED.status, created_at = NOW()`,
          [req.params.id, userId, req.body.status]
        )
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        throw err
      } finally {
        client.release()
      }

      const { rows: userData } = await db.query(
        `SELECT id, username, avatar FROM users WHERE id = $1`,
        [userId]
      )
      announcePublic('event:rsvp', ev[0], { eventId: req.params.id, user: userData[0], status: req.body.status })
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
