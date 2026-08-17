// ─── L'adresse du visiteur derrière le tunnel Cloudflare ─────────────────────
//
// Contexte mesuré le 2026-08-17. Depuis le 2026-08-08 le trafic passe par un
// tunnel Cloudflare, qui envoie `CF-Connecting-IP` mais pas `X-Forwarded-For`.
// Fastify dérivant `request.ip` de X-Forwarded-For, il se rabattait sur le
// socket : `127.0.0.1` pour TOUS les visiteurs externes.
//
// Constaté en production avant correctif :
//   - `honeypot_hits` : 100 % de loopback depuis le 9 août
//   - UNE seule clé Redis, `nodyx:rate:127.0.0.1` : seau de limitation partagé
//     par tout Internet, donc 429 possible pour tout le site par un seul client
//
// Ces tests tombent sur le code d'avant le correctif. cf feedback_test_first_critical.

import { describe, it, expect } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { getClientIp, pairDeConfiance } from '../utils/clientIp'

/**
 * Requête minimale. `peer` est le VRAI pair TCP (infalsifiable), `ip` est ce que
 * Fastify aurait calculé depuis X-Forwarded-For contre la liste de confiance.
 */
function req(o: { peer?: string; ip?: string; headers?: Record<string, string> }): FastifyRequest {
  return {
    socket:  { remoteAddress: o.peer ?? '127.0.0.1' },
    ip:      o.ip ?? o.peer ?? '127.0.0.1',
    headers: o.headers ?? {},
  } as unknown as FastifyRequest
}

describe('pairDeConfiance', () => {
  it('accepte le loopback et les plages privées, où vivent nos proxys', () => {
    for (const p of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.0.0.5', '192.168.1.9', '172.16.4.2']) {
      expect(pairDeConfiance(p), p).toBe(true)
    }
  })

  it('accepte les plages Cloudflare', () => {
    expect(pairDeConfiance('162.158.1.1')).toBe(true)
    expect(pairDeConfiance('2a06:98c0:3600::103')).toBe(true)
  })

  it("refuse une adresse publique quelconque, et l'absence d'adresse", () => {
    expect(pairDeConfiance('62.60.130.128')).toBe(false)
    expect(pairDeConfiance('')).toBe(false)
    expect(pairDeConfiance(undefined)).toBe(false)
  })
})

describe("getClientIp — l'en-tête n'est cru que d'un proxy à nous", () => {
  it('LE DÉFAUT DU 8 AOÛT : tunnel Cloudflare, CF-Connecting-IP et pas de XFF', () => {
    // Exactement la requête observée en base : loopback en pair, aucun XFF, une
    // vraie adresse dans CF-Connecting-IP. Avant correctif on renvoyait
    // `127.0.0.1` et l'attaquant devenait invisible.
    const ip = getClientIp(req({
      peer: '127.0.0.1',
      ip:   '127.0.0.1',
      headers: { 'cf-connecting-ip': '103.78.255.128', 'cf-ipcountry': 'BD' },
    }))
    expect(ip).toBe('103.78.255.128')
  })

  it("IGNORE un CF-Connecting-IP forgé venant d'un pair non fiable", () => {
    // Un client qui joint le cœur en direct ne doit pas pouvoir se choisir une
    // adresse : sinon limitation, bannissements et pot de miel se contournent.
    const ip = getClientIp(req({
      peer: '62.60.130.128',
      ip:   '62.60.130.128',
      headers: { 'cf-connecting-ip': '1.2.3.4', 'x-real-ip': '5.6.7.8' },
    }))
    expect(ip).toBe('62.60.130.128')
  })

  it('refuse une adresse privée ou loopback lue dans un en-tête', () => {
    // Un en-tête annonçant du loopback ne désigne aucun visiteur d'Internet.
    for (const faux of ['127.0.0.1', '10.0.0.3', '192.168.0.1', '::1']) {
      const ip = getClientIp(req({ peer: '127.0.0.1', ip: '127.0.0.1', headers: { 'cf-connecting-ip': faux } }))
      expect(ip, faux).toBe('127.0.0.1')
    }
  })

  it("refuse une adresse Cloudflare : c'est notre infrastructure, pas un visiteur", () => {
    // Vu tel quel dans les données du 17/08.
    const ip = getClientIp(req({
      peer: '127.0.0.1', ip: '127.0.0.1',
      headers: { 'cf-connecting-ip': '2a06:98c0:3600::103' },
    }))
    expect(ip).toBe('127.0.0.1')
  })

  it('garde le chemin historique : X-Forwarded-For via request.ip', () => {
    // Instance sans tunnel, Caddy pose XFF, Fastify a déjà fait le travail.
    const ip = getClientIp(req({ peer: '127.0.0.1', ip: '81.10.20.30', headers: { 'x-forwarded-for': '81.10.20.30' } }))
    expect(ip).toBe('81.10.20.30')
  })

  it('prend la première adresse quand CF-Connecting-IP en contient plusieurs', () => {
    // NB : pas d'adresse en 203.0.113.x ici. C'est la plage de documentation
    // RFC 5737, que `ipaddr.js` classe « reserved » et que le garde-fou refuse
    // donc à juste titre. Il faut une adresse réellement routable.
    const ip = getClientIp(req({
      peer: '127.0.0.1', ip: '127.0.0.1',
      headers: { 'cf-connecting-ip': '45.83.12.7, 162.158.1.1' },
    }))
    expect(ip).toBe('45.83.12.7')
  })

  it('refuse les plages de documentation RFC 5737 dans un en-tête', () => {
    // Elles n'appartiennent à personne : les accepter reviendrait à polluer le
    // pot de miel et le blocage fédéré avec des adresses fictives.
    const ip = getClientIp(req({ peer: '127.0.0.1', ip: '127.0.0.1', headers: { 'cf-connecting-ip': '203.0.113.9' } }))
    expect(ip).toBe('127.0.0.1')
  })

  it("préserve l'appel interne du rendu serveur : loopback, aucun en-tête", () => {
    expect(getClientIp(req({ peer: '127.0.0.1', ip: '127.0.0.1' }))).toBe('127.0.0.1')
  })

  it('ne renvoie jamais de chaîne vide, la valeur sert de clé et de colonne', () => {
    expect(getClientIp(req({ peer: '', ip: '' }))).toBe('0.0.0.0')
  })

  it('DEUX visiteurs distincts donnent DEUX adresses distinctes', () => {
    // C'est ce test qui prouve la fin du seau de limitation unique : avant, les
    // deux valaient `127.0.0.1` et partageaient donc la clé `rate:127.0.0.1`.
    const a = getClientIp(req({ peer: '127.0.0.1', ip: '127.0.0.1', headers: { 'cf-connecting-ip': '103.78.255.128' } }))
    const b = getClientIp(req({ peer: '127.0.0.1', ip: '127.0.0.1', headers: { 'cf-connecting-ip': '62.60.130.128' } }))
    expect(a).not.toBe(b)
  })
})
