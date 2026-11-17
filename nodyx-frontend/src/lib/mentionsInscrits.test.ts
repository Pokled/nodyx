// @inscrits (SPECS/NODYX_MENTIONS_CDC.md §10) : l'étiquette insérée, et D63 dans un texte public.
import { describe, it, expect } from 'vitest'
import { insertLabel, isEventKey, refOf, type MentionSuggestion } from './mentions'

const tFn = (k: string) => ({ 'mention.g_inscrits': 'inscrits', 'mention.g_inscrits_going': 'ceux qui viennent', 'mention.g_inscrits_private': "inscrits d'un événement privé" } as Record<string, string>)[k] ?? k
const EV = '11111111-1111-4111-8111-111111111111'
const sug = (priv: boolean, key = `event:${EV}`): MentionSuggestion => ({
  id: 'g:' + key, key, username: key, display_name: 'Raid Veloren', avatar: null, reason: 'group', count: 11,
  event: { starts_at: '2026-11-21T19:00:00Z', going: 8, maybe: 3, role: 'organizer', private: priv, cancelled: false },
})

describe('@inscrits', () => {
  it('la clé et la référence', () => {
    expect(isEventKey(`event:${EV}`)).toBe(true)
    expect(isEventKey(`event-going:${EV}`)).toBe(true)
    expect(isEventKey('equipe')).toBe(false)
    expect(refOf(sug(false))).toBe(`g:event:${EV}`)
  })
  it('dans le chat : « inscrits · Raid Veloren », même pour un événement privé', () => {
    expect(insertLabel(sug(false), tFn)).toBe('inscrits · Raid Veloren')
    expect(insertLabel(sug(true), tFn)).toBe('inscrits · Raid Veloren')
  })
  it('dans un texte public : jamais le titre d’un événement privé (D63)', () => {
    expect(insertLabel(sug(true), tFn, { publicText: true })).toBe("inscrits d'un événement privé")
    expect(insertLabel(sug(false), tFn, { publicText: true })).toBe('inscrits · Raid Veloren')
  })
  it('« seulement ceux qui viennent »', () => {
    expect(insertLabel(sug(false, `event-going:${EV}`), tFn)).toBe('ceux qui viennent · Raid Veloren')
  })
})
