/**
 * NEXUS — Système de tâches léger (Kanban)
 * Tableaux par communauté, colonnes configurables, cartes avec assignation/priorité/due date.
 * Prefix: /api/v1/tasks
 */

import { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { validate }    from '../middleware/validate'
import { rateLimit }   from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import { db }          from '../config/database'

// ── getCommunityId (cached) ────────────────────────────────────────────────────

let _communityId: string | null = null

async function getCommunityId(): Promise<string> {
  if (_communityId) return _communityId
  const slug = process.env.NEXUS_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId! }
  }
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  _communityId = rows[0]?.id
  return _communityId!
}

// ── Permission helper ──────────────────────────────────────────────────────────

async function getMemberRole(communityId: string, userId: string): Promise<string | null> {
  const { rows } = await db.query(
    `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 LIMIT 1`,
    [communityId, userId]
  )
  return rows[0]?.role ?? null
}

function canAdmin(role: string | null) {
  return role === 'owner' || role === 'admin' || role === 'moderator'
}

// ── Schemas ────────────────────────────────────────────────────────────────────

const COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'indigo', 'purple', 'pink'] as const
const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

const CreateBoardSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(1000).optional().default(''),
})

const UpdateBoardSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
})

const CreateColumnSchema = z.object({
  name:  z.string().min(1).max(100),
  color: z.enum(COLORS).optional().default('gray'),
})

const UpdateColumnSchema = z.object({
  name:     z.string().min(1).max(100).optional(),
  color:    z.enum(COLORS).optional(),
  position: z.number().int().min(0).optional(),
})

const CreateCardSchema = z.object({
  title:       z.string().min(1).max(200),
  description: z.string().max(10000).optional().default(''),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority:    z.enum(PRIORITIES).optional().default('normal'),
})

const UpdateCardSchema = z.object({
  title:       z.string().min(1).max(200).optional(),
  description: z.string().max(10000).optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  due_date:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  priority:    z.enum(PRIORITIES).optional(),
  column_id:   z.string().uuid().optional(),
})

// ── Routes ─────────────────────────────────────────────────────────────────────

export default async function taskRoutes(app: FastifyInstance) {

  // ── GET /boards ─────────────────────────────────────────────────────────────

  app.get('/boards', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    try {
      const communityId = await getCommunityId()
      const { rows } = await db.query(
        `SELECT b.id, b.name, b.description, b.created_by, b.created_at,
                u.username AS created_by_username,
                (SELECT COUNT(*)::int FROM task_columns c WHERE c.board_id = b.id) AS column_count,
                (SELECT COUNT(*)::int
                 FROM task_cards k
                 JOIN task_columns c ON c.id = k.column_id
                 WHERE c.board_id = b.id) AS card_count
         FROM task_boards b
         JOIN users u ON u.id = b.created_by
         WHERE b.community_id = $1
         ORDER BY b.created_at DESC`,
        [communityId]
      )
      return reply.send({ boards: rows })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── POST /boards ─────────────────────────────────────────────────────────────

  app.post('/boards', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateBoardSchema })],
  }, async (request, reply) => {
    try {
      const communityId = await getCommunityId()
      const userId = (request as any).user.userId
      const body   = request.body as z.infer<typeof CreateBoardSchema>

      const { rows: [board] } = await db.query(
        `INSERT INTO task_boards (community_id, name, description, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [communityId, body.name, body.description, userId]
      )

      const defaults = [
        { name: 'À faire',   color: 'gray',  pos: 0 },
        { name: 'En cours',  color: 'blue',  pos: 1 },
        { name: 'Terminé',   color: 'green', pos: 2 },
      ]
      for (const col of defaults) {
        await db.query(
          `INSERT INTO task_columns (board_id, name, color, position) VALUES ($1, $2, $3, $4)`,
          [board.id, col.name, col.color, col.pos]
        )
      }

      return reply.code(201).send({ id: board.id })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── GET /boards/:id ───────────────────────────────────────────────────────────

  app.get('/boards/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId

      const { rows: [board] } = await db.query(
        `SELECT b.id, b.name, b.description, b.created_by, b.created_at,
                u.username AS created_by_username
         FROM task_boards b
         JOIN users u ON u.id = b.created_by
         WHERE b.id = $1 AND b.community_id = $2`,
        [id, communityId]
      )
      if (!board) return reply.code(404).send({ error: 'Board not found' })

      const { rows: columns } = await db.query(
        `SELECT id, name, color, position FROM task_columns WHERE board_id = $1 ORDER BY position ASC`,
        [id]
      )

      const { rows: cards } = await db.query(
        `SELECT k.id, k.column_id, k.title, k.description, k.due_date, k.priority,
                k.position, k.created_by, k.created_at, k.updated_at,
                u.username AS created_by_username,
                a.id       AS assignee_id,
                a.username AS assignee_username,
                a.avatar   AS assignee_avatar
         FROM task_cards k
         JOIN task_columns c ON c.id = k.column_id
         JOIN users u ON u.id = k.created_by
         LEFT JOIN users a ON a.id = k.assignee_id
         WHERE c.board_id = $1
         ORDER BY k.column_id, k.position ASC`,
        [id]
      )

      const cardsByColumn: Record<string, typeof cards> = {}
      for (const card of cards) {
        if (!cardsByColumn[card.column_id]) cardsByColumn[card.column_id] = []
        cardsByColumn[card.column_id].push(card)
      }
      const columnsWithCards = columns.map(col => ({
        ...col,
        cards: cardsByColumn[col.id] ?? [],
      }))

      const role = await getMemberRole(communityId, userId)
      const canManage = board.created_by === userId || canAdmin(role)

      const { rows: members } = await db.query(
        `SELECT u.id, u.username, u.avatar
         FROM community_members cm
         JOIN users u ON u.id = cm.user_id
         WHERE cm.community_id = $1
         ORDER BY u.username ASC`,
        [communityId]
      )

      return reply.send({ board: { ...board, columns: columnsWithCards }, canManage, members })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── PATCH /boards/:id ─────────────────────────────────────────────────────────

  app.patch('/boards/:id', {
    preHandler: [rateLimit, requireAuth, validate({ body: UpdateBoardSchema })],
  }, async (request, reply) => {
    try {
      const { id }      = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId
      const body        = request.body as z.infer<typeof UpdateBoardSchema>

      const { rows: [board] } = await db.query(
        `SELECT created_by FROM task_boards WHERE id = $1 AND community_id = $2`,
        [id, communityId]
      )
      if (!board) return reply.code(404).send({ error: 'Board not found' })

      const role = await getMemberRole(communityId, userId)
      if (board.created_by !== userId && !canAdmin(role)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const updates: string[] = []
      const params: unknown[] = []
      if (body.name        !== undefined) { params.push(body.name);        updates.push(`name = $${params.length}`) }
      if (body.description !== undefined) { params.push(body.description); updates.push(`description = $${params.length}`) }
      if (!updates.length) return reply.send({ ok: true })

      params.push(id)
      await db.query(`UPDATE task_boards SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
      return reply.send({ ok: true })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── DELETE /boards/:id ────────────────────────────────────────────────────────

  app.delete('/boards/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    try {
      const { id }      = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId

      const { rows: [board] } = await db.query(
        `SELECT created_by FROM task_boards WHERE id = $1 AND community_id = $2`,
        [id, communityId]
      )
      if (!board) return reply.code(404).send({ error: 'Board not found' })

      const role = await getMemberRole(communityId, userId)
      if (board.created_by !== userId && !canAdmin(role)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      await db.query(`DELETE FROM task_boards WHERE id = $1`, [id])
      return reply.send({ ok: true })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── POST /boards/:id/columns ──────────────────────────────────────────────────

  app.post('/boards/:id/columns', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateColumnSchema })],
  }, async (request, reply) => {
    try {
      const { id }      = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId
      const body        = request.body as z.infer<typeof CreateColumnSchema>

      const { rows: [board] } = await db.query(
        `SELECT created_by FROM task_boards WHERE id = $1 AND community_id = $2`,
        [id, communityId]
      )
      if (!board) return reply.code(404).send({ error: 'Board not found' })

      const role = await getMemberRole(communityId, userId)
      if (board.created_by !== userId && !canAdmin(role)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const { rows: [{ max_pos }] } = await db.query(
        `SELECT COALESCE(MAX(position), -1) AS max_pos FROM task_columns WHERE board_id = $1`,
        [id]
      )
      const { rows: [col] } = await db.query(
        `INSERT INTO task_columns (board_id, name, color, position) VALUES ($1, $2, $3, $4) RETURNING id, name, color, position`,
        [id, body.name, body.color, max_pos + 1]
      )
      return reply.code(201).send({ column: { ...col, cards: [] } })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── PATCH /columns/:id ────────────────────────────────────────────────────────

  app.patch('/columns/:id', {
    preHandler: [rateLimit, requireAuth, validate({ body: UpdateColumnSchema })],
  }, async (request, reply) => {
    try {
      const { id }      = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId
      const body        = request.body as z.infer<typeof UpdateColumnSchema>

      const { rows: [col] } = await db.query(
        `SELECT c.id, b.created_by FROM task_columns c
         JOIN task_boards b ON b.id = c.board_id
         WHERE c.id = $1 AND b.community_id = $2`,
        [id, communityId]
      )
      if (!col) return reply.code(404).send({ error: 'Column not found' })

      const role = await getMemberRole(communityId, userId)
      if (col.created_by !== userId && !canAdmin(role)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const updates: string[] = []
      const params: unknown[] = []
      if (body.name     !== undefined) { params.push(body.name);     updates.push(`name = $${params.length}`) }
      if (body.color    !== undefined) { params.push(body.color);    updates.push(`color = $${params.length}`) }
      if (body.position !== undefined) { params.push(body.position); updates.push(`position = $${params.length}`) }
      if (!updates.length) return reply.send({ ok: true })

      params.push(id)
      await db.query(`UPDATE task_columns SET ${updates.join(', ')} WHERE id = $${params.length}`, params)
      return reply.send({ ok: true })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── DELETE /columns/:id ───────────────────────────────────────────────────────

  app.delete('/columns/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    try {
      const { id }      = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId

      const { rows: [col] } = await db.query(
        `SELECT c.id, b.created_by FROM task_columns c
         JOIN task_boards b ON b.id = c.board_id
         WHERE c.id = $1 AND b.community_id = $2`,
        [id, communityId]
      )
      if (!col) return reply.code(404).send({ error: 'Column not found' })

      const role = await getMemberRole(communityId, userId)
      if (col.created_by !== userId && !canAdmin(role)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      await db.query(`DELETE FROM task_columns WHERE id = $1`, [id])
      return reply.send({ ok: true })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── POST /columns/:id/cards ───────────────────────────────────────────────────

  app.post('/columns/:id/cards', {
    preHandler: [rateLimit, requireAuth, validate({ body: CreateCardSchema })],
  }, async (request, reply) => {
    try {
      const { id }      = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId
      const body        = request.body as z.infer<typeof CreateCardSchema>

      const { rows: [col] } = await db.query(
        `SELECT c.id FROM task_columns c
         JOIN task_boards b ON b.id = c.board_id
         WHERE c.id = $1 AND b.community_id = $2`,
        [id, communityId]
      )
      if (!col) return reply.code(404).send({ error: 'Column not found' })

      const { rows: [{ max_pos }] } = await db.query(
        `SELECT COALESCE(MAX(position), -1) AS max_pos FROM task_cards WHERE column_id = $1`,
        [id]
      )

      const { rows: [card] } = await db.query(
        `INSERT INTO task_cards (column_id, title, description, assignee_id, due_date, priority, position, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, column_id, title, description, due_date, priority, position, created_by, created_at`,
        [id, body.title, body.description, body.assignee_id ?? null, body.due_date ?? null, body.priority, max_pos + 1, userId]
      )

      const { rows: [enriched] } = await db.query(
        `SELECT k.*, u.username AS created_by_username,
                a.id AS assignee_id, a.username AS assignee_username, a.avatar AS assignee_avatar
         FROM task_cards k
         JOIN users u ON u.id = k.created_by
         LEFT JOIN users a ON a.id = k.assignee_id
         WHERE k.id = $1`,
        [card.id]
      )

      return reply.code(201).send({ card: enriched })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── PATCH /cards/:id ──────────────────────────────────────────────────────────

  app.patch('/cards/:id', {
    preHandler: [rateLimit, requireAuth, validate({ body: UpdateCardSchema })],
  }, async (request, reply) => {
    const { id }      = request.params as { id: string }
    const communityId = await getCommunityId()
    const userId      = (request as any).user.userId
    const body        = request.body as z.infer<typeof UpdateCardSchema>

    try {
    // Récupère la carte + board pour vérif droits
    const { rows: [card] } = await db.query(
      `SELECT k.created_by, b.created_by AS board_creator, b.community_id
       FROM task_cards k
       JOIN task_columns c ON c.id = k.column_id
       JOIN task_boards b ON b.id = c.board_id
       WHERE k.id = $1 AND b.community_id = $2`,
      [id, communityId]
    )
    if (!card) return reply.code(404).send({ error: 'Card not found' })

    const role = await getMemberRole(communityId, userId)
    if (card.created_by !== userId && card.board_creator !== userId && !canAdmin(role)) {
      return reply.code(403).send({ error: 'Forbidden' })
    }

    // Déplacement de colonne : vérifier que la colonne cible appartient au même board
    if (body.column_id) {
      const { rows: [targetCol] } = await db.query(
        `SELECT c.id FROM task_columns c
         JOIN task_boards b ON b.id = c.board_id
         WHERE c.id = $1 AND b.community_id = $2`,
        [body.column_id, communityId]
      )
      if (!targetCol) return reply.code(400).send({ error: 'Invalid column' })
    }

    const updates: string[] = ['updated_at = NOW()']
    const params: unknown[] = []
    if (body.title       !== undefined) { params.push(body.title);        updates.push(`title = $${params.length}`) }
    if (body.description !== undefined) { params.push(body.description);  updates.push(`description = $${params.length}`) }
    if (body.assignee_id !== undefined) { params.push(body.assignee_id);  updates.push(`assignee_id = $${params.length}`) }
    if (body.due_date    !== undefined) { params.push(body.due_date);     updates.push(`due_date = $${params.length}`) }
    if (body.priority    !== undefined) { params.push(body.priority);     updates.push(`priority = $${params.length}`) }
    if (body.column_id   !== undefined) {
      // Déplacer en dernière position de la colonne cible
      const { rows: [{ max_pos }] } = await db.query(
        `SELECT COALESCE(MAX(position), -1) AS max_pos FROM task_cards WHERE column_id = $1 AND id != $2`,
        [body.column_id, id]
      )
      params.push(body.column_id); updates.push(`column_id = $${params.length}`)
      params.push(max_pos + 1);    updates.push(`position = $${params.length}`)
    }

    params.push(id)
    await db.query(`UPDATE task_cards SET ${updates.join(', ')} WHERE id = $${params.length}`, params)

    const { rows: [updated] } = await db.query(
      `SELECT k.*, u.username AS created_by_username,
              a.id AS assignee_id, a.username AS assignee_username, a.avatar AS assignee_avatar
       FROM task_cards k
       JOIN users u ON u.id = k.created_by
       LEFT JOIN users a ON a.id = k.assignee_id
       WHERE k.id = $1`,
      [id]
    )
    return reply.send({ card: updated })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })

  // ── DELETE /cards/:id ─────────────────────────────────────────────────────────

  app.delete('/cards/:id', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    try {
      const { id }      = request.params as { id: string }
      const communityId = await getCommunityId()
      const userId      = (request as any).user.userId

      const { rows: [card] } = await db.query(
        `SELECT k.created_by, b.created_by AS board_creator, b.community_id
         FROM task_cards k
         JOIN task_columns c ON c.id = k.column_id
         JOIN task_boards b ON b.id = c.board_id
         WHERE k.id = $1 AND b.community_id = $2`,
        [id, communityId]
      )
      if (!card) return reply.code(404).send({ error: 'Card not found' })

      const role = await getMemberRole(communityId, userId)
      if (card.created_by !== userId && card.board_creator !== userId && !canAdmin(role)) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      await db.query(`DELETE FROM task_cards WHERE id = $1`, [id])
      return reply.send({ ok: true })
    } catch { return reply.code(500).send({ error: 'Internal server error' }) }
  })
}
