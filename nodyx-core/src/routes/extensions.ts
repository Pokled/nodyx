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
import { db, redis }    from '../config/database'
import { adminOnly }    from '../middleware/adminOnly'
import { optionalAuth } from '../middleware/auth'
import { rateLimit }    from '../middleware/rateLimit'
import { installExtension, uninstallExtension } from '../extensions/installer'
import { sensitiveCapabilities } from '../extensions/capabilities'
import { validateManifest }      from '../extensions/manifest'
import { mintExtensionToken, verifyExtensionToken, type ExtensionTokenClaims } from '../extensions/token'
import { storageGet, storageSet, storageDelete, storageList } from '../extensions/storage'
import { projectUser, columnsFor } from '../extensions/identity'
import { parseSize } from '../extensions/manifest'
import { STORAGE } from '../extensions/limits'
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

  // ── GET /extensions/public ──────────────────────────────────────────────
  //
  // Ce que le frontend a besoin de savoir pour AFFICHER des extensions, et
  // rien de plus : ni permissions accordees, ni empreinte, ni qui a installe.
  //
  // Les libelles sont resolus ICI, dans la langue demandee. Le frontend n'a
  // donc aucune logique de cles a porter, et une extension ne peut pas lui
  // faire afficher une chaine qui n'est pas dans ses dictionnaires.
  app.get('/extensions/public', { preHandler: [rateLimit] }, async (request, reply) => {
    const asked = String((request.query as { locale?: string }).locale ?? '').slice(0, 5)

    const { rows } = await db.query(
      `SELECT id, manifest, messages, version
         FROM installed_extensions
        WHERE enabled = true
        ORDER BY id`,
    )

    const extensions = (rows as Array<{ id: string; manifest: Record<string, unknown>; messages: Record<string, Record<string, string>>; version: string }>)
      .map((row) => {
        const parsed = validateManifest(row.manifest)
        if (!parsed.ok) return null                 // manifeste corrompu : on l'ignore plutot que de servir n'importe quoi

        const m = parsed.manifest
        const dict = { ...(row.messages?.[m.default_locale] ?? {}), ...(asked ? row.messages?.[asked] ?? {} : {}) }
        const tr = (v?: string) => (v?.startsWith('@') ? dict[v.slice(1)] ?? v.slice(1) : v)

        return {
          id:          m.id,
          version:     row.version,
          label:       tr(m.label),
          description: tr(m.description),
          icon:        m.icon ? `/api/v1/extensions/${m.id}/${row.version}/assets/${m.icon}` : null,
          family:      m.family ?? 'content',
          messages:    dict,
          surfaces:    m.surfaces.map((s) => s.type === 'widget'
            ? {
                type:  'widget' as const,
                id:    s.id,
                entry: s.entry,
                label: tr(s.label),
                defaultHeight: s.default_height ?? null,
                schema: (s.schema ?? []).map((f) => ({
                  ...f,
                  label:   tr(f.label),
                  hint:    tr(f.hint),
                  details: tr(f.details),
                  options: f.options?.map((o) => ({ ...o, label: tr(o.label) })),
                })),
              }
            : {
                type:  'page' as const,
                path:  s.path,
                entry: s.entry,
                label: tr(s.label) ?? tr(m.label),
                nav:   s.nav ? { label: tr(s.nav.label), icon: s.nav.icon ?? null } : null,
              }),
        }
      })
      .filter((e) => e !== null)

    return reply.send({ extensions })
  })

  // ── POST /extensions/:id/storage ────────────────────────────────────────
  //
  // Authentifiee par le JETON D'EXTENSION, jamais par le cookie de session :
  // la frame n'a pas de session, et c'est tout l'interet. Origin: null est
  // accepte, parce que c'est ce qu'envoie une origine opaque, mais il ne vaut
  // strictement rien comme preuve : l'identite vient du jeton.
  app.post('/extensions/:id/storage', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const surface = request.headers['x-nodyx-surface']
    const header  = request.headers.authorization

    if (!RE_ID.test(id) || typeof surface !== 'string' || !RE_SURFACE.test(surface)) {
      return reply.code(400).send({ error: 'Requête invalide', code: 'INVALID_REQUEST' })
    }
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Jeton absent', code: 'TOKEN_MISSING' })
    }
    if (!appSecret) return reply.code(500).send({ error: 'Instance mal configurée', code: 'MISSING_SECRET' })

    const revoked = await redis.exists(`ext:revoked:${id}`).catch(() => 0)
    const verified = verifyExtensionToken(
      header.slice(7),
      { instanceId, extensionId: id, surface },
      appSecret,
      () => revoked === 1,
    )
    if (!verified.ok) {
      const status = verified.code === 'SESSION_EXPIRED' ? 401 : 403
      return reply.code(status).send({ error: verified.message, code: verified.code })
    }
    const claims: ExtensionTokenClaims = verified.claims

    const body = (request.body ?? {}) as { op?: string; key?: unknown; value?: unknown; scope?: unknown }

    // Les ecritures sont plafonnees par membre et par extension : sans ca, une
    // extension martele la base sans jamais approcher son quota d'octets.
    if (body.op === 'set' || body.op === 'delete') {
      const bucket = `ext:writes:${id}:${claims.sub ?? 'anon'}`
      const hits = await redis.incr(bucket).catch(() => 0)
      if (hits === 1) await redis.expire(bucket, 60).catch(() => {})
      if (hits > STORAGE.writesPerMinute) {
        return reply.code(429).send({ error: 'Trop d\'écritures', code: 'RATE_LIMITED' })
      }
    }

    // Le quota vient du manifeste INSTALLE, jamais de la requete.
    const { rows } = await db.query(
      `SELECT manifest, enabled FROM installed_extensions WHERE id = $1`, [id],
    )
    const row = rows[0] as { manifest: Record<string, unknown>; enabled: boolean } | undefined
    if (!row)         return reply.code(404).send({ error: 'Extension introuvable', code: 'EXTENSION_NOT_FOUND' })
    if (!row.enabled) return reply.code(403).send({ error: 'Extension désactivée', code: 'EXTENSION_DISABLED' })

    const declared = (row.manifest as { permissions?: { storage?: Record<string, string> } }).permissions?.storage ?? {}
    const scopeKey = body.scope === 'instance' ? 'instance' : 'user'
    const quotaBytes = Math.min(parseSize(declared[scopeKey] ?? '') ?? 0, STORAGE.maxQuotaBytes)

    const caller = { extensionId: id, userId: claims.sub, granted: claims.prm, quotaBytes }
    const query  = (sql: string, params?: unknown[]) => db.query(sql, params) as Promise<{ rows: unknown[] }>

    const result = body.op === 'get'    ? await storageGet(caller, body.key, body.scope, query)
                 : body.op === 'set'    ? await storageSet(caller, body.key, body.value, body.scope, query)
                 : body.op === 'delete' ? await storageDelete(caller, body.key, body.scope, query)
                 : body.op === 'list'   ? await storageList(caller, body.scope, query)
                 : { ok: false as const, code: 'INVALID_ARGUMENT' as const, message: 'operation inconnue' }

    if (!result.ok) {
      const status = result.code === 'PERMISSION_DENIED'  ? 403
                   : result.code === 'NOT_AUTHENTICATED'  ? 401
                   : result.code === 'QUOTA_EXCEEDED'     ? 507
                   : 400
      return reply.code(status).send({ error: result.message, code: result.code })
    }
    return reply.send({ result: result.value })
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

    // L'identite est projetee ICI, cote serveur, et pas dans la page qui monte
    // la surface : si le frontend devait filtrer, un composant distrait passant
    // l'objet utilisateur entier suffirait a faire partir une adresse de
    // courriel dans une extension tierce.
    const granted = Array.isArray(row.granted) ? row.granted : []
    let projectedUser: Record<string, unknown> | null = null
    if (request.user?.userId) {
      const cols = columnsFor(granted)
      if (cols.length) {
        const { rows: userRows } = await db.query(
          `SELECT ${cols.join(', ')} FROM users WHERE id = $1`,
          [request.user.userId],
        )
        projectedUser = projectUser(userRows[0] as Record<string, unknown> | undefined, granted)
      }
    }

    const token = mintExtensionToken({
      issuer:      origin,
      instanceId,
      extensionId: id,
      surface,
      userId:      request.user?.userId ?? null,
      permissions: granted,
      jti:         randomUUID(),
    }, appSecret)

    return reply.send({
      token,
      expiresIn: SURFACE.tokenTtlSeconds,
      version:   row.version,
      surface,
      granted,
      user: projectedUser,
    })
  })
}
