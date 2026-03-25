/**
 * One-shot script — Génère les slugs de toutes les catégories existantes.
 * Usage: cd nodyx-core && npx ts-node scripts/regen-category-slugs.ts
 */
import 'dotenv/config'
import { db } from '../src/config/database'
import { generateCategorySlug } from '../src/models/community'

async function run() {
  const { rows } = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM categories ORDER BY created_at`
  )

  console.log(`Génération de ${rows.length} slug(s) de catégories...`)

  for (const c of rows) {
    const slug = generateCategorySlug(c.name)
    await db.query(
      `UPDATE categories SET slug = $1 WHERE id = $2`,
      [slug, c.id]
    )
    console.log(`  ${c.id.slice(0, 8)} "${c.name}" → ${slug}`)
  }

  console.log(`\n✓ ${rows.length} slug(s) générés.`)
  await db.end()
}

run().catch(err => {
  console.error(err)
  process.exit(1)
})
