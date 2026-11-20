// LA frontière entre le site (SvelteKit, rendu serveur) et le reste du monde : un
// appel qui porte le secret partagé INTERNAL_API_SECRET vient du site, et de lui seul
// (un client externe passe par Caddy et ne connaît pas le secret). Fail-closed : pas
// de secret configuré, aucun appel n'est « interne ». Partagé par la limitation de
// débit (rateLimit) et par l'adresse du visiteur (clientIp) depuis le 20/11/2026.
import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

export function isTrustedInternalCall(request: FastifyRequest): boolean {
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
