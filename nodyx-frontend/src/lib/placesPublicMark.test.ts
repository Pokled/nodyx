// ─── « # » dans un texte qui peut être lu de tous (lot C5) ────────────────────
//
// Un sujet du forum est public et indexé. Y montrer un salon, un tableau ou une
// page du wiki (réservés aux membres) ne doit JAMAIS écrire leur nom dans le HTML :
// sinon un visiteur, un moteur de recherche ou un aperçu de lien le lirait. Le
// membre, lui, voit le vrai nom grâce aux puces (placeChips).

import { describe, it, expect } from 'vitest'
import { isPublicPlace, publicMark, pastedMark, PLACE_VALUE, type Place } from './places'

const neutral = (k: string) => `<${k}>`
const id = '7e2645ec-fa19-4afa-84e5-5b6726e82e12'
const place = (kind: Place['kind'], url: string, priv = false) => ({ kind, url, private: priv, title: 'Coin des stratèges' })

describe('isPublicPlace', () => {
  it('lisibles de tous : un sujet, un événement public, le sondage d’un sujet', () => {
    expect(isPublicPlace(place('thread', '/forum/a/b'))).toBe(true)
    expect(isPublicPlace(place('event', `/calendar/${id}`))).toBe(true)
    expect(isPublicPlace(place('poll', '/forum/a/b'))).toBe(true)
  })
  it('réservés aux membres : salon, tableau, wiki, sondage d’un salon, événement privé', () => {
    expect(isPublicPlace(place('channel', `/chat?channel=${id}`))).toBe(false)
    expect(isPublicPlace(place('board', `/tasks/${id}`))).toBe(false)
    expect(isPublicPlace(place('wiki', '/wiki/charte'))).toBe(false)
    expect(isPublicPlace(place('poll', `/chat?channel=${id}`))).toBe(false)
    expect(isPublicPlace(place('event', `/calendar/${id}`, true))).toBe(false)
  })
})

describe('publicMark', () => {
  it('un endroit public garde son nom et son adresse', () => {
    expect(publicMark(place('thread', '/forum/a/b'), neutral)).toEqual({ label: 'Coin des stratèges', url: '/forum/a/b' })
  })
  it('un salon : mot neutre, adresse par identifiant seulement', () => {
    const m = publicMark(place('channel', `/chat?channel=${id}`), neutral)
    expect(m).toEqual({ label: '<channel>', url: `/chat?channel=${id}` })
  })
  it('une page du wiki : ni son nom, ni son adresse (le wiki range ses pages par titre)', () => {
    const m = publicMark(place('wiki', '/wiki/plan-secret'), neutral)
    expect(m.label).toBe('<wiki>')
    expect(m.url).toBe('/wiki')
  })
})

describe('PLACE_VALUE', () => {
  it('accepte une sorte connue et un uuid, rien d’autre', () => {
    expect(PLACE_VALUE.test(`channel:${id}`)).toBe(true)
    expect(PLACE_VALUE.test(`user:${id}`)).toBe(false)
    expect(PLACE_VALUE.test(`channel:${id}" onclick="x`)).toBe(false)
    expect(PLACE_VALUE.test('channel:abc')).toBe(false)
  })
})

describe('pastedMark : un endroit collé depuis une page lue par un membre', () => {
  it('un salon collé avec son vrai nom : le nom part, le mot neutre reste', () => {
    expect(pastedMark('channel', '#Coin des stratèges', `/chat?channel=${id}`, neutral)).toEqual({ label: '<channel>', url: `/chat?channel=${id}` })
  })
  it('un événement collé : on ne sait pas s’il est privé, mot neutre « événement »', () => {
    expect(pastedMark('event', '#Réunion secrète', `/calendar/${id}`, neutral).label).toBe('<event_any>')
  })
  it('une page du wiki collée : ni nom, ni adresse à titre', () => {
    expect(pastedMark('wiki', '#Plan secret', '/wiki/plan-secret', neutral)).toEqual({ label: '<wiki>', url: '/wiki' })
  })
  it('un sujet du forum (toujours public) garde son nom', () => {
    expect(pastedMark('thread', '#Tournoi', '/forum/a/b', neutral)).toEqual({ label: 'Tournoi', url: '/forum/a/b' })
  })
})
