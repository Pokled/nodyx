// L'adresse du visiteur à travers le rendu serveur (20/11/2026). Le site appelle le cœur
// via Caddy (127.0.0.1:3099), qui remplace X-Forwarded-For par 127.0.0.1 : aucune
// connexion ne laissait d'adresse publique (0 compte sur 168 bannissables par IP).
// L'en-tête x-nodyx-client-ip n'est cru QU'AVEC le secret interne.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { getClientIp } from '../utils/clientIp'

const SECRET = 'a'.repeat(64)
const req = (headers: Record<string, string>, peer = '127.0.0.1'): FastifyRequest =>
  ({ socket: { remoteAddress: peer }, ip: peer, headers } as unknown as FastifyRequest)

let old: string | undefined
beforeEach(() => { old = process.env.INTERNAL_API_SECRET; process.env.INTERNAL_API_SECRET = SECRET })
afterEach(() => { if (old === undefined) delete process.env.INTERNAL_API_SECRET; else process.env.INTERNAL_API_SECRET = old })

describe('l’adresse du visiteur transmise par le site', () => {
  it('avec le secret : l’adresse du visiteur, pas 127.0.0.1', () => {
    expect(getClientIp(req({ 'x-nodyx-internal': SECRET, 'x-nodyx-client-ip': '93.184.216.34', 'x-forwarded-for': '127.0.0.1' }))).toBe('93.184.216.34')
  })
  it('en IPv6 aussi', () => {
    expect(getClientIp(req({ 'x-nodyx-internal': SECRET, 'x-nodyx-client-ip': '2a00:1450:4007:80e::200e' }))).toBe('2a00:1450:4007:80e::200e')
  })
  it('SANS le secret, l’en-tête est ignoré : personne ne se choisit une adresse', () => {
    expect(getClientIp(req({ 'x-nodyx-client-ip': '93.184.216.34' }))).toBe('127.0.0.1')
  })
  it('avec un faux secret, ou un secret de la mauvaise longueur : ignoré', () => {
    for (const s of ['b'.repeat(64), 'a'.repeat(63), SECRET + 'x', ''])
      expect([s.length, getClientIp(req({ 'x-nodyx-internal': s, 'x-nodyx-client-ip': '93.184.216.34' }))]).toEqual([s.length, '127.0.0.1'])
  })
  it('aucun secret configuré sur l’instance : ignoré (fermé par défaut)', () => {
    delete process.env.INTERNAL_API_SECRET
    expect(getClientIp(req({ 'x-nodyx-internal': '', 'x-nodyx-client-ip': '93.184.216.34' }))).toBe('127.0.0.1')
  })
  it('une adresse interne transmise (127.0.0.1, 10.x, n’importe quoi) n’est pas retenue', () => {
    for (const ip of ['127.0.0.1', '10.0.0.4', '::1', 'pas-une-ip', '93.184.216.34, 1.2.3.4'])
      expect([ip, getClientIp(req({ 'x-nodyx-internal': SECRET, 'x-nodyx-client-ip': ip }))]).toEqual([ip, '127.0.0.1'])
  })
  it('un visiteur externe direct garde le chemin d’avant (Cloudflare)', () => {
    expect(getClientIp(req({ 'cf-connecting-ip': '151.101.1.69' }))).toBe('151.101.1.69')
  })
})
