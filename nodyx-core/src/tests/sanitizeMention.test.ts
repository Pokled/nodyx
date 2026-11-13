import { describe, it, expect } from 'vitest'
import { sanitize } from '../utils/sanitize'
import { sanitizeChat } from '../utils/chatSanitize'

const A = '11111111-1111-4111-8111-111111111111'
describe('data-mention dans le nettoyeur (forum et chat)', () => {
  for (const [nom, clean] of [['forum', sanitize], ['chat', sanitizeChat]] as const) {
    it(`${nom} : une personne ou un groupe connu est gardé`, () => {
      expect(clean(`<p><span data-mention="u:${A}">@Léa</span></p>`)).toContain(`data-mention="u:${A}"`)
      expect(clean(`<p><span data-mention="g:ici">@ici</span></p>`)).toContain('data-mention="g:ici"')
      expect(clean(`<p><span data-mention="g:grade:${A}">@x</span></p>`)).toContain(`data-mention="g:grade:${A}"`)
    })
    it(`${nom} : toute autre valeur est retirée, le texte reste`, () => {
      for (const v of ['u:pas-un-id', 'g:everyone', 'javascript:x', `u:${A} `, '']) {
        const out = clean(`<p><span data-mention="${v}">@x</span></p>`)
        expect(out).not.toContain('data-mention')
        expect(out).toContain('@x')
      }
    })
  }
})
