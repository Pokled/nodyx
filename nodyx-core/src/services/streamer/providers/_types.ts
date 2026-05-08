// ─── Streamer Hub — interface provider ───────────────────────────────────────
// Cette interface est implémentée par chaque provider (Twitch en Phase 1,
// Owncast / PeerTube / YouTube Live / Kick possibles plus tard sans toucher
// au moteur Streamer Hub). Voir spec §2.2.

export type ProviderId = 'twitch' | 'owncast' | 'peertube' | 'youtube' | 'kick'

export interface OAuthTokens {
  accessToken:  string
  refreshToken: string
  expiresIn:    number   // seconds
  scopes:       string[]
}

export interface ProviderUser {
  id:          string
  login:       string
  displayName: string
  email:       string | null
}

export interface CreatedSubscription {
  externalSubId: string
  status:        string
  type:          string
  condition:     Record<string, string>
}

export interface StreamerProvider {
  readonly id:    ProviderId
  readonly label: string

  // ── OAuth flow (streamer login) ────────────────────────────────────────────
  buildAuthorizeUrl(args: {
    redirectUri: string
    state:       string
    scopes:      string[]
    forceVerify?: boolean
  }): string

  exchangeCode(code: string, redirectUri: string): Promise<OAuthTokens>

  refreshTokens(refreshToken: string): Promise<OAuthTokens>

  getCurrentUser(accessToken: string): Promise<ProviderUser>

  // ── EventSub / webhooks subscription management ────────────────────────────
  // accessToken peut être un app access token OU un user access token, selon
  // les exigences de l'event :
  //   - app token : events qui ne demandent pas de scope user (follow, raid,
  //     stream.online, poll.*, etc. quand user_id n'est pas dans la condition)
  //   - user token : events qui exigent un scope user_id avec scope spécifique
  //     (ex: channel.chat.message → user_id avec user:read:chat)
  createEventSubscription(args: {
    accessToken:    string
    eventType:      string
    condition:      Record<string, string>
    callbackUrl:    string
    hmacSecret:     string
  }): Promise<CreatedSubscription>

  deleteEventSubscription(appAccessToken: string, externalSubId: string): Promise<void>

  // Liste les subscriptions actives côté provider. Utilisé pour dédupliquer
  // un re-sync : si une sub matche déjà (type, version, condition), on skip.
  listEventSubscriptions(appAccessToken: string): Promise<ListedSubscription[]>

  // App Access Token (client_credentials grant) — utilisé pour les opérations
  // qui ne dépendent pas d'un user spécifique.
  getAppAccessToken(): Promise<string>
}

export interface ListedSubscription {
  id:        string
  type:      string
  version:   string
  status:    string
  condition: Record<string, string>
  callback:  string  // transport.callback URL
}

// ── Erreur unifiée pour les providers ────────────────────────────────────────
export class ProviderError extends Error {
  constructor(
    public readonly providerId: ProviderId,
    public readonly status:     number,
    public readonly body:       unknown,
    message: string,
  ) {
    super(`[${providerId}] ${message}`)
    this.name = 'ProviderError'
  }
}
