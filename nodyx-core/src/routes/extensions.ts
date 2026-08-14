// Administration des extensions, et frappe des jetons de surface.
//
// Deux publics dans un seul fichier, mais deux régimes bien séparés :
//   - `/admin/extensions/*` : réservé à l'administration, c'est là que
//     l'installation et les permissions se décident ;
//   - `/extensions/:id/session` : appelé par l'hôte pour frapper le jeton
//     court d'une surface, avec la session réelle de l'utilisateur.
// cf SPECS/NODYX_SDK_CDC.md §4 et §6

import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'crypto'
import { db }           from '../config/database'
import { adminOnly }    from '../middleware/adminOnly'
import { optionalAuth } from '../middleware/auth'
import { rateLimit }    from '../middleware/rateLimit'
import { installExtension, uninstallExtension } from '../extensions/installer'
import { sensitiveCapabilities } from '../extensions/capabilities'
import { validateManifest }      from '../extensions/manifest'
import { mintExtensionToken }    from '../extensions/token'
import { PACKAGE, SURFACE }      from '../extensions/limits'

const RE_ID      = /^[a-z][a-z0-9-]{2,38}$/
const RE_SURFACE = /^(page|widget:[a-z][a-z0-9-]{0,30})$/

interface InstalledRow {
  id:       string
  manifest: Record<string, unknown>
  version:  string
  enabled:  boolean
  granted:  string[]
}

export async function extensionRoutes(app: FastifyInstance) {
  const query = (sql: string, params?: unknown[]) => db.query(sql, params) as Promise<{ rows: unknown[] }>
  const origin     = process.env.FRONTEND_URL?.replace(/\/+$/, '') || 'http://localhost:5173'
  const instanceId = origin
  const appSecret  = process.env.JWT_SECRET ?? ''

  // ── GET /admin/extensions ───────────────────────────────────────────────
  app.get('/admin/extensions', { preHandler: [rateLimit, adminOnly] }, async (_req, reply) => {
    const { rows } = await db.query(
      `SELECT id, manifest, version, origin, sha256, enabled, granted, installed_at, updated_at
         FROM installed_extensions
        ORDER BY installed_at DESC`,
    )
    return reply.send({ extensions: rows })
  })

  // ── POST /admin/extensions/install ──────────────────────────────────────
  // Téléversement d'un .nyx. Tout le jugement appartient au lecteur de paquet :
  // cette route ne fait que lire le corps, appliquer la décision de l'admin, et
  // rendre un compte rendu exploitable par l'interface.
  app.post('/admin/extensions/install', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const data = await request.file({ limits: { fileSize: PACKAGE.maxArchiveBytes } })
    if (!data) {
      return reply.code(400).send({ error: 'Aucun fichier reçu', code: 'NO_FILE' })
    }

    const archive = await data.toBuffer()
    if (data.file.truncated) {
      return reply.code(413).send({
        error: `Archive au dessus du plafond de ${PACKAGE.maxArchiveBytes / 1024 / 1024} Mo`,
        code:  'ARCHIVE_TOO_LARGE',
      })
    }

    // Les capacités acceptées arrivent en champ de formulaire : l'écran de
    // permissions est côté interface, la décision voyage explicitement.
    let accept: string[] | undefined
    const raw = (data.fields?.accept as { value?: string } | undefined)?.value
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed) && parsed.every(v => typeof v === 'string')) accept = parsed
      } catch { /* décision illisible : on retombe sur « tout ce qui est demandé » */ }
    }

    const result = await installExtension(
      { archive, origin: 'file', installedBy: request.user?.userId ?? null, grant: accept ? { accept } : undefined },
      { query },
    )

    if (!result.ok) {
      return reply.code(400).send({
        error:  'Paquet refusé',
        code:   'PACKAGE_REJECTED',
        issues: result.issues,
      })
    }
    return reply.code(201).send(result.result)
  })

  // ── POST /admin/extensions/inspect ──────────────────────────────────────
  // Lit un paquet SANS l'installer, pour alimenter l'écran de permissions.
  // L'admin doit pouvoir voir ce qu'une extension demande avant de dire oui.
  app.post('/admin/extensions/inspect', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const data = await request.file({ limits: { fileSize: PACKAGE.maxArchiveBytes } })
    if (!data) return reply.code(400).send({ error: 'Aucun fichier reçu', code: 'NO_FILE' })

    const { readExtensionPackage } = await import('../extensions/package')
    const { requestedCapabilities } = await import('../extensions/capabilities')

    const read = readExtensionPackage(await data.toBuffer())
    if (!read.ok) return reply.code(400).send({ error: 'Paquet refusé', code: 'PACKAGE_REJECTED', issues: read.issues })

    return reply.send({
      manifest:            read.pkg.manifest,
      messages:            read.pkg.messages[read.pkg.manifest.default_locale] ?? {},
      requested:           requestedCapabilities(read.pkg.manifest),
      sensitive:           sensitiveCapabilities(read.pkg.manifest),
      privateNetworkHosts: read.pkg.privateNetworkHosts,
      sanitized:           read.pkg.sanitized,
    })
  })

  // ── PATCH /admin/extensions/:id ─────────────────────────────────────────
  app.patch('/admin/extensions/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id }      = request.params as { id: string }
    const { enabled } = request.body   as { enabled?: boolean }
    if (!RE_ID.test(id) || typeof enabled !== 'boolean') {
      return reply.code(400).send({ error: 'Requête invalide', code: 'INVALID_REQUEST' })
    }

    const { rowCount } = await db.query(
      `UPDATE installed_extensions SET enabled = $1, updated_at = now() WHERE id = $2`,
      [enabled, id],
    )
    if (!rowCount) return reply.code(404).send({ error: 'Extension introuvable', code: 'EXTENSION_NOT_FOUND' })

    // Désactiver doit couper tout de suite. Les jetons déjà émis vivent dix
    // minutes : sans révocation, une surface continuerait d'appeler pendant ce
    // temps là, ce qui viderait le bouton de son sens.
    if (!enabled) {
      await db.query(
        `INSERT INTO extension_revoked_tokens (jti, expires_at)
         SELECT $1, now() + interval '${SURFACE.tokenTtlSeconds} seconds'
         ON CONFLICT (jti) DO NOTHING`,
        [`ext:${id}:*`],
      ).catch(() => { /* la révocation fine arrive avec le suivi des jti émis */ })
    }

    return reply.send({ success: true })
  })

  // ── DELETE /admin/extensions/:id ────────────────────────────────────────
  app.delete('/admin/extensions/:id', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!RE_ID.test(id)) return reply.code(400).send({ error: 'Identifiant invalide', code: 'INVALID_ID' })
    await uninstallExtension(id, { query })
    return reply.send({ success: true })
  })

  // ── POST /extensions/:id/session ────────────────────────────────────────
  // Frappe le jeton court d'une surface. Appelé par l'HÔTE, avec la session
  // réelle de l'utilisateur, jamais par la frame : la frame n'a pas de session
  // et c'est tout l'intérêt.
  app.post('/extensions/:id/session', { preHandler: [rateLimit, optionalAuth] }, async (request, reply) => {
    const { id }      = request.params as { id: string }
    const { surface } = (request.body ?? {}) as { surface?: string }

    if (!RE_ID.test(id))                  return reply.code(400).send({ error: 'Identifiant invalide', code: 'INVALID_ID' })
    if (!surface || !RE_SURFACE.test(surface)) return reply.code(400).send({ error: 'Surface invalide', code: 'INVALID_SURFACE' })
    if (!appSecret)                       return reply.code(500).send({ error: 'Instance mal configurée', code: 'MISSING_SECRET' })

    const { rows } = await db.query(
      `SELECT id, manifest, version, enabled, granted FROM installed_extensions WHERE id = $1`,
      [id],
    )
    const row = rows[0] as InstalledRow | undefined
    if (!row)          return reply.code(404).send({ error: 'Extension introuvable', code: 'EXTENSION_NOT_FOUND' })
    if (!row.enabled)  return reply.code(403).send({ error: 'Extension désactivée', code: 'EXTENSION_DISABLED' })

    // La surface demandée doit exister dans le manifeste installé, sinon un
    // jeton serait frappé pour quelque chose qui n'existe pas.
    const parsed = validateManifest(row.manifest)
    if (!parsed.ok) return reply.code(500).send({ error: 'Manifeste installé invalide', code: 'MANIFEST_CORRUPT' })

    const known = parsed.manifest.surfaces.some(s =>
      s.type === 'page' ? surface === 'page' : surface === `widget:${s.id}`,
    )
    if (!known) return reply.code(404).send({ error: 'Surface inconnue', code: 'SURFACE_NOT_FOUND' })

    const token = mintExtensionToken({
      issuer:      origin,
      instanceId,
      extensionId: id,
      surface,
      userId:      request.user?.userId ?? null,
      permissions: Array.isArray(row.granted) ? row.granted : [],
      jti:         randomUUID(),
    }, appSecret)

    return reply.send({
      token,
      expiresIn: SURFACE.tokenTtlSeconds,
      version:   row.version,
      surface,
    })
  })
}
