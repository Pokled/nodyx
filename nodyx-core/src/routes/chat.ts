/**
 * NODYX — Chat routes (REST)
 * WebSocket events are handled by src/socket/index.ts
 * Prefix: /api/v1/chat
 */

import { FastifyInstance } from 'fastify'
import { rateLimit } from '../middleware/rateLimit'
import { requireAuth } from '../middleware/auth'
import * as ChannelModel from '../models/channel'
import { redis } from '../config/database'
import https from 'https'
import http from 'http'
// Garde anti-SSRF partagée (F-055, 2026-09-12) : vivait ici en copie locale,
// consolidée avec linkPreview.ts et directory.ts dans un seul module — ce
// dernier était le seul des trois à ne PAS résoudre le DNS avant de juger.
import { resolveSsrfSafe } from '../utils/ssrfGuard'

// ── Resolve instance community (cached) ──────────────────────────────────────

import { db } from '../config/database'

let _communityId: string | null = null

async function getCommunityId(): Promise<string | null> {
  if (_communityId) return _communityId
  const slug = process.env.NODYX_COMMUNITY_SLUG
  if (slug) {
    const { rows } = await db.query(`SELECT id FROM communities WHERE slug = $1`, [slug])
    if (rows[0]) { _communityId = rows[0].id; return _communityId }
  }
  const { rows } = await db.query(`SELECT id FROM communities ORDER BY created_at ASC LIMIT 1`)
  if (rows[0]) { _communityId = rows[0].id; return _communityId }
  return null
}

// ── Routes ───────────────────────────────────────────────────────────────────

export default async function chatRoutes(app: FastifyInstance) {

  // GET /api/v1/chat/channels — list all channels for this instance
  app.get('/channels', {
    preHandler: [rateLimit, requireAuth],
  }, async (_req, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const channels = await ChannelModel.listByCommunity(communityId)
    return reply.send({ channels })
  })

  // GET /api/v1/chat/channels/:id/history — paginated history (REST, for scroll-up)
  app.get('/channels/:id/history', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const q = request.query as { limit?: string; before?: string }
    const limit  = Math.min(Number(q.limit ?? 50), 100)
    const before = q.before

    const channel = await ChannelModel.findById(id)
    if (!channel) return reply.code(404).send({ error: 'Channel not found' })

    const messages = await ChannelModel.getHistory(id, limit, before)
    return reply.send({ messages })
  })

  // GET /api/v1/chat/unfurl?url= — server-side Open Graph fetch (avoids CORS)
  app.get('/unfurl', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const { url } = request.query as { url?: string }
    if (!url) return reply.code(400).send({ error: 'Missing url' })

    // Validation URL + protection SSRF
    let parsed: URL
    try {
      parsed = new URL(url)
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Bad protocol')
    } catch {
      return reply.code(400).send({ error: 'Invalid url' })
    }

    // Résolution DNS unique — l'IP est utilisée directement pour la connexion
    // (anti-DNS rebinding : le même résultat est utilisé pour la validation ET la connexion)
    const resolvedIp = await resolveSsrfSafe(parsed.hostname)
    if (!resolvedIp) {
      return reply.code(400).send({ error: 'URL non autorisée' })
    }

    // Check Redis cache (TTL 1h)
    const cacheKey = `unfurl:${url}`
    const cached = await redis.get(cacheKey).catch(() => null)
    if (cached) {
      return reply.send(JSON.parse(cached))
    }

    try {
      // Connexion directe à l'IP résolue pour éviter le DNS rebinding.
      // Pour HTTPS : servername = hostname original pour la vérification TLS/SNI.
      const res = await new Promise<{ ok: boolean; text: () => Promise<string> }>((resolve, reject) => {
        const isHttps = parsed.protocol === 'https:'
        const mod = isHttps ? https : http
        const port = parsed.port ? Number(parsed.port) : (isHttps ? 443 : 80)
        const options: https.RequestOptions = {
          hostname: resolvedIp,
          port,
          path: (parsed.pathname || '/') + parsed.search,
          method: 'GET',
          headers: { 'Host': parsed.hostname, 'User-Agent': 'NodyxBot/1.0 (link preview)' },
          ...(isHttps ? { servername: parsed.hostname } : {}),
          timeout: 4000,
        }
        const req = mod.request(options, (res2) => {
          if (!res2.statusCode || res2.statusCode < 200 || res2.statusCode >= 400) {
            return resolve({ ok: false, text: async () => '' })
          }
          let data = ''
          res2.setEncoding('utf8')
          res2.on('data', (chunk: string) => { if (data.length < 512_000) data += chunk })
          res2.on('end', () => resolve({ ok: true, text: async () => data }))
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')) })
        req.end()
      })
      if (!res.ok) return reply.code(422).send({ error: 'Fetch failed' })

      const html = await res.text()

      const getOg = (prop: string) => {
        const m = html.match(new RegExp(`<meta[^>]+property=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
            ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:${prop}["']`, 'i'))
        return m?.[1] ?? null
      }
      const getMeta = (name: string) => {
        const m = html.match(new RegExp(`<meta[^>]+name=["']${name}["'][^>]+content=["']([^"']+)["']`, 'i'))
            ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${name}["']`, 'i'))
        return m?.[1] ?? null
      }
      const titleM = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i)

      const result = {
        url:         parsed.toString(),
        title:       getOg('title') ?? getMeta('title') ?? titleM?.[1]?.trim() ?? null,
        description: getOg('description') ?? getMeta('description') ?? null,
        image:       getOg('image') ?? null,
        siteName:    getOg('site_name') ?? parsed.hostname,
      }

      await redis.set(cacheKey, JSON.stringify(result), 'EX', 3600).catch(() => {})
      return reply.send(result)
    } catch {
      return reply.code(422).send({ error: 'Could not fetch preview' })
    }
  })

  // GET /api/v1/chat/members?q= — autocomplete @mention (members of this community)
  app.get('/members', {
    preHandler: [rateLimit, requireAuth],
  }, async (request, reply) => {
    const communityId = await getCommunityId()
    if (!communityId) return reply.code(503).send({ error: 'Community not configured' })

    const { q } = request.query as { q?: string }
    const search = (q ?? '').trim()

    const { rows } = await db.query<{ username: string; avatar: string | null }>(
      `SELECT u.username, u.avatar
       FROM users u
       JOIN community_members cm ON cm.user_id = u.id
       WHERE cm.community_id = $1
         AND u.is_system = false
         AND ($2 = '' OR u.username ILIKE $3)
       ORDER BY u.username ASC
       LIMIT 8`,
      [communityId, search, `${search}%`]
    )

    return reply.send({ members: rows })
  })
}
