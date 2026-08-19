// ─── Une ancre ne doit pas mourir parce qu'on a changé un niveau de titre ────
//
// Le 2026-08-19, un rédacteur a passé deux titres de section de `h2` à `h1`
// depuis l'éditeur. TipTap avait correctement conservé leur `id`, mais la liste
// d'attributs de l'assainisseur ne l'autorisait que sur `h2`, `h3` et `h4`.
// L'attribut a donc été retiré à l'enregistrement, et deux entrées du sommaire
// pointaient dans le vide, SANS le moindre message.
//
// Perdre une ancre en silence est un piège, pas une protection.

import { describe, it, expect } from 'vitest'
import { sanitize } from '../utils/sanitize'

/** L'id survit-il à l'assainissement, pour ce niveau de titre ? */
const gardeId = (n: number) =>
  sanitize(`<h${n} id="section">Titre</h${n}>`).includes('id="section"')

describe("ancres de titres : les quatre niveaux se comportent pareil", () => {
  it("conserve l'id sur h1, le cas qui a cassé un sommaire en production", () => {
    expect(gardeId(1)).toBe(true)
  })

  it("conserve l'id sur h2, h3 et h4, comme avant", () => {
    for (const n of [2, 3, 4]) expect(gardeId(n), `h${n}`).toBe(true)
  })

  it("un sommaire survit au passage d'un titre de h2 à h1", () => {
    // Le scénario exact : le lien du sommaire et le titre doivent continuer de
    // se répondre après l'édition.
    const html = sanitize(
      '<div class="toc"><a href="#kaon">KAON</a></div><h1 id="kaon">KAON</h1>',
    )
    expect(html).toContain('href="#kaon"')
    expect(html).toContain('id="kaon"')
  })

  it('centre un titre sans lui faire perdre son ancre', () => {
    // L'auteur avait aussi centré ses titres : `style` et `id` doivent survivre
    // ensemble, sinon on répare un défaut en en laissant un autre.
    const html = sanitize('<h1 style="text-align:center" id="kaon">KAON</h1>')
    expect(html).toContain('id="kaon"')
    expect(html).toContain('text-align:center')
  })
})

describe("ancres de titres : ce qui reste refusé", () => {
  it("n'autorise pas l'id sur un élément quelconque", () => {
    // La raison d'être de la restriction d'origine : limiter le DOM clobbering.
    // Elle tient toujours partout ailleurs que sur les titres.
    expect(sanitize('<p id="x">t</p>')).not.toContain('id="x"')
    expect(sanitize('<div id="x">t</div>')).not.toContain('id="x"')
    expect(sanitize('<span id="x">t</span>')).not.toContain('id="x"')
  })
})
