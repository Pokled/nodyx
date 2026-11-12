/**
 * OctoGuard, Module 5 Webhook out (spec v2.1.1).
 *
 * Permet à l'admin de configurer une URL externe qui reçoit un POST
 * signé HMAC-SHA256 pour chaque action OctoGuard (delete, warn, mute,
 * ban_temp, welcome, command, report). Utile pour mirrorer les events
 * sur un Discord admin, ntfy, Slack, ou tout endpoint de monitoring.
 *
 * Architecture :
 *  - triggerWebhook(payload) push dans une queue Redis (LPUSH non bloquant).
 *  - Un worker setInterval consomme la queue (RPOP batch, POST sériel).
 *  - HMAC-SHA256 sur le body JSON brut, header `X-Octoguard-Signature`.
 *  - Pas de retry sophistiqué : si POST échoue, on log et on drop. L'admin
 *    voit dans son endpoint webhook qu'il manque des events et investigue.
 *  - URL lente ou down : ne ralentit JAMAIS le pipeline (queue + worker async).
 *
 * Cf. memory/project_octoguard_roadmap.md §Session D + spec §Module 5.
 */

import { createHmac, randomUUID } from 'crypto'
import { db, redis } from '../../config/database'
import type { WebhookRow } from './types'
import { safeRequest, webhookAllowsPrivate } from '../../utils/ssrfGuard'

// ─── Queue Redis ─────────────────────────────────────────────────────────────

const QUEUE_KEY = 'octoguard:webhook:queue'
const MAX_QUEUE_LEN = 1000  // garde-fou contre une queue qui grossit indéfiniment
const WORKER_INTERVAL_MS = 5_000  // poll toutes les 5s
const BATCH_SIZE = 20  // POST jusqu'à 20 events par tick

export interface WebhookPayload {
  action:        string
  event_id:      string
  target_type:   string | null
  target_id:     string | null
  target_label:  string | null
  metadata?:     Record<string, unknown>
  at:            string  // ISO timestamp
}

// ─── Config (singleton DB) ───────────────────────────────────────────────────

/**
 * Cache RAM de la config webhook. TTL 30s.
 * Évite un SELECT à chaque action OctoGuard.
 */
let _cfgCache: { row: WebhookRow | null; ts: number } | null = null
const CFG_TTL_MS = 30_000

async function getWebhookConfigCached(): Promise<WebhookRow | null> {
  if (_cfgCache && Date.now() - _cfgCache.ts < CFG_TTL_MS) {
    return _cfgCache.row
  }
  try {
    const { rows } = await db.query<WebhookRow>(
      `SELECT id, url, secret, enabled, updated_at::text AS updated_at
         FROM octoguard_webhook WHERE id = 1 LIMIT 1`
    )
    _cfgCache = { row: rows[0] ?? null, ts: Date.now() }
    return _cfgCache.row
  } catch (err) {
    console.warn('[octoguard:webhook] getWebhookConfig error:', err)
    return null
  }
}

/** Force invalidation du cache config (appelé après PUT /webhook). */
export function invalidateWebhookConfig(): void {
  _cfgCache = null
}

export async function getWebhookConfig(): Promise<WebhookRow | null> {
  return getWebhookConfigCached()
}

export async function setWebhookConfig(input: {
  url?:     string | null
  secret?:  string | null
  enabled?: boolean
}): Promise<WebhookRow | null> {
  // undefined = ne pas toucher ; null = EFFACER (avant : COALESCE, on ne pouvait
  // jamais retirer une adresse ni un secret une fois posés).
  const sets: string[] = []
  const vals: unknown[] = []
  if (input.url !== undefined)     { vals.push(input.url);     sets.push(`url = $${vals.length}`) }
  if (input.secret !== undefined)  { vals.push(input.secret);  sets.push(`secret = $${vals.length}`) }
  // (une colonne ne s'assigne qu'une fois : sans adresse, « éteint » l'emporte)
  if (input.enabled !== undefined && input.url !== null) { vals.push(input.enabled); sets.push(`enabled = $${vals.length}`) }
  // Sans adresse, rien à appeler : le webhook s'éteint
  if (input.url === null) sets.push('enabled = false')
  sets.push('updated_at = NOW()')
  try {
    const { rows } = await db.query<WebhookRow>(
      `UPDATE octoguard_webhook SET ${sets.join(', ')}
        WHERE id = 1
        RETURNING id, url, secret, enabled, updated_at::text AS updated_at`,
      vals
    )
    invalidateWebhookConfig()
    return rows[0] ?? null
  } catch (err) {
    console.warn('[octoguard:webhook] setWebhookConfig error:', err)
    return null
  }
}

// ─── triggerWebhook : push dans la queue (fire-and-forget) ───────────────────

/**
 * Pousse un event dans la queue Redis pour traitement async par le worker.
 * NON BLOQUANT : retourne immédiatement.
 *
 * Filtres :
 *  - Webhook désactivé en config → no-op.
 *  - URL absente → no-op (rien à appeler).
 *  - Queue déjà saturée (>MAX_QUEUE_LEN) → drop + warning (protection mémoire Redis).
 */
export function triggerWebhook(payload: WebhookPayload): void {
  void (async () => {
    try {
      const cfg = await getWebhookConfigCached()
      if (!cfg || !cfg.enabled || !cfg.url) return

      const len = await redis.llen(QUEUE_KEY).catch(() => 0)
      if (len >= MAX_QUEUE_LEN) {
        console.warn(`[octoguard:webhook] queue saturated (${len} >= ${MAX_QUEUE_LEN}), dropping event ${payload.event_id}`)
        return
      }

      await redis.lpush(QUEUE_KEY, JSON.stringify(payload))
    } catch (err) {
      console.warn('[octoguard:webhook] triggerWebhook error:', err)
    }
  })()
}

// ─── Worker : RPOP + POST + HMAC ─────────────────────────────────────────────

let _workerTimer: NodeJS.Timeout | null = null

async function processOne(rawPayload: string, url: string, secret: string | null): Promise<void> {
  try {
    const signature = secret
      ? 'sha256=' + createHmac('sha256', secret).update(rawPayload).digest('hex')
      : null

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent':   'OctoGuard-Webhook/1.0',
    }
    if (signature) headers['X-Octoguard-Signature'] = signature

    // Garde anti-SSRF (11/11/2026) : l'adresse est vérifiée à la connexion même
    // (jamais 127.0.0.1, dont l'API d'administration de Caddy partagée par toutes
    // les instances du serveur ; réseau local seulement si l'admin du SERVEUR l'a
    // permis, D36). Aucune redirection suivie. Temps borné à 10 s.
    const res = await safeRequest(url, {
      method: 'POST', headers, body: rawPayload, timeoutMs: 10_000, maxBytes: 4096,
      allowPrivate: webhookAllowsPrivate(),
    })
    if (res.status < 200 || res.status >= 300) {
      console.warn(`[octoguard:webhook] POST returned ${res.status}`)
    }
  } catch (err) {
    // Tout échec : on drop + warn. Pas de retry pour éviter d'embouteiller la queue.
    console.warn('[octoguard:webhook] POST error:', err)
  }
}

async function tickWorker(): Promise<void> {
  try {
    const cfg = await getWebhookConfigCached()
    if (!cfg || !cfg.enabled || !cfg.url) return

    for (let i = 0; i < BATCH_SIZE; i++) {
      const raw = await redis.rpop(QUEUE_KEY).catch(() => null)
      if (!raw) break
      await processOne(raw, cfg.url, cfg.secret)
    }
  } catch (err) {
    console.warn('[octoguard:webhook] tickWorker error:', err)
  }
}

export function startWebhookWorker(): void {
  if (_workerTimer) return
  _workerTimer = setInterval(() => { void tickWorker() }, WORKER_INTERVAL_MS)
  if (_workerTimer.unref) _workerTimer.unref()
}

export function stopWebhookWorker(): void {
  if (_workerTimer) {
    clearInterval(_workerTimer)
    _workerTimer = null
  }
}

// ─── Helper pour les autres modules : convertit ActionLogEntry → payload ─────

export function buildWebhookPayload(args: {
  action:        string
  target_type:   string | null
  target_id:     string | null
  target_label:  string | null
  metadata?:     Record<string, unknown>
}): WebhookPayload {
  return {
    action:        args.action,
    event_id:      (args.metadata?.event_id as string) ?? randomUUID(),
    target_type:   args.target_type,
    target_id:     args.target_id,
    target_label:  args.target_label,
    metadata:      args.metadata,
    at:            new Date().toISOString(),
  }
}
