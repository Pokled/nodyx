import { FastifyRequest, FastifyReply } from 'fastify'
import { timingSafeEqual } from 'crypto'
import { redis } from '../config/database'

const WINDOW_SECONDS = 60
const MAX_REQUESTS   = 100

// Appel interne de confiance : le SSR du frontend rend une page en tirant ~8
// requêtes core (layout + page), et injecte le X-Forwarded-For du visiteur pour
// alimenter bans/inscriptions. Comptées au nom du visiteur, ces ~8 requêtes/page
// épuisent son quota en ~12 pages -> 429 -> le loader SSR renvoie une page vide
// (incident cyclique du 2026-08-08). On exempte donc les appels qui portent un
// secret partagé connu du seul frontend. C'est LA frontière : un client externe
// passe par Caddy et ne connaît pas le secret. Fail-closed : pas de secret
// configuré = pas de bypass (l'ancien bypass loopback ci-dessous prend le relais).
function isTrustedInternalCall(request: FastifyRequest): boolean {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return false
  const provided = request.headers['x-nodyx-internal']
  if (typeof provided !== 'string' || provided.length === 0) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(secret)
  // timingSafeEqual exige des tampons de même taille. Court-circuiter sur la
  // longueur ne fuit rien d'exploitable : la longueur du secret n'est pas secrète.
  return a.length === b.length && timingSafeEqual(a, b)
}

// ── Middleware ───────────────────────────────────────────────

export async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  // Appels internes du frontend (SSR), authentifiés par secret partagé : exemptés.
  // Sans cette exemption, un visiteur qui navigue casse le site (429 en cascade).
  if (isTrustedInternalCall(request)) return

  // Bypass ONLY genuine internal traffic: SvelteKit SSR calling the core
  // directly over loopback. That path adds no forwarding header, while Caddy
  // adds one to every proxied external request. So "loopback socket AND no
  // forwarding header" is the only combination an external attacker cannot
  // reproduce, and it is what we key the bypass on.
  //
  // The previous version checked `request.ip`, believing it socket-level. It is
  // NOT: under Fastify `trustProxy: true`, request.ip is derived from
  // X-Forwarded-For, so `X-Forwarded-For: 127.0.0.1` made request.ip loopback
  // and disabled rate limiting entirely. We now read the true TCP peer from the
  // socket, which a header cannot forge.
  const socketPeer = request.socket?.remoteAddress ?? ''
  const isLoopbackPeer =
    socketPeer === '127.0.0.1' || socketPeer === '::1' || socketPeer === '::ffff:127.0.0.1'
  const hasForwardingHeader = !!(
    request.headers['x-forwarded-for'] ||
    request.headers['x-real-ip'] ||
    request.headers['cf-connecting-ip']
  )
  if (isLoopbackPeer && !hasForwardingHeader) return

  // Clé = request.ip, calculé par Fastify contre la liste de proxys de confiance
  // (loopback + privé + Cloudflare, cf config/trustedProxies.ts). C'est la vraie
  // adresse du visiteur, qu'un X-Forwarded-For usurpé ne peut plus détourner :
  // les fausses lignes de l'attaquant sont à gauche du dernier proxy de
  // confiance et sont ignorées. On ne lit donc plus d'en-tête brut ici.
  const ip = request.ip || socketPeer

  const key = `rate:${ip}`

  const count = await redis.incr(key)

  if (count === 1) {
    // First request in this window — set the expiry
    await redis.expire(key, WINDOW_SECONDS)
  }

  if (count > MAX_REQUESTS) {
    const ttl = await redis.ttl(key)
    reply.header('Retry-After', String(ttl))
    return reply.code(429).send({
      error: `Too many requests — limit is ${MAX_REQUESTS} per minute`,
      code:  'RATE_LIMITED',
    })
  }

  reply.header('X-RateLimit-Limit',     String(MAX_REQUESTS))
  reply.header('X-RateLimit-Remaining', String(Math.max(0, MAX_REQUESTS - count)))
}
