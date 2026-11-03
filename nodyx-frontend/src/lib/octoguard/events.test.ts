import { describe, it, expect } from 'vitest'
import { eventOf } from './events'

describe('les événements racontés', () => {
	it('distingue le moteur, l\'équipe et l\'observation', () => {
		expect(eventOf({ action: 'octoguard.warn_user', metadata: { rule_id: 'r' } })).toEqual({ kind: 'warn', key: 'ev_warn', source: 'octoguard' })
		expect(eventOf({ action: 'octoguard.would_delete_message', metadata: {} }).source).toBe('observed')
		expect(eventOf({ action: 'octoguard.mute_user', metadata: {} })).toMatchObject({ key: 'ev_mute_team', source: 'team' })
		expect(eventOf({ action: 'octoguard.mute_user', metadata: { actor: 'octoguard:auto' } })).toMatchObject({ key: 'ev_mute', source: 'octoguard' })
		expect(eventOf({ action: 'octoguard.rule_updated', metadata: null })).toMatchObject({ kind: 'acc', source: 'team' })
		expect(eventOf({ action: 'octoguard.escalation_mute', metadata: { rule_id: 'r' } }).key).toBe('ev_escalation')
	})
	it('un nom d\'action inconnu ne casse rien', () => {
		expect(eventOf({ action: 'octoguard.truc_nouveau', metadata: null }).key).toBe('ev_other')
	})
})
