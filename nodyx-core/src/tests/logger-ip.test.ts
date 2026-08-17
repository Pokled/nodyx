// ─── Les journaux du cœur doivent porter la VRAIE adresse du visiteur ────────
//
// Contexte mesuré le 2026-08-17, APRÈS le correctif #587. L'application
// connaissait la bonne adresse, mais ne la journalisait pas :
//
//     {"req":{"method":"GET","url":"/api/v1/...","remoteAddress":"127.0.0.1"}}
//
// Le sérialiseur par défaut de Fastify écrit `req.raw.socket.remoteAddress`,
// c'est-à-dire le proxy. Ces journaux étant la source prévue de la détection
// comportementale, les brancher en l'état n'aurait permis de bannir personne :
// le défaut se serait manifesté par « rien ne se déclenche jamais ».
//
// Ces tests tombent sur le sérialiseur par défaut. cf feedback_test_first_critical.

import { describe, it, expect } from 'vitest'
import type { FastifyRequest } from 'fastify'
import { buildLoggerOptions } from '../config/logger'

type Serialiseur = (v: unknown) => Record<string, unknown>

function serialiseurRequete(): Serialiseur {
  const opts = buildLoggerOptions() as { serializers: { req: Serialiseur } }
  return opts.serializers.req
}

function req(o: { peer?: string; ip?: string; headers?: Record<string, string> }): FastifyRequest {
  return {
    method: 'GET',
    url: '/api/v1/instance/info',
    socket: { remoteAddress: o.peer ?? '127.0.0.1' },
    ip: o.ip ?? o.peer ?? '127.0.0.1',
    headers: { host: 'nodyx.org', ...(o.headers ?? {}) },
  } as unknown as FastifyRequest
}

describe('journalisation : adresse du visiteur', () => {
  it("journalise l'adresse RÉELLE, pas celle de la socket", () => {
    const s = serialiseurRequete()(req({
      peer: '127.0.0.1',
      headers: { 'cf-connecting-ip': '103.78.255.128' },
    }))
    expect(s.ip).toBe('103.78.255.128')
  })

  it('conserve le pair TCP dans un champ SÉPARÉ', () => {
    // Vérité réseau et vérité applicative sont deux colonnes. Les fusionner,
    // c'est perdre la capacité de détecter une usurpation.
    const s = serialiseurRequete()(req({
      peer: '127.0.0.1',
      headers: { 'cf-connecting-ip': '103.78.255.128' },
    }))
    expect(s.peer).toBe('127.0.0.1')
    expect(s.ip).not.toBe(s.peer)
  })

  it("n'accepte pas une adresse annoncée par un pair non fiable", () => {
    const s = serialiseurRequete()(req({
      peer: '62.60.130.128',
      ip: '62.60.130.128',
      headers: { 'cf-connecting-ip': '1.2.3.4' },
    }))
    expect(s.ip).toBe('62.60.130.128')
  })

  it('signale les tentatives d\'usurpation comme empreinte d\'outillage', () => {
    // Mesure du 17/08 : 14 adresses envoient ces sept en-têtes ENSEMBLE, tous à
    // `127.0.0.1`, soit 1369 tentatives. Leur présence conjointe identifie un
    // outil mieux que l'adresse, qui change.
    const s = serialiseurRequete()(req({
      headers: {
        'x-originating-ip': '127.0.0.1',
        'x-client-ip': '127.0.0.1',
        'true-client-ip': '127.0.0.1',
        'x-forwared': '127.0.0.1',
      },
    })) as { headers: Record<string, string> }
    expect(s.headers._usurpation).toBeDefined()
    expect(s.headers._usurpation.split(',')).toHaveLength(4)
  })

  it('ne journalise NI corps, NI cookie, NI autorisation', () => {
    // Un journal de sécurité qui aspire les corps devient lui-même une fuite :
    // mots de passe en clair sur /auth/login, contenu de messages privés, jetons.
    const s = serialiseurRequete()(req({
      headers: {
        cookie: 'session=secret',
        authorization: 'Bearer jeton-secret',
        'user-agent': 'curl/8.0',
      },
    })) as { headers: Record<string, string>; body?: unknown }
    const brut = JSON.stringify(s)
    expect(brut).not.toContain('secret')
    expect(brut).not.toContain('jeton')
    expect(s.body).toBeUndefined()
    // L'agent, lui, est conservé : c'est un signal, pas une donnée sensible.
    expect(s.headers['user-agent']).toBe('curl/8.0')
  })

  it('borne la longueur des en-têtes conservés', () => {
    const s = serialiseurRequete()(req({ headers: { 'user-agent': 'A'.repeat(5000) } })) as {
      headers: Record<string, string>
    }
    expect(s.headers['user-agent'].length).toBeLessThanOrEqual(300)
  })
})
