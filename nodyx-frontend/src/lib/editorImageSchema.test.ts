// ─── L'image doit pouvoir vivre DANS un paragraphe ───────────────────────────
//
// Le 2026-08-19, un article publié avec des icônes devant ses liens s'est
// disloqué dès qu'un rédacteur l'a rouvert dans l'éditeur : chaque icône s'est
// retrouvée SEULE sur sa ligne, au-dessus du lien qu'elle devait précéder.
//
// La cause n'était pas le CSS mais le SCHÉMA. L'extension Image de TipTap crée
// par défaut un nœud de bloc (`group: 'block'`). Un nœud de bloc ne peut pas
// être contenu dans un paragraphe : à la lecture du HTML, ProseMirror l'extrait
// et le place entre deux paragraphes. Aucun arrangement du HTML n'y échappe.
//
// Ces contrôles échouent sur la configuration d'avant.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'

const COMPOSANT = new URL('./components/editor/NodyxEditor.svelte', import.meta.url).pathname

/** Le schéma tel que ProseMirror le construira, avec l'option testée. */
function schemaAvec(inline: boolean) {
  return getSchema([StarterKit, Image.configure({ inline })])
}

/** Un paragraphe peut-il contenir ce type de nœud ? C'est toute la question. */
function paragrapheAccepte(inline: boolean) {
  const s = schemaAvec(inline)
  return s.nodes.paragraph.contentMatch.matchType(s.nodes.image) !== null
}

describe('schéma : une image en ligne reste dans son paragraphe', () => {
  it('un nœud image de BLOC est refusé par le paragraphe, donc extrait', () => {
    // La démonstration du défaut : c'est cette configuration qui disloquait
    // l'article à la première réouverture.
    expect(paragrapheAccepte(false)).toBe(false)
  })

  it('un nœud image EN LIGNE est accepté, donc conservé', () => {
    expect(paragrapheAccepte(true)).toBe(true)
  })

  it("le groupe du nœud suit l'option, c'est lui qui décide", () => {
    expect(schemaAvec(false).nodes.image.spec.group).toBe('block')
    expect(schemaAvec(true).nodes.image.spec.group).toBe('inline')
    expect(schemaAvec(true).nodes.image.isInline).toBe(true)
  })
})

describe("l'éditeur configure bien son image en ligne", () => {
  // Même approche que les contrôles de migrations du cœur : on lit le fichier,
  // parce que l'extension est construite derrière un import dynamique et n'est
  // pas exportable sans refactor du composant.
  const src = readFileSync(COMPOSANT, 'utf-8')

  it('AlignableImage déclare inline: true dans ses options', () => {
    // Fenêtre large : le bloc porte un commentaire expliquant pourquoi l'option
    // est structurelle, et un contrôle trop serré casserait au premier mot ajouté.
    expect(src).toMatch(/addOptions\(\)\s*\{[\s\S]{0,400}?inline:\s*true/)
  })

  it("l'option est posée sur AlignableImage, pas ailleurs", () => {
    const i = src.indexOf('const AlignableImage = Image.extend({')
    expect(i).toBeGreaterThan(-1)
    // On borne la recherche au bloc de l'extension, pour qu'un `inline: true`
    // apparaissant ailleurs dans ce fichier de 1700 lignes ne fasse pas passer
    // ce contrôle par accident.
    expect(src.slice(i, i + 900)).toContain('inline: true')
  })
})
