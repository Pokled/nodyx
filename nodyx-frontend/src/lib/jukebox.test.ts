// ─── Jukebox : quelle action appliquer au lecteur ────────────────────────────
//
// Ces tests existent à cause d'un bug qui a tenu des mois en production, et que
// personne ne pouvait voir : la décision était noyée dans les effets de bord.
//
// `_applyState` écrivait le store, PUIS relisait ce même store pour savoir quel
// morceau jouait « avant ». `prev` et `state` étaient donc le même objet, la
// comparaison de videoId se faisait entre une valeur et elle-même et valait
// toujours vrai. La branche qui appelle `loadVideoById` chez un auditeur était
// donc du CODE MORT : son lecteur recevait `seekTo` et `playVideo` sans avoir
// jamais reçu de vidéo. Symptôme vécu : le titre s'affiche, le silence règne.
//
// Le cas n°1 ci-dessous échoue sur le code d'avant. C'est lui qui compte.
// cf feedback_test_first_critical

import { describe, it, expect } from 'vitest'
import { decideJukeboxAction, JUKEBOX_DRIFT_TOLERANCE, type JukeboxState } from './jukebox'

/** Un état de lecture minimal, surchargeable. */
function state(over: Partial<JukeboxState> = {}): JukeboxState {
  return {
    track:    { videoId: 'aaa', title: 'Piste A', addedBy: 'pokled' },
    playing:  true,
    position: 0,
    syncedAt: 0,
    duration: 180,
    queue:    [],
    history:  [],
    repeat:   'none',
    shuffle:  false,
    ...over,
  }
}

describe('decideJukeboxAction', () => {
  it("charge la video quand le lecteur est vide (le bug qui rendait l'auditeur muet)", () => {
    // Exactement le cas de la 2e personne : elle reçoit l'état, son lecteur n'a
    // rien. Avant le correctif on tombait dans « même vidéo » et on faisait
    // seekTo/playVideo sur un lecteur vide : aucun son, pour toujours.
    const action = decideJukeboxAction(null, 0, state(), 0)
    expect(action).toEqual({ kind: 'load', videoId: 'aaa', at: 0, play: true })
  })

  it('charge la nouvelle vidéo quand la piste change', () => {
    const action = decideJukeboxAction('aaa', 42, state({ track: { videoId: 'bbb', title: 'Piste B', addedBy: 'x' } }), 0)
    expect(action).toEqual({ kind: 'load', videoId: 'bbb', at: 0, play: true })
  })

  it('resynchronise quand la dérive dépasse la tolérance', () => {
    const action = decideJukeboxAction('aaa', 10, state(), 13)
    expect(action).toEqual({ kind: 'seek', at: 13, play: true })
  })

  it('ne resynchronise PAS pour une dérive sous la tolérance', () => {
    const drift  = JUKEBOX_DRIFT_TOLERANCE / 2
    const action = decideJukeboxAction('aaa', 10, state(), 10 + drift)
    expect(action).toEqual({ kind: 'play' })
  })

  it('met en pause quand l\'état partagé est en pause', () => {
    const action = decideJukeboxAction('aaa', 10, state({ playing: false }), 10)
    expect(action).toEqual({ kind: 'pause' })
  })

  it('arrête le lecteur quand il n\'y a plus de piste', () => {
    const action = decideJukeboxAction('aaa', 10, state({ track: null }), 0)
    expect(action).toEqual({ kind: 'stop' })
  })

  it('recharge si le lecteur a perdu sa video en cours de route (auto-reparation)', () => {
    // Le lecteur peut être recréé ou vidé (remontage du composant). On ne veut
    // pas jouer dans le vide en silence : on recharge.
    const action = decideJukeboxAction(null, 0, state({ position: 30, playing: true }), 30)
    expect(action).toEqual({ kind: 'load', videoId: 'aaa', at: 30, play: true })
  })
})
