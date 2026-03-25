/**
 * One-shot script — Regénère les slugs de tous les threads existants
 * avec la fonction TypeScript (NFD + unaccent correct).
 * Usage: cd nodyx-core && npx ts-node scripts/regen-slugs.ts
 */
import 'dotenv/config'
import { db } from '../src/config/database'
import { generateSlug } from '../src/models/thread'

async function run() {
  const { rows } = await db.query<{ id: string; title: string }>(
    `SELECT id, title FROM threads ORDER BY created_at`
  )

  console.log(`Regénération de ${rows.length} slug(s)...`)

  let updated = 0
  for (const t of rows) {
    const slug = generateSlug(t.title, t.id)
    await db.query(
      `UPDATE threads SET slug = $1 WHERE id = $2`,
      [slug, t.id]
    )
    updated++
    console.log(`  ${t.id.slice(0, 8)} → ${slug}`)
  }

  console.log(`\n✓ ${updated} slug(s) mis à jour.`)
  await db.end()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
