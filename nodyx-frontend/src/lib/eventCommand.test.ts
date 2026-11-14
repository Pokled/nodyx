// « /événement » (lot C3) : ce que Nodyx comprend, avant toute publication.
import { describe, it, expect } from 'vitest'
import { EVENT_COMMAND, parseEventDraft, draftStart, draftUrl, readStartParam, readTitleParam } from './eventCommand'

// Samedi 14 novembre 2026, 18:00 (heure locale du test)
const NOW = new Date(2026, 10, 14, 18, 0)
const p = (t: string) => parseEventDraft(t, NOW)
const start = (t: string) => draftStart(p(t))

describe('EVENT_COMMAND', () => {
  it('reconnaît /événement, /evenement, /event, et rien qui commence pareil', () => {
    expect(EVENT_COMMAND.exec('/événement Pizza vendredi 20h')?.[1]).toBe('Pizza vendredi 20h')
    expect(EVENT_COMMAND.exec('/evenement Pizza')?.[1]).toBe('Pizza')
    expect(EVENT_COMMAND.exec('/event Pizza')?.[1]).toBe('Pizza')
    expect(EVENT_COMMAND.exec('/évènement Pizza')?.[1]).toBe('Pizza')
    expect(EVENT_COMMAND.exec('/ÉVÉNEMENT Pizza')?.[1]).toBe('Pizza')
    expect(EVENT_COMMAND.exec('/événement')?.[1]).toBe('')
    expect(EVENT_COMMAND.test('/evenements Pizza')).toBe(false)
    expect(EVENT_COMMAND.test('/eventail')).toBe(false)
  })
})

describe('parseEventDraft', () => {
  it('l’exemple de la maquette : « Pizza vendredi 20h » → vendredi 20 novembre 20:00', () => {
    expect(p('Pizza vendredi 20h')).toEqual({ title: 'Pizza', day: { y: 2026, m: 11, d: 20 }, time: { h: 20, mi: 0 } })
  })
  it('les heures : 20h30, 20:30, 8pm, 8:30pm, « à 21h »', () => {
    expect(start('Ciné demain 20h30')).toBe('2026-11-15T20:30')
    expect(start('Ciné demain 20:30')).toBe('2026-11-15T20:30')
    expect(start('Movie tomorrow 8pm')).toBe('2026-11-15T20:00')
    expect(start('Movie tomorrow at 8:30pm')).toBe('2026-11-15T20:30')
    expect(p('Raid demain à 21h').title).toBe('Raid')
  })
  it('aujourd’hui / today, demain / tomorrow', () => {
    expect(start("Apéro aujourd'hui 20h")).toBe('2026-11-14T20:00')
    expect(start('Drinks today 9pm')).toBe('2026-11-14T21:00')
    expect(start('Raid demain')).toBe('2026-11-15')
  })
  it('un jour de la semaine : le prochain ; le jour même s’il reste du temps', () => {
    expect(start('Pizza samedi 20h')).toBe('2026-11-14T20:00')        // samedi, il est 18 h : ce soir
    expect(start('Pizza samedi 17h')).toBe('2026-11-21T17:00')        // déjà passé : samedi prochain
    expect(start('Pizza samedi')).toBe('2026-11-21')                   // sans heure : pas « aujourd’hui » par surprise
    expect(start('Réunion lundi 9h')).toBe('2026-11-16T09:00')
    expect(start('Meeting Monday 9:00')).toBe('2026-11-16T09:00')
  })
  it('jour/mois, avec ou sans année ; passé : l’an prochain', () => {
    expect(start('Noël 24/12 19h')).toBe('2026-12-24T19:00')
    expect(start('Galette 06/01')).toBe('2027-01-06')
    expect(start('Fête 21/11/2027')).toBe('2027-11-21')
  })
  it('l’heure seule : aujourd’hui, ou demain si elle est passée', () => {
    expect(start('Partie 20h')).toBe('2026-11-14T20:00')
    expect(start('Partie 9h')).toBe('2026-11-15T09:00')
  })
  it('rien de compris : pas de date, tout est le titre', () => {
    expect(p('Pizza chez Léa')).toEqual({ title: 'Pizza chez Léa', day: null, time: null })
    expect(start('Pizza chez Léa')).toBeNull()
  })
  it('ce qui n’existe pas n’est pas compris (31/02, 25h, 13pm)', () => {
    expect(p('Truc 31/02').day).toBeNull()
    expect(p('Truc 25h').time).toBeNull()
    expect(p('Truc 13pm').time).toBeNull()
    expect(p('Truc 31/02').title).toBe('Truc 31/02')
  })
  it('les accents et majuscules ne gênent pas (Vendredi, Samedi.)', () => {
    expect(start('Pizza Vendredi 20H')).toBe('2026-11-20T20:00')
    expect(p('Pizza, samedi.').day).toEqual({ y: 2026, m: 11, d: 21 })
  })
  it('le titre est borné à 200 caractères', () => {
    expect(p('x'.repeat(500)).title).toHaveLength(200)
  })
})

describe('draftUrl', () => {
  it('le formulaire prérempli, paramètres encodés', () => {
    expect(draftUrl(p('Pizza & co vendredi 20h'))).toBe('/calendar/new?title=Pizza+%26+co&start=2026-11-20T20%3A00')
    expect(draftUrl(p(''))).toBe('/calendar/new')
  })
})

describe('le formulaire ne croit que ce qui est sûr', () => {
  it('readStartParam : format strict, jour réel, pas dans le passé', () => {
    expect(readStartParam('2026-11-20T20:00', NOW)).toEqual({ date: '2026-11-20', time: '20:00' })
    expect(readStartParam('2026-11-20', NOW)).toEqual({ date: '2026-11-20', time: null })
    expect(readStartParam('2026-11-14', NOW)).toEqual({ date: '2026-11-14', time: null })   // aujourd’hui reste possible
    expect(readStartParam('2026-11-13T20:00', NOW)).toBeNull()
    expect(readStartParam('2026-02-31', NOW)).toBeNull()
    expect(readStartParam('2026-11-20T25:00', NOW)).toBeNull()
    expect(readStartParam('2026-11-20T20:00Z', NOW)).toBeNull()
    expect(readStartParam('"><script>', NOW)).toBeNull()
    expect(readStartParam(null, NOW)).toBeNull()
  })
  it('readTitleParam : une ligne, sans caractère de contrôle, 200 au plus', () => {
    expect(readTitleParam('  Pizza\n\tchez  Léa ')).toBe('Pizza chez Léa')
    expect(readTitleParam('a'.repeat(300))).toHaveLength(200)
    expect(readTitleParam(null)).toBe('')
  })
})
