// ─── La porte i18n doit voir ce qu'elle prétend voir ─────────────────────────
//
// Le 2026-08-19, `npm run i18n:check` annonçait « 0 hardcoded French string »
// alors que l'éditeur affichait `'Remplacer'` en dur. La porte exemptait la
// LIGNE ENTIÈRE dès qu'elle contenait un appel `tFn(` :
//
//     const frHit = !l.includes('tFn(') && ...
//
// Une ligne mêlant un appel traduit et une chaîne en dur passait donc
// intégralement sous le radar. Quatre portes protègent l'i18n de ce dépôt, et
// l'une d'elles avait un angle mort que rien ne pouvait détecter.
//
// Ces contrôles échouent sur l'ancienne logique : ils sont la garde de la garde.

import { describe, it, expect } from 'vitest'
// Module d'outillage en JS pur, hors du graphe TypeScript de l'application :
// il est importé tel quel, ses annotations JSDoc suffisent au typage.
import { stripI18n } from '../../scripts/i18n/strip.mjs'

/** Ce que la porte examine réellement, une fois les appels i18n neutralisés. */
const reste = (ligne: string) => stripI18n(ligne).trim()

describe('porte i18n : neutralisation des appels traduits', () => {
  it('LAISSE VISIBLE une chaîne en dur voisine d un appel traduit', () => {
    // LE cas qui a échappé à la porte. Sur l'ancienne logique, toute la ligne
    // était ignorée et « Remplacer » restait invisible.
    const l = `{cond ? 'Remplacer' : tFn('editor.insert')}`
    expect(reste(l)).toContain('Remplacer')
    expect(reste(l)).not.toContain('editor.insert')
  })

  it('attrape aussi les replis en dur, morts mais bien réels', () => {
    // `tFn` renvoie la clef quand la traduction manque, jamais null : ces replis
    // sont du code mort ET une chaîne non traduite.
    for (const l of [
      `title={tFn('dm.reply') ?? 'Répondre'}`,
      `<span>{tFn('common.members') || 'membres'}</span>`,
    ]) {
      expect(reste(l), l).toMatch(/Répondre|membres/)
    }
  })

  it('neutralise un appel entier, y compris ses arguments imbriqués', () => {
    // Les parenthèses imbriquées doivent être comptées, sinon la neutralisation
    // s'arrêterait à la première `)` et laisserait la fin de l'appel visible,
    // ce qui produirait un faux positif à chaque appel un peu riche.
    const l = `<p>{tFn('a.b', { n: compte(1), x: f(g(2)) })}</p>`
    const r = stripI18n(l)
    expect(r).not.toContain('a.b')
    expect(r).not.toContain('compte')
    // Le balisage autour, lui, doit survivre intact.
    expect(r.startsWith('<p>{')).toBe(true)
    expect(r.endsWith('}</p>')).toBe(true)
  })

  it('ne se laisse pas piéger par une parenthèse dans une chaîne', () => {
    const l = `{tFn('chat.send')} garde`
    expect(reste(l)).toContain('garde')
    expect(reste(l)).not.toContain('chat.send')
  })

  it('préserve la longueur, pour que les colonnes rapportées restent justes', () => {
    for (const l of [
      `{cond ? 'Remplacer' : tFn('editor.insert')}`,
      `title={tFn('dm.reply')}`,
      `keywords: ['profil', 'compte'],`,
    ]) {
      expect(stripI18n(l).length, l).toBe(l.length)
    }
  })
})

describe('porte i18n : les alias de recherche ne sont pas de l interface', () => {
  it('ignore keywords, jamais affiché et volontairement bilingue', () => {
    // `keywords` alimente uniquement le champ de recherche de la palette. Les
    // signaler pousserait à supprimer « paramètres » ou « réseau », donc à
    // casser la recherche pour un francophone.
    const l = `{ id: 'settings', label: tFn('nav.account_settings'), keywords: ['settings', 'paramètres', 'compte'] }`
    expect(reste(l)).not.toContain('paramètres')
    expect(reste(l)).not.toContain('compte')
  })

  it("n'étend pas cette tolérance au reste de la ligne", () => {
    // Un libellé affiché reste visible, même quand la ligne porte des alias.
    const l = `{ sub: 'Créer une discussion', keywords: ['créer', 'nouveau'] }`
    expect(reste(l)).toContain('Créer une discussion')
    expect(reste(l)).not.toContain("'créer'")
  })
})
