import { describe, it, expect, beforeEach } from 'vitest'
import { firstExternalLink } from '../utils/firstExternalLink'

const E = '33333333-3333-4333-8333-333333333333'
beforeEach(() => { process.env.FRONTEND_URL = 'https://communaute.example'; delete process.env.SELF_URL; delete process.env.PUBLIC_API_URL })

describe('le lien dont un statut garde un aperçu', () => {
  it('un lien externe : gardé (comportement inchangé)', () => {
    expect(firstExternalLink('<p>Vu <a href="https://example.org/a?x=1&amp;y=2">ici</a></p>')).toBe('https://example.org/a?x=1&y=2')
  })
  it('un lien Nodyx en premier : sauté, le lien externe suivant est pris', () => {
    expect(firstExternalLink(`<p><a href="https://communaute.example/calendar/${E}">soirée</a> et <a href="https://example.org/b">b</a></p>`)).toBe('https://example.org/b')
  })
  it('seulement des liens Nodyx : aucun aperçu figé (la carte vivante suffit)', () => {
    expect(firstExternalLink(`<p><a href="https://communaute.example/forum/jeux/quokka-ab12">sujet</a></p>`)).toBeNull()
  })
  it('une page de l’instance qui n’a pas de carte (profil…) garde son aperçu comme avant', () => {
    expect(firstExternalLink('<p><a href="https://communaute.example/users/lea">Léa</a></p>')).toBe('https://communaute.example/users/lea')
  })
  it('pas de lien : null', () => {
    expect(firstExternalLink('<p>bonjour</p>')).toBeNull()
  })
})
