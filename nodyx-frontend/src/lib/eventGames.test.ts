// Le jeu d'un événement (D66) : ce que le formulaire envoie, ce que l'affichage accepte.
import { describe, it, expect } from 'vitest'
import { gameFieldsFromForm, isGameCover, hasLook } from './eventGames'

const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.append(k, v); return f }
const G = '11111111-1111-4111-8111-111111111111'

describe('gameFieldsFromForm', () => {
  it('un jeu choisi : ni icône ni couleur', () => {
    expect(gameFieldsFromForm(fd({ game_id: G, icon: 'dice', icon_color: 'red' }))).toEqual({ game_id: G, icon: null, icon_color: null })
  })
  it('pas de jeu : l’icône et sa couleur', () => {
    expect(gameFieldsFromForm(fd({ game_id: '', icon: 'dice', icon_color: 'green' }))).toEqual({ game_id: null, icon: 'dice', icon_color: 'green' })
  })
  it('valeurs hors liste écartées (jamais envoyées au cœur)', () => {
    expect(gameFieldsFromForm(fd({ game_id: 'abc', icon: '<svg>', icon_color: 'pink' }))).toEqual({ game_id: null, icon: null, icon_color: null })
    expect(gameFieldsFromForm(fd({ icon: '', icon_color: 'red' }))).toEqual({ game_id: null, icon: null, icon_color: null })
  })
  it('rien du tout : tout à null (une modification EFFACE le jeu)', () => {
    expect(gameFieldsFromForm(fd({}))).toEqual({ game_id: null, icon: null, icon_color: null })
  })
})

describe('isGameCover', () => {
  it('seulement une jaquette servie par l’instance', () => {
    expect(isGameCover(`/uploads/games/${G}.webp`)).toBe(true)
    for (const bad of ['https://cdn.cloudflare.steamstatic.com/x.jpg', `/uploads/games/${G}.webp?x`, '/uploads/../etc/passwd', 'javascript:alert(1)', null]) expect(isGameCover(bad)).toBe(false)
  })
})

describe('hasLook', () => {
  it('une jaquette de l’instance ou une icône connue ; rien d’autre', () => {
    expect(hasLook({ game_cover: `/uploads/games/${G}.webp` })).toBe(true)
    expect(hasLook({ icon: 'dice' })).toBe(true)
    expect(hasLook({ game_cover: 'https://evil.example/x.webp', icon: 'nope' })).toBe(false)
    expect(hasLook(null)).toBe(false)
  })
})
