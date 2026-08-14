import { describe, it, expect } from 'vitest'
import { projectUser, columnsFor, PROJECTABLE_FIELDS } from '../extensions/identity'

const USER = {
  id:       'user-42',
  username: 'ada',
  avatar:   'https://instance.example/a.png',
  locale:   'fr',
  email:    'prive@example.org',
  password_hash: '$argon2id$...',
  is_admin: true,
}

const ALL = ['identity', ...PROJECTABLE_FIELDS.map(f => `identity:${f}`)]

describe('ce qui ne doit jamais sortir', () => {
  it('ne rend jamais l adresse de courriel, meme avec tout accorde', () => {
    const p = projectUser(USER, ALL)!
    expect(p.email).toBeUndefined()
    expect(JSON.stringify(p)).not.toContain('prive@example.org')
  })

  it('ne rend aucun champ non projetable, meme si l appelant les demande', () => {
    const p = projectUser(USER, [...ALL, 'identity:email', 'identity:password_hash', 'identity:is_admin'])!
    expect(Object.keys(p).sort()).toEqual(['avatar', 'id', 'locale', 'username'])
  })

  it('la liste des champs projetables ne contient pas email', () => {
    expect(PROJECTABLE_FIELDS).not.toContain('email')
  })
})

describe('projection champ par champ', () => {
  it('rend exactement ce qui est accorde', () => {
    expect(projectUser(USER, ['identity', 'identity:id', 'identity:username']))
      .toEqual({ id: 'user-42', username: 'ada' })
  })

  it('un champ absent en base ne fabrique pas de cle', () => {
    expect(projectUser({ id: 'u', username: 'ada' }, ALL)).toEqual({ id: 'u', username: 'ada' })
  })

  it('un champ vide en base rend null, pas undefined', () => {
    expect(projectUser({ id: 'u', avatar: null }, ['identity', 'identity:avatar']))
      .toEqual({ avatar: null })
  })
})

describe('les trois facons de ne rien rendre', () => {
  it('aucun membre connecte', () => {
    expect(projectUser(null, ALL)).toBeNull()
    expect(projectUser(undefined, ALL)).toBeNull()
  })

  it('capacite identity non accordee', () => {
    // Meme avec les champs listes : sans la capacite, rien ne sort.
    expect(projectUser(USER, ['identity:id', 'identity:username'])).toBeNull()
  })

  it('capacite accordee mais aucun champ', () => {
    expect(projectUser(USER, ['identity'])).toBeNull()
  })
})

describe('colonnes a lire en base', () => {
  it('ne lit que ce qu on a le droit de rendre', () => {
    // Une requete qui ramene le courriel pour le jeter finit par le laisser
    // fuir dans un journal ou une trace d'erreur.
    expect(columnsFor(['identity', 'identity:id', 'identity:locale'])).toEqual(['id', 'locale'])
  })

  it('ne lit rien sans la capacite', () => {
    expect(columnsFor(['identity:id'])).toEqual([])
    expect(columnsFor([])).toEqual([])
  })

  it('ignore une colonne inventee par l appelant', () => {
    expect(columnsFor(['identity', 'identity:email', 'identity:id'])).toEqual(['id'])
  })
})
