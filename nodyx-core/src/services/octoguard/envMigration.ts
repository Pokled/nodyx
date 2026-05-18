/**
 * OctoGuard, migration one-shot de BLOCKED_CONTENT_PATTERNS env → DB.
 * Conforme à spec v2.1.1 §Module 1.
 *
 * Au boot, si :
 *  - l'env BLOCKED_CONTENT_PATTERNS est défini ET non vide
 *  - ET la table octoguard_automod_rules est vide
 * → on importe chaque pattern comme une règle regex action='delete'.
 *
 * Si la table contient déjà des règles, l'env est ignoré (DB fait foi).
 *
 * Cette fonction est appelée par initOctoGuard() après reloadRules().
 * Idempotente : un second appel sur une DB déjà peuplée est un no-op.
 *
 * Compatibilité ascendante prévue 2 versions (deprecated v2.1, retiré v2.3
 * selon spec). Document de migration à fournir aux admins.
 */

import { db } from '../../config/database'
import { compileSafeRegex } from './matchers'

export interface MigrationResult {
  skipped:  boolean
  reason?:  string
  imported: number
  invalid:  string[]  // patterns rejetés
}

export async function migrateEnvPatternsToDB(): Promise<MigrationResult> {
  const raw = (process.env.BLOCKED_CONTENT_PATTERNS ?? '').trim()
  if (!raw) {
    return { skipped: true, reason: 'env_empty', imported: 0, invalid: [] }
  }

  // Vérifier que la table est vide pour ne pas écraser une config admin
  let existingCount = 0
  try {
    const { rows } = await db.query<{ cnt: string }>(
      `SELECT COUNT(*)::text AS cnt FROM octoguard_automod_rules`
    )
    existingCount = parseInt(rows[0]?.cnt ?? '0', 10)
  } catch (err) {
    console.warn('[octoguard:envMigration] cannot count rules, skip:', err)
    return { skipped: true, reason: 'db_error', imported: 0, invalid: [] }
  }

  if (existingCount > 0) {
    return {
      skipped: true,
      reason:  `db_has_${existingCount}_rules`,
      imported: 0,
      invalid: [],
    }
  }

  // Découpe les patterns (séparateur "|", historique) et valide chacun
  const patterns = raw.split('|').map(p => p.trim()).filter(p => p.length > 0)
  const invalid: string[] = []
  let imported = 0

  for (const pattern of patterns) {
    const compiled = compileSafeRegex(pattern, 'i')
    if (!compiled) {
      invalid.push(pattern)
      continue
    }

    try {
      await db.query(
        `INSERT INTO octoguard_automod_rules
           (name, type, params, action, immunized_role_types)
         VALUES ($1, 'regex', $2::jsonb, 'delete',
                 ARRAY['owner','admin','moderator'])`,
        [
          `env-migrated: ${pattern.slice(0, 60)}`,
          JSON.stringify({ pattern, flags: 'i' }),
        ]
      )
      imported++
    } catch (err) {
      console.warn('[octoguard:envMigration] INSERT failed for pattern:', pattern, err)
      invalid.push(pattern)
    }
  }

  console.log(
    `[octoguard:envMigration] imported ${imported}/${patterns.length} env pattern(s) ` +
    `(${invalid.length} invalid). Removing BLOCKED_CONTENT_PATTERNS from .env is recommended.`
  )

  return { skipped: false, imported, invalid }
}
