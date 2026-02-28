import fs   from 'fs'
import path from 'path'
import { db } from '../config/database'

// ── Migration runner ──────────────────────────────────────────────────────────
//
// Runs all pending SQL migrations in nexus-core/src/migrations/ in order.
// Tracks applied migrations in the schema_migrations table.
// Safe to call on every server start — already-applied migrations are skipped.

export async function runMigrations(): Promise<void> {
  // PostgreSQL 15+ révoque le droit CREATE sur le schéma public pour PUBLIC par défaut.
  // CREATE TABLE IF NOT EXISTS échoue avec 42501 même si la table existe déjà.
  let migrationTrackingAvailable = true

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        run_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
  } catch (err: any) {
    if (err?.code !== '42501') throw err  // erreur inattendue — on re-lance

    // Permission denied sur CREATE — vérifier si la table existe via information_schema
    try {
      const { rows } = await db.query(`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'schema_migrations'
      `)
      if (rows.length === 0) {
        // Table vraiment absente ET pas de CREATE possible — skip toutes les migrations
        console.warn(
          '[migrate] ⚠️  schema_migrations absente et CREATE refusé (PG15+ permission).\n' +
          '[migrate] → Migrations ignorées. Accorder CREATE ON SCHEMA public TO nexus_user\n' +
          '[migrate]   pour activer le suivi automatique des migrations.'
        )
        migrationTrackingAvailable = false
      } else {
        console.warn('[migrate] permission CREATE refusée (PG15+), schema_migrations existe déjà — ok.')
      }
    } catch {
      console.warn('[migrate] ⚠️  Impossible de vérifier schema_migrations — migrations ignorées.')
      migrationTrackingAvailable = false
    }
  }

  if (!migrationTrackingAvailable) return

  const migrationsDir = path.join(process.cwd(), 'src', 'migrations')
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  let applied = 0

  for (const file of files) {
    const version = file.replace('.sql', '')

    const { rowCount } = await db.query(
      'SELECT 1 FROM schema_migrations WHERE version = $1',
      [version]
    )

    if (rowCount && rowCount > 0) continue

    console.log(`[migrate] Applying ${file}...`)
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8')
    await db.query(sql)
    await db.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
    applied++
  }

  if (applied === 0) {
    console.log('[migrate] Database up to date.')
  } else {
    console.log(`[migrate] ✓ ${applied} migration(s) applied.`)
  }
}
