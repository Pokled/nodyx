// ─── Un message supprimé disparaît du fil ──────────────────────────────────────
//
// Avant : sa ligne restait (avatar, nom, heure, « · message supprimé · ») et
// cassait le regroupement des messages de son auteur. Maintenant il disparaît,
// et ne laisse de trace que là où elle a un sens : dans la citation d'une
// réponse qui lui était adressée.

import { describe, it, expect } from 'vitest'
import { messagesVisibles, marquerSupprime } from './chatFil'

const msg = (id: string, extra: Record<string, unknown> = {}) => ({
  id, is_deleted: false, content: `texte ${id}`, reply_to_id: null as string | null, reply_to_content: null as string | null, ...extra,
})

describe('fil du chat', () => {
  it("n'affiche pas les messages supprimés", () => {
    const fil = [msg('a'), msg('b', { is_deleted: true, content: null }), msg('c')]
    expect(messagesVisibles(fil).map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('marque le message supprimé sans le retirer de la liste (le curseur d’historique en dépend)', () => {
    const fil = marquerSupprime([msg('a'), msg('b'), msg('c')], 'b')
    expect(fil.map((m) => m.id)).toEqual(['a', 'b', 'c'])
    expect(fil[1]).toMatchObject({ is_deleted: true, content: null })
  })

  it('vide la citation des réponses au message supprimé, qui affichent alors « message supprimé »', () => {
    const fil = marquerSupprime(
      [msg('a'), msg('r', { reply_to_id: 'a', reply_to_content: 'texte a' }), msg('x', { reply_to_id: 'z', reply_to_content: 'autre' })],
      'a',
    )
    expect(fil[1].reply_to_content).toBeNull()
    expect(fil[2].reply_to_content).toBe('autre')
  })

  it('le message suivant se regroupe de nouveau avec le précédent du même auteur', () => {
    const fil = marquerSupprime([msg('a'), msg('b'), msg('c')], 'b')
    const visibles = messagesVisibles(fil)
    expect(visibles.map((m) => m.id)).toEqual(['a', 'c'])
  })
})
