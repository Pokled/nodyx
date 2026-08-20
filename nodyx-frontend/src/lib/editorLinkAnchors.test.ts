// ─── Une ancre interne ne doit pas s'ouvrir dans un onglet ───────────────────
//
// Le 2026-08-19, un rédacteur a rouvert un article dans l'éditeur. Les liens de
// son sommaire en sont ressortis ainsi :
//
//     <a target="_blank" rel="noopener noreferrer nofollow" href="#parcours">
//
// Cliquer une entrée du sommaire ouvrait donc un onglet VIDE au lieu de
// descendre dans la page. Tout sommaire éditable était cassé dès la première
// réouverture.
//
// La cause n'est pas une faute de frappe : c'est le DÉFAUT de l'extension Link,
// appliqué sans distinguer la destination du lien.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import Link from '@tiptap/extension-link'

const COMPOSANT = new URL('./components/editor/NodyxEditor.svelte', import.meta.url).pathname
const src = readFileSync(COMPOSANT, 'utf-8')

describe("le danger vient du paquet, pas de notre code", () => {
  it("l'extension Link ouvre TOUT dans un onglet par défaut", () => {
    // La démonstration du piège : ces attributs sont posés sur chaque lien,
    // y compris une ancre `#section` pour laquelle ils n'ont aucun sens.
    const defauts = (Link as unknown as { options?: Record<string, unknown> }).options
      ?.HTMLAttributes as Record<string, string> | undefined
    expect(defauts?.target).toBe('_blank')
    expect(defauts?.rel).toContain('noopener')
  })
})

describe("l'éditeur neutralise ces attributs pour les ancres", () => {
  // L'extension est construite derrière un import dynamique et n'est pas
  // exportable sans refactor du composant : on garde la décision en lisant le
  // fichier, comme le font les contrôles de migrations du cœur.

  it('un SmartLink est défini et remplace Link dans les extensions', () => {
    expect(src).toContain('const SmartLink = Link.extend({')
    expect(src).toMatch(/SmartLink\.configure\(\{[^}]*openOnClick/)
    // L'ancien branchement ne doit plus exister, sinon le correctif est inerte.
    expect(src).not.toMatch(/\n\s*Link\.configure\(\{/)
  })

  it('il ne retire target et rel que pour un href commençant par #', () => {
    const i = src.indexOf('const SmartLink = Link.extend({')
    const bloc = src.slice(i, i + 700)
    expect(bloc).toContain("href.startsWith('#')")
    expect(bloc).toMatch(/target:\s*_t,\s*rel:\s*_r/)
  })

  it('les liens sortants gardent leur ouverture en onglet', () => {
    // On corrige une ancre cassée, on ne supprime pas une bonne pratique :
    // un lien externe doit continuer de sortir avec son `rel` de sécurité.
    const i = src.indexOf('const SmartLink = Link.extend({')
    const bloc = src.slice(i, i + 700)
    expect(bloc).toContain('this.options.HTMLAttributes')
  })
})
