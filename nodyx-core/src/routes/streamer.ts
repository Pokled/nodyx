// ─── Streamer Hub — routes Phase 1 ──────────────────────────────────────────
// Deux scopes :
//   /api/v1/streamer/twitch/*           admin-gated (sauf /callback public)
//   /api/v1/integrations/twitch/eventsub/:nonce  webhook public Twitch
//
// Voir spec 015 §4 (OAuth) + §5 (EventSub) + §12 (sécurité).

import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { adminOnly } from '../middleware/adminOnly'
import { requireAuth } from '../middleware/auth'
import { redis } from '../config/database'
import { createHmac, timingSafeEqual } from 'node:crypto'

import {
  completeOAuthCallback,
  completeViewerOAuth,
  consumeOAuthState,
  createOAuthState,
  getProvider,
  getViewerLink,
  ingestEvent,
  listEventSubStatus,
  syncStreamerSubscriptions,
  unlinkViewerTwitch,
  STREAMER_HUB_SCOPES,
  VIEWER_SCOPES,
} from '../services/streamer/streamerHubService'

import {
  findStreamerByExternalId,
  getDecryptedTokens,
  listStreamers,
  refreshAndPersist,
  revokeTokens,
  type StreamerTokenRow,
} from '../services/streamer/tokenService'

import {
  findByNonce,
  markEnabledById,
  markRevokedById,
  readHmacSecretByNonce,
} from '../services/streamer/eventsubService'

import { listRecentEvents } from '../services/streamer/eventService'
import { audit } from '../services/streamer/audit'
import { ProviderError } from '../services/streamer/providers/_types'

// ── Helpers env ──────────────────────────────────────────────────────────────

function redirectUri(): string {
  const v = process.env.STREAMER_OAUTH_REDIRECT_URI
  if (!v) throw new Error('STREAMER_OAUTH_REDIRECT_URI non défini')
  return v
}

function publicBase(): string {
  const v = process.env.STREAMER_PUBLIC_BASE
  if (!v) throw new Error('STREAMER_PUBLIC_BASE non défini (ex: https://nodyx.org)')
  return v.replace(/\/+$/, '')
}

// ── EventSub webhook constants ───────────────────────────────────────────────

const DEDUPE_PREFIX  = 'streamer:eventsub:msgid:'
const DEDUPE_TTL_SEC = 24 * 3600

const HEADER_MSG_ID    = 'twitch-eventsub-message-id'
const HEADER_TIMESTAMP = 'twitch-eventsub-message-timestamp'
const HEADER_SIGNATURE = 'twitch-eventsub-message-signature'
const HEADER_TYPE      = 'twitch-eventsub-message-type'

const MSG_TYPE_VERIFICATION = 'webhook_callback_verification'
const MSG_TYPE_NOTIFICATION = 'notification'
const MSG_TYPE_REVOCATION   = 'revocation'

function readHeader(request: FastifyRequest, name: string): string | null {
  const v = request.headers[name]
  if (typeof v === 'string') return v
  if (Array.isArray(v))      return v[0] ?? null
  return null
}

function verifyHmac(args: {
  secret:    string
  messageId: string
  timestamp: string
  rawBody:   string
  signature: string
}): boolean {
  if (!args.signature.startsWith('sha256=')) return false
  const expectedHex = createHmac('sha256', args.secret)
    .update(args.messageId)
    .update(args.timestamp)
    .update(args.rawBody)
    .digest('hex')
  const provided = Buffer.from(args.signature.slice('sha256='.length), 'hex')
  const expected = Buffer.from(expectedHex, 'hex')
  if (provided.length !== expected.length) return false
  return timingSafeEqual(provided, expected)
}

// ─────────────────────────────────────────────────────────────────────────────
//  Plugin 1 : routes admin OAuth (préfixe /api/v1/streamer)
// ─────────────────────────────────────────────────────────────────────────────

export const streamerAdminPlugin: FastifyPluginAsync = async (server) => {
  // GET /twitch/auth-init  (admin-gated) — retourne l'URL Twitch en JSON
  // Le frontend admin fait ensuite `window.location = authorizeUrl` pour
  // déclencher la navigation. On peut PAS faire un 302 direct ici parce que
  // les navigateurs n'envoient pas le header Authorization sur navigation,
  // donc adminOnly serait inopérant.
  server.get('/twitch/auth-init', { preHandler: adminOnly }, async (request) => {
    const provider = getProvider('twitch')
    const state = await createOAuthState({
      kind:         'streamer',
      targetUserId: request.user!.userId,
      ip:           request.ip,
    })
    const authorizeUrl = provider.buildAuthorizeUrl({
      redirectUri: redirectUri(),
      state,
      scopes:      [...STREAMER_HUB_SCOPES],
      forceVerify: true,
    })
    return { authorizeUrl }
  })

  // GET /twitch/viewer/auth-init  (auth-only) — viewer Flow A : lier son
  // compte Twitch perso à son profil Nodyx. Scopes minimaux user:read:email.
  server.get('/twitch/viewer/auth-init', { preHandler: requireAuth }, async (request) => {
    const provider = getProvider('twitch')
    const state = await createOAuthState({
      kind:         'viewer',
      targetUserId: request.user!.userId,
      ip:           request.ip,
    })
    const authorizeUrl = provider.buildAuthorizeUrl({
      redirectUri: redirectUri(),
      state,
      scopes:      [...VIEWER_SCOPES],
      forceVerify: true,
    })
    return { authorizeUrl }
  })

  // GET /twitch/viewer/me  (auth-only) — état du link Twitch du user actuel
  server.get('/twitch/viewer/me', { preHandler: requireAuth }, async (request) => {
    const link = await getViewerLink(request.user!.userId)
    return { link }
  })

  // DELETE /twitch/viewer/unlink  (auth-only) — délie le compte Twitch
  server.delete('/twitch/viewer/unlink', { preHandler: requireAuth }, async (request, reply) => {
    const ok = await unlinkViewerTwitch({
      viewerUserId: request.user!.userId,
      ip:           request.ip,
    })
    if (!ok) return reply.code(404).send({ ok: false, error: 'no_twitch_link' })
    return { ok: true }
  })

  // GET /twitch/callback (public — Twitch nous appelle)
  // On valide le state pour s'assurer que l'admin Nodyx est bien celui qui a
  // initié le flow (anti-CSRF), puis on persiste tokens + subscribe events.
  server.get('/twitch/callback', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>

    if (q.error) {
      await audit({
        action: 'connect_twitch', status: 'failed',
        ipAddress: request.ip,
        metadata: { stage: 'callback', twitchError: q.error, description: q.error_description ?? null },
      })
      return reply.code(400).send({
        ok: false, stage: 'callback',
        error: q.error, description: q.error_description ?? null,
      })
    }
    if (!q.code || !q.state) {
      return reply.code(400).send({ ok: false, error: 'missing_code_or_state' })
    }

    const consumed = await consumeOAuthState(q.state)
    if (!consumed) {
      await audit({
        action: 'connect_twitch', status: 'failed',
        ipAddress: request.ip,
        metadata: { stage: 'state', reason: 'invalid_or_expired' },
      })
      return reply.code(400).send({ ok: false, error: 'invalid_or_expired_state' })
    }
    const { state: stateData, replayed } = consumed

    // Branch sur le kind du state : streamer (admin OAuth complet) ou
    // viewer (lier juste le twitch_id à un user Nodyx existant).
    if (stateData.kind === 'viewer') {
      // Callback dupliqué (Twitch / browser prefetch) : on skip le exchange
      // (le code OAuth a déjà été consommé par le 1er callback) et on redirect
      // gracieusement vers /settings. Le 1er callback a fait le link, le user
      // est arrivé au bon état.
      if (replayed) {
        request.log.info({ stateKind: 'viewer' }, 'OAuth callback replayed — skipping exchange')
        return reply.redirect('/settings?twitch_link_replay=1', 302)
      }
      try {
        const result = await completeViewerOAuth({
          provider:     getProvider('twitch'),
          code:         q.code,
          redirectUri:  redirectUri(),
          viewerUserId: stateData.targetUserId,
          ip:           request.ip,
        })
        // Si Twitch déjà lié à un autre Nodyx, on renvoie 409 + détail
        if (result.alreadyLinkedTo) {
          return reply.code(409).send({
            ok:    false,
            error: 'twitch_id_already_linked',
            message: `Ce compte Twitch est déjà lié au membre ${result.alreadyLinkedTo}.`,
            twitchLogin: result.twitchLogin,
          })
        }
        // Pour le viewer, on redirect vers /settings avec un query param
        // qui permet à la page settings d'afficher un toast de confirmation
        // et d'ouvrir directement le pane "Comptes liés".
        return reply.redirect(
          '/settings?just_linked_twitch=' + encodeURIComponent(result.twitchLogin),
          302,
        )
      } catch (err) {
        const e = err as Error
        return reply.code(502).send({ ok: false, kind: 'viewer', error: 'pipeline_failure', message: e.message })
      }
    }

    // kind === 'streamer'
    if (replayed) {
      request.log.info({ stateKind: 'streamer' }, 'OAuth callback replayed — skipping exchange')
      return reply.redirect('/admin/streamer-hub?twitch_link_replay=1', 302)
    }
    try {
      const result = await completeOAuthCallback({
        provider:    getProvider('twitch'),
        code:        q.code,
        redirectUri: redirectUri(),
        publicBase:  publicBase(),
        adminUserId: stateData.targetUserId,
        ip:          request.ip,
      })
      return reply.send({
        ok:       true,
        streamer: result.streamer,
        email:    result.email,
        subscribed: result.subscribeResults,
      })
    } catch (err) {
      const e = err as Error
      const status = err instanceof ProviderError ? err.status : 500
      await audit({
        action: 'connect_twitch', status: 'failed',
        userId: stateData.targetUserId, ipAddress: request.ip,
        metadata: { stage: 'callback_pipeline' },
        error:    e.message,
      })
      return reply.code(502).send({ ok: false, error: 'pipeline_failure', status, message: e.message })
    }
  })

  // GET /twitch/me  — admin only — liste les streamers connectés
  server.get('/twitch/me', { preHandler: adminOnly }, async () => {
    const rows = await listStreamers('twitch')
    return { streamers: rows }
  })

  // GET /twitch/eventsub-status  — admin only — état des subscriptions
  server.get('/twitch/eventsub-status', { preHandler: adminOnly }, async () => {
    return await listEventSubStatus('twitch')
  })

  // POST /twitch/sync-subscriptions  — admin only — re-souscrit tous les events
  // pour le primary streamer connecté. Utile pour ajouter les events Phase 2+
  // sans qu'il ait à se reconnecter, tant que les scopes ont déjà été accordés
  // (Phase 1 demandait déjà user:read:chat dans STREAMER_HUB_SCOPES).
  server.post('/twitch/sync-subscriptions', { preHandler: adminOnly }, async (request, reply) => {
    const result = await syncStreamerSubscriptions({
      provider:    getProvider('twitch'),
      publicBase:  publicBase(),
    })
    if (!result.ok) {
      return reply.code(404).send({ ok: false, error: result.reason })
    }
    return reply.send({
      ok:        true,
      created:   result.results.filter(r => r.status === 'created').length,
      skipped:   result.results.filter(r => r.status === 'skipped').length,
      failed:    result.results.filter(r => r.status === 'failed').length,
      results:   result.results,
    })
  })

  // POST /twitch/refresh/:rowId  — admin only — refresh proactif
  server.post<{ Params: { rowId: string } }>('/twitch/refresh/:rowId', { preHandler: adminOnly }, async (request, reply) => {
    try {
      const updated = await refreshAndPersist({
        provider: getProvider('twitch'),
        rowId:    request.params.rowId,
        userId:   request.user!.userId,
        ip:       request.ip,
      })
      if (!updated) return reply.code(404).send({ ok: false, error: 'not_found' })
      return reply.send({ ok: true, streamer: updated })
    } catch (err) {
      const status = err instanceof ProviderError ? err.status : 502
      return reply.code(status === 401 ? 401 : 502).send({
        ok: false, error: 'refresh_failed', message: (err as Error).message,
      })
    }
  })

  // DELETE /twitch/:rowId  — admin only — déconnecte un streamer (delete row)
  server.delete<{ Params: { rowId: string } }>('/twitch/:rowId', { preHandler: adminOnly }, async (request, reply) => {
    const ok = await revokeTokens({
      rowId:  request.params.rowId,
      userId: request.user!.userId,
      ip:     request.ip,
    })
    if (!ok) return reply.code(404).send({ ok: false, error: 'not_found' })
    return reply.send({ ok: true })
  })

  // GET /events  — admin only — derniers événements (debug + live feed)
  server.get<{ Querystring: { limit?: string; type?: string } }>('/events', { preHandler: adminOnly }, async (request) => {
    const limit = request.query.limit ? Math.min(Number(request.query.limit) || 50, 500) : 50
    const rows = await listRecentEvents({
      provider:  'twitch',
      eventType: request.query.type,
      limit,
    })
    return { events: rows }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
//  Plugin 2 : webhook EventSub (préfixe /api/v1/integrations)
//  Encapsulé pour scoper le content-type parser custom (raw body pour HMAC).
// ─────────────────────────────────────────────────────────────────────────────

export const streamerEventsubPlugin: FastifyPluginAsync = async (server) => {
  // Garder le body brut pour le calcul HMAC. Ce parser est encapsulé au plugin
  // par Fastify v5, zéro impact sur les autres handlers.
  server.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      const parsed = body.length ? JSON.parse(body as string) : {}
      ;(parsed as Record<string, unknown>).__rawBody = body
      done(null, parsed)
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  server.post<{ Params: { nonce: string } }>('/twitch/eventsub/:nonce', async (request, reply) => {
    const nonce = request.params.nonce

    const sub = await findByNonce(nonce)
    if (!sub) return reply.code(404).send()  // silencieux, ne révèle rien

    const messageId = readHeader(request, HEADER_MSG_ID)
    const timestamp = readHeader(request, HEADER_TIMESTAMP)
    const signature = readHeader(request, HEADER_SIGNATURE)
    const msgType   = readHeader(request, HEADER_TYPE)
    if (!messageId || !timestamp || !signature || !msgType) {
      return reply.code(400).send({ error: 'missing_headers' })
    }

    // Dedupe (24h Redis, atomique via SET NX EX)
    const dedupeKey = DEDUPE_PREFIX + messageId
    const fresh     = await redis.set(dedupeKey, '1', 'EX', DEDUPE_TTL_SEC, 'NX')
    if (fresh !== 'OK') {
      request.log.info({ messageId }, 'EventSub dupe absorbed')
      return reply.code(204).send()
    }

    // HMAC vérification
    const body    = request.body as Record<string, unknown> & { __rawBody?: string }
    const rawBody = body?.__rawBody ?? ''
    const secret  = await readHmacSecretByNonce(nonce)
    if (!secret) return reply.code(500).send({ error: 'secret_unavailable' })

    const valid = verifyHmac({ secret, messageId, timestamp, rawBody, signature })
    if (!valid) {
      // Effacer le dedupe : un signature-fail ne doit pas bloquer un retry légitime
      await redis.del(dedupeKey).catch(() => {})
      await audit({
        action:   'hmac_invalid',
        status:   'failed',
        ipAddress: request.ip,
        metadata: { nonce: nonce.slice(0, 8) + '…', messageId, msgType },
      })
      request.log.warn({ messageId, nonce: nonce.slice(0, 8) + '…' }, 'EventSub HMAC invalid')
      return reply.code(403).send()
    }

    // Dispatch selon le type
    if (msgType === MSG_TYPE_VERIFICATION) {
      const challenge = (body as { challenge?: string }).challenge
      if (typeof challenge !== 'string') {
        return reply.code(400).send({ error: 'missing_challenge' })
      }
      await markEnabledById(sub.id)
      request.log.info({ rowId: sub.id, eventType: sub.eventType }, 'EventSub verification OK → enabled')
      return reply
        .code(200)
        .header('content-type', 'text/plain; charset=utf-8')
        .send(challenge)
    }

    if (msgType === MSG_TYPE_NOTIFICATION) {
      const evt = body as { event?: Record<string, unknown>; subscription?: { type?: string } }
      const eventType = evt.subscription?.type ?? sub.eventType

      try {
        await ingestEvent({
          provider:   sub.provider,
          eventType,
          payload:    {
            event:        evt.event ?? {},
            subscription: evt.subscription ?? {},
          },
          externalId: messageId,
        })
        request.log.info({
          subId: sub.externalSubId,
          eventType,
        }, '🎬 EventSub notification reçue + persistée')
      } catch (err) {
        request.log.error({ err, eventType }, 'ingestEvent failed')
        // On répond quand même 204 à Twitch pour ne pas déclencher de retry
        // (l'event est dans les pm2 logs, on peut rejouer à la main si besoin)
      }
      return reply.code(204).send()
    }

    if (msgType === MSG_TYPE_REVOCATION) {
      const reason = (body as { subscription?: { status?: string } }).subscription?.status
      await markRevokedById(sub.id, reason)
      request.log.warn({ rowId: sub.id, eventType: sub.eventType, reason }, 'EventSub revoked by Twitch')
      return reply.code(204).send()
    }

    request.log.warn({ msgType }, 'EventSub message type inconnu')
    return reply.code(400).send({ error: 'unknown_message_type' })
  })
}
