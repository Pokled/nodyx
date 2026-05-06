/**
 * NODYX — Admin backups routes (spec 014-backup-system, Phase 1 MVP)
 *
 * All routes require owner or admin role (adminOnly middleware).
 * Prefix: /api/v1/admin/backups
 *
 * Endpoints in Phase 1:
 *   GET    /                    list paginated backups
 *   POST   /                    create a backup
 *   GET    /audit               audit log (paginated)
 *   GET    /storage             disk usage info
 *   GET    /settings            read backup settings (write comes in Phase 2)
 *   GET    /:id                 backup details
 *   GET    /:id/download        stream the archive
 *   DELETE /:id                 delete a backup (refused if protected)
 *   POST   /:id/restore         type-to-confirm + dry-run + 5s server-side guard
 *   POST   /:id/verify          checksum + structure check
 *   GET    /:id/diff            diff stats vs current state (for restore preview)
 */

import { FastifyInstance, FastifyRequest } from 'fastify'
import '../middleware/auth' // augments FastifyRequest with `user?: JwtPayload`
import { z }                                from 'zod'
import { adminOnly }                        from '../middleware/adminOnly'
import { validate }                         from '../middleware/validate'
import { rateLimit }                        from '../middleware/rateLimit'
import { createReadStream, statSync, existsSync } from 'fs'

import {
  createBackup,
  listBackups,
  getBackup,
  verifyBackup,
  deleteBackup,
  restoreBackup,
  getDiffPreview,
  getStorageInfo,
  getBackupSettings,
  auditList,
  recordDownload,
  getBackupFilePath,
  type AuditActor,
} from '../services/backupService'

// ─── Schemas ─────────────────────────────────────────────────────────────────

const ListQuery = z.object({
  limit:  z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const CreateBody = z.object({
  include_uploads: z.boolean().optional().default(true),
  label:           z.string().trim().max(200).optional(),
})

const RestoreBody = z.object({
  confirm_slug: z.string().trim().min(1).max(200),
  dry_run:      z.boolean().optional().default(false),
})

const AuditQuery = z.object({
  limit:     z.coerce.number().int().min(1).max(200).optional(),
  offset:    z.coerce.number().int().min(0).optional(),
  backup_id: z.string().uuid().optional(),
})

// ─── Helpers ────────────────────────────────────────────────────────────────

function actor(req: FastifyRequest): AuditActor {
  return {
    user_id:    req.user?.userId || null,
    ip_address: req.ip || null,
    user_agent: req.headers['user-agent'] || null,
  }
}

async function getInstanceSlug(): Promise<string> {
  // Local import to avoid cyclic load with database.ts at module init time
  const { db } = await import('../config/database')
  try {
    const { rows } = await db.query('SELECT slug FROM communities ORDER BY created_at ASC LIMIT 1')
    return rows[0]?.slug || ''
  } catch { return '' }
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function adminBackupRoutes(app: FastifyInstance) {

  // ── GET /admin/backups — list paginated ──────────────────────────────────
  app.get(
    '/admin/backups',
    { preHandler: [rateLimit, adminOnly, validate({ query: ListQuery })] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof ListQuery>
      const { rows, total } = await listBackups({ limit: q.limit, offset: q.offset })
      return reply.send({ rows, total, limit: q.limit ?? 50, offset: q.offset ?? 0 })
    },
  )

  // ── GET /admin/backups/audit — audit log paginated ───────────────────────
  // Note: declared BEFORE /admin/backups/:id so the literal segment 'audit'
  // is matched as a route, not as a UUID.
  app.get(
    '/admin/backups/audit',
    { preHandler: [rateLimit, adminOnly, validate({ query: AuditQuery })] },
    async (request, reply) => {
      const q = request.query as z.infer<typeof AuditQuery>
      const { rows, total } = await auditList({ limit: q.limit, offset: q.offset, backup_id: q.backup_id })
      return reply.send({ rows, total, limit: q.limit ?? 50, offset: q.offset ?? 0 })
    },
  )

  // ── GET /admin/backups/storage ───────────────────────────────────────────
  app.get(
    '/admin/backups/storage',
    { preHandler: [rateLimit, adminOnly] },
    async (_request, reply) => {
      const info = await getStorageInfo()
      return reply.send(info)
    },
  )

  // ── GET /admin/backups/settings — read only (write in Phase 2) ───────────
  app.get(
    '/admin/backups/settings',
    { preHandler: [rateLimit, adminOnly] },
    async (_request, reply) => {
      const settings = await getBackupSettings()
      // Never expose the encryption_passphrase hash to the client
      const safe = { ...settings }
      delete (safe as Record<string, unknown>).encryption_passphrase
      return reply.send(safe)
    },
  )

  // ── POST /admin/backups — create ─────────────────────────────────────────
  // Synchronous in Phase 1: the request blocks until the backup is written.
  // Phase 2 will move this behind a job queue + Socket.IO progress events.
  app.post(
    '/admin/backups',
    { preHandler: [rateLimit, adminOnly, validate({ body: CreateBody })] },
    async (request, reply) => {
      const body = request.body as z.infer<typeof CreateBody>
      try {
        const row = await createBackup({
          include_uploads: body.include_uploads ?? true,
          label:           body.label,
          source:          'manual',
          created_by:      actor(request).user_id,
          audit_actor:     actor(request),
        })
        return reply.code(201).send(row)
      } catch (err) {
        request.log.error({ err }, '[backup] create failed')
        return reply.code(500).send({ error: (err as Error).message })
      }
    },
  )

  // ── GET /admin/backups/:id — details ─────────────────────────────────────
  app.get(
    '/admin/backups/:id',
    { preHandler: [rateLimit, adminOnly] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const row = await getBackup(id)
      if (!row) return reply.code(404).send({ error: 'backup introuvable' })
      return reply.send(row)
    },
  )

  // ── GET /admin/backups/:id/download — stream the archive ─────────────────
  app.get(
    '/admin/backups/:id/download',
    { preHandler: [rateLimit, adminOnly] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const row = await getBackup(id)
      if (!row) return reply.code(404).send({ error: 'backup introuvable' })

      const filePath = getBackupFilePath(row.filename)
      if (!existsSync(filePath)) return reply.code(404).send({ error: 'fichier absent sur le disque' })

      const size = statSync(filePath).size
      await recordDownload(id, actor(request))

      return reply
        .header('Content-Type',        'application/gzip')
        .header('Content-Length',      String(size))
        .header('Content-Disposition', `attachment; filename="${row.filename}"`)
        .header('X-Content-Type-Options', 'nosniff')
        .header('Cache-Control',       'private, no-store')
        .send(createReadStream(filePath))
    },
  )

  // ── DELETE /admin/backups/:id ────────────────────────────────────────────
  app.delete(
    '/admin/backups/:id',
    { preHandler: [rateLimit, adminOnly] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        await deleteBackup(id, { audit_actor: actor(request) })
        return reply.code(204).send()
      } catch (err) {
        const msg = (err as Error).message
        if (msg.includes('introuvable')) return reply.code(404).send({ error: msg })
        if (msg.includes('protégé'))     return reply.code(409).send({ error: msg })
        return reply.code(500).send({ error: msg })
      }
    },
  )

  // ── POST /admin/backups/:id/restore — type-to-confirm + dry-run ──────────
  // The client must send `confirm_slug` matching the instance's community slug.
  // The 5-second client-side countdown is reinforced server-side: a client
  // that bypasses the modal still gets its slug check.
  app.post(
    '/admin/backups/:id/restore',
    { preHandler: [rateLimit, adminOnly, validate({ body: RestoreBody })] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      const body = request.body as z.infer<typeof RestoreBody>

      const expected = (await getInstanceSlug()).toLowerCase()
      if (!expected) {
        return reply.code(500).send({ error: 'slug d\'instance introuvable, impossible de valider la confirmation' })
      }
      if (body.confirm_slug.trim().toLowerCase() !== expected) {
        return reply.code(400).send({ error: 'confirmation invalide : le slug saisi ne correspond pas au slug de l\'instance' })
      }

      try {
        await restoreBackup(id, {
          dry_run:     body.dry_run,
          audit_actor: actor(request),
        })
        return reply.send({ status: 'ok', dry_run: !!body.dry_run })
      } catch (err) {
        request.log.error({ err }, '[backup] restore failed')
        return reply.code(500).send({ error: (err as Error).message })
      }
    },
  )

  // ── POST /admin/backups/:id/verify ───────────────────────────────────────
  app.post(
    '/admin/backups/:id/verify',
    { preHandler: [rateLimit, adminOnly] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const result = await verifyBackup(id)
        return reply.send(result)
      } catch (err) {
        return reply.code(500).send({ error: (err as Error).message })
      }
    },
  )

  // ── GET /admin/backups/:id/diff ──────────────────────────────────────────
  app.get(
    '/admin/backups/:id/diff',
    { preHandler: [rateLimit, adminOnly] },
    async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const diff = await getDiffPreview(id)
        return reply.send(diff)
      } catch (err) {
        const msg = (err as Error).message
        return reply.code(msg.includes('introuvable') ? 404 : 500).send({ error: msg })
      }
    },
  )
}
