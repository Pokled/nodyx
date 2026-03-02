import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import { adminOnly } from '../middleware/adminOnly'
import { rateLimit } from '../middleware/rateLimit'
import { validate } from '../middleware/validate'
import {
  uploadAsset,
  getAssetMeta,
  listUserAssets,
  searchAssets,
  deleteAsset,
  type AssetType,
} from '../services/assetService'
import { db } from '../config/database'

const VALID_TYPES = ['frame', 'banner', 'font', 'badge', 'sticker', 'theme', 'emoji', 'sound'] as const

const SearchQuery = z.object({
  q:      z.string().optional(),
  type:   z.enum(VALID_TYPES).optional(),
  limit:  z.coerce.number().min(1).max(100).default(20),
  offset: z.coerce.number().min(0).default(0),
})

export default async function assetRoutes(app: FastifyInstance) {

  // ── POST /api/v1/assets — Upload a new asset ───────────────────────────────
  app.post('/', {
    preHandler: [rateLimit, requireAuth],
  }, async (req, reply) => {
    const userId = req.user!.userId

    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'Aucun fichier fourni.' })

    const name        = (data.fields['name']        as { value?: string } | undefined)?.value?.trim()
    const description = (data.fields['description'] as { value?: string } | undefined)?.value?.trim()
    const assetType   = (data.fields['asset_type']  as { value?: string } | undefined)?.value?.trim() as AssetType | undefined
    const tagsRaw     = (data.fields['tags']        as { value?: string } | undefined)?.value

    if (!name)      return reply.code(400).send({ error: 'Le champ "name" est requis.' })
    if (!assetType || !VALID_TYPES.includes(assetType)) {
      return reply.code(400).send({ error: `Type invalide. Valeurs possibles : ${VALID_TYPES.join(', ')}` })
    }

    const tags = tagsRaw
      ? tagsRaw.split(',').map(t => t.trim()).filter(t => t.length > 0)
      : []

    const buffer = await data.toBuffer()

    try {
      const asset = await uploadAsset({
        creatorId:        userId,
        buffer,
        originalFilename: data.filename,
        mimeType:         data.mimetype,
        assetType,
        name,
        description:      description || undefined,
        tags,
      })
      return reply.code(201).send({ asset })
    } catch (err: unknown) {
      app.log.error(err)
      return reply.code(500).send({ error: 'Erreur lors de l\'upload.' })
    }
  })

  // ── GET /api/v1/assets — Search public assets ──────────────────────────────
  app.get('/', {
    preHandler: [validate({ query: SearchQuery })],
  }, async (req, reply) => {
    const q = req.query as z.infer<typeof SearchQuery>
    const assets = await searchAssets({
      q:         q.q,
      assetType: q.type,
      limit:     q.limit,
      offset:    q.offset,
    })
    return reply.send({ assets })
  })

  // ── GET /api/v1/assets/:id — Get asset metadata ────────────────────────────
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const asset = await getAssetMeta(req.params.id)
    if (!asset) return reply.code(404).send({ error: 'Asset introuvable.' })
    return reply.send({ asset })
  })

  // ── DELETE /api/v1/assets/:id — Delete own asset ───────────────────────────
  app.delete<{ Params: { id: string } }>('/:id', {
    preHandler: [requireAuth],
  }, async (req, reply) => {
    const deleted = await deleteAsset(req.params.id, req.user!.userId)
    if (!deleted) return reply.code(404).send({ error: 'Asset introuvable ou non autorisé.' })
    return reply.send({ ok: true })
  })

  // ── GET /api/v1/assets/user/:userId — List a user's assets ────────────────
  app.get<{ Params: { userId: string } }>('/user/:userId', async (req, reply) => {
    const assets = await listUserAssets(req.params.userId)
    return reply.send({ assets })
  })

  // ── GET /api/v1/assets/admin/all — All assets incl. banned (admin) ─────────
  app.get('/admin/all', {
    preHandler: [adminOnly],
  }, async (req, reply) => {
    const { rows } = await db.query(
      `SELECT a.*, u.username AS creator_username
       FROM community_assets a
       LEFT JOIN users u ON u.id = a.creator_id
       ORDER BY a.created_at DESC
       LIMIT 200`
    )
    return reply.send({ assets: rows })
  })

  // ── DELETE /api/v1/assets/:id/force — Admin force-delete any asset ─────────
  app.delete<{ Params: { id: string } }>('/:id/force', {
    preHandler: [adminOnly],
  }, async (req, reply) => {
    const { rows } = await db.query<{ file_path: string; thumbnail_path: string | null }>(
      `DELETE FROM community_assets WHERE id = $1 RETURNING file_path, thumbnail_path`,
      [req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Asset introuvable.' })
    const { file_path, thumbnail_path } = rows[0]
    const fs = await import('fs/promises')
    const path = await import('path')
    await fs.unlink(path.join(process.cwd(), 'uploads', file_path)).catch(() => {})
    if (thumbnail_path) await fs.unlink(path.join(process.cwd(), 'uploads', thumbnail_path)).catch(() => {})
    return reply.send({ ok: true })
  })

  // ── PATCH /api/v1/assets/:id/ban — Admin toggle ban ────────────────────────
  app.patch<{ Params: { id: string } }>('/:id/ban', {
    preHandler: [adminOnly],
  }, async (req, reply) => {
    const { rows } = await db.query<{ is_banned: boolean }>(
      `UPDATE community_assets SET is_banned = NOT is_banned WHERE id = $1 RETURNING is_banned`,
      [req.params.id]
    )
    if (!rows[0]) return reply.code(404).send({ error: 'Asset introuvable.' })
    return reply.send({ is_banned: rows[0].is_banned })
  })
}
