/**
 * Webhooks : le facteur (CDC SPECS/NODYX_WEBHOOKS_CDC.md, D36 à D39).
 *
 * emitEvent() ne fait jamais attendre la communauté : il range une tâche par
 * destination concernée dans une file Redis (ensemble trié par heure d'envoi) et
 * rend la main. Le facteur passe toutes les 2 s, prend les tâches dues, les met
 * en forme, les envoie par safeRequest (jamais vers le serveur lui-même, #975).
 *
 * Règles tenues ICI, quelle que soit l'interface :
 *  - D39 : une destination PUBLIQUE ne reçoit jamais une famille d'équipe ;
 *  - le texte d'un message ne part que vers une destination d'équipe qui l'a demandé ;
 *  - essais : tout de suite, +1 min, +10 min ; 10 échecs de suite = pause (D37),
 *    équipe prévenue ; les événements de la pause ne sont pas rejoués.
 */
import { randomUUID } from 'crypto'
import { db, redis } from '../../config/database'
import { safeRequest, webhookAllowsPrivate, OutboundBlocked } from '../../utils/ssrfGuard'
import { resolveServerLocale } from '../../i18n/serverStrings'
import { renderEvent } from '../../i18n/webhookStrings'
import { buildOutgoing, type Format } from './format'
import { isTeamFamily, type NodyxEvent, type Family } from './catalog'
import * as NotificationModel from '../../models/notification'
import { io } from '../../socket/io'
import { getInstanceCommunityId } from '../../middleware/adminOnly'

export const RETRY_DELAYS_MS = [60_000, 600_000]          // 2e essai après 1 min, 3e après 10 min
export const PAUSE_AFTER_FAILURES = 10                      // D37
const QUEUE = 'webhooks:jobs'
const MAX_QUEUE = 5000
const TICK_MS = 2000
const KEEP_DELIVERIES = 50

export interface Destination {
  id: string; name: string; kind: 'public' | 'team'; format: Format; url: string; secret: string | null
  events: string[]; include_text: boolean; options: { forum_categories?: string[] | null }; enabled: boolean
  consecutive_failures: number; paused_at: string | null
}
interface Job { job: string; dest: string; ev: NodyxEvent; delivery: string; attempt: number }

/** Cette destination peut-elle recevoir cet événement ? La règle D39 vit ici. */
export function accepts(d: Pick<Destination, 'kind' | 'events' | 'enabled' | 'paused_at' | 'options'>, ev: Pick<NodyxEvent, 'family' | 'details'>): boolean {
  if (!d.enabled || d.paused_at) return false
  if (d.kind === 'public' && isTeamFamily(ev.family)) return false
  if (!d.events.includes(ev.family)) return false
  // Forum : une liste de catégories choisies (vide ou absente = toutes)
  const cats = d.options?.forum_categories
  const cat = ev.details?.category_id
  if ((ev.family === 'forum_article' || ev.family === 'forum_pinned') && cats && cats.length && (typeof cat !== 'string' || !cats.includes(cat))) return false
  return true
}

/** Ce qui part réellement : sans le texte du message, sauf destination d'équipe qui l'a demandé. */
export function shapeFor(d: Pick<Destination, 'kind' | 'include_text'>, ev: NodyxEvent): NodyxEvent {
  if (ev.text && !(d.kind === 'team' && d.include_text)) { const { text: _t, ...rest } = ev; return rest }
  return ev
}

let cache: { at: number; rows: Destination[] } | null = null
export function invalidateDestinations(): void { cache = null }
async function destinations(): Promise<Destination[]> {
  if (cache && Date.now() - cache.at < 15_000) return cache.rows
  const { rows } = await db.query<Destination>(
    `SELECT id, name, kind, format, url, secret, events, include_text, options, enabled, consecutive_failures, paused_at::text AS paused_at
       FROM webhook_destinations`)
  cache = { at: Date.now(), rows }
  return rows
}

/** Ranger l'événement pour chaque destination concernée. Jamais bloquant, jamais d'exception. */
export function emitEvent(ev: NodyxEvent): void {
  void (async () => {
    try {
      const targets = (await destinations()).filter((d) => accepts(d, ev))
      if (!targets.length) return
      if ((await redis.zcard(QUEUE)) >= MAX_QUEUE) { console.warn('[webhooks] file pleine, événement abandonné', ev.type); return }
      const now = Date.now()
      for (const d of targets) {
        const job: Job = { job: randomUUID(), dest: d.id, ev: shapeFor(d, ev), delivery: randomUUID(), attempt: 1 }
        await redis.zadd(QUEUE, now, JSON.stringify(job))
      }
    } catch (err) { console.warn('[webhooks] emitEvent', err) }
  })()
}

async function community(): Promise<{ name: string; url: string }> {
  return { name: process.env.NODYX_COMMUNITY_NAME || 'Nodyx', url: process.env.FRONTEND_URL || 'http://localhost:5173' }
}

export interface SendResult { ok: boolean; http_status: number | null; duration_ms: number; error_code: string | null; response: string | null; request: string }

/** Un envoi, une fois : met en forme, envoie par la garde réseau, mesure. */
export async function sendOnce(d: Pick<Destination, 'format' | 'url' | 'secret'>, ev: NodyxEvent, deliveryId: string): Promise<SendResult> {
  const r = renderEvent(ev, resolveServerLocale(null, process.env.NODYX_COMMUNITY_LANGUAGE))
  const out = buildOutgoing(d.format, d.url, ev, r, { community: await community(), deliveryId, timestamp: Math.floor(Date.now() / 1000), secret: d.secret })
  const t0 = Date.now()
  try {
    const res = await safeRequest(out.url, { method: 'POST', headers: out.headers, body: out.body, timeoutMs: 10_000, maxBytes: 2048, allowPrivate: webhookAllowsPrivate() })
    const ok = res.status >= 200 && res.status < 300
    return { ok, http_status: res.status, duration_ms: Date.now() - t0, error_code: ok ? null : `HTTP_${res.status}`, response: res.body.toString('utf8').slice(0, 500), request: out.body.slice(0, 8192) }
  } catch (err) {
    const code = err instanceof OutboundBlocked ? err.code : (err as { name?: string }).name === 'AbortError' ? 'TIMEOUT' : 'NETWORK'
    return { ok: false, http_status: null, duration_ms: Date.now() - t0, error_code: code, response: null, request: out.body.slice(0, 8192) }
  }
}

async function record(destId: string, job: { delivery: string; ev: NodyxEvent; attempt: number }, status: string, r: SendResult): Promise<void> {
  const label = renderEvent(job.ev, resolveServerLocale(null, process.env.NODYX_COMMUNITY_LANGUAGE)).text.slice(0, 200)
  await db.query(
    `INSERT INTO webhook_deliveries (destination_id, delivery_id, event, label, attempt, status, http_status, duration_ms, error_code, request_body, response_body)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [destId, job.delivery, job.ev.type, label, job.attempt, status, r.http_status, r.duration_ms, r.error_code, r.request, r.response])
  // Les 50 derniers seulement
  await db.query(
    `DELETE FROM webhook_deliveries WHERE destination_id = $1 AND id NOT IN
       (SELECT id FROM webhook_deliveries WHERE destination_id = $1 ORDER BY created_at DESC LIMIT ${KEEP_DELIVERIES})`, [destId])
}

/** D37 : prévenir ceux qui gèrent l'instance qu'une destination est en pause. */
async function notifyPaused(d: Destination): Promise<void> {
  try {
    const communityId = await getInstanceCommunityId()
    const { rows } = await db.query<{ user_id: string }>(
      `SELECT cm.user_id FROM community_members cm JOIN users u ON u.id = cm.user_id AND u.is_system = false
        WHERE cm.community_id = $1 AND cm.role IN ('owner', 'admin')`, [communityId])
    for (const { user_id } of rows) {
      await NotificationModel.create({ user_id, type: 'webhook_paused', meta: { destination_id: d.id, name: d.name } })
      if (io) io.to(`user:${user_id}`).emit('notification:new', { unreadCount: await NotificationModel.getUnreadCount(user_id) })
    }
  } catch { /* la notification ne bloque jamais le facteur */ }
}

export async function processJob(raw: string): Promise<void> {
  const job = JSON.parse(raw) as Job
  const { rows } = await db.query<Destination>(
    `SELECT id, name, kind, format, url, secret, events, include_text, options, enabled, consecutive_failures, paused_at::text AS paused_at
       FROM webhook_destinations WHERE id = $1`, [job.dest])
  const d = rows[0]
  // Destination supprimée, éteinte, en pause, ou devenue publique entre-temps : rien ne part
  if (!d || !accepts(d, job.ev)) return
  const r = await sendOnce(d, shapeFor(d, job.ev), job.delivery)
  if (r.ok) {
    await record(d.id, job, 'ok', r)
    if (d.consecutive_failures) await db.query(`UPDATE webhook_destinations SET consecutive_failures = 0 WHERE id = $1`, [d.id])
    return
  }
  const last = job.attempt > RETRY_DELAYS_MS.length || r.error_code === 'URL_FORBIDDEN' || r.error_code === 'URL_INVALID'
  await record(d.id, job, last ? 'failed' : 'retry', r)
  const { rows: upd } = await db.query<{ consecutive_failures: number; paused_at: string | null }>(
    `UPDATE webhook_destinations
        SET consecutive_failures = consecutive_failures + 1,
            paused_at = CASE WHEN consecutive_failures + 1 >= $2 AND paused_at IS NULL THEN NOW() ELSE paused_at END,
            pause_reason = CASE WHEN consecutive_failures + 1 >= $2 AND paused_at IS NULL THEN $3 ELSE pause_reason END
      WHERE id = $1 RETURNING consecutive_failures, paused_at::text AS paused_at`,
    [d.id, PAUSE_AFTER_FAILURES, r.error_code])
  invalidateDestinations()
  if (upd[0]?.paused_at && !d.paused_at) { await notifyPaused(d); return }
  if (!last && !upd[0]?.paused_at) {
    await redis.zadd(QUEUE, Date.now() + RETRY_DELAYS_MS[job.attempt - 1], JSON.stringify({ ...job, job: randomUUID(), attempt: job.attempt + 1 }))
  }
}

async function tick(): Promise<void> {
  try {
    const due = await redis.zrangebyscore(QUEUE, 0, Date.now(), 'LIMIT', 0, 20)
    for (const raw of due) {
      // Une seule main prend une tâche (plusieurs processus possibles)
      if ((await redis.zrem(QUEUE, raw)) !== 1) continue
      await processJob(raw).catch((err) => console.warn('[webhooks] envoi', err))
    }
  } catch (err) { console.warn('[webhooks] facteur', err) }
}

let timer: NodeJS.Timeout | null = null
export function startWebhookDispatcher(): void {
  if (timer) return
  timer = setInterval(() => { void tick() }, TICK_MS)
  if (timer.unref) timer.unref()
}
export function stopWebhookDispatcher(): void { if (timer) { clearInterval(timer); timer = null } }

/** Un exemple, selon la sorte de la destination, pour le bouton « Envoyer un test ». */
export function sampleEvent(kind: 'public' | 'team', family?: Family): NodyxEvent {
  const at = new Date().toISOString()
  const fr = resolveServerLocale(null, process.env.NODYX_COMMUNITY_LANGUAGE) === 'fr'
  if (kind === 'team' || (family && isTeamFamily(family))) {
    return { type: 'sanction.mute', family: 'sanctions', at, test: true, actor: { type: 'octoguard' }, target: { type: 'user', name: 'remi' }, rule: fr ? 'Inondation' : 'Flood', place: fr ? '#général' : '#general', details: { duration_minutes: 60 } }
  }
  return { type: 'forum.article', family: 'forum_article', at, test: true, actor: { type: 'member', name: 'lea' }, item: { title: fr ? 'Guide : réussir le niveau 4 sans tricher' : 'Guide: beating level 4 without cheating', category: fr ? 'Entraide' : 'Help' }, path: '/forum' }
}
