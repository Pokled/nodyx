// ─── Streamer Hub — Twitch provider (Phase 1) ───────────────────────────────
// Implémentation `StreamerProvider` pour l'API Twitch (id.twitch.tv + Helix).
//
// Adapté du spike Phase 0 (validé bout-en-bout 2026-05-08), désormais branché
// sur l'interface commune pour permettre l'ajout d'autres providers en
// Phase 6+ sans refactor.

import {
  type StreamerProvider,
  type OAuthTokens,
  type ProviderUser,
  type CreatedSubscription,
  type ListedSubscription,
  ProviderError,
} from './_types'

const TWITCH_OAUTH = 'https://id.twitch.tv/oauth2'
const TWITCH_HELIX = 'https://api.twitch.tv/helix'

function clientId(): string {
  const v = process.env.STREAMER_TWITCH_CLIENT_ID
  if (!v) throw new Error('STREAMER_TWITCH_CLIENT_ID non défini (app Twitch dédiée au Streamer Hub)')
  return v
}

function clientSecret(): string {
  const v = process.env.STREAMER_TWITCH_CLIENT_SECRET
  if (!v) throw new Error('STREAMER_TWITCH_CLIENT_SECRET non défini')
  return v
}

async function helixGet<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${TWITCH_HELIX}${path}`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id':     clientId(),
    },
  })
  if (!res.ok) throw new ProviderError('twitch', res.status, await res.text(), `Helix GET ${path} failed`)
  return await res.json() as T
}

async function helixPost<T>(path: string, accessToken: string, body: unknown): Promise<T> {
  const res = await fetch(`${TWITCH_HELIX}${path}`, {
    method:  'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Client-Id':     clientId(),
      'Content-Type':  'application/json',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new ProviderError('twitch', res.status, await res.text(), `Helix POST ${path} failed`)
  return await res.json() as T
}

export const twitchProvider: StreamerProvider = {
  id:    'twitch',
  label: 'Twitch',

  buildAuthorizeUrl({ redirectUri, state, scopes, forceVerify }) {
    const params = new URLSearchParams({
      client_id:     clientId(),
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         scopes.join(' '),
      state,
    })
    if (forceVerify) params.set('force_verify', 'true')
    return `${TWITCH_OAUTH}/authorize?${params.toString()}`
  },

  async exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens> {
    const res = await fetch(`${TWITCH_OAUTH}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId(),
        client_secret: clientSecret(),
        code,
        grant_type:    'authorization_code',
        redirect_uri:  redirectUri,
      }),
    })
    if (!res.ok) throw new ProviderError('twitch', res.status, await res.text(), 'exchangeCode failed')
    const data = await res.json() as {
      access_token:  string
      refresh_token: string
      expires_in:    number
      scope:         string[] | undefined
    }
    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresIn:    data.expires_in,
      scopes:       data.scope ?? [],
    }
  },

  async refreshTokens(refreshToken: string): Promise<OAuthTokens> {
    const res = await fetch(`${TWITCH_OAUTH}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId(),
        client_secret: clientSecret(),
        grant_type:    'refresh_token',
        refresh_token: refreshToken,
      }),
    })
    if (!res.ok) throw new ProviderError('twitch', res.status, await res.text(), 'refreshTokens failed')
    const data = await res.json() as {
      access_token:  string
      refresh_token: string
      expires_in:    number
      scope:         string[] | undefined
    }
    return {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresIn:    data.expires_in,
      scopes:       data.scope ?? [],
    }
  },

  async getCurrentUser(accessToken: string): Promise<ProviderUser> {
    const data = await helixGet<{ data: Array<{ id: string; login: string; email?: string; display_name: string }> }>(
      '/users',
      accessToken,
    )
    if (!data.data.length) throw new ProviderError('twitch', 404, data, 'getCurrentUser empty data')
    const u = data.data[0]
    return {
      id:          u.id,
      login:       u.login,
      displayName: u.display_name,
      email:       u.email ?? null,
    }
  },

  async createEventSubscription({ accessToken, eventType, condition, callbackUrl, hmacSecret }): Promise<CreatedSubscription> {
    // Twitch exige version "1" pour la plupart des events (sauf channel.follow
    // qui est "2"). On laisse le caller fixer la version via condition.version
    // pour rester souple, mais le défaut est "1".
    const version = (condition as Record<string, string>).version ?? '1'
    const cleanCondition = { ...condition }
    delete (cleanCondition as Record<string, string>).version

    // Twitch wire format: { data: [{ id, status, type, version, condition, transport, ... }] }.
    // On mappe id → externalSubId pour la convention interne.
    const data = await helixPost<{ data: Array<{
      id:        string
      status:    string
      type:      string
      condition: Record<string, string>
    }> }>('/eventsub/subscriptions', accessToken, {
      type:    eventType,
      version,
      condition: cleanCondition,
      transport: {
        method:   'webhook',
        callback: callbackUrl,
        secret:   hmacSecret,
      },
    })
    if (!data.data.length) throw new ProviderError('twitch', 500, data, 'createEventSubscription empty response')
    const raw = data.data[0]
    return {
      externalSubId: raw.id,
      status:        raw.status,
      type:          raw.type,
      condition:     raw.condition,
    }
  },

  async deleteEventSubscription(appAccessToken: string, externalSubId: string): Promise<void> {
    const res = await fetch(`${TWITCH_HELIX}/eventsub/subscriptions?id=${encodeURIComponent(externalSubId)}`, {
      method:  'DELETE',
      headers: {
        'Authorization': `Bearer ${appAccessToken}`,
        'Client-Id':     clientId(),
      },
    })
    if (res.status !== 204) throw new ProviderError('twitch', res.status, await res.text(), 'deleteEventSubscription failed')
  },

  async listEventSubscriptions(appAccessToken: string): Promise<ListedSubscription[]> {
    const data = await helixGet<{
      data: Array<{
        id:        string
        type:      string
        version:   string
        status:    string
        condition: Record<string, string>
        transport: { method: string; callback?: string }
      }>
    }>('/eventsub/subscriptions', appAccessToken)
    return data.data.map(s => ({
      id:        s.id,
      type:      s.type,
      version:   s.version,
      status:    s.status,
      condition: s.condition,
      callback:  s.transport.callback ?? '',
    }))
  },

  async getAppAccessToken(): Promise<string> {
    const res = await fetch(`${TWITCH_OAUTH}/token`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     clientId(),
        client_secret: clientSecret(),
        grant_type:    'client_credentials',
      }),
    })
    if (!res.ok) throw new ProviderError('twitch', res.status, await res.text(), 'getAppAccessToken failed')
    const data = await res.json() as { access_token: string }
    return data.access_token
  },
}
