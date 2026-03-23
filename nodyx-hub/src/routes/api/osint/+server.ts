import type { RequestHandler } from './$types'
import { getPool } from '$lib/server/pg.js'

export const GET: RequestHandler = async ({ url }) => {
  const ip = url.searchParams.get('ip')?.trim()
  if (!ip) return new Response(JSON.stringify({ error: 'ip required' }), { status: 400 })

  // Sanitize : IPv4 ou IPv6 uniquement
  if (!/^[0-9a-fA-F.:]+$/.test(ip)) {
    return new Response(JSON.stringify({ error: 'invalid ip' }), { status: 400 })
  }

  const pool = getPool()

  // Récurrence dans le honeypot
  let recurrence = 0
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM honeypot_hits WHERE ip = $1`, [ip]
    )
    recurrence = rows[0]?.cnt ?? 0
  } catch { /* ignore */ }

  // Proxy vers nodyx-core (cache Redis géré côté core)
  const coreUrl = process.env.PRIVATE_API_SSR_URL || 'http://127.0.0.1:3000/api/v1'
  const secret  = process.env.JWT_SECRET || ''

  try {
    const res = await fetch(`${coreUrl}/honeypot/osint?ip=${encodeURIComponent(ip)}`, {
      headers: { 'x-internal-secret': secret }
    })
    if (!res.ok) throw new Error('core unavailable')

    const data = await res.json()
    return new Response(JSON.stringify({ ...data, recurrence }), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch {
    // Retourner les données minimales si nodyx-core est indisponible
    return new Response(JSON.stringify({
      error: 'enrichment unavailable',
      threat_score: 0, threat_level: 'low', factors: [], summary: '',
      recurrence,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })
  }
}
