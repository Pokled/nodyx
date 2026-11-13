/**
 * « Retirer la carte » / « Lien simple » : l'auteur marque un lien data-card="off".
 * Le nettoyeur doit garder EXACTEMENT cette valeur, partout (forum et chat), et rien d'autre.
 */
import { describe, it, expect } from 'vitest'
import { sanitize } from '../utils/sanitize'
import { sanitizeChat } from '../utils/chatSanitize'

describe('data-card sur un lien', () => {
  for (const [nom, clean] of [['forum', sanitize], ['chat', sanitizeChat]] as const) {
    it(`${nom} : data-card="off" est gardé`, () => {
      expect(clean('<p><a href="/calendar/x" data-card="off">soirée</a></p>')).toContain('data-card="off"')
    })
    it(`${nom} : toute autre valeur est retirée, le lien reste`, () => {
      const out = clean('<p><a href="/calendar/x" data-card="on">soirée</a> <a href="/forum/a/b" data-card="javascript:x">b</a></p>')
      expect(out).not.toContain('data-card')
      expect(out).toContain('href="/calendar/x"')
    })
    it(`${nom} : data-card ailleurs que sur un lien est retiré`, () => {
      expect(clean('<p data-card="off">x</p>')).not.toContain('data-card')
    })
  }
  it('le chat garde toujours ses titres SANS id (la copie des attributs n’a rien cassé)', () => {
    expect(sanitizeChat('<h2 id="chat-input">t</h2>')).not.toContain('id=')
    expect(sanitize('<h2 id="plan">t</h2>')).toContain('id="plan"')
  })
})
