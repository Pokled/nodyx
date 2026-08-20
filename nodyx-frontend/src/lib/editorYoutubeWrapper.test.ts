// ─── Une vidéo insérée depuis l'éditeur doit garder sa mise en forme ─────────
//
// Mesuré le 2026-08-20. L'extension Youtube enveloppe l'iframe dans
// `<div data-youtube-video>`. Or l'assainisseur du cœur n'autorise pas cet
// attribut : il le retire et laisse un `<div>` NU, sans aucune prise pour la
// feuille de style, qui vise `.youtube-wrapper`.
//
// Ce n'était donc pas un défaut d'aller-retour comme les trois précédents :
// c'était le cas NORMAL. Toute vidéo insérée depuis l'éditeur perdait sa mise
// en forme, et les vidéos écrites à la main en HTML étaient l'exception.
//
// Effet visible : l'iframe gardait 360 px de haut pour 324 de large, soit un
// ratio faux, au lieu des 322x180 attendus en 16:9.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const COMPOSANT = new URL('./components/editor/NodyxEditor.svelte', import.meta.url).pathname
const src = readFileSync(COMPOSANT, 'utf-8')

const CSS = new URL('../app.css', import.meta.url).pathname
const css = readFileSync(CSS, 'utf-8')

describe("l'enveloppe de la vidéo porte la classe attendue", () => {
  it('RobustYoutube surcharge renderHTML pour poser la classe', () => {
    const i = src.indexOf('const RobustYoutube = Youtube.extend({')
    expect(i).toBeGreaterThan(-1)
    const bloc = src.slice(i, i + 1400)
    expect(bloc).toContain('renderHTML')
    expect(bloc).toContain("class: 'youtube-wrapper'")
  })

  it("s'appuie sur le rendu du parent au lieu de le réécrire", () => {
    // Réécrire l'enveloppe à la main casserait au premier changement de
    // l'extension. On ajoute la classe à ce qu'elle produit, rien de plus.
    const i = src.indexOf('const RobustYoutube = Youtube.extend({')
    const bloc = src.slice(i, i + 1400)
    expect(bloc).toContain('this.parent!(props)')
    expect(bloc).toContain('mergeAttributes')
  })

  it('la classe visée est bien celle que la feuille de style attend', () => {
    // Le contrôle qui relie les deux moitiés : poser une classe que le style
    // ignore ne servirait à rien, et le défaut serait invisible.
    expect(css).toMatch(/\.nodyx-prose\s+\.youtube-wrapper/)
    expect(css).toMatch(/\.youtube-wrapper\s*\{[\s\S]{0,200}position:\s*relative/)
  })
})

describe("ce que l'assainisseur laisse passer", () => {
  it('la classe est un attribut autorisé, contrairement à data-youtube-video', () => {
    // La raison du choix : `class` traverse l'assainissement, l'attribut de
    // l'extension non. Vérifié dans la liste du cœur.
    const sanit = readFileSync(
      new URL('../../../nodyx-core/src/utils/sanitize.ts', import.meta.url).pathname,
      'utf-8',
    )
    expect(sanit).toMatch(/'\*':\s*\[[^\]]*'class'/)
    expect(sanit).not.toContain('data-youtube-video')
  })
})
