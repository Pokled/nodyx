// ─── Streamer Hub — routes Phase 1 ──────────────────────────────────────────
// Deux scopes :
//   /api/v1/streamer/twitch/*           admin-gated (sauf /callback public)
//   /api/v1/integrations/twitch/eventsub/:nonce  webhook public Twitch
//
// Voir spec 015 §4 (OAuth) + §5 (EventSub) + §12 (sécurité).

import type { FastifyPluginAsync, FastifyRequest } from 'fastify'
import { adminOnly } from '../middleware/adminOnly'
import { requireAuth } from '../middleware/auth'
import { db, redis } from '../config/database'
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
import { getTwitchProfile } from '../services/streamer/twitchProfile'
import {
  createMarker,
  hasManageBroadcastScope,
  searchGames,
  updateChannelInfo,
} from '../services/streamer/twitchStreamControl'
import {
  createPoll,
  createPrediction,
  endPoll,
  getActivePoll,
  getActivePrediction,
  getEngagementScopes,
  patchPrediction,
} from '../services/streamer/twitchEngagement'
import {
  createReward,
  deleteReward,
  hasRedemptionsScope,
  listRewards,
  updateReward,
} from '../services/streamer/twitchChannelPoints'
import {
  adminUnlinkViewer,
  listLinkedViewers,
} from '../services/streamer/linkedViewersService'
import {
  listClipsForBroadcaster,
  listOwnTopClips,
  listRecentRaids,
  type ClipsPeriod,
} from '../services/streamer/twitchClips'
import { getClipMp4Url } from '../services/streamer/twitchClipExtraction'
import {
  createOverlay,
  findOverlayByToken,
  isOverlayType,
  listOverlays,
  revokeOverlay,
  updateOverlayConfig,
  withGoalBarDefaults,
  withLeaderboardDefaults,
  withTickerDefaults,
  type OverlayType,
} from '../services/streamer/overlayService'
import { computeGoalBarState } from '../services/streamer/goalBarState'
import { fetchTickerEvents } from '../services/streamer/tickerState'
import { computeLeaderboard } from '../services/streamer/leaderboardState'
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
      return reply.redirect('/admin/streamer-hub?twitch=replayed', 302)
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
      // Redirect to the admin dashboard with a success marker. Email + token
      // payload are intentionally NOT forwarded in the URL: the dashboard will
      // fetch fresh data via /streamer/twitch/me on load. This also removes the
      // "raw JSON in your browser" UX after OAuth.
      const login = encodeURIComponent(result.streamer.externalLogin)
      const subs  = result.subscribeResults.length
      return reply.redirect(`/admin/streamer-hub?twitch=connected&login=${login}&subs=${subs}`, 302)
    } catch (err) {
      const e = err as Error
      await audit({
        action: 'connect_twitch', status: 'failed',
        userId: stateData.targetUserId, ipAddress: request.ip,
        metadata: { stage: 'callback_pipeline' },
        error:    e.message,
      })
      const reason = encodeURIComponent(e.message?.slice(0, 200) || 'pipeline_failure')
      return reply.redirect(`/admin/streamer-hub?twitch=error&reason=${reason}`, 302)
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

  // GET /twitch/profile  — admin only — profil Twitch enrichi pour le hero
  // dashboard (avatar, follower count, état live, jeu en cours…). Cache Redis
  // 60s côté service pour ne pas hammer l'API Twitch. ?refresh=1 force le refetch.
  server.get<{ Querystring: { refresh?: string } }>(
    '/twitch/profile',
    { preHandler: adminOnly },
    async (request, reply) => {
      const force = request.query.refresh === '1'
      const profile = await getTwitchProfile({ forceRefresh: force })
      if (!profile) {
        return reply.code(404).send({ ok: false, error: 'no_streamer_or_helix_unavailable' })
      }
      return profile
    },
  )

  // ── Stream Control Panel (Phase 3) ─────────────────────────────────────
  // Pilote la diffusion Twitch depuis Nodyx : édition titre + catégorie,
  // marker VOD pendant le live, recherche de jeu. Tous gated par
  // channel:manage:broadcast (scope ajouté à STREAMER_HUB_SCOPES, requiert
  // un reconnect pour les anciennes connexions).

  // GET /twitch/control-status — admin only — état du scope manage broadcast
  // pour que le frontend prompt un reconnect si nécessaire.
  server.get('/twitch/control-status', { preHandler: adminOnly }, async () => {
    const hasScope = await hasManageBroadcastScope()
    return { hasScope, requiredScope: 'channel:manage:broadcast' }
  })

  // PATCH /twitch/channel — admin only — met à jour titre + catégorie du
  // stream. Twitch limite le titre à 140 chars (truncation côté service).
  server.patch<{ Body: { title?: string; gameId?: string } }>(
    '/twitch/channel',
    { preHandler: adminOnly },
    async (request, reply) => {
      const r = await updateChannelInfo({
        title:  request.body?.title,
        gameId: request.body?.gameId,
      })
      if (!r.ok) {
        await audit({
          action:   'channel_update_failed',
          status:   'failed',
          userId:   request.user!.userId,
          ipAddress: request.ip,
          metadata: { status: r.status, reason: r.reason },
        })
        return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502)
          .send({ ok: false, error: r.reason })
      }
      await audit({
        action:    'channel_update',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  {
          titleSet:  typeof request.body?.title  === 'string',
          gameIdSet: typeof request.body?.gameId === 'string',
        },
      })
      return reply.send({ ok: true })
    },
  )

  // GET /twitch/games/search?q= — admin only — autocomplete catégorie.
  // 0 résultats si q < 2 chars. Max 10 résultats.
  server.get<{ Querystring: { q?: string } }>(
    '/twitch/games/search',
    { preHandler: adminOnly },
    async (request, reply) => {
      const q = request.query.q ?? ''
      const r = await searchGames(q)
      if (!r.ok) return reply.code(502).send({ ok: false, error: r.reason })
      return reply.send({ games: r.data })
    },
  )

  // POST /twitch/marker — admin only — place un marker VOD à la position
  // courante du stream. Échoue 404 si offline (Twitch enforced).
  server.post<{ Body: { description?: string } }>(
    '/twitch/marker',
    { preHandler: adminOnly },
    async (request, reply) => {
      const r = await createMarker({ description: request.body?.description })
      if (!r.ok) {
        // 404 = stream offline, on retourne 409 (conflict) côté API pour que
        // le frontend distingue "pas streamer" (401) de "pas live" (409).
        const httpCode = r.status === 404 ? 409 : (r.status >= 400 && r.status < 600 ? r.status : 502)
        return reply.code(httpCode).send({
          ok:    false,
          error: r.status === 404 ? 'stream_offline' : r.reason,
        })
      }
      await audit({
        action:    'vod_marker_created',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { markerId: r.data.id, positionSeconds: r.data.positionSeconds },
      })
      return reply.send({ ok: true, marker: r.data })
    },
  )

  // ── Engagement live : Polls + Prédictions ──────────────────────────────
  // Endpoints CRUD pour piloter sondages et prédictions Twitch depuis Studio
  // Live. Scopes manage:polls + manage:predictions (à reconnecter si la
  // connexion OAuth date d'avant cette feature).

  server.get('/twitch/engagement-status', { preHandler: adminOnly }, async () => {
    const scopes = await getEngagementScopes()
    return {
      hasPolls:       scopes.hasPolls,
      hasPredictions: scopes.hasPredictions,
      requiredScopes: ['channel:manage:polls', 'channel:manage:predictions'],
    }
  })

  // ── Polls ────────────────────────────────────────────────────────────
  server.get('/twitch/poll/active', { preHandler: adminOnly }, async (_request, reply) => {
    const r = await getActivePoll()
    if (!r.ok) return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
    return reply.send({ poll: r.data })
  })

  server.post<{ Body: { title?: string; choices?: string[]; duration?: number } }>(
    '/twitch/poll',
    { preHandler: adminOnly },
    async (request, reply) => {
      const { title, choices, duration } = request.body ?? {}
      if (!title || !Array.isArray(choices) || typeof duration !== 'number') {
        return reply.code(400).send({ ok: false, error: 'missing_fields' })
      }
      const r = await createPoll({ title, choices, duration })
      if (!r.ok) {
        await audit({
          action:    'poll_create_failed',
          status:    'failed',
          userId:    request.user!.userId,
          ipAddress: request.ip,
          metadata:  { reason: r.reason, status: r.status },
        })
        return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
      }
      await audit({
        action:    'poll_created',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { pollId: r.data.id, choices: r.data.choices.length, duration: r.data.durationSeconds },
      })
      return reply.send({ ok: true, poll: r.data })
    },
  )

  server.patch<{ Params: { id: string }; Body: { status?: 'TERMINATED' | 'ARCHIVED' } }>(
    '/twitch/poll/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const status = request.body?.status ?? 'TERMINATED'
      if (status !== 'TERMINATED' && status !== 'ARCHIVED') {
        return reply.code(400).send({ ok: false, error: 'invalid_status' })
      }
      const r = await endPoll({ pollId: request.params.id, status })
      if (!r.ok) return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
      await audit({
        action:    'poll_ended',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { pollId: request.params.id, finalStatus: status },
      })
      return reply.send({ ok: true, poll: r.data })
    },
  )

  // ── Prédictions ──────────────────────────────────────────────────────
  server.get('/twitch/prediction/active', { preHandler: adminOnly }, async (_request, reply) => {
    const r = await getActivePrediction()
    if (!r.ok) return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
    return reply.send({ prediction: r.data })
  })

  server.post<{ Body: { title?: string; outcomes?: string[]; predictionWindow?: number } }>(
    '/twitch/prediction',
    { preHandler: adminOnly },
    async (request, reply) => {
      const { title, outcomes, predictionWindow } = request.body ?? {}
      if (!title || !Array.isArray(outcomes) || typeof predictionWindow !== 'number') {
        return reply.code(400).send({ ok: false, error: 'missing_fields' })
      }
      const r = await createPrediction({ title, outcomes, predictionWindow })
      if (!r.ok) {
        await audit({
          action:    'prediction_create_failed',
          status:    'failed',
          userId:    request.user!.userId,
          ipAddress: request.ip,
          metadata:  { reason: r.reason, status: r.status },
        })
        return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
      }
      await audit({
        action:    'prediction_created',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { predictionId: r.data.id, outcomes: r.data.outcomes.length, window: r.data.predictionWindowSeconds },
      })
      return reply.send({ ok: true, prediction: r.data })
    },
  )

  server.patch<{
    Params: { id: string }
    Body:   { status?: 'LOCKED' | 'RESOLVED' | 'CANCELED'; winningOutcomeId?: string }
  }>(
    '/twitch/prediction/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const { status, winningOutcomeId } = request.body ?? {}
      if (status !== 'LOCKED' && status !== 'RESOLVED' && status !== 'CANCELED') {
        return reply.code(400).send({ ok: false, error: 'invalid_status' })
      }
      const r = await patchPrediction({ predictionId: request.params.id, status, winningOutcomeId })
      if (!r.ok) return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
      await audit({
        action:    'prediction_patched',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { predictionId: request.params.id, newStatus: status, winningOutcomeId: winningOutcomeId ?? null },
      })
      return reply.send({ ok: true, prediction: r.data })
    },
  )

  // POST /overlays/:id/play-clips — admin only — déclenche la lecture
  // d'une session de clips dans une overlay de type clips_player. Le body
  // contient soit { period, count } pour piocher dans les top clips de la
  // chaine, soit { broadcasterId, count } pour piocher dans les clips d'un
  // raider précis. Émet le payload via socket dans la room overlay:<id>.
  server.post<{
    Params: { id: string }
    Body:   { period?: 'top_own_7d' | 'top_own_30d' | 'top_own_all' | 'raider'; broadcasterId?: string; count?: number }
  }>(
    '/overlays/:id/play-clips',
    { preHandler: adminOnly },
    async (request, reply) => {
      const body = request.body ?? {}
      const count = Math.min(20, Math.max(1, body.count ?? 5))

      let clips
      if (body.period === 'raider' && body.broadcasterId) {
        clips = await listClipsForBroadcaster(body.broadcasterId, count)
      } else {
        const period: ClipsPeriod = body.period === 'top_own_30d' ? '30d' : body.period === 'top_own_all' ? 'all' : '7d'
        clips = await listOwnTopClips(period, count)
      }

      if (clips.length === 0) return reply.code(404).send({ ok: false, error: 'no_clips_found' })

      const { io } = await import('../socket/io')
      if (!io) return reply.code(503).send({ ok: false, error: 'socket_unavailable' })

      // Enrichit chaque clip avec son URL mp4 directe via GraphQL Twitch.
      // Permet au <video> natif côté overlay d'autoplay sans passer par
      // l'iframe Twitch (qui bloque l'autoplay cross-origin). Best-effort
      // par clip : si l'extraction échoue, mp4Url = null et le frontend
      // tombe en fallback iframe.
      const clipsEnriched = await Promise.all(clips.map(async c => ({
        id:           c.id,
        embedUrl:     c.embedUrl,
        title:        c.title,
        creatorName:  c.creatorName,
        duration:     c.duration,
        thumbnailUrl: c.thumbnailUrl,
        viewCount:    c.viewCount,
        mp4Url:       await getClipMp4Url(c.id),
      })))

      io.of('/overlay').to(`overlay:${request.params.id}`).emit('clips:play', {
        clips: clipsEnriched,
      })

      return reply.send({ ok: true, count: clips.length, mp4Resolved: clipsEnriched.filter(c => c.mp4Url).length })
    },
  )

  // ── Twitch Clips (Studio Live tab) ───────────────────────────────────

  server.get<{ Querystring: { period?: string; limit?: string } }>(
    '/twitch/clips/own',
    { preHandler: adminOnly },
    async (request) => {
      const VALID: readonly ClipsPeriod[] = ['7d', '30d', 'all']
      const period = (VALID as readonly string[]).includes(request.query.period ?? '')
        ? request.query.period as ClipsPeriod
        : '7d'
      const limit = request.query.limit ? Math.min(100, Math.max(1, parseInt(request.query.limit, 10) || 20)) : 20
      const clips = await listOwnTopClips(period, limit)
      return { clips, period, limit }
    },
  )

  server.get<{ Params: { broadcasterId: string }; Querystring: { limit?: string } }>(
    '/twitch/clips/raider/:broadcasterId',
    { preHandler: adminOnly },
    async (request) => {
      const limit = request.query.limit ? Math.min(20, Math.max(1, parseInt(request.query.limit, 10) || 5)) : 5
      const clips = await listClipsForBroadcaster(request.params.broadcasterId, limit)
      return { clips }
    },
  )

  server.get<{ Querystring: { limit?: string } }>(
    '/twitch/raids/recent',
    { preHandler: adminOnly },
    async (request) => {
      const limit = request.query.limit ? Math.min(50, Math.max(1, parseInt(request.query.limit, 10) || 10)) : 10
      const raids = await listRecentRaids(limit)
      return { raids }
    },
  )

  // ── Linked Viewers (Audience tab) ────────────────────────────────────
  // Liste les membres Nodyx qui ont link leur compte Twitch via Flow A,
  // avec leurs stats agrégées (messages chat + events). Admin can unlink.

  server.get<{ Querystring: { limit?: string } }>(
    '/twitch/linked-viewers',
    { preHandler: adminOnly },
    async (request) => {
      const limit = request.query.limit ? Math.min(500, Math.max(1, parseInt(request.query.limit, 10) || 200)) : 200
      const viewers = await listLinkedViewers(limit)
      return { viewers }
    },
  )

  server.delete<{ Params: { userId: string } }>(
    '/twitch/linked-viewers/:userId',
    { preHandler: adminOnly },
    async (request, reply) => {
      const ok = await adminUnlinkViewer(request.params.userId)
      if (!ok) return reply.code(404).send({ ok: false, error: 'not_linked_or_not_found' })
      await audit({
        action:    'unlink_twitch_viewer_admin',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { targetUserId: request.params.userId },
      })
      return reply.send({ ok: true })
    },
  )

  // ── Channel Points Rewards (Phase 3, suite) ─────────────────────────────
  // CRUD sur les custom rewards de la chaine. Affiliate/Partner requis côté
  // Twitch (le frontend gate via broadcasterType, mais on retourne quand
  // même proprement les 403 helix au cas où). Toutes les routes gated admin.

  server.get('/twitch/rewards/scope-status', { preHandler: adminOnly }, async () => {
    const hasScope = await hasRedemptionsScope()
    return { hasScope, requiredScope: 'channel:manage:redemptions' }
  })

  server.get('/twitch/rewards', { preHandler: adminOnly }, async (_request, reply) => {
    const r = await listRewards()
    if (!r.ok) return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
    return reply.send({ rewards: r.data })
  })

  server.post<{ Body: {
    title?: string; cost?: number; prompt?: string
    isEnabled?: boolean; backgroundColor?: string
    isUserInputRequired?: boolean
    cooldownSeconds?: number; maxPerStream?: number; maxPerUserPerStream?: number
  } }>(
    '/twitch/rewards',
    { preHandler: adminOnly },
    async (request, reply) => {
      const b = request.body ?? {}
      if (!b.title || typeof b.cost !== 'number') {
        return reply.code(400).send({ ok: false, error: 'title_and_cost_required' })
      }
      const r = await createReward({
        title:               b.title,
        cost:                b.cost,
        prompt:              b.prompt,
        isEnabled:           b.isEnabled,
        backgroundColor:     b.backgroundColor,
        isUserInputRequired: b.isUserInputRequired,
        cooldownSeconds:     b.cooldownSeconds,
        maxPerStream:        b.maxPerStream,
        maxPerUserPerStream: b.maxPerUserPerStream,
      })
      if (!r.ok) {
        await audit({
          action:    'reward_create_failed',
          status:    'failed',
          userId:    request.user!.userId,
          ipAddress: request.ip,
          metadata:  { reason: r.reason, status: r.status, title: b.title },
        })
        return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
      }
      await audit({
        action:    'reward_created',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { rewardId: r.data.id, title: r.data.title, cost: r.data.cost },
      })
      return reply.send({ ok: true, reward: r.data })
    },
  )

  server.patch<{
    Params: { id: string }
    Body:   {
      title?: string; prompt?: string; cost?: number
      isEnabled?: boolean; isPaused?: boolean
      backgroundColor?: string
      cooldownSeconds?: number | null
      maxPerStream?: number | null
      maxPerUserPerStream?: number | null
    }
  }>(
    '/twitch/rewards/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const b = request.body ?? {}
      const r = await updateReward({ rewardId: request.params.id, ...b })
      if (!r.ok) return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
      await audit({
        action:    'reward_updated',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { rewardId: r.data.id, patchedFields: Object.keys(b) },
      })
      return reply.send({ ok: true, reward: r.data })
    },
  )

  server.delete<{ Params: { id: string } }>(
    '/twitch/rewards/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const r = await deleteReward(request.params.id)
      if (!r.ok) return reply.code(r.status >= 400 && r.status < 600 ? r.status : 502).send({ ok: false, error: r.reason })
      await audit({
        action:    'reward_deleted',
        status:    'success',
        userId:    request.user!.userId,
        ipAddress: request.ip,
        metadata:  { rewardId: request.params.id },
      })
      return reply.send({ ok: true })
    },
  )

  // ── Overlays OBS ───────────────────────────────────────────────────────
  // Génère et gère les URLs browser source à coller dans OBS. Chaque overlay
  // a un token unguessable qui sert d'auth côté socket (lookup + room join).

  server.get('/overlays', { preHandler: adminOnly }, async () => {
    const rows = await listOverlays()
    return { overlays: rows }
  })

  server.post<{ Body: { overlayType?: string; label?: string; config?: Record<string, unknown> } }>(
    '/overlays',
    { preHandler: adminOnly },
    async (request, reply) => {
      const t = request.body?.overlayType ?? ''
      if (!isOverlayType(t)) {
        return reply.code(400).send({ ok: false, error: 'invalid_overlay_type', allowed: ['alert_box', 'goal_bar', 'stream_timer', 'event_ticker', 'leaderboard'] })
      }
      const overlay = await createOverlay({
        overlayType: t as OverlayType,
        label:       request.body?.label  ?? null,
        config:      request.body?.config ?? {},
        createdBy:   request.user!.userId,
      })
      return reply.send({ ok: true, overlay })
    },
  )

  server.patch<{ Params: { id: string }; Body: { label?: string; config?: Record<string, unknown> } }>(
    '/overlays/:id',
    { preHandler: adminOnly },
    async (request, reply) => {
      const updated = await updateOverlayConfig({
        id:     request.params.id,
        label:  request.body?.label,
        config: request.body?.config,
      })
      if (!updated) return reply.code(404).send({ ok: false, error: 'not_found' })

      // Push live la nouvelle config à toutes les pages overlays connectées
      // pour CE overlay précis (room overlay:<id>). Évite au streamer de
      // devoir refresh OBS pour voir le nouveau template / thème.
      try {
        const { io } = await import('../socket/io')
        if (io) {
          io.of('/overlay').to(`overlay:${updated.id}`).emit('overlay:config-updated', {
            config: updated.config,
            label:  updated.label,
          })
        }
      } catch { /* best-effort */ }

      return reply.send({ ok: true, overlay: updated })
    },
  )

  server.delete<{ Params: { id: string } }>('/overlays/:id', { preHandler: adminOnly }, async (request, reply) => {
    const ok = await revokeOverlay(request.params.id)
    if (!ok) return reply.code(404).send({ ok: false, error: 'not_found_or_already_revoked' })
    return reply.send({ ok: true })
  })

  // POST /overlays/:id/test-fire — admin only — envoie un event factice à
  // CETTE overlay précise (room overlay:<id>), sans passer par ingestEvent.
  // Ne crée pas de row dans streamer_events, ne pollue pas les stats, ne
  // touche pas au channel #twitch-chat. Utile pour valider que la config et
  // les templates fonctionnent sans attendre un vrai follower.
  server.post<{ Params: { id: string }; Body: { eventType?: string } }>(
    '/overlays/:id/test-fire',
    { preHandler: adminOnly },
    async (request, reply) => {
      const ALLOWED: readonly string[] = [
        'channel.follow', 'channel.subscribe', 'channel.subscription.gift',
        'channel.cheer', 'channel.raid',
      ]
      const evtType = request.body?.eventType ?? 'channel.follow'
      if (!ALLOWED.includes(evtType)) {
        return reply.code(400).send({ ok: false, error: 'invalid_event_type', allowed: ALLOWED })
      }

      // Payloads alignés sur ce que Twitch livrerait via EventSub.
      const FAKE: Record<string, Record<string, unknown>> = {
        'channel.follow':            { user_name: 'TestFollower',   user_login: 'testfollower' },
        'channel.subscribe':         { user_name: 'TestSubscriber', tier: '1000', is_gift: false },
        'channel.subscription.gift': { user_name: 'TestGifter',     total: 5 },
        'channel.cheer':             { user_name: 'TestCheerer',    bits: 1000, is_anonymous: false },
        'channel.raid':              { from_broadcaster_user_name: 'TestRaider', viewers: 42 },
      }

      const { io } = await import('../socket/io')
      if (!io) return reply.code(503).send({ ok: false, error: 'socket_unavailable' })
      const ns = io.of('/overlay')
      ns.to(`overlay:${request.params.id}`).emit('overlay:event', {
        kind:       'alert_box',
        eventType:  evtType,
        payload:    { event: FAKE[evtType], subscription: { type: evtType, test: true } },
        occurredAt: new Date().toISOString(),
      })

      return reply.send({ ok: true })
    },
  )

  // GET /overlay/goal/:token/state — public — état courant de la goal bar.
  // Calcule le `current` en live (helix ou COUNT/SUM streamer_events selon
  // goalType). Pas d'auth admin : le token EST l'auth.
  server.get<{ Params: { token: string } }>('/overlay/goal/:token/state', async (request, reply) => {
    const overlay = await findOverlayByToken(request.params.token)
    if (!overlay)                         return reply.code(404).send({ ok: false, error: 'not_found' })
    if (overlay.overlayType !== 'goal_bar') return reply.code(400).send({ ok: false, error: 'wrong_overlay_type' })
    const cfg   = withGoalBarDefaults(overlay.config)
    const state = await computeGoalBarState(cfg)
    return reply.send({ ok: true, state })
  })

  // GET /overlay/leaderboard/:token/state — public — top N viewers par
  // catégorie + période. Recalculé à chaque appel (pas de cache : la donnée
  // bouge à chaque event reçu, et le coût SQL reste bas sur les indexes
  // event_type + occurred_at qui existent déjà).
  server.get<{ Params: { token: string } }>('/overlay/leaderboard/:token/state', async (request, reply) => {
    const overlay = await findOverlayByToken(request.params.token)
    if (!overlay)                             return reply.code(404).send({ ok: false, error: 'not_found' })
    if (overlay.overlayType !== 'leaderboard') return reply.code(400).send({ ok: false, error: 'wrong_overlay_type' })
    const cfg   = withLeaderboardDefaults(overlay.config)
    const state = await computeLeaderboard(cfg)
    return reply.send({ ok: true, config: cfg, state })
  })

  // GET /overlay/ticker/:token/state — public — events initiaux + config pour
  // bootstrap d'un event_ticker. Les nouveaux events arrivent ensuite via
  // socket sur la room overlay-type:event_ticker (dispatch déjà existant pour
  // alert_box, on étend pour le ticker).
  server.get<{ Params: { token: string } }>('/overlay/ticker/:token/state', async (request, reply) => {
    const overlay = await findOverlayByToken(request.params.token)
    if (!overlay)                              return reply.code(404).send({ ok: false, error: 'not_found' })
    if (overlay.overlayType !== 'event_ticker') return reply.code(400).send({ ok: false, error: 'wrong_overlay_type' })
    const cfg    = withTickerDefaults(overlay.config)
    const events = await fetchTickerEvents(cfg, 30)
    return reply.send({ ok: true, config: cfg, events })
  })

  // GET /overlay/lookup/:token — public — bootstrap d'une overlay côté navigateur.
  // PAS d'auth admin parce que la page tourne dans OBS sur la machine du
  // streamer. Le token EST l'auth, et il donne uniquement le droit de lire la
  // config et de recevoir les events (rien d'écriture). Si revoked → 404.
  //
  // Selon le type d'overlay, on inclut un objet state initial pour que la
  // page puisse render quelque chose avant que les events socket arrivent
  // (ex: stream_timer a besoin du started_at de la session en cours).
  server.get<{ Params: { token: string } }>('/overlay/lookup/:token', async (request, reply) => {
    const overlay = await findOverlayByToken(request.params.token)
    if (!overlay) return reply.code(404).send({ ok: false, error: 'not_found' })

    let state: Record<string, unknown> | null = null

    if (overlay.overlayType === 'stream_timer') {
      const r = await db.query<{ started_at: string; ended_at: string | null }>(
        `SELECT started_at, ended_at FROM streamer_sessions
         WHERE provider = 'twitch'
         ORDER BY started_at DESC LIMIT 1`,
      ).catch(() => null)
      const s = r?.rows[0]
      state = {
        isLive:    !!(s && !s.ended_at),
        startedAt: s && !s.ended_at ? s.started_at : null,
      }
    }

    return reply.send({
      ok:      true,
      overlay: {
        id:          overlay.id,
        overlayType: overlay.overlayType,
        label:       overlay.label,
        config:      overlay.config,
        state,
      },
    })
  })

  // GET /stats  — admin only — totaux + séries journalières des events EventSub
  // sur les N derniers jours (default 7, max 30). Sert à alimenter les sparklines
  // du dashboard. Renvoie un bucket par jour (0 si aucun event ce jour-là) pour
  // que le frontend puisse render la série sans calcul ni gap.
  server.get<{ Querystring: { days?: string } }>('/stats', { preHandler: adminOnly }, async (request) => {
    const days = Math.min(Math.max(Number(request.query.days) || 7, 1), 30)
    const TRACKED_TYPES = [
      'channel.follow',
      'channel.subscribe',
      'channel.cheer',
      'channel.raid',
      'channel.chat.message',
    ] as const

    // Aggrégation : 1 row par (event_type, day) avec count.
    // Exclut les injections via POST /test-event (external_id préfixé 'test-')
    // pour que les stats reflètent l'activité Twitch réelle.
    const rows = await db.query<{ event_type: string; day: string; count: string }>(
      `SELECT event_type, DATE_TRUNC('day', occurred_at) AS day, COUNT(*)::text AS count
       FROM streamer_events
       WHERE provider = 'twitch'
         AND occurred_at >= NOW() - ($1::int || ' days')::interval
         AND event_type = ANY($2::text[])
         AND (external_id IS NULL OR external_id NOT LIKE 'test-%')
       GROUP BY event_type, day
       ORDER BY day ASC`,
      [days, TRACKED_TYPES as unknown as string[]],
    ).then(r => r.rows).catch(() => [] as { event_type: string; day: string; count: string }[])

    // Build : { event_type → { day_iso_yyyy_mm_dd → count } }
    const grouped: Record<string, Map<string, number>> = {}
    for (const t of TRACKED_TYPES) grouped[t] = new Map()
    for (const row of rows) {
      const dayKey = new Date(row.day).toISOString().slice(0, 10)
      grouped[row.event_type]?.set(dayKey, parseInt(row.count, 10) || 0)
    }

    // Génère les `days` derniers jours (ordre chronologique, plus ancien → plus récent)
    const dayKeys: string[] = []
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today)
      d.setUTCDate(d.getUTCDate() - i)
      dayKeys.push(d.toISOString().slice(0, 10))
    }

    const totals:  Record<string, number>   = {}
    const daily:   Record<string, number[]> = {}
    for (const t of TRACKED_TYPES) {
      const series = dayKeys.map(d => grouped[t]?.get(d) ?? 0)
      daily[t]  = series
      totals[t] = series.reduce((a, b) => a + b, 0)
    }

    return {
      periodDays: days,
      dayLabels:  dayKeys,
      totals,
      daily,
    }
  })

  // GET /health  — admin only — métriques live du Hub pour le dashboard
  // Compte la queue de chat outbound (Redis sorted set), les viewers Nodyx
  // liés à un Twitch, la date du dernier event reçu et l'état de la session
  // live en cours (s'il y en a une). Renvoyé en best-effort : si un metric
  // échoue, on retourne null sur ce champ plutôt que de casser le payload.
  server.get('/health', { preHandler: adminOnly }, async () => {
    const [
      chatQueueSize,
      linkedViewers,
      lastEvent,
      session,
    ] = await Promise.all([
      redis.zcard('streamer:chat:send_queue').catch(() => null),
      db.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM users WHERE twitch_id IS NOT NULL`
      ).then(r => r.rows[0]?.count ? parseInt(r.rows[0].count, 10) : 0).catch(() => null),
      db.query<{ occurred_at: string; event_type: string }>(
        `SELECT occurred_at, event_type FROM streamer_events
         WHERE provider = 'twitch' ORDER BY occurred_at DESC LIMIT 1`
      ).then(r => r.rows[0] ?? null).catch(() => null),
      db.query<{ id: string; started_at: string; ended_at: string | null }>(
        `SELECT id, started_at, ended_at FROM streamer_sessions
         WHERE provider = 'twitch' ORDER BY started_at DESC LIMIT 1`
      ).then(r => r.rows[0] ?? null).catch(() => null),
    ])

    return {
      chatQueueSize,
      linkedViewersCount: linkedViewers,
      lastEvent: lastEvent ? { eventType: lastEvent.event_type, occurredAt: lastEvent.occurred_at } : null,
      currentSession: session && !session.ended_at
        ? { id: session.id, startedAt: session.started_at, live: true }
        : session
          ? { id: session.id, startedAt: session.started_at, endedAt: session.ended_at, live: false }
          : null,
    }
  })

  // GET /setup-status  — admin only — diagnostic granulaire du Hub
  // Chaque check est indépendant : le streamer voit exactement quel point
  // bloque et quel anchor de la doc consulter. Statuts : ok | warning | down.
  server.get('/setup-status', { preHandler: adminOnly }, async () => {
    type CheckStatus = 'ok' | 'warning' | 'down'
    interface Check {
      id:        string
      label:     string
      status:    CheckStatus
      summary:   string
      fix:       string | null
      docAnchor: string | null
    }

    const checks: Check[] = []

    // ── Group 1: env vars ──
    const env = process.env
    const clientId     = (env.TWITCH_CLIENT_ID         ?? '').trim()
    const clientSecret = (env.TWITCH_CLIENT_SECRET     ?? '').trim()
    const oauthKey     = (env.STREAMER_OAUTH_KEY       ?? '').trim()
    const publicBase   = (env.STREAMER_PUBLIC_BASE     ?? '').trim()
    const redirectUri  = (env.STREAMER_OAUTH_REDIRECT_URI ?? '').trim()

    checks.push({
      id:        'env-client-id',
      label:     'TWITCH_CLIENT_ID configuré',
      status:    clientId ? 'ok' : 'down',
      summary:   clientId ? 'Client ID Twitch détecté dans .env' : 'Variable absente du fichier nodyx-core/.env',
      fix:       clientId ? null : 'Crée une application sur dev.twitch.tv/console/apps puis copie le "Client ID" dans nodyx-core/.env sous TWITCH_CLIENT_ID',
      docAnchor: 'prerequisites',
    })

    checks.push({
      id:        'env-client-secret',
      label:     'TWITCH_CLIENT_SECRET configuré',
      status:    clientSecret ? 'ok' : 'down',
      summary:   clientSecret ? 'Client Secret Twitch détecté' : 'Variable absente du fichier nodyx-core/.env',
      fix:       clientSecret ? null : 'Dans la même app Twitch (dev.twitch.tv/console/apps), clique "New Secret" et copie la valeur dans TWITCH_CLIENT_SECRET',
      docAnchor: 'prerequisites',
    })

    const oauthKeyOk = /^[0-9a-fA-F]{64}$/.test(oauthKey)
    checks.push({
      id:        'env-oauth-key',
      label:     'STREAMER_OAUTH_KEY au bon format (64 hex)',
      status:    !oauthKey ? 'down' : oauthKeyOk ? 'ok' : 'warning',
      summary:   !oauthKey     ? 'Clé de chiffrement AES-256-GCM absente' :
                  oauthKeyOk    ? 'Clé maître présente, 32 octets hex' :
                                  `Format invalide (${oauthKey.length} caractères, attendu 64)`,
      fix:       oauthKeyOk ? null : 'Génère une clé : node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))" puis colle-la dans STREAMER_OAUTH_KEY',
      docAnchor: 'prerequisites',
    })

    let publicBaseOk = false
    let publicBaseProto = ''
    try {
      const u = new URL(publicBase)
      publicBaseProto = u.protocol
      publicBaseOk = u.protocol === 'https:'
    } catch { /* invalid URL */ }
    checks.push({
      id:        'env-public-base',
      label:     'STREAMER_PUBLIC_BASE en HTTPS',
      status:    !publicBase ? 'down' : publicBaseOk ? 'ok' : 'down',
      summary:   !publicBase   ? 'Variable absente' :
                  publicBaseOk  ? `URL publique HTTPS détectée : ${publicBase}` :
                                  `Protocole "${publicBaseProto || 'inconnu'}" non supporté (Twitch livre uniquement sur HTTPS)`,
      fix:       publicBaseOk ? null : 'Définis STREAMER_PUBLIC_BASE=https://ton-instance.nodyx.org dans .env (HTTPS obligatoire, Twitch refuse HTTP pour EventSub)',
      docAnchor: 'prerequisites',
    })

    const redirectExpected = publicBase ? `${publicBase.replace(/\/+$/, '')}/api/v1/streamer/twitch/callback` : ''
    const redirectMatches  = !!redirectUri && !!redirectExpected && redirectUri === redirectExpected
    checks.push({
      id:        'env-redirect-uri',
      label:     'STREAMER_OAUTH_REDIRECT_URI cohérent',
      status:    !redirectUri ? 'down' : redirectMatches ? 'ok' : 'warning',
      summary:   !redirectUri    ? 'Variable absente' :
                  redirectMatches ? 'Match exact avec STREAMER_PUBLIC_BASE + path callback' :
                                    `Mismatch détecté : attendu "${redirectExpected || '?'}", obtenu "${redirectUri}"`,
      fix:       redirectMatches ? null : `Définis STREAMER_OAUTH_REDIRECT_URI=${redirectExpected || 'https://ton-instance.nodyx.org/api/v1/streamer/twitch/callback'} et reporte-la EXACTEMENT dans dev.twitch.tv/console/apps → "OAuth Redirect URLs"`,
      docAnchor: 'prerequisites',
    })

    // ── Group 2: connection ──
    const streamers = await listStreamers('twitch').catch(() => [])
    const primary = streamers[0] ?? null
    checks.push({
      id:        'oauth-connected',
      label:     'Compte Twitch lié',
      status:    primary ? 'ok' : 'warning',
      summary:   primary ? `Connecté en tant que ${primary.externalLogin}` : 'Aucun streamer connecté',
      fix:       primary ? null : 'Une fois tous les checks env verts, clique "Connecter Twitch" en haut de cette page',
      docAnchor: 'connecting-your-account',
    })

    // Token expiry
    if (primary) {
      const expiresInMs = new Date(primary.expiresAt).getTime() - Date.now()
      const expired = expiresInMs < 0
      const expiringSoon = expiresInMs >= 0 && expiresInMs < 30 * 60 * 1000
      checks.push({
        id:        'tokens-valid',
        label:     'Access token Twitch valide',
        status:    expired ? 'down' : expiringSoon ? 'warning' : 'ok',
        summary:   expired       ? 'Token expiré, refresh nécessaire' :
                    expiringSoon  ? 'Token expire dans moins de 30 min (refresh auto imminent)' :
                                    `Token valide, expire dans ${Math.round(expiresInMs / 60000)} min`,
        fix:       expired ? 'Clique "Refresh tokens" dans la carte streamer pour forcer un renouvellement immédiat' : null,
        docAnchor: 'when-to-use-which-action',
      })
    }

    // ── Group 3: EventSub ──
    if (primary) {
      const subsStatus = await listEventSubStatus('twitch').catch(() => ({ subscriptions: [] as Array<{ status: string }> }))
      const subs       = subsStatus.subscriptions ?? []
      const enabled    = subs.filter(s => s.status === 'enabled').length
      const failed     = subs.filter(s => s.status === 'failed').length
      const pending    = subs.filter(s => s.status === 'pending').length

      checks.push({
        id:        'eventsub-subscribed',
        label:     'EventSub : au moins une subscription active',
        status:    enabled > 0 ? 'ok' : subs.length === 0 ? 'down' : 'warning',
        summary:   enabled > 0
          ? `${enabled} subscription${enabled > 1 ? 's' : ''} active${enabled > 1 ? 's' : ''} sur ${subs.length}`
          : subs.length === 0
            ? 'Aucune subscription côté Twitch'
            : `${pending} en attente, aucune active pour l'instant`,
        fix:       enabled > 0 ? null : 'Clique "Synchroniser EventSub" dans la carte streamer pour (re)créer les subscriptions',
        docAnchor: 'when-to-use-which-action',
      })

      checks.push({
        id:        'eventsub-no-failed',
        label:     'EventSub : aucune subscription en échec',
        status:    failed === 0 ? 'ok' : 'down',
        summary:   failed === 0
          ? 'Aucune subscription failed'
          : `${failed} subscription${failed > 1 ? 's' : ''} en échec (Twitch n'a pas pu joindre ton webhook)`,
        fix:       failed === 0 ? null : 'Vérifie 1) que ton domaine répond en HTTPS depuis l\'internet public, 2) que ton reverse-proxy ne modifie pas le body du POST EventSub (Caddy par défaut OK), puis clique "Synchroniser EventSub"',
        docAnchor: 'troubleshooting',
      })
    }

    // ── Group 4: activity ──
    const lastEventRow = primary
      ? await db.query<{ occurred_at: string }>(
          `SELECT occurred_at FROM streamer_events WHERE provider = 'twitch' ORDER BY occurred_at DESC LIMIT 1`
        ).then(r => r.rows[0] ?? null).catch(() => null)
      : null
    if (primary) {
      const lastMs = lastEventRow ? Date.now() - new Date(lastEventRow.occurred_at).getTime() : null
      const STALE  = 7 * 24 * 60 * 60 * 1000  // 7 days
      checks.push({
        id:        'recent-activity',
        label:     'Pipeline actif (au moins 1 event reçu récemment)',
        status:    lastMs === null ? 'warning' : lastMs < STALE ? 'ok' : 'warning',
        summary:   lastMs === null
          ? 'Aucun event reçu depuis la connexion. Normal si tu viens de te connecter.'
          : lastMs < STALE
            ? `Dernier event il y a ${lastMs < 3600_000 ? Math.round(lastMs/60_000) + ' min' : lastMs < 86400_000 ? Math.round(lastMs/3_600_000) + ' h' : Math.round(lastMs/86_400_000) + ' j'}`
            : `Plus aucun event depuis ${Math.round(lastMs / 86_400_000)} jours. Le webhook EventSub est peut-être cassé.`,
        fix:       lastMs !== null && lastMs >= STALE
          ? 'Lance un test : choisis un type d\'event dans "Tester le pipeline" et clique "Injecter l\'event". Si l\'event apparaît dans le feed, le pipeline marche et c\'est Twitch qui ne pousse plus (synchronise EventSub).'
          : null,
        docAnchor: 'troubleshooting',
      })
    }

    // ── Overall ──
    const downCount    = checks.filter(c => c.status === 'down').length
    const warningCount = checks.filter(c => c.status === 'warning').length
    const overall: CheckStatus = downCount > 0 ? 'down' : warningCount > 0 ? 'warning' : 'ok'

    return { overall, checks, downCount, warningCount }
  })

  // POST /test-event  — admin only — injecte un faux event EventSub dans le
  // pipeline pour valider end-to-end (persistence + dispatch chat) sans avoir
  // à attendre un vrai follow. N'envoie RIEN à Twitch, c'est purement local.
  server.post<{ Body?: { eventType?: string } }>('/test-event', { preHandler: adminOnly }, async (request, reply) => {
    const type = (request.body?.eventType ?? 'channel.follow').trim()
    const ALLOWED = ['channel.follow', 'channel.subscribe', 'channel.cheer', 'channel.raid', 'stream.online']
    if (!ALLOWED.includes(type)) {
      return reply.code(400).send({ ok: false, error: 'unsupported_event_type', allowed: ALLOWED })
    }

    // Build a minimal-but-plausible payload per event type
    const ts = new Date().toISOString()
    const fakeEvent: Record<string, Record<string, unknown>> = {
      'channel.follow':    { user_id: '0', user_login: 'test_follower',   user_name: 'TestFollower',   followed_at: ts },
      'channel.subscribe': { user_id: '0', user_login: 'test_subscriber', user_name: 'TestSubscriber', tier: '1000', is_gift: false },
      'channel.cheer':     { user_id: '0', user_login: 'test_cheerer',    user_name: 'TestCheerer',    is_anonymous: false, message: 'Test cheer', bits: 42 },
      'channel.raid':      { from_broadcaster_user_id: '0', from_broadcaster_user_name: 'TestRaider', viewers: 17 },
      'stream.online':     { id: 'test', started_at: ts, type: 'live' },
    }

    try {
      await ingestEvent({
        provider:   'twitch',
        eventType:  type,
        payload:    { event: fakeEvent[type], subscription: { type, test: true } },
        externalId: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      return reply.send({ ok: true, eventType: type, persistedAt: ts })
    } catch (err) {
      return reply.code(500).send({ ok: false, error: 'ingest_failed', message: (err as Error).message })
    }
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
