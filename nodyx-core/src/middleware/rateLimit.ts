import { FastifyRequest, FastifyReply } from 'fastify'
import { redis } from '../config/database'

const WINDOW_SECONDS = 60
const MAX_REQUESTS   = 100

// ── Middleware ───────────────────────────────────────────────

export async function rateLimit(request: FastifyRequest, reply: FastifyReply): Promise<void> {
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

  // For the rate-limit key, prefer the real client IP from trusted proxy headers.
  // NB: on a self-hosted instance with no Cloudflare, these headers are not
  // authenticated — hardening the key against a rotating X-Forwarded-For is a
  // separate, deployment-topology-dependent change (see the trustProxy note).
  const ip = (
    (request.headers['cf-connecting-ip'] as string) ||
    (request.headers['x-real-ip'] as string) ||
    (request.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
    socketPeer
  )

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
