/**
 * NEXUS — Polls (sondages)
 * Prefix: /api/v1/polls
 *
 * Types : choice | schedule | ranking
 *
 * GET    /               — liste des sondages de la communauté
 * POST   /               — créer un sondage (+ message chat si channel_id)
 * GET    /:id            — détail complet (options + résultats + participants)
 * DELETE /:id            — supprimer (créateur ou admin)
 * POST   /:id/vote       — voter / mettre à jour son vote
 * DELETE /:id/vote       — retirer son vote
 * POST   /:id/close      — fermer manuellement (créateur ou admin)
 */

import { FastifyInstance } from 'fastify'
import { db } from '../config/database'
import { requireAuth } from '../middleware/auth'
import { rateLimit } from '../middleware/rateLimit'
import { io } from '../socket/io'
import * as ChannelModel from '../models/channel'

// ── Community helper (same pattern as chat.ts) ────────────────────────────────

let _communityId: string | null = null

async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId
  const slug = process.env.NEXUS_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId }
  }
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  if (rows[0]) { _communityId = rows[0].id; return _communityId }
  return null
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Vérifie si un sondage est encore ouvert */
function isOpen(poll: { closed_at: string | null; closes_at: string | null }): boolean {
  if (poll.closed_at) return false
  if (poll.closes_at && new Date(poll.closes_at) < new Date()) return false
  return true
}

/** Calcule les résultats d'un sondage à partir des votes */
async function computeResults(pollId: string, type: string, anonymous: boolean) {
  const { rows: votes } = await db.query(`
    SELECT pv.option_id, pv.user_id, pv.value,
           u.username, u.avatar
    FROM poll_votes pv
    JOIN users u ON u.id = pv.user_id
    WHERE pv.poll_id = $1
  `, [pollId])

  const { rows: options } = await db.query(`
    SELECT id, label, description, image_url, date_start, date_end, position
    FROM poll_options
    WHERE poll_id = $1
    ORDER BY position ASC, created_at ASC
  `, [pollId])

  // Groupe les votes par option
  const byOption = new Map<string, typeof votes>()
  for (const v of votes) {
    if (!byOption.has(v.option_id)) byOption.set(v.option_id, [])
    byOption.get(v.option_id)!.push(v)
  }

  // Compte total de participants (utilisateurs uniques)
  const participantIds = new Set(votes.map(v => v.user_id))
  const totalParticipants = participantIds.size

  if (type === 'choice') {
    const totalVotes = votes.length  // nombre total de bulletins

    return options.map(opt => {
      const optVotes = byOption.get(opt.id) ?? []
      return {
        ...opt,
        vote_count: optVotes.length,
        percentage: totalVotes > 0 ? Math.round(optVotes.length / totalVotes * 100) : 0,
        voters: anonymous ? [] : optVotes.map(v => ({ id: v.user_id, username: v.username, avatar: v.avatar })),
      }
    })
  }

  if (type === 'schedule') {
    // Pour chaque créneau : comptage YES (2) / MAYBE (1) / NO (0)
    return options.map(opt => {
      const optVotes = byOption.get(opt.id) ?? []
      const yes    = optVotes.filter(v => v.value === 2)
      const maybe  = optVotes.filter(v => v.value === 1)
      const no     = optVotes.filter(v => v.value === 0)
      return {
        ...opt,
        yes_count:   yes.length,
        maybe_count: maybe.length,
        no_count:    no.length,
        voters: anonymous ? {} : {
          yes:   yes.map(v   => ({ id: v.user_id, username: v.username, avatar: v.avatar })),
          maybe: maybe.map(v => ({ id: v.user_id, username: v.username, avatar: v.avatar })),
          no:    no.map(v    => ({ id: v.user_id, username: v.username, avatar: v.avatar })),
        },
      }
    })
  }

  if (type === 'ranking') {
    // Score : somme inversée des rangs. Position 1 = plus de points
    const totalOptions = options.length
    return options.map(opt => {
      const optVotes = byOption.get(opt.id) ?? []
      const score = optVotes.reduce((acc, v) => acc + (totalOptions - v.value + 1), 0)
      return {
        ...opt,
        score,
        avg_rank: optVotes.length > 0
          ? parseFloat((optVotes.reduce((a, v) => a + v.value, 0) / optVotes.length).toFixed(1))
          : null,
        vote_count: optVotes.length,
      }
    }).sort((a, b) => b.score - a.score)
  }

  return options
}

/** Récupère les votes d'un utilisateur sur un sondage */
async function getUserVotes(pollId: string, userId: string) {
  const { rows } = await db.query(
    `SELECT option_id, value FROM poll_votes WHERE poll_id = $1 AND user_id = $2`,
    [pollId, userId]
  )
  return rows
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function pollRoutes(app: FastifyInstance) {

  // ── GET / — liste des sondages ─────────────────────────────────────────────

  app.get<{
    Querystring: { limit?: string; offset?: string; status?: string; channel_id?: string; thread_id?: string }
  }>('/', { preHandler: [rateLimit, requireAuth] }, async (req, reply) => {
    const userId = (req as any).user!.userId
    const limit  = Math.min(Number(req.query.limit ?? 20), 50)
    const offset = Number(req.query.offset ?? 0)
    const status = req.query.status  // 'active' | 'closed' | undefined = all
    const channelFilter = req.query.channel_id
    const threadFilter  = req.query.thread_id

    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    // Filtre communauté : via le canal (chat) ou via la catégorie forum du thread
    let where = `(ch.community_id = $1 OR tcat.community_id = $1 OR (p.channel_id IS NULL AND p.thread_id IS NULL))`
    const params: unknown[] = [communityId]
    let idx = 2

    if (channelFilter) {
      where += ` AND p.channel_id = $${idx++}`
      params.push(channelFilter)
    }
    if (threadFilter) {
      where += ` AND p.thread_id = $${idx++}`
      params.push(threadFilter)
    }
    if (status === 'active') {
      where += ` AND p.closed_at IS NULL AND (p.closes_at IS NULL OR p.closes_at > NOW())`
    } else if (status === 'closed') {
      where += ` AND (p.closed_at IS NOT NULL OR (p.closes_at IS NOT NULL AND p.closes_at <= NOW()))`
    }

    const { rows: polls } = await db.query(`
      SELECT p.*,
             u.username AS creator_username,
             u.avatar   AS creator_avatar,
             ch.name    AS channel_name,
             (SELECT COUNT(*) FROM poll_votes pv WHERE pv.poll_id = p.id) AS total_votes,
             (SELECT COUNT(*) FROM poll_options po WHERE po.poll_id = p.id) AS option_count,
             EXISTS(SELECT 1 FROM poll_votes pv WHERE pv.poll_id = p.id AND pv.user_id = $${idx}) AS has_voted
      FROM polls p
      JOIN users u ON u.id = p.created_by
      LEFT JOIN channels ch ON ch.id = p.channel_id
      LEFT JOIN threads th ON th.id = p.thread_id
      LEFT JOIN categories tcat ON tcat.id = th.category_id
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT $${idx + 1} OFFSET $${idx + 2}
    `, [...params, userId, limit, offset])

    return reply.send({ polls: polls.map(p => ({
      ...p,
      is_open: isOpen(p),
      total_votes: Number(p.total_votes),
      option_count: Number(p.option_count),
    }))})
  })

  // ── POST / — créer un sondage ──────────────────────────────────────────────

  app.post<{
    Body: {
      title:        string
      description?: string
      type?:        'choice' | 'schedule' | 'ranking'
      multiple?:    boolean
      max_choices?: number | null
      anonymous?:   boolean
      show_results?: boolean
      closes_at?:   string | null
      channel_id?:  string | null
      thread_id?:   string | null
      options:      Array<{
        label:       string
        description?: string
        image_url?:  string
        date_start?: string
        date_end?:   string
      }>
    }
  }>('/', { preHandler: [rateLimit, requireAuth] }, async (req, reply) => {
    const userId = (req as any).user!.userId
    const {
      title, description, type = 'choice',
      multiple = false, max_choices = null,
      anonymous = false, show_results = true,
      closes_at = null, channel_id = null, thread_id = null,
      options,
    } = req.body

    if (!title?.trim()) return reply.code(400).send({ error: 'Title is required' })
    if (!options?.length || options.length < 2)
      return reply.code(400).send({ error: 'At least 2 options required' })
    if (options.length > 20)
      return reply.code(400).send({ error: 'Maximum 20 options' })

    // Validation spécifique par type
    if (type === 'schedule') {
      for (const opt of options) {
        if (!opt.date_start) return reply.code(400).send({ error: 'schedule options require date_start' })
      }
    }

    // Créer le sondage dans une transaction
    const client = await (db as any).connect()
    try {
      await client.query('BEGIN')

      const { rows: [poll] } = await client.query(`
        INSERT INTO polls (created_by, channel_id, thread_id, title, description, type,
                           multiple, max_choices, anonymous, show_results, closes_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [userId, channel_id, thread_id, title.trim(), description?.trim() ?? null,
          type, multiple, max_choices, anonymous, show_results,
          closes_at ? new Date(closes_at) : null])

      // Insérer les options
      for (let i = 0; i < options.length; i++) {
        const opt = options[i]
        await client.query(`
          INSERT INTO poll_options (poll_id, label, description, image_url, date_start, date_end, position)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [poll.id, opt.label.trim(), opt.description?.trim() ?? null,
            opt.image_url ?? null,
            opt.date_start ? new Date(opt.date_start) : null,
            opt.date_end   ? new Date(opt.date_end)   : null,
            i])
      }

      // Si lié à un canal, poster un message spécial dans le chat
      if (channel_id) {
        const { rows: [user] } = await client.query(
          `SELECT username, avatar FROM users WHERE id = $1`, [userId]
        )
        const { rows: [msg] } = await client.query(`
          INSERT INTO channel_messages (channel_id, author_id, content, poll_id)
          VALUES ($1, $2, $3, $4)
          RETURNING id, created_at
        `, [channel_id, userId, '', poll.id])

        // Broadcaster le message chat avec poll via Socket.IO
        const pollMsg = {
          id:              msg.id,
          channel_id:      String(channel_id),
          author_id:       userId,
          author_username: user.username,
          author_avatar:   user.avatar ?? null,
          content:         null,
          poll_id:         poll.id,
          poll: {
            id:          poll.id,
            title:       poll.title,
            type:        poll.type,
            is_open:     true,
            option_count: options.length,
            total_votes: 0,
          },
          created_at:  msg.created_at,
          reactions:   [],
          is_deleted:  false,
        }
        io?.to(`channel:${channel_id}`).emit('chat:message', pollMsg)
      }

      await client.query('COMMIT')

      return reply.code(201).send({ poll: { ...poll, is_open: true } })
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }
  })

  // ── GET /:id — détail complet ──────────────────────────────────────────────

  app.get<{ Params: { id: string } }>(
    '/:id', { preHandler: [rateLimit, requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user!.userId
      const { id }  = req.params

      const { rows: [poll] } = await db.query(`
        SELECT p.*,
               u.username AS creator_username,
               u.avatar   AS creator_avatar,
               ch.name    AS channel_name
        FROM polls p
        JOIN users u ON u.id = p.created_by
        LEFT JOIN channels ch ON ch.id = p.channel_id
        WHERE p.id = $1
      `, [id])

      if (!poll) return reply.code(404).send({ error: 'Poll not found' })

      const open = isOpen(poll)

      // Montrer les résultats si : show_results = true  OU  l'utilisateur a déjà voté  OU  le sondage est fermé
      const userVotes     = await getUserVotes(id, userId)
      const hasVoted      = userVotes.length > 0
      const showResults   = poll.show_results || hasVoted || !open

      const results       = showResults ? await computeResults(id, poll.type, poll.anonymous) : null

      // Participants uniques
      const { rows: [{ count: participantCount }] } = await db.query(
        `SELECT COUNT(DISTINCT user_id) AS count FROM poll_votes WHERE poll_id = $1`, [id]
      )

      return reply.send({
        poll: {
          ...poll,
          is_open:           open,
          participant_count: Number(participantCount),
          user_votes:        userVotes,
          results,
        }
      })
    }
  )

  // ── DELETE /:id — supprimer ────────────────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    '/:id', { preHandler: [rateLimit, requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user!.userId
      const { id }  = req.params

      const { rows: [poll] } = await db.query(`SELECT * FROM polls WHERE id = $1`, [id])
      if (!poll) return reply.code(404).send({ error: 'Poll not found' })

      // Autorisation : créateur ou admin
      const { rows: [user] } = await db.query(`SELECT role FROM users WHERE id = $1`, [userId])
      if (String(poll.created_by) !== String(userId) && user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      await db.query(`DELETE FROM polls WHERE id = $1`, [id])
      return reply.send({ success: true })
    }
  )

  // ── POST /:id/vote — voter ────────────────────────────────────────────────

  app.post<{
    Params: { id: string }
    Body: {
      votes: Array<{ option_id: string; value?: number }>
    }
  }>('/:id/vote', { preHandler: [rateLimit, requireAuth] }, async (req, reply) => {
    const userId = (req as any).user!.userId
    const { id }  = req.params
    const { votes } = req.body

    if (!votes?.length) return reply.code(400).send({ error: 'votes array required' })

    const { rows: [poll] } = await db.query(`SELECT * FROM polls WHERE id = $1`, [id])
    if (!poll) return reply.code(404).send({ error: 'Poll not found' })
    if (!isOpen(poll))  return reply.code(409).send({ error: 'Poll is closed' })

    // Validation des votes selon le type
    if (poll.type === 'choice') {
      if (!poll.multiple && votes.length > 1)
        return reply.code(400).send({ error: 'This poll allows only one choice' })
      if (poll.max_choices && votes.length > poll.max_choices)
        return reply.code(400).send({ error: `Maximum ${poll.max_choices} choices` })
    }

    if (poll.type === 'schedule') {
      // Chaque vote doit avoir une valeur 0/1/2
      for (const v of votes) {
        if (v.value === undefined || ![0, 1, 2].includes(v.value))
          return reply.code(400).send({ error: 'schedule votes require value 0 (no), 1 (maybe), 2 (yes)' })
      }
    }

    if (poll.type === 'ranking') {
      const ranks = votes.map(v => v.value ?? 0)
      const sorted = [...ranks].sort((a, b) => a - b)
      if (sorted[0] !== 1 || sorted[sorted.length - 1] !== sorted.length)
        return reply.code(400).send({ error: 'ranking votes must be consecutive integers starting at 1' })
    }

    // Vérifier que toutes les options appartiennent à ce sondage
    const optionIds = votes.map(v => v.option_id)
    const { rows: validOptions } = await db.query(
      `SELECT id FROM poll_options WHERE poll_id = $1 AND id = ANY($2::uuid[])`,
      [id, optionIds]
    )
    if (validOptions.length !== optionIds.length)
      return reply.code(400).send({ error: 'Invalid option_id(s)' })

    const client = await (db as any).connect()
    try {
      await client.query('BEGIN')

      // Pour choice et ranking : supprimer les votes précédents de cet utilisateur
      if (poll.type !== 'schedule') {
        await client.query(
          `DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2`,
          [id, userId]
        )
      }

      // Insérer/mettre à jour les votes
      for (const v of votes) {
        await client.query(`
          INSERT INTO poll_votes (poll_id, option_id, user_id, value)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (poll_id, option_id, user_id) DO UPDATE SET value = $4, created_at = NOW()
        `, [id, v.option_id, userId, v.value ?? 1])
      }

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    // Calculer et broadcaster les nouveaux résultats
    const results = await computeResults(id, poll.type, poll.anonymous)
    const { rows: [{ count: participantCount }] } = await db.query(
      `SELECT COUNT(DISTINCT user_id) AS count FROM poll_votes WHERE poll_id = $1`, [id]
    )

    const payload = {
      poll_id:           id,
      results,
      participant_count: Number(participantCount),
    }

    if (poll.channel_id) {
      io?.to(`channel:${poll.channel_id}`).emit('poll:updated', payload)
    }
    if (poll.thread_id) {
      io?.to(`thread:${poll.thread_id}`).emit('poll:updated', payload)
    }

    return reply.send({ success: true, ...payload })
  })

  // ── DELETE /:id/vote — retirer son vote ────────────────────────────────────

  app.delete<{ Params: { id: string } }>(
    '/:id/vote', { preHandler: [rateLimit, requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user!.userId
      const { id }  = req.params

      const { rows: [poll] } = await db.query(`SELECT * FROM polls WHERE id = $1`, [id])
      if (!poll) return reply.code(404).send({ error: 'Poll not found' })
      if (!isOpen(poll)) return reply.code(409).send({ error: 'Poll is closed' })

      await db.query(
        `DELETE FROM poll_votes WHERE poll_id = $1 AND user_id = $2`,
        [id, userId]
      )

      const results = await computeResults(id, poll.type, poll.anonymous)
      const { rows: [{ count: participantCount }] } = await db.query(
        `SELECT COUNT(DISTINCT user_id) AS count FROM poll_votes WHERE poll_id = $1`, [id]
      )
      const payload = { poll_id: id, results, participant_count: Number(participantCount) }

      if (poll.channel_id) {
        io?.to(`channel:${poll.channel_id}`).emit('poll:updated', payload)
      }
      if (poll.thread_id) {
        io?.to(`thread:${poll.thread_id}`).emit('poll:updated', payload)
      }

      return reply.send({ success: true, ...payload })
    }
  )

  // ── POST /:id/close — fermer manuellement ─────────────────────────────────

  app.post<{ Params: { id: string } }>(
    '/:id/close', { preHandler: [rateLimit, requireAuth] },
    async (req, reply) => {
      const userId = (req as any).user!.userId
      const { id }  = req.params

      const { rows: [poll] } = await db.query(`SELECT * FROM polls WHERE id = $1`, [id])
      if (!poll) return reply.code(404).send({ error: 'Poll not found' })

      const { rows: [user] } = await db.query(`SELECT role FROM users WHERE id = $1`, [userId])
      if (String(poll.created_by) !== String(userId) && user?.role !== 'admin') {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      await db.query(
        `UPDATE polls SET closed_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]
      )

      if (poll.channel_id) {
        io?.to(`channel:${poll.channel_id}`).emit('poll:closed', { poll_id: id })
      }
      if (poll.thread_id) {
        io?.to(`thread:${poll.thread_id}`).emit('poll:closed', { poll_id: id })
      }

      return reply.send({ success: true })
    }
  )
}
