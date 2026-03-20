import { db } from '../config/database'

export type SeedCategory = 'feature' | 'design' | 'plugin' | 'event'
export type GrowthStage  = 'germe' | 'pousse' | 'fleur' | 'fruit'

export interface SeedRow {
  id: string
  title: string
  description: string | null
  category: SeedCategory
  planted_by: string | null
  planted_at: string
  water_count: number
  harvest_date: string | null
  implemented_by: string | null
}

export interface SeedWithStage extends SeedRow {
  growth_stage: GrowthStage
  watered_by_me: boolean
}

function growthStage(waterCount: number): GrowthStage {
  if (waterCount >= 200) return 'fruit'
  if (waterCount >= 50)  return 'fleur'
  if (waterCount >= 10)  return 'pousse'
  return 'germe'
}

// ── Create a seed ─────────────────────────────────────────────────────────────

export async function createSeed(opts: {
  userId: string
  title: string
  description?: string
  category?: SeedCategory
}): Promise<SeedRow> {
  const { userId, title, description, category = 'feature' } = opts
  const { rows } = await db.query<SeedRow>(
    `INSERT INTO feature_seeds (title, description, category, planted_by)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [title, description ?? null, category, userId]
  )
  return rows[0]
}

// ── Water (vote for) a seed ───────────────────────────────────────────────────

export async function waterSeed(userId: string, seedId: string): Promise<{ alreadyWatered: boolean; waterCount: number }> {
  // Check existence
  const { rows: existing } = await db.query<SeedRow>(
    `SELECT id, water_count FROM feature_seeds WHERE id = $1`,
    [seedId]
  )
  if (!existing[0]) throw new Error('Seed not found')

  // Try to insert water record (unique constraint prevents double-voting)
  try {
    await db.query(
      `INSERT INTO seed_waters (user_id, seed_id) VALUES ($1, $2)`,
      [userId, seedId]
    )
  } catch (err: unknown) {
    // Unique constraint violation = already watered
    if ((err as { code?: string }).code === '23505') {
      return { alreadyWatered: true, waterCount: existing[0].water_count }
    }
    throw err
  }

  // Increment counter
  const { rows } = await db.query<SeedRow>(
    `UPDATE feature_seeds SET water_count = water_count + 1 WHERE id = $1 RETURNING water_count`,
    [seedId]
  )
  return { alreadyWatered: false, waterCount: rows[0].water_count }
}

// ── List seeds ────────────────────────────────────────────────────────────────

export async function listSeeds(opts: {
  category?: string
  stage?: GrowthStage
  limit?: number
  offset?: number
  requesterId?: string
}): Promise<SeedWithStage[]> {
  const { category, stage, limit = 30, offset = 0, requesterId } = opts
  const params: unknown[] = []
  const conditions: string[] = []

  if (category) {
    params.push(category)
    conditions.push(`s.category = $${params.length}`)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  let waterExpr = 'false'
  if (requesterId) {
    params.push(requesterId)
    waterExpr = `EXISTS(SELECT 1 FROM seed_waters w WHERE w.seed_id = s.id AND w.user_id = $${params.length})`
  }
  params.push(limit, offset)

  const { rows } = await db.query<SeedRow & { watered_by_me: boolean }>(
    `SELECT s.*,
       ${waterExpr} AS watered_by_me
     FROM feature_seeds s
     ${where}
     ORDER BY s.water_count DESC, s.planted_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  )

  return rows.map(row => ({
    ...row,
    growth_stage: growthStage(row.water_count),
  }))
}

// ── Get a single seed ─────────────────────────────────────────────────────────

export async function getSeed(id: string, requesterId?: string): Promise<SeedWithStage | null> {
  const queryParams: unknown[] = [id]
  let waterExpr = 'false'
  if (requesterId) {
    queryParams.push(requesterId)
    waterExpr = `EXISTS(SELECT 1 FROM seed_waters w WHERE w.seed_id = s.id AND w.user_id = $2)`
  }
  const { rows } = await db.query<SeedRow & { watered_by_me: boolean }>(
    `SELECT s.*,
       ${waterExpr} AS watered_by_me
     FROM feature_seeds s
     WHERE s.id = $1`,
    queryParams
  )
  if (!rows[0]) return null
  return { ...rows[0], growth_stage: growthStage(rows[0].water_count) }
}
