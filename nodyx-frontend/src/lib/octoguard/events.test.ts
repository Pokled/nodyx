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

describe('les marques de l’équipe (lot 10)', () => {
	it('« faux positif » et « c’était normal » sont des phrases de l’équipe, pas un « événement » générique', () => {
		expect(eventOf({ action: 'octoguard.false_positive', metadata: {} })).toEqual({ kind: 'ok', key: 'ev_false_positive', source: 'team' })
		expect(eventOf({ action: 'octoguard.observed_normal', metadata: {} })).toEqual({ kind: 'ok', key: 'ev_observed_normal', source: 'team' })
	})
})

describe('une règle qui suit le barème (D28)', () => {
	it('une marche posée par OctoGuard se raconte comme OctoGuard, avec la règle', () => {
		expect(eventOf({ action: 'octoguard.ladder_applied', metadata: { actor: 'octoguard:auto', sanction: 'warn', rule_id: 'r' } })).toEqual({ kind: 'delete', key: 'ev_ladder_engine_warn', source: 'octoguard' })
		expect(eventOf({ action: 'octoguard.ladder_applied', metadata: { actor: 'octoguard:auto', sanction: 'mute_1h', rule_id: 'r' } })).toMatchObject({ key: 'ev_ladder_engine_mute', source: 'octoguard' })
	})
	it('une marche posée par l’équipe reste une phrase de l’équipe', () => {
		expect(eventOf({ action: 'octoguard.ladder_applied', metadata: { actor: 'admin', sanction: 'mute_1h' } })).toMatchObject({ key: 'ev_ladder_applied_mute', source: 'team' })
		expect(eventOf({ action: 'octoguard.ladder_applied', metadata: { actor: 'admin', sanction: 'ban_7d' } })).toMatchObject({ key: 'ev_ladder_applied_ban', source: 'team' })
	})
	it('l’alerte à l’équipe a sa phrase', () => {
		expect(eventOf({ action: 'octoguard.ladder_engine_alert', metadata: { actor: 'octoguard:auto' } })).toEqual({ kind: 'report', key: 'ev_ladder_engine_alert', source: 'octoguard' })
	})
})
