import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { adminOnly }   from '../middleware/adminOnly'
import { rateLimit }   from '../middleware/rateLimit'
import { validate }    from '../middleware/validate'
import { db }          from '../config/database'
import { create as createNotification } from '../models/notification'

// ── Types (mirror of frontend canvas.ts) ─────────────────────────────────────

const PointSchema   = z.tuple([z.number(), z.number()])
const PathDataSchema = z.object({
  points: z.array(PointSchema),
  color:  z.string().max(32),
  width:  z.number().min(1).max(100),
})
const StickyDataSchema = z.object({
  x:     z.number(),
  y:     z.number(),
  text:  z.string().max(1000),
  color: z.string().max(32),
  w:     z.number().optional(),
  h:     z.number().optional(),
})
const ShapeDataSchema = z.object({
  x:     z.number(),
  y:     z.number(),
  w:     z.number(),
  h:     z.number(),
  color: z.string().max(32),
  fill:  z.boolean(),
})
const TextDataSchema = z.object({
  x:        z.number(),
  y:        z.number(),
  text:     z.string().max(2000),
  color:    z.string().max(32),
  fontSize: z.number().min(8).max(200).optional(),
  bold:     z.boolean().optional(),
  italic:   z.boolean().optional(),
})
const ArrowDataSchema = z.object({
  x1: z.number(), y1: z.number(),
  x2: z.number(), y2: z.number(),
  color: z.string().max(32),
  width: z.number().min(1).max(50),
})
const ImageDataSchema = z.object({
  x:      z.number(),
  y:      z.number(),
  w:      z.number(),
  h:      z.number(),
  url:    z.string().max(500),
  assetId: z.string().uuid().optional(),
})

const VALID_KINDS = ['pen', 'sticky', 'rect', 'circle', 'text', 'arrow', 'image', 'eraser'] as const

const CanvasElementSchema = z.object({
  id:      z.string().uuid(),
  ts:      z.number(),
  author:  z.string().uuid(),
  kind:    z.enum(VALID_KINDS),
  data:    z.union([
    PathDataSchema, StickyDataSchema, ShapeDataSchema,
    TextDataSchema, ArrowDataSchema, ImageDataSchema,
  ]),
  deleted: z.boolean().optional(),
})

const SnapshotSchema = z.array(CanvasElementSchema).max(5000)

// ── Helpers ───────────────────────────────────────────────────────────────────

async function isModuleEnabled(): Promise<boolean> {
  const { rows } = await db.query<{ enabled: boolean }>(
    `SELECT enabled FROM modules WHERE id = 'canvas'`
  )
  return rows[0]?.enabled ?? false
}

async function boardExists(id: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM canvas_boards WHERE id = $1`, [id]
  )
  return rows.length > 0
}

// Voir / écrire un board. Doit rester cohérent avec resolveBoardAccess du socket
// (src/socket/canvas.ts). Public standalone = view pour tout membre, write non
// (lecture seule). Invitations/éditeurs = Lot 2b.
async function resolveAccess(
  board: { id: string; created_by: string; channel_id: string | null; visibility: string },
  userId: string,
): Promise<{ view: boolean; write: boolean }> {
  if (board.created_by === userId) return { view: true, write: true }
  if (board.channel_id) {
    const { rowCount } = await db.query(
      `SELECT 1 FROM channels c
       JOIN community_members cm ON cm.community_id = c.community_id
       WHERE c.id = $1 AND cm.user_id = $2 LIMIT 1`,
      [board.channel_id, userId],
    )
    const m = (rowCount ?? 0) > 0
    return { view: m, write: m }
  }
  // Standalone, pas le créateur : collaborateur accepté ?
  const { rows: [collab] } = await db.query<{ role: string; status: string }>(
    `SELECT role, status FROM canvas_board_collaborators WHERE board_id = $1 AND user_id = $2`,
    [board.id, userId],
  )
  const activeEditor = collab?.status === 'active' && collab?.role === 'editor'
  if (board.visibility === 'public') {
    const { rowCount } = await db.query(
      `SELECT 1 FROM community_members WHERE user_id = $1 LIMIT 1`, [userId],
    )
    return { view: (rowCount ?? 0) > 0, write: !!activeEditor }
  }
  // Privé : seuls les collaborateurs actifs voient.
  return { view: collab?.status === 'active', write: !!activeEditor }
}

// ── Routes ────────────────────────────────────────────────────────────────────

export default async function canvasRoutes(app: FastifyInstance) {

  // ── POST /api/v1/canvas — Créer un board ─────────────────────────────────
  app.post('/', {
    preHandler: [rateLimit, requireAuth],
    schema: {
      body: {
        type: 'object',
        properties: {
          name:       { type: 'string', maxLength: 100 },
          channel_id: { type: 'string' },
          visibility: { type: 'string', enum: ['private', 'public'] },
        },
      },
    },
  }, async (req, reply) => {
    if (!await isModuleEnabled()) {
      return reply.code(403).send({ error: 'Le module Canvas n\'est pas activé.' })
    }

    const { name, channel_id, visibility } = req.body as { name?: string; channel_id?: string; visibility?: string }
    const vis = visibility === 'public' ? 'public' : 'private'
    const userId = req.user!.userId

    // Validate channel_id is a real UUID if provided
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (channel_id && !UUID_RE.test(channel_id)) {
      return reply.code(400).send({ error: 'channel_id invalide.' })
    }

    // If channel_id provided, verify it exists
    if (channel_id) {
      const { rows } = await db.query(`SELECT 1 FROM channels WHERE id = $1`, [channel_id])
      if (!rows.length) return reply.code(404).send({ error: 'Canal introuvable.' })
    }

    const { rows } = await db.query<{ id: string; name: string; created_at: string }>(
      `INSERT INTO canvas_boards (name, channel_id, created_by, visibility)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, channel_id, created_by, visibility, created_at, updated_at`,
      [name?.trim() || 'Sans titre', channel_id ?? null, userId, vis]
    )
    return reply.code(201).send({ board: rows[0] })
  })

  // ── GET /api/v1/canvas/channel/:channelId — Boards d'un canal ────────────
  app.get<{ Params: { channelId: string } }>('/channel/:channelId', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    if (!await isModuleEnabled()) {
      return reply.code(403).send({ error: 'Le module Canvas n\'est pas activé.' })
    }

    const { channelId } = req.params
    const { rows } = await db.query(
      `SELECT id, name, channel_id, created_by, created_at, updated_at,
              jsonb_array_length(snapshot) AS element_count
       FROM canvas_boards
       WHERE channel_id = $1
       ORDER BY updated_at DESC`,
      [channelId]
    )
    return reply.send({ boards: rows })
  })

  // ── GET /api/v1/canvas/boards — Boards standalone (hub Projets) ──────────
  // Déclaré AVANT /:boardId : Fastify priorise la route statique de toute
  // façon, mais on garde l'ordre lisible. Read-only, additif.
  app.get('/boards', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    if (!await isModuleEnabled()) {
      return reply.code(403).send({ error: 'Le module Canvas n\'est pas activé.' })
    }
    // Lot 1 : on ne liste que MES projets standalone. La galerie publique
    // (projets d'autres membres en visibility='public') arrive au Lot 2 avec
    // le système de rôles/accès.
    const userId = req.user!.userId
    const { rows } = await db.query(
      `SELECT b.id, b.name, b.visibility, b.created_by, b.created_at, b.updated_at,
              jsonb_array_length(b.snapshot) AS element_count,
              (SELECT COUNT(*) FROM canvas_board_collaborators c
               WHERE c.board_id = b.id AND c.status = 'pending')::int AS pending_requests
       FROM canvas_boards b
       WHERE b.channel_id IS NULL AND b.created_by = $1
       ORDER BY b.updated_at DESC
       LIMIT 200`,
      [userId]
    )
    return reply.send({ boards: rows })
  })

  // ── GET /api/v1/canvas/public — Galerie des projets publics (Lot 2a) ─────
  // Projets standalone publics des AUTRES membres. Lecture seule à l'ouverture.
  app.get('/public', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    if (!await isModuleEnabled()) {
      return reply.code(403).send({ error: 'Le module Canvas n\'est pas activé.' })
    }
    const userId = req.user!.userId
    const { rows } = await db.query(
      `SELECT b.id, b.name, b.visibility, b.created_by, b.created_at, b.updated_at,
              u.username AS creator_username,
              jsonb_array_length(b.snapshot) AS element_count
       FROM canvas_boards b
       LEFT JOIN users u ON u.id = b.created_by
       WHERE b.channel_id IS NULL AND b.visibility = 'public' AND b.created_by <> $1
       ORDER BY b.updated_at DESC
       LIMIT 200`,
      [userId]
    )
    return reply.send({ boards: rows })
  })

  // ── GET /api/v1/canvas/:boardId — Charger un board ───────────────────────
  app.get<{ Params: { boardId: string } }>('/:boardId', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    if (!await isModuleEnabled()) {
      return reply.code(403).send({ error: 'Le module Canvas n\'est pas activé.' })
    }

    const { rows } = await db.query<{
      id: string; name: string; channel_id: string | null; created_by: string;
      visibility: string; snapshot: unknown; created_at: string; updated_at: string;
    }>(
      `SELECT id, name, channel_id, created_by, visibility, snapshot, created_at, updated_at
       FROM canvas_boards WHERE id = $1`,
      [req.params.boardId]
    )
    const board = rows[0]
    if (!board) return reply.code(404).send({ error: 'Board introuvable.' })

    const userId = req.user!.userId
    const access = await resolveAccess(board, userId)
    if (!access.view) return reply.code(403).send({ error: 'Accès refusé à ce board.' })

    // Dernière visite (pour surligner les nouveautés), puis on la met à jour à maintenant.
    const { rows: [view] } = await db.query<{ last_seen_at: string }>(
      `SELECT last_seen_at FROM canvas_board_views WHERE board_id = $1 AND user_id = $2`,
      [board.id, userId])
    const lastSeen = view?.last_seen_at ?? null
    await db.query(
      `INSERT INTO canvas_board_views (board_id, user_id, last_seen_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (board_id, user_id) DO UPDATE SET last_seen_at = NOW()`,
      [board.id, userId]).catch(() => {})

    return reply.send({ board: { ...board, can_edit: access.write, last_seen: lastSeen } })
  })

  // ── PATCH /api/v1/canvas/:boardId — Sauvegarder snapshot ─────────────────
  // Authorization: the requester must either own the board, or be a member of
  // the community that owns the channel the board is attached to. Without this
  // check any authenticated user could overwrite any board by guessing its UUID.
  app.patch<{ Params: { boardId: string } }>('/:boardId', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    if (!await isModuleEnabled()) {
      return reply.code(403).send({ error: 'Le module Canvas n\'est pas activé.' })
    }

    const userId = req.user!.userId

    // Resolve board ownership context before letting any UPDATE through
    const { rows: [board] } = await db.query<{ created_by: string; channel_id: string | null }>(
      `SELECT created_by, channel_id FROM canvas_boards WHERE id = $1`,
      [req.params.boardId]
    )
    if (!board) return reply.code(404).send({ error: 'Board introuvable.' })

    let allowed = board.created_by === userId
    if (!allowed && board.channel_id) {
      const { rowCount } = await db.query(
        `SELECT 1
         FROM channels c
         JOIN community_members cm ON cm.community_id = c.community_id
         WHERE c.id = $1 AND cm.user_id = $2
         LIMIT 1`,
        [board.channel_id, userId]
      )
      allowed = (rowCount ?? 0) > 0
    }
    if (!allowed) {
      return reply.code(403).send({ error: 'Accès refusé à ce board.' })
    }

    const { snapshot, name } = req.body as { snapshot?: unknown[]; name?: string }

    if (snapshot !== undefined) {
      const parsed = SnapshotSchema.safeParse(snapshot)
      if (!parsed.success) {
        return reply.code(400).send({ error: 'Snapshot invalide.', details: parsed.error.issues })
      }
    }

    const updates: string[] = ['updated_at = NOW()']
    const params: unknown[]  = [req.params.boardId]

    if (name !== undefined) {
      params.push(name.trim().slice(0, 100) || 'Sans titre')
      updates.push(`name = $${params.length}`)
    }
    if (snapshot !== undefined) {
      params.push(JSON.stringify(snapshot))
      updates.push(`snapshot = $${params.length}`)
    }

    const { rows } = await db.query(
      `UPDATE canvas_boards SET ${updates.join(', ')}
       WHERE id = $1
       RETURNING id, name, updated_at`,
      params
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Board introuvable.' })
    return reply.send({ board: rows[0] })
  })

  // ── DELETE /api/v1/canvas/:boardId — Supprimer un board ──────────────────
  app.delete<{ Params: { boardId: string } }>('/:boardId', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const userId   = req.user!.userId
    const isAdmin  = (req.user as any)?.isAdmin ?? false

    // Owner or admin can delete
    const { rows } = await db.query(
      `DELETE FROM canvas_boards
       WHERE id = $1 AND (created_by = $2 OR $3)
       RETURNING id`,
      [req.params.boardId, userId, isAdmin]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Board introuvable ou non autorisé.' })
    return reply.send({ ok: true })
  })

  // ── POST /api/v1/canvas/:boardId/request-access — demander l'édition ─────
  app.post<{ Params: { boardId: string } }>('/:boardId/request-access', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    if (!await isModuleEnabled()) {
      return reply.code(403).send({ error: 'Le module Canvas n\'est pas activé.' })
    }
    const userId = req.user!.userId
    const { rows: [board] } = await db.query<{
      id: string; created_by: string; channel_id: string | null; visibility: string
    }>(`SELECT id, created_by, channel_id, visibility FROM canvas_boards WHERE id = $1`,
      [req.params.boardId])
    if (!board) return reply.code(404).send({ error: 'Board introuvable.' })

    const access = await resolveAccess(board, userId)
    if (!access.view)  return reply.code(403).send({ error: 'Accès refusé à ce board.' })
    if (access.write)  return reply.code(400).send({ error: 'Vous avez déjà l\'accès en édition.' })

    await db.query(
      `INSERT INTO canvas_board_collaborators (board_id, user_id, role, status)
       VALUES ($1, $2, 'editor', 'pending')
       ON CONFLICT (board_id, user_id) DO NOTHING`,
      [board.id, userId])

    await createNotification({ user_id: board.created_by, type: 'canvas_access_request', actor_id: userId })
      .catch(() => {})
    return reply.send({ ok: true })
  })

  // ── GET /api/v1/canvas/:boardId/requests — demandes en attente (proprio) ──
  app.get<{ Params: { boardId: string } }>('/:boardId/requests', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const userId = req.user!.userId
    const { rows: [board] } = await db.query<{ created_by: string }>(
      `SELECT created_by FROM canvas_boards WHERE id = $1`, [req.params.boardId])
    if (!board) return reply.code(404).send({ error: 'Board introuvable.' })
    if (board.created_by !== userId) return reply.code(403).send({ error: 'Réservé au propriétaire.' })

    const { rows } = await db.query(
      `SELECT c.user_id, u.username, u.avatar, c.created_at
       FROM canvas_board_collaborators c
       JOIN users u ON u.id = c.user_id
       WHERE c.board_id = $1 AND c.status = 'pending'
       ORDER BY c.created_at ASC`,
      [req.params.boardId])
    return reply.send({ requests: rows })
  })

  // ── POST /api/v1/canvas/:boardId/requests/:userId/approve ────────────────
  app.post<{ Params: { boardId: string; userId: string } }>('/:boardId/requests/:userId/approve', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const ownerId = req.user!.userId
    const { rows: [board] } = await db.query<{ created_by: string }>(
      `SELECT created_by FROM canvas_boards WHERE id = $1`, [req.params.boardId])
    if (!board) return reply.code(404).send({ error: 'Board introuvable.' })
    if (board.created_by !== ownerId) return reply.code(403).send({ error: 'Réservé au propriétaire.' })

    const { rowCount } = await db.query(
      `UPDATE canvas_board_collaborators
       SET status = 'active', role = 'editor', invited_by = $3
       WHERE board_id = $1 AND user_id = $2 AND status = 'pending'`,
      [req.params.boardId, req.params.userId, ownerId])
    if (!rowCount) return reply.code(404).send({ error: 'Demande introuvable.' })

    await createNotification({ user_id: req.params.userId, type: 'canvas_access_granted', actor_id: ownerId })
      .catch(() => {})
    return reply.send({ ok: true })
  })

  // ── DELETE /api/v1/canvas/:boardId/requests/:userId — refuser / retirer ──
  app.delete<{ Params: { boardId: string; userId: string } }>('/:boardId/requests/:userId', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const ownerId = req.user!.userId
    const { rows: [board] } = await db.query<{ created_by: string }>(
      `SELECT created_by FROM canvas_boards WHERE id = $1`, [req.params.boardId])
    if (!board) return reply.code(404).send({ error: 'Board introuvable.' })
    if (board.created_by !== ownerId) return reply.code(403).send({ error: 'Réservé au propriétaire.' })

    await db.query(
      `DELETE FROM canvas_board_collaborators WHERE board_id = $1 AND user_id = $2`,
      [req.params.boardId, req.params.userId])
    return reply.send({ ok: true })
  })

  // ── GET /api/v1/canvas/admin/all — Tous les boards (admin) ───────────────
  app.get('/admin/all', {
    preHandler: [adminOnly],
  }, async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT b.id, b.name, b.channel_id, b.created_by,
              b.created_at, b.updated_at,
              u.username AS creator_username,
              jsonb_array_length(b.snapshot) AS element_count
       FROM canvas_boards b
       LEFT JOIN users u ON u.id = b.created_by
       ORDER BY b.updated_at DESC
       LIMIT 200`
    )
    return reply.send({ boards: rows })
  })
}
