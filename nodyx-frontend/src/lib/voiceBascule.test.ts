/**
 * Tests de l'orchestrateur client de la bascule mesh↔SFU (voiceBascule.ts).
 * On mocke voiceSfu : on teste la COORDINATION (hold, confirmation, ordre du
 * commit zéro-coupure), pas la couche mediasoup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const { sfuJoin, sfuLeave, sfuActivatePlayback, sfuIsActive } = vi.hoisted(() => ({
  sfuJoin:             vi.fn(async () => {}),
  sfuLeave:            vi.fn(async () => {}),
  sfuActivatePlayback: vi.fn(),
  sfuIsActive:         vi.fn(() => true),
}))
vi.mock('./voiceSfu', () => ({ sfuJoin, sfuLeave, sfuActivatePlayback, sfuIsActive }))

import { basculeBeginSwitch, basculeJoinDirectSfu, basculeLeaveSfu, basculeCommit } from './voiceBascule'

beforeEach(() => { vi.clearAllMocks() })

describe('basculeBeginSwitch (cas A/C : bascule ou arrivée en switching)', () => {
  it('établit l\'SFU en HOLD, puis confirme voice:sfu_ready si actif', async () => {
    const emit = vi.fn()
    await basculeBeginSwitch({ emit }, 'chan-1')
    expect(sfuJoin).toHaveBeenCalledWith('chan-1', { holdPlayback: true })
    expect(emit).toHaveBeenCalledWith('voice:sfu_ready', { channelId: 'chan-1' })
  })

  it('ne confirme PAS si l\'établissement a échoué (le serveur abandonnera)', async () => {
    sfuIsActive.mockReturnValueOnce(false)
    const emit = vi.fn()
    await basculeBeginSwitch({ emit }, 'chan-1')
    expect(sfuJoin).toHaveBeenCalledWith('chan-1', { holdPlayback: true })
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('basculeJoinDirectSfu (cas B : arrivée sur un canal déjà SFU)', () => {
  it('rejoint l\'SFU en lecture immédiate (pas de hold)', async () => {
    await basculeJoinDirectSfu('chan-1')
    expect(sfuJoin).toHaveBeenCalledWith('chan-1')
  })
})

describe('basculeLeaveSfu (abandon / départ)', () => {
  it('quitte l\'SFU', async () => {
    await basculeLeaveSfu()
    expect(sfuLeave).toHaveBeenCalledTimes(1)
  })
})

describe('basculeCommit (l\'instant zéro-coupure)', () => {
  it('joue l\'SFU AVANT de couper puis démonter le mesh', () => {
    const order: string[] = []
    sfuActivatePlayback.mockImplementationOnce(() => order.push('sfu'))
    const meshMute = vi.fn((m: boolean) => order.push(`mute:${m}`))
    const meshTeardown = vi.fn(() => order.push('teardown'))

    basculeCommit(meshMute, meshTeardown)

    expect(meshMute).toHaveBeenCalledWith(true)
    expect(meshTeardown).toHaveBeenCalledTimes(1)
    // Ordre critique : SFU joue d'abord (relais pris), PUIS le mesh se tait et se démonte.
    expect(order).toEqual(['sfu', 'mute:true', 'teardown'])
  })
})
