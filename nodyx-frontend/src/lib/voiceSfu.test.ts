/**
 * Tests des parties PURES du client SFU (voiceSfu.ts).
 * Le flux complet (device/transports/média) se prouve dans le labo
 * /admin/sfu-lab avec de vrais navigateurs : ici on verrouille les garde-fous.
 */

import { describe, it, expect } from 'vitest'
import { looksLikeTransportParams } from './voiceSfu'

describe('looksLikeTransportParams (garde-fou avant mediasoup-client)', () => {
  const valid = {
    id: 'transport-1',
    iceParameters:  { usernameFragment: 'x', password: 'y' },
    iceCandidates:  [{ ip: '1.2.3.4' }],
    dtlsParameters: { fingerprints: [] },
  }

  it('accepte la forme complète', () => {
    expect(looksLikeTransportParams(valid)).toBe(true)
  })

  it('rejette null, string, tableau', () => {
    expect(looksLikeTransportParams(null)).toBe(false)
    expect(looksLikeTransportParams('{"id":"x"}')).toBe(false)
    expect(looksLikeTransportParams([])).toBe(false)
  })

  it('rejette chaque champ manquant', () => {
    for (const missing of ['id', 'iceParameters', 'iceCandidates', 'dtlsParameters'] as const) {
      const broken: Record<string, unknown> = { ...valid }
      delete broken[missing]
      expect(looksLikeTransportParams(broken), `sans ${missing}`).toBe(false)
    }
  })

  it('rejette iceCandidates non-tableau (poison sournois)', () => {
    expect(looksLikeTransportParams({ ...valid, iceCandidates: {} })).toBe(false)
  })
})
