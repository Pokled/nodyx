/**
 * Webhooks : les routes de l'administration (préfixe /api/v1/admin/webhooks).
 * Admins et propriétaires seulement (réglage d'instance). Le secret ne revient
 * JAMAIS du serveur : seulement sa présence.
 */
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db, redis } from '../config/database'
import { adminOnly } from '../middleware/adminOnly'
import { rateLimit } from '../middleware/rateLimit'
import { validate } from '../middleware/validate'
import { logAction } from './admin'
import { checkOutboundUrl, OutboundBlocked, webhookAllowsPrivate } from '../utils/ssrfGuard'
import { PUBLIC_FAMILIES, TEAM_FAMILIES, DEFAULT_EVENTS, isFamily, isTeamFamily } from '../services/webhooks/catalog'
import { invalidateDestinations, sendOnce, sampleEvent } from '../services/webhooks/dispatch'
import { randomUUID } from 'crypto'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const FORMATS = ['ntfy', 'matrix', 'discord', 'slack', 'json'] as const

const Body = z.object({
  name:         z.string().trim().min(1).max(60),
  kind:         z.enum(['public', 'team']),
  format:       z.enum(FORMATS),
  url:          z.string().trim().min(1).max(2048),
  secret:       z.string().min(16).max(256).nullable().optional(),
  events:       z.array(z.string()).max(32).optional(),
  include_text: z.boolean().optional(),
  options:      z.object({ forum_categories: z.array(z.string().regex(UUID_RE)).max(100).nullable().optional() }).optional(),
  enabled:      z.boolean().optional(),
})
const Partial = Body.partial()

type Fail = { status: number; code: string; error: string }
const fail = (status: number, code: string, error: string): Fail => ({ status, code, error })

/** Les règles qui ne dépendent pas de l'écran : adresse sûre, D39, texte réservé à l'équipe. */
async function check(b: { kind: 'public' | 'team'; format: string; url: string; events: string[]; include_text: boolean; secret?: string | null }): Promise<Fail | null> {
  try { await checkOutboundUrl(b.url, { allowPrivate: webhookAllowsPrivate() }) } catch (err) {
    const code = err instanceof OutboundBlocked ? err.code : 'URL_INVALID'
    return fail(400, `WEBHOOK_${code}`, 'This address cannot receive the webhook')
  }
  const unknown = b.events.filter((e) => !isFamily(e))
  if (unknown.length) return fail(400, 'WEBHOOK_UNKNOWN_EVENT', `Unknown event family: ${unknown.join(', ')}`)
  // D39 : la modération ne part jamais vers une destination publique
  if (b.kind === 'public' && b.events.some(isTeamFamily)) return fail(400, 'WEBHOOK_TEAM_EVENTS_ON_PUBLIC', 'A public destination cannot receive moderation events')
  if (b.kind === 'public' && b.include_text) return fail(400, 'WEBHOOK_TEXT_ON_PUBLIC', 'Message text can only go to a team destination')
  if (b.format !== 'json' && b.secret) return fail(400, 'WEBHOOK_SECRET_JSON_ONLY', 'A signing secret only applies to the JSON format')
  return null
}

const PUBLIC_COLS = `id, name, kind, format, url, (secret IS NOT NULL) AS has_secret, events, include_text, options, enabled,
  consecutive_failures, paused_at::text AS paused_at, pause_reason, created_at::text AS created_at, updated_at::text AS updated_at,
  (SELECT MAX(created_at)::text FROM webhook_deliveries d WHERE d.destination_id = webhook_destinations.id AND d.status IN ('ok', 'test_ok')) AS last_ok_at,
  (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.destination_id = webhook_destinations.id AND d.status IN ('ok', 'retry', 'failed') AND d.created_at > NOW() - INTERVAL '7 days') AS sent_7d,
  (SELECT COUNT(*)::int FROM webhook_deliveries d WHERE d.destination_id = webhook_destinations.id AND d.status = 'ok' AND d.created_at > NOW() - INTERVAL '7 days') AS ok_7d`

/** Combien d'envois par semaine chaque famille aurait produits (30 derniers jours / 4,3). */
async function estimates(): Promise<Record<string, number>> {
  const q = async (sql: string) => { try { const { rows } = await db.query<{ n: number }>(sql); return rows[0]?.n ?? 0 } catch { return 0 } }
  const since = `NOW() - INTERVAL '30 days'`
  const audit = (like: string) => q(`SELECT COUNT(*)::int AS n FROM admin_audit_log WHERE action SIMILAR TO '${like}' AND created_at > ${since}`)
  const raw: Record<string, number> = {
    forum_article: await q(`SELECT COUNT(*)::int AS n FROM threads WHERE created_at > ${since}`),
    forum_pinned:  await q(`SELECT COUNT(*)::int AS n FROM threads WHERE is_pinned AND updated_at > ${since}`),
    music:         await q(`SELECT COUNT(*)::int AS n FROM music_tracks WHERE created_at > ${since}`),
    calendar:      await q(`SELECT COUNT(*)::int AS n FROM events WHERE is_public AND created_at > ${since}`),
    polls:         await q(`SELECT COUNT(*)::int AS n FROM polls WHERE created_at > ${since}`),
    wiki:          await q(`SELECT COUNT(*)::int AS n FROM wiki_pages WHERE is_public AND created_at > ${since}`),
    live:          0,
    members:       await q(`SELECT COUNT(*)::int AS n FROM users WHERE is_system = false AND created_at > ${since}`),
    shield:        await audit('octoguard.shield_(raised|suggested)'),
    sanctions:     await audit('octoguard.(warn_user|mute_user|unmute_user|ban_temp_user|delete_message|escalation_%|hate_symbol_blocked|action_undone|false_positive)'),
    reports:       await audit('octoguard.(report_filed|notify)'),
    held:          await audit('octoguard.(message_held|held_%)'),
    appeals:       await audit('octoguard.appeal_%'),
    ladder:        await audit('octoguard.ladder_(applied|proposed|approved|refused|expired|undone|engine_alert)'),
    og_settings:   await audit('octoguard.(rule_%|profile_%|enabled|disabled|ladder_settings)'),
    observations:  await audit('octoguard.would_%'),
  }
  return Object.fromEntries(Object.entries(raw).map(([k, n]) => [k, Math.round(n / 4.3)]))
}

export async function webhooksAdminPlugin(app: FastifyInstance) {
  app.addHook('preHandler', adminOnly)

  app.get('/', async (_request, reply) => {
    const { rows } = await db.query(`SELECT ${PUBLIC_COLS} FROM webhook_destinations ORDER BY kind, created_at`)
    const { rows: cats } = await db.query<{ id: string; name: string }>(`SELECT id, name FROM categories ORDER BY position NULLS LAST, name`).catch(() => ({ rows: [] as Array<{ id: string; name: string }> }))
    return reply.send({
      destinations: rows,
      families: { public: PUBLIC_FAMILIES, team: TEAM_FAMILIES },
      defaults: DEFAULT_EVENTS,
      estimates: await estimates(),
      forum_categories: cats,
      allow_private: webhookAllowsPrivate(),
    })
  })

  app.post('/', { preHandler: [rateLimit, validate({ body: Body })] }, async (request, reply) => {
    const b = request.body as z.infer<typeof Body>
    const events = b.events ?? DEFAULT_EVENTS[b.kind]
    const bad = await check({ kind: b.kind, format: b.format, url: b.url, events, include_text: !!b.include_text, secret: b.secret })
    if (bad) return reply.code(bad.status).send({ error: bad.error, code: bad.code })
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO webhook_destinations (name, kind, format, url, secret, events, include_text, options, enabled, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10) RETURNING id`,
      [b.name, b.kind, b.format, b.url, b.format === 'json' ? (b.secret ?? null) : null, events, !!b.include_text, JSON.stringify(b.options ?? {}), b.enabled ?? true, request.user!.userId])
    invalidateDestinations()
    await logAction(request.user!.userId, 'webhook.created', 'webhook', rows[0].id, b.name, { kind: b.kind, format: b.format, events })
    const { rows: out } = await db.query(`SELECT ${PUBLIC_COLS} FROM webhook_destinations WHERE id = $1`, [rows[0].id])
    return reply.code(201).send({ destination: out[0] })
  })

  app.put('/:id', { preHandler: [rateLimit, validate({ body: Partial })] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const b = request.body as z.infer<typeof Partial>
    const { rows: cur } = await db.query(`SELECT * FROM webhook_destinations WHERE id = $1`, [id])
    if (!cur[0]) return reply.code(404).send({ error: 'Not found', code: 'NOT_FOUND' })
    const next = { ...cur[0], ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) } as Record<string, any>
    // Un changement d'outil efface un secret qui ne s'applique plus
    if (next.format !== 'json') next.secret = null
    const bad = await check({ kind: next.kind, format: next.format, url: next.url, events: next.events, include_text: next.include_text, secret: b.secret })
    if (bad) return reply.code(bad.status).send({ error: bad.error, code: bad.code })
    await db.query(
      `UPDATE webhook_destinations SET name = $2, kind = $3, format = $4, url = $5, secret = $6, events = $7, include_text = $8,
              options = $9::jsonb, enabled = $10, updated_at = NOW() WHERE id = $1`,
      [id, next.name, next.kind, next.format, next.url, next.secret ?? null, next.events, next.include_text, JSON.stringify(next.options ?? {}), next.enabled])
    invalidateDestinations()
    await logAction(request.user!.userId, 'webhook.updated', 'webhook', id, next.name, {
      changed: Object.keys(b).filter((k) => k !== 'secret').concat(b.secret !== undefined ? ['secret'] : []),
      ...(cur[0].kind !== next.kind ? { kind_from: cur[0].kind, kind_to: next.kind } : {}),
    })
    const { rows: out } = await db.query(`SELECT ${PUBLIC_COLS} FROM webhook_destinations WHERE id = $1`, [id])
    return reply.send({ destination: out[0] })
  })

  app.delete('/:id', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const { rows } = await db.query<{ name: string }>(`DELETE FROM webhook_destinations WHERE id = $1 RETURNING name`, [id])
    if (!rows[0]) return reply.code(404).send({ error: 'Not found', code: 'NOT_FOUND' })
    invalidateDestinations()
    await logAction(request.user!.userId, 'webhook.deleted', 'webhook', id, rows[0].name, {})
    return reply.send({ ok: true })
  })

  // D37 : « Tester et reprendre »
  app.post('/:id/resume', { preHandler: [rateLimit] }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const { rows } = await db.query<{ name: string }>(
      `UPDATE webhook_destinations SET paused_at = NULL, pause_reason = NULL, consecutive_failures = 0, updated_at = NOW()
        WHERE id = $1 RETURNING name`, [id])
    if (!rows[0]) return reply.code(404).send({ error: 'Not found', code: 'NOT_FOUND' })
    invalidateDestinations()
    await logAction(request.user!.userId, 'webhook.resumed', 'webhook', id, rows[0].name, {})
    return reply.send({ ok: true })
  })

  app.get('/:id/deliveries', async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!UUID_RE.test(id)) return reply.code(400).send({ error: 'Invalid id', code: 'INVALID_REQUEST' })
    const { rows } = await db.query(
      `SELECT id, delivery_id, event, label, attempt, status, http_status, duration_ms, error_code, request_body, response_body, created_at::text AS created_at
         FROM webhook_deliveries WHERE destination_id = $1 ORDER BY created_at DESC LIMIT 50`, [id])
    return reply.send({ deliveries: rows })
  })

  // Un exemple marqué « test », vers une destination enregistrée OU une adresse pas encore enregistrée.
  // Limité en débit : le serveur ne doit pas devenir un canon à requêtes.
  const TestBody = z.object({
    destination_id: z.string().regex(UUID_RE).optional(),
    kind: z.enum(['public', 'team']).optional(), format: z.enum(FORMATS).optional(),
    url: z.string().trim().max(2048).optional(), secret: z.string().min(16).max(256).nullable().optional(),
  })
  app.post('/test', { preHandler: [rateLimit, validate({ body: TestBody })] }, async (request, reply) => {
    const key = `webhooks:test:${request.user!.userId}`
    const n = await redis.incr(key)
    if (n === 1) await redis.expire(key, 60)
    if (n > 10) return reply.code(429).send({ error: 'Too many tests, wait a minute', code: 'WEBHOOK_TEST_RATE' })
    const b = request.body as z.infer<typeof TestBody>
    let dest: { id?: string; kind: 'public' | 'team'; format: typeof FORMATS[number]; url: string; secret: string | null }
    if (b.destination_id) {
      const { rows } = await db.query(`SELECT id, kind, format, url, secret FROM webhook_destinations WHERE id = $1`, [b.destination_id])
      if (!rows[0]) return reply.code(404).send({ error: 'Not found', code: 'NOT_FOUND' })
      dest = { ...rows[0], ...(b.url ? { url: b.url } : {}), ...(b.format ? { format: b.format } : {}), ...(b.secret ? { secret: b.secret } : {}) }
    } else {
      if (!b.kind || !b.format || !b.url) return reply.code(400).send({ error: 'kind, format and url are required', code: 'INVALID_REQUEST' })
      dest = { kind: b.kind, format: b.format, url: b.url, secret: b.secret ?? null }
    }
    try { await checkOutboundUrl(dest.url, { allowPrivate: webhookAllowsPrivate() }) } catch (err) {
      const code = err instanceof OutboundBlocked ? err.code : 'URL_INVALID'
      return reply.code(400).send({ error: 'This address cannot receive the webhook', code: `WEBHOOK_${code}` })
    }
    const ev = sampleEvent(dest.kind)
    const deliveryId = randomUUID()
    const r = await sendOnce(dest, ev, deliveryId)
    if (dest.id) {
      await db.query(
        `INSERT INTO webhook_deliveries (destination_id, delivery_id, event, label, attempt, status, http_status, duration_ms, error_code, request_body, response_body)
         VALUES ($1, $2, $3, 'test', 1, $4, $5, $6, $7, $8, $9)`,
        [dest.id, deliveryId, ev.type, r.ok ? 'test_ok' : 'test_failed', r.http_status, r.duration_ms, r.error_code, r.request, r.response])
    }
    return reply.send({ ok: r.ok, http_status: r.http_status, duration_ms: r.duration_ms, error_code: r.error_code, response: r.response?.slice(0, 300) ?? null })
  })
}
