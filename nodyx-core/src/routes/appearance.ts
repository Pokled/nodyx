/**
 * appearance.ts — /api/v1/admin/appearance (SPECS/NODYX_APPARENCE_CDC.md)
 *
 * L'apparence de l'instance se règle sur un BROUILLON, partagé par les deux
 * entrées de l'admin : l'écran Apparence (édition globale) et le stylo en
 * direct (édition d'une zone). Rien ne change pour les membres avant
 * « Publier ». Deux parties dans ce brouillon :
 *   - l'Ambiance (accent, décor, intensité, mode) → publiée dans
 *     instance_settings.theme_shell ;
 *   - l'Identité (logo, bannière) → publiée dans communities, là où le reste
 *     du site la lit déjà.
 *
 *   GET    /                → { published, draft, identity: { published, draft } }
 *   PUT    /draft           → brouillon d'Ambiance (valeurs validées, jamais de CSS)
 *   PUT    /draft/identity  → brouillon d'Identité
 *   DELETE /draft/identity  → abandonne le seul brouillon d'identité
 *   DELETE /draft           → abandonne les DEUX brouillons
 *   POST   /publish         → publie ce qui est en brouillon, tout ou rien
 */
import { FastifyInstance } from 'fastify'
import { db } from '../config/database'
import { adminOnly } from '../middleware/adminOnly'
import { rateLimit } from '../middleware/rateLimit'
import { validate } from '../middleware/validate'
import { logAction, getCommunityId } from './admin'
import {
  ShellThemeSchema, ShellTheme, normalizeShellTheme, parseStoredShellTheme,
  IdentityDraftSchema, IdentityDraft, parseStoredIdentityDraft,
  SHELL_KEY_PUBLISHED, SHELL_KEY_DRAFT, IDENTITY_KEY_DRAFT,
} from '../utils/shellTheme'

async function readKeys(): Promise<{ published: string | null; draft: string | null; identityDraft: string | null }> {
  const { rows } = await db.query<{ key: string; value: string | null }>(
    `SELECT key, value FROM instance_settings WHERE key IN ($1, $2, $3)`,
    [SHELL_KEY_PUBLISHED, SHELL_KEY_DRAFT, IDENTITY_KEY_DRAFT],
  )
  const get = (k: string) => rows.find(r => r.key === k)?.value ?? null
  return { published: get(SHELL_KEY_PUBLISHED), draft: get(SHELL_KEY_DRAFT), identityDraft: get(IDENTITY_KEY_DRAFT) }
}

const UPSERT = `INSERT INTO instance_settings (key, value, is_secret, updated_by, updated_at)
  VALUES ($1, $2, FALSE, $3, NOW())
  ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`

export default async function appearanceRoutes(app: FastifyInstance) {

  app.get('/', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    const { published, draft, identityDraft } = await readKeys()
    const communityId = await getCommunityId()
    const ident = communityId
      ? (await db.query<{ logo_url: string | null; banner_url: string | null }>(
          `SELECT logo_url, banner_url FROM communities WHERE id = $1`, [communityId])).rows[0] ?? null
      : null
    return reply.send({
      published: parseStoredShellTheme(published),
      draft:     parseStoredShellTheme(draft),
      identity: {
        published: ident ? { logo_url: ident.logo_url, banner_url: ident.banner_url } : null,
        draft:     parseStoredIdentityDraft(identityDraft),
      },
    })
  })

  app.put('/draft', {
    preHandler: [rateLimit, adminOnly, validate({ body: ShellThemeSchema })],
  }, async (request, reply) => {
    const userId = (request as any).user?.userId ?? null
    const draft = normalizeShellTheme(request.body as ShellTheme)
    await db.query(UPSERT, [SHELL_KEY_DRAFT, JSON.stringify(draft), userId])
    return reply.send({ draft })
  })

  app.put('/draft/identity', {
    preHandler: [rateLimit, adminOnly, validate({ body: IdentityDraftSchema })],
  }, async (request, reply) => {
    const userId = (request as any).user?.userId ?? null
    const draft = request.body as IdentityDraft
    await db.query(UPSERT, [IDENTITY_KEY_DRAFT, JSON.stringify(draft), userId])
    return reply.send({ draft })
  })

  // Identité revenue à la version publiée : on retire son seul brouillon.
  app.delete('/draft/identity', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    await db.query(`DELETE FROM instance_settings WHERE key = $1`, [IDENTITY_KEY_DRAFT])
    return reply.send({ ok: true })
  })

  app.delete('/draft', { preHandler: [rateLimit, adminOnly] }, async (_request, reply) => {
    await db.query(`DELETE FROM instance_settings WHERE key IN ($1, $2)`, [SHELL_KEY_DRAFT, IDENTITY_KEY_DRAFT])
    return reply.send({ ok: true })
  })

  app.post('/publish', { preHandler: [rateLimit, adminOnly] }, async (request, reply) => {
    const userId = (request as any).user?.userId ?? null
    const { draft: rawAmbiance, identityDraft: rawIdentity } = await readKeys()
    if (!rawAmbiance && !rawIdentity) {
      return reply.code(409).send({ error: 'Aucun brouillon à publier', code: 'NO_DRAFT' })
    }
    // Revalidé à la publication : une valeur modifiée hors de l'API (base
    // éditée à la main) ne doit jamais devenir publique sans contrôle.
    const ambiance = rawAmbiance ? parseStoredShellTheme(rawAmbiance) : null
    const identity = rawIdentity ? parseStoredIdentityDraft(rawIdentity) : null
    if ((rawAmbiance && !ambiance) || (rawIdentity && !identity)) {
      return reply.code(409).send({ error: 'Brouillon invalide', code: 'DRAFT_INVALID' })
    }
    const communityId = identity ? await getCommunityId() : null
    if (identity && !communityId) {
      return reply.code(404).send({ error: 'Communauté introuvable', code: 'COMMUNITY_NOT_FOUND' })
    }

    // Deux tables, donc une vraie transaction : tout est publié, ou rien.
    // Chaque brouillon n'est retiré que s'il vaut encore EXACTEMENT ce qu'on
    // a relu et validé ; sinon (réenregistré pendant la publication), on annule.
    const client = await (db as any).connect()
    let changed = false
    try {
      await client.query('BEGIN')
      if (rawAmbiance) {
        const r = await client.query(
          `WITH d AS (
             DELETE FROM instance_settings WHERE key = $1 AND value = $2 RETURNING value
           )
           INSERT INTO instance_settings (key, value, is_secret, updated_by, updated_at)
           SELECT $3, value, FALSE, $4, NOW() FROM d
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
           RETURNING value`,
          [SHELL_KEY_DRAFT, rawAmbiance, SHELL_KEY_PUBLISHED, userId],
        )
        if (r.rows.length === 0) changed = true
      }
      if (!changed && identity) {
        const r = await client.query(
          `DELETE FROM instance_settings WHERE key = $1 AND value = $2 RETURNING key`,
          [IDENTITY_KEY_DRAFT, rawIdentity],
        )
        if (r.rows.length === 0) changed = true
        else {
          const fields: string[] = []
          const values: unknown[] = []
          if (identity.logo_url !== undefined)   { values.push(identity.logo_url);   fields.push(`logo_url = $${values.length}`) }
          if (identity.banner_url !== undefined) { values.push(identity.banner_url); fields.push(`banner_url = $${values.length}`) }
          values.push(communityId)
          await client.query(`UPDATE communities SET ${fields.join(', ')} WHERE id = $${values.length}`, values)
        }
      }
      if (changed) {
        await client.query('ROLLBACK')
        return reply.code(409).send({ error: 'Le brouillon a changé pendant la publication, réessayez', code: 'DRAFT_CHANGED' })
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }

    if (userId) void logAction(userId, 'publish_appearance', 'instance', null, null, { ambiance, identity })
    return reply.send({ published: ambiance, identity })
  })
}
