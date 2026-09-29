/**
 * appearance.ts — /api/v1/admin/appearance (SPECS/NODYX_APPARENCE_CDC.md)
 *
 * L'Ambiance de l'instance (accent, décor, intensité, mode par défaut) se
 * règle sur un BROUILLON, partagé par les deux entrées de l'admin : l'écran
 * Apparence (édition globale) et le stylo en direct (édition d'une zone). Rien
 * ne change pour les membres avant « Publier ».
 *
 *   GET    /           → { published, draft }
 *   PUT    /draft      → enregistre le brouillon (valeurs validées, jamais de CSS)
 *   DELETE /draft      → abandonne le brouillon
 *   POST   /publish    → le brouillon devient la version publique
 */
import { FastifyInstance } from 'fastify'
import { db } from '../config/database'
import { adminOnly } from '../middleware/adminOnly'
import { rateLimit } from '../middleware/rateLimit'
import { validate } from '../middleware/validate'
import { logAction } from './admin'
import {
  ShellThemeSchema, ShellTheme, normalizeShellTheme, parseStoredShellTheme,
  SHELL_KEY_PUBLISHED, SHELL_KEY_DRAFT,
} from '../utils/shellTheme'

async function readKeys(): Promise<{ published: string | null; draft: string | null }> {
  const { rows } = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM instance_settings WHERE key IN ($1, $2)`,
    [SHELL_KEY_PUBLISHED, SHELL_KEY_DRAFT],
  )
  return {
    published: rows.find(r => r.key === SHELL_KEY_PUBLISHED)?.value ?? null,
    draft:     rows.find(r => r.key === SHELL_KEY_DRAFT)?.value ?? null,
  }
}

export default async function appearanceRoutes(app: FastifyInstance) {

  app.get('/', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    const { published, draft } = await readKeys()
    return reply.send({
      published: parseStoredShellTheme(published),
      draft:     parseStoredShellTheme(draft),
    })
  })

  app.put('/draft', {
    preHandler: [rateLimit, adminOnly, validate({ body: ShellThemeSchema })],
  }, async (request, reply) => {
    const userId = (request as any).user?.userId ?? null
    const draft = normalizeShellTheme(request.body as ShellTheme)
    await db.query(
      `INSERT INTO instance_settings (key, value, is_secret, updated_by, updated_at)
       VALUES ($1, $2, FALSE, $3, NOW())
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [SHELL_KEY_DRAFT, JSON.stringify(draft), userId],
    )
    return reply.send({ draft })
  })

  app.delete('/draft', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    await db.query(`DELETE FROM instance_settings WHERE key = $1`, [SHELL_KEY_DRAFT])
    return reply.send({ ok: true })
  })

  app.post('/publish', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const userId = (request as any).user?.userId ?? null
    const { draft: raw } = await readKeys()
    if (!raw) {
      return reply.code(409).send({ error: 'Aucun brouillon à publier', code: 'NO_DRAFT' })
    }
    // Revalidé à la publication : une valeur modifiée hors de l'API (base
    // éditée à la main) ne doit jamais devenir publique sans contrôle.
    const draft = parseStoredShellTheme(raw)
    if (!draft) {
      return reply.code(409).send({ error: 'Brouillon invalide', code: 'DRAFT_INVALID' })
    }

    // Une seule instruction, donc atomique : le brouillon est retiré ET
    // installé comme version publique, ou rien. La condition sur la valeur
    // relue écarte le cas où l'admin réenregistre pendant la publication :
    // on ne publie jamais une version qu'on n'a pas validée.
    const { rows } = await db.query<{ value: string }>(
      `WITH d AS (
         DELETE FROM instance_settings WHERE key = $1 AND value = $2 RETURNING value
       )
       INSERT INTO instance_settings (key, value, is_secret, updated_by, updated_at)
       SELECT $3, value, FALSE, $4, NOW() FROM d
       ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING value`,
      [SHELL_KEY_DRAFT, raw, SHELL_KEY_PUBLISHED, userId],
    )
    if (rows.length === 0) {
      return reply.code(409).send({ error: 'Le brouillon a changé pendant la publication, réessayez', code: 'DRAFT_CHANGED' })
    }

    if (userId) void logAction(userId, 'publish_appearance', 'instance', null, null, { ...draft })
    return reply.send({ published: draft })
  })
}
