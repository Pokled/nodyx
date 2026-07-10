/**
 * Tests de l'orchestrateur client de la bascule mesh↔SFU (voiceBascule.ts).
 * On mocke voiceSfu : on teste la COORDINATION (lecture immédiate + crossfade par
 * personne, confirmation, teardown au commit), pas la couche mediasoup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sfuJoin, sfuLeave, sfuIsActive, sfuSetConsumerPlayingCallback, sfuCollectStats } = vi.hoisted(() => ({
  sfuJoin:                       vi.fn(async () => {}),
  sfuLeave:                      vi.fn(async () => {}),
  sfuIsActive:                   vi.fn(() => true),
  sfuSetConsumerPlayingCallback: vi.fn(),
  sfuCollectStats:               vi.fn(async () => ({ rtt: null, connType: 'unknown', perUser: new Map() })),
}))
vi.mock('./voiceSfu', () => ({ sfuJoin, sfuLeave, sfuIsActive, sfuSetConsumerPlayingCallback, sfuCollectStats }))

import { basculeBeginSwitch, basculeJoinDirectSfu, basculeLeaveSfu, basculeCommit } from './voiceBascule'

beforeEach(() => { vi.clearAllMocks() })

describe('basculeBeginSwitch (cas A/C : bascule ou arrivée en switching)', () => {
  it('enregistre le callback crossfade, joue tout de suite, puis confirme si actif', async () => {
    const emit = vi.fn()
    const cross = vi.fn()
    await basculeBeginSwitch({ emit }, 'chan-1', cross)
    expect(sfuSetConsumerPlayingCallback).toHaveBeenCalledWith(cross)  // coupe le mesh par personne
    expect(sfuJoin).toHaveBeenCalledWith('chan-1')                     // lecture immédiate (pas de hold)
    expect(emit).toHaveBeenCalledWith('voice:sfu_ready', { channelId: 'chan-1' })
  })

  it('ne confirme PAS si l\'établissement a échoué (le serveur abandonnera)', async () => {
    sfuIsActive.mockReturnValueOnce(false)
    const emit = vi.fn()
    await basculeBeginSwitch({ emit }, 'chan-1', vi.fn())
    expect(sfuJoin).toHaveBeenCalledWith('chan-1')
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('basculeJoinDirectSfu (cas B : arrivée sur un canal déjà SFU)', () => {
  it('rejoint l\'SFU directement', async () => {
    await basculeJoinDirectSfu('chan-1')
    expect(sfuJoin).toHaveBeenCalledWith('chan-1')
  })
})

describe('basculeLeaveSfu (abandon / départ)', () => {
  it('oublie le callback puis quitte l\'SFU', async () => {
    await basculeLeaveSfu()
    expect(sfuSetConsumerPlayingCallback).toHaveBeenCalledWith(null)
    expect(sfuLeave).toHaveBeenCalledTimes(1)
  })
})

describe('basculeCommit (finalisation)', () => {
  it('oublie le callback, coupe un résidu mesh, puis démonte les PC', () => {
    const order: string[] = []
    const meshMute = vi.fn((m: boolean) => order.push(`mute:${m}`))
    const meshTeardown = vi.fn(() => order.push('teardown'))

    basculeCommit(meshMute, meshTeardown)

    expect(sfuSetConsumerPlayingCallback).toHaveBeenCalledWith(null)
    expect(order).toEqual(['mute:true', 'teardown'])  // coupe le résidu avant de démonter
  })
})
