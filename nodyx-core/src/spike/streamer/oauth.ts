// ─── Streamer Hub spike — OAuth Twitch (streamer flow) ───────────────────────
// GET  /api/v1/streamer/twitch/auth     → redirige vers Twitch authorize
// GET  /api/v1/streamer/twitch/callback → reçoit code + state → échange tokens
//                                          puis déclenche subscribe stream.online
// GET  /api/v1/streamer/twitch/refresh  → force un refresh proactif (debug)
// GET  /api/v1/streamer/twitch/me       → liste les streamers connectés (debug)
//
// Spike-only : aucun JWT, aucun gate admin. Le user qui colle l'URL dans son
// navigateur EST le streamer qui se connecte. Phase 1 ajoutera adminOnly.

import type { FastifyPluginAsync } from 'fastify'
import {
  buildAuthorizeUrl,
  exchangeCode,
  refreshTokens,
  getCurrentUser,
  getAppAccessToken,
  createStreamOnlineSubscription,
  TwitchError,
} from './twitchClient'
import {
  createState,
  consumeState,
  saveTokens,
  getTokens,
  readRefreshToken,
  listAllStreamers,
  saveSubscription,
} from './store'
import { randomBytes } from 'node:crypto'

// Phase 0 utilise les scopes les plus larges qu'on aura besoin en Phase 1-2,
// pour valider que la consent screen ne pose pas de problème.
//
// §15.bis #2 résolu (spike 2026-05-08) : Twitch rejette `clips:read` avec
// "invalid scope requested" → ce scope n'existe pas. Pour lire les top clips
// (Helix GET /clips), un App Access Token suffit (pas besoin de scope user).
// On garde `clips:edit` pour Phase 5 quand on voudra créer des clips depuis
// Nodyx, mais pas en Phase 0.
const SCOPES_PHASE_0 = [
  'user:read:email',
  'user:read:chat',                  // EventSub Chat (§15.bis #1, à valider)
  'user:write:chat',                 // Helix Send Chat Message
  'channel:read:subscriptions',
  'bits:read',
  'moderator:read:followers',
  'channel:read:polls',
]

function redirectUri(): string {
  const v = process.env.STREAMER_OAUTH_REDIRECT_URI
  if (!v) throw new Error('STREAMER_OAUTH_REDIRECT_URI non défini')
  return v
}

function publicBase(): string {
  // Base publique pour construire les URLs de webhook EventSub.
  // Doit être l'URL HTTPS racine de l'instance, ex: https://nodyx.org
  const v = process.env.STREAMER_PUBLIC_BASE
  if (!v) throw new Error('STREAMER_PUBLIC_BASE non défini (ex: https://nodyx.org)')
  return v.replace(/\/+$/, '')
}

export const oauthPlugin: FastifyPluginAsync = async (server) => {
  // GET /auth — démarre le flow, redirige vers Twitch
  server.get('/auth', async (request, reply) => {
    const state = await createState(request.ip)
    const url = buildAuthorizeUrl({
      redirectUri: redirectUri(),
      state,
      scopes:      SCOPES_PHASE_0,
      forceVerify: true,  // toujours afficher consent screen pendant le spike
    })
    return reply.redirect(url, 302)
  })

  // GET /callback?code=...&state=... — Twitch revient ici
  server.get('/callback', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>

    if (q.error) {
      return reply.code(400).send({
        ok: false,
        stage: 'callback',
        error: q.error,
        description: q.error_description ?? null,
      })
    }
    if (!q.code || !q.state) {
      return reply.code(400).send({ ok: false, stage: 'callback', error: 'missing_code_or_state' })
    }

    const stateData = await consumeState(q.state)
    if (!stateData) {
      return reply.code(400).send({ ok: false, stage: 'state', error: 'invalid_or_expired_state' })
    }

    let tokens
    try {
      tokens = await exchangeCode(q.code, redirectUri())
    } catch (e) {
      const err = e as TwitchError
      return reply.code(502).send({
        ok: false, stage: 'exchange_code',
        twitchStatus: err.status, twitchBody: err.body,
      })
    }

    // Identify the streamer
    let user
    try {
      user = await getCurrentUser(tokens.accessToken)
    } catch (e) {
      const err = e as TwitchError
      return reply.code(502).send({
        ok: false, stage: 'get_user',
        twitchStatus: err.status, twitchBody: err.body,
      })
    }

    saveTokens({
      externalId:    user.id,
      externalLogin: user.login,
      scopes:        tokens.scopes,
      expiresAt:     Date.now() + tokens.expiresIn * 1000,
      accessToken:   tokens.accessToken,
      refreshToken:  tokens.refreshToken,
    })

    // Souscrire stream.online (canary EventSub) avec un App Access Token
    // (Twitch exige App token pour subscribe, pas user token).
    let subscription
    try {
      const appToken   = await getAppAccessToken()
      const hmacSecret = randomBytes(32).toString('base64url').slice(0, 64)  // 64 ASCII chars

      const sub = saveSubscription({
        externalSubId: 'pending',  // Twitch nous renverra l'ID, on le mettra à jour
        eventType:     'stream.online',
        hmacSecret,
        status:        'pending',
      })
      const callbackUrl = `${publicBase()}/api/v1/integrations/twitch/eventsub/${sub.callbackNonce}`

      subscription = await createStreamOnlineSubscription({
        appAccessToken: appToken,
        broadcasterId:  user.id,
        callbackUrl,
        hmacSecret,
      })

      // saveSubscription a déjà persisté le secret + nonce ; on enrichit l'objet
      sub.externalSubId = subscription.id
      sub.status        = (subscription.status === 'webhook_callback_verification_pending') ? 'pending' : 'enabled'
      request.log.info({ subId: subscription.id, status: subscription.status, callbackUrl }, 'EventSub subscribed')
    } catch (e) {
      const err = e as TwitchError
      return reply.code(502).send({
        ok: false, stage: 'subscribe_eventsub',
        twitchStatus: err.status, twitchBody: err.body,
        // L'OAuth a réussi, le subscribe a échoué. On laisse les tokens en mémoire
        // pour que /me et /refresh puissent quand même valider leur partie.
      })
    }

    return reply.send({
      ok: true,
      streamer: {
        externalId:    user.id,
        externalLogin: user.login,
        displayName:   user.displayName,
        email:         user.email,
        scopesGranted: tokens.scopes,
      },
      eventSub: {
        subscriptionId: subscription.id,
        status:         subscription.status,
        type:           subscription.type,
      },
      next: 'Lance ton stream Twitch — le webhook stream.online sera reçu ici (logs nodyx-core).',
    })
  })

  // GET /refresh?id={externalId} — déclenche un refresh manuel pour ce streamer
  server.get('/refresh', async (request, reply) => {
    const q = request.query as Record<string, string | undefined>
    if (!q.id) return reply.code(400).send({ error: 'param id manquant' })

    const stored = getTokens(q.id)
    if (!stored) return reply.code(404).send({ error: 'streamer non connecté' })

    try {
      const refreshed = await refreshTokens(readRefreshToken(stored))
      saveTokens({
        externalId:    stored.externalId,
        externalLogin: stored.externalLogin,
        scopes:        refreshed.scopes,
        expiresAt:     Date.now() + refreshed.expiresIn * 1000,
        accessToken:   refreshed.accessToken,
        refreshToken:  refreshed.refreshToken,
      })
      return reply.send({
        ok: true,
        externalLogin: stored.externalLogin,
        newExpiresAt:  new Date(Date.now() + refreshed.expiresIn * 1000).toISOString(),
        scopes:        refreshed.scopes,
      })
    } catch (e) {
      const err = e as TwitchError
      return reply.code(502).send({
        ok: false, stage: 'refresh',
        twitchStatus: err.status, twitchBody: err.body,
      })
    }
  })

  // GET /me — liste les streamers en mémoire (debug spike)
  server.get('/me', async () => {
    return { streamers: listAllStreamers() }
  })
}
