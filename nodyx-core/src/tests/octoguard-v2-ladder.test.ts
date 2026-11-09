import { describe, it, expect } from 'vitest'
import { validateSteps, positionOf, nextStepOf, needsSecondOpinion, kindOf, SANCTIONS, DEFAULT_SETTINGS } from '../services/octoguard/ladder'

// Lot 4b (CDC §E4i, D27-D32 validées le 09/11) : la logique pure du barème.

describe('les étapes : une liste fermée, jamais plus douce que la précédente (D29)', () => {
  it('le barème de la maquette est valide', () => {
    expect(validateSteps(['warn', 'mute_1h', 'mute_24h', 'ban_7d'])).toEqual(['warn', 'mute_1h', 'mute_24h', 'ban_7d'])
    expect(validateSteps(DEFAULT_SETTINGS.steps)).not.toBeNull()
  })
  it('une étape ÉGALE à la précédente est permise (« deux avertissements avant la sourdine »)', () => {
    expect(validateSteps(['warn', 'warn', 'mute_1h', 'ban_7d'])).not.toBeNull()
  })
  it('une étape plus douce que la précédente est refusée', () => {
    expect(validateSteps(['warn', 'mute_24h', 'mute_1h', 'ban_7d'])).toBeNull()
    expect(validateSteps(['ban_1d', 'warn', 'warn', 'warn'])).toBeNull()
  })
  it('hors de la liste, ou pas exactement 4 étapes : refusé', () => {
    expect(validateSteps(['warn', 'mute_2h', 'mute_24h', 'ban_7d'])).toBeNull()
    expect(validateSteps(['warn', 'mute_1h', 'ban_7d'])).toBeNull()
    expect(validateSteps(['warn', 'mute_1h', 'mute_24h', 'ban_7d', 'ban_30d'])).toBeNull()
    expect(validateSteps('warn')).toBeNull()
    expect(validateSteps(null)).toBeNull()
  })
  it('la liste va bien du plus doux au plus ferme', () => {
    expect(SANCTIONS[0]).toBe('warn')
    expect(SANCTIONS[SANCTIONS.length - 1]).toBe('ban_30d')
    expect(kindOf('mute_7d')).toBe('mute')
    expect(kindOf('ban_1d')).toBe('ban')
  })
})

describe('la position se calcule à la lecture, avec l’oubli', () => {
  const DAY = 86_400_000, now = Date.parse('2026-11-09T12:00:00Z')
  const at = (days: number) => new Date(now - days * DAY).toISOString()
  it('sans écart : position 0, prochaine étape 1', () => {
    expect(positionOf(null, 30, now)).toBe(0)
    expect(nextStepOf(0)).toBe(1)
  })
  it('une étape de la veille compte entièrement', () => {
    expect(positionOf({ step: 2, at: at(1) }, 30, now)).toBe(2)
    expect(nextStepOf(2)).toBe(3)
  })
  it('une période d’oubli écoulée sans écart : on redescend d’une étape, pas plus', () => {
    expect(positionOf({ step: 3, at: at(30) }, 30, now)).toBe(2)
    expect(positionOf({ step: 3, at: at(29.9) }, 30, now)).toBe(3)
    expect(positionOf({ step: 3, at: at(61) }, 30, now)).toBe(1)
    expect(positionOf({ step: 3, at: at(61) }, 90, now)).toBe(3)
  })
  it('jamais en dessous de zéro', () => {
    expect(positionOf({ step: 1, at: at(400) }, 30, now)).toBe(0)
  })
  it('au-delà de la dernière étape : plus de suite automatique, c’est un admin qui décide', () => {
    expect(nextStepOf(4)).toBeNull()
  })
})

describe('le second avis (D30)', () => {
  it('une exclusion de 7 jours OU PLUS (la maquette disait « plus de » : jamais déclenchée par défaut)', () => {
    expect(needsSecondOpinion('ban_7d')).toBe(true)
    expect(needsSecondOpinion('ban_30d')).toBe(true)
  })
  it('pas pour une exclusion plus courte, ni pour une sourdine, même de 7 jours', () => {
    expect(needsSecondOpinion('ban_1d')).toBe(false)
    expect(needsSecondOpinion('mute_7d')).toBe(false)
    expect(needsSecondOpinion('warn')).toBe(false)
  })
})
