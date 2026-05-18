// OctoGuard Session C : tests purs sur extractCommand (Module 3).
// Les tests d'intégration (tryHandleCommand avec DB/Redis/Socket.IO)
// sont déjà couverts par les smoke e2e sur le VPS (cf. roadmap §R2).

import { describe, it, expect } from 'vitest'
import { extractCommand } from '../services/octoguard/commands'

describe('extractCommand', () => {
  it('extrait une commande simple', () => {
    expect(extractCommand('!regles')).toBe('regles')
  })

  it('extrait avec argument après espace', () => {
    expect(extractCommand('!regles svp')).toBe('regles')
  })

  it('extrait avec underscore et dash', () => {
    expect(extractCommand('!my_cmd-1')).toBe('my_cmd-1')
  })

  it('case-insensitive (toujours en lowercase)', () => {
    expect(extractCommand('!REGLES')).toBe('regles')
  })

  it('refuse si pas en début de message (après strip + trim)', () => {
    expect(extractCommand('hi !regles')).toBeNull()
    // Note : "  !regles" est trimmé puis match. C'est volontaire :
    // l'utilisateur peut taper avec des espaces avant sans pénalité.
  })

  it('refuse texte sans !', () => {
    expect(extractCommand('regles')).toBeNull()
    expect(extractCommand('hello')).toBeNull()
  })

  it('refuse "! " sans nom', () => {
    expect(extractCommand('!')).toBeNull()
    expect(extractCommand('! plz')).toBeNull()
  })

  it('refuse caractères spéciaux après le nom', () => {
    // Le regex exige (\s|$) après le nom, donc "!cmd@bad" ne match pas du tout
    expect(extractCommand('!cmd@bad')).toBeNull()
    expect(extractCommand('!!double')).toBeNull()
    expect(extractCommand('!cmd avec espace')).toBe('cmd')
  })

  it('strip HTML avant détection', () => {
    expect(extractCommand('<p>!regles</p>')).toBe('regles')
    expect(extractCommand('<strong>!cmd</strong>')).toBe('cmd')
  })

  it('rejette si nom > 64 chars (pas de troncature, hard reject)', () => {
    // Le regex exige (\s|$) après le 64e char max. 100 'a' sans terminator → null.
    const long = '!' + 'a'.repeat(100)
    expect(extractCommand(long)).toBeNull()
    // 64 chars exact + fin de message → match
    const ok = '!' + 'a'.repeat(64)
    expect(extractCommand(ok)).toBe('a'.repeat(64))
  })
})
