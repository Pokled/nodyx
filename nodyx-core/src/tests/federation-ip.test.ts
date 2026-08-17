// ─── Le blocage federe ne doit pas casser les instances des autres ───────────
//
// CONTEXTE. La migration 113 pose une contrainte CHECK refusant les adresses
// privees dans `reported_ips` — il y en avait 102 sur 118, du bruit distribue a
// tout le reseau.
//
// MAIS l'insertion n'etait pas protegee. Une instance TIERCE signalant du
// `127.0.0.1` recevait donc une erreur 500. Et le cas est reel : toute instance
// tournant une version anterieure au correctif d'identification du 2026-08-17
// enregistre `127.0.0.1` pour ses visiteurs. Au moins sept instances existent
// dans l'annuaire, dont une active le jour meme.
//
// Casser l'instance de quelqu'un d'autre avec une contrainte posee chez soi est
// exactement ce qu'un projet federe ne doit pas faire.

import { describe, it, expect } from 'vitest'
import { estPubliquementRoutable } from '../utils/clientIp'

describe('signalement federe : quelles adresses sont acceptables', () => {
  it('refuse ce qu une instance mal configuree enverrait', () => {
    // Ce sont les valeurs REELLEMENT observees avant correctif.
    for (const ip of ['127.0.0.1', '::1', '10.0.0.5', '192.168.1.9', '172.16.4.2', 'fe80::1']) {
      expect(estPubliquementRoutable(ip), ip).toBe(false)
    }
  })

  it('refuse une adresse Cloudflare : notre propre infrastructure', () => {
    // Vue telle quelle dans les donnees du 17/08, remontee comme un client.
    expect(estPubliquementRoutable('2a06:98c0:3600::103')).toBe(false)
    expect(estPubliquementRoutable('162.158.1.1')).toBe(false)
  })

  it('refuse les plages de documentation, qui n appartiennent a personne', () => {
    expect(estPubliquementRoutable('203.0.113.9')).toBe(false)
    expect(estPubliquementRoutable('198.51.100.4')).toBe(false)
  })

  it('accepte une vraie adresse d attaquant', () => {
    // Observees dans le pot de miel le 17/08.
    for (const ip of ['103.78.255.128', '62.60.130.128', '91.92.241.196', '2a01:4f8:1c19:a30c::1']) {
      expect(estPubliquementRoutable(ip), ip).toBe(true)
    }
  })
})
