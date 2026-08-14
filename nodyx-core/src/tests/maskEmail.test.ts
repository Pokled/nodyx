import { describe, it, expect } from 'vitest'
import { maskEmail, maskEmailIn } from '../utils/maskEmail'

describe('masquage des adresses', () => {
  it('garde la premiere lettre de chaque cote et l extension', () => {
    // Assez pour reconnaitre une adresse qu'on connait deja, pas assez pour la
    // lire a quelqu'un qui la decouvre.
    expect(maskEmail('jonathan@gmail.com')).toBe('j••••••@g••••.com')
  })

  it('ne laisse JAMAIS passer la partie locale complete', () => {
    for (const e of ['jaronoah@gmail.com', 'contact@nodyx.org', 'a.b.c@sous.domaine.fr']) {
      const masque = maskEmail(e)
      const local = e.slice(0, e.indexOf('@'))
      if (local.length > 1) expect(masque).not.toContain(local)
    }
  })

  it('borne la longueur des points, pour ne pas trahir la taille', () => {
    // Une adresse de quarante caracteres ne doit pas se distinguer d'une de
    // quinze : la longueur est en soi une information.
    const court = maskEmail('abcdefg@example.com')
    const long  = maskEmail('abcdefghijklmnopqrstuvwxyz@example.com')
    expect(court.split('@')[0]).toBe(long.split('@')[0])
  })

  it('conserve l extension, utile pour distinguer un domaine jetable', () => {
    expect(maskEmail('x@yopmail.com')).toContain('.com')
    expect(maskEmail('x@truc.fr')).toContain('.fr')
  })

  it('traite les valeurs absentes sans exploser', () => {
    expect(maskEmail(null)).toBe('')
    expect(maskEmail(undefined)).toBe('')
    expect(maskEmail('')).toBe('')
  })

  it('masque aussi ce qui n est pas une adresse, plutot que de le rendre tel quel', () => {
    const r = maskEmail('pas-une-adresse')
    expect(r).not.toBe('pas-une-adresse')
    expect(r.startsWith('p')).toBe(true)
  })

  it('gere une adresse a plusieurs arobases en prenant la derniere', () => {
    expect(maskEmail('a@b@example.com')).toContain('@e')
  })

  it('masque un champ dans une ligne sans toucher au reste', () => {
    const row = { id: '1', username: 'ada', email: 'ada@example.com', role: 'admin' }
    const out = maskEmailIn(row)
    expect(out.email).toBe('a••@e••••••.com')
    expect(out.username).toBe('ada')
    expect(out.role).toBe('admin')
  })
})
