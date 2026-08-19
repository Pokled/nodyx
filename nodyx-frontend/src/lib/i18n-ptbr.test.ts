// ─── Le portugais brésilien doit atteindre les Brésiliens ────────────────────
//
// Demandé dans l'issue #601. Avant ce câblage, la détection excluait
// explicitement `pt-br` du repli vers `pt-PT` sans rien proposer à la place :
// un navigateur n'annonçant que `pt-BR` ne recevait donc AUCUN portugais.
//
// Ces contrôles échouent sur le code d'avant : `pt-BR` n'existait pas comme
// valeur de retour possible.

import { describe, it, expect } from 'vitest'
import { getLocaleFromAcceptLanguage, isKnownLocale, LOCALES } from './i18n'

describe('détection du portugais', () => {
  it('sert le brésilien à un navigateur brésilien', () => {
    // En-têtes réels, relevés sur les navigateurs courants.
    for (const h of ['pt-BR,pt;q=0.9,en;q=0.8', 'pt-BR', 'pt-BR;q=0.9,en-US;q=0.8', 'pt-br']) {
      expect(getLocaleFromAcceptLanguage(h), h).toBe('pt-BR')
    }
  })

  it('sert toujours le portugais européen au Portugal', () => {
    for (const h of ['pt-PT,pt;q=0.9', 'pt-pt', 'pt']) {
      expect(getLocaleFromAcceptLanguage(h), h).toBe('pt-PT')
    }
  })

  it('ne détourne pas les autres langues', () => {
    expect(getLocaleFromAcceptLanguage('fr-FR,fr;q=0.9')).toBe('fr')
    expect(getLocaleFromAcceptLanguage('es-ES')).toBe('es')
    expect(getLocaleFromAcceptLanguage('en-US,en;q=0.9')).toBe('en')
  })
})

describe('câblage de la langue', () => {
  it('pt-BR est une langue connue, donc sélectionnable', () => {
    expect(isKnownLocale('pt-BR')).toBe(true)
  })

  it('porte le drapeau brésilien, pas celui du Portugal', () => {
    const br = LOCALES.find((l) => l.code === 'pt-BR')
    expect(br?.flagIcon).toBe('twemoji:flag-brazil')
  })

  it('les deux portugais portent des étiquettes distinctes', () => {
    // Sans suffixe, le sélecteur affichait deux fois « Português » et personne
    // ne pouvait savoir lequel il choisissait.
    const pt = LOCALES.filter((l) => l.code.startsWith('pt-')).map((l) => l.label)
    expect(pt).toHaveLength(2)
    expect(new Set(pt).size).toBe(2)
  })
})
