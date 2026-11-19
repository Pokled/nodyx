import { describe, it, expect } from 'vitest'
import fr from '$lib/locales/fr.json'
import { fmtDuration, ago } from './format'
import { eventOf, eventVars } from '$lib/octoguard/events'

const tFr = (key: string, vars: Record<string, string | number> = {}) =>
	((fr as Record<string, string>)[key] ?? key).replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? ''))

describe('le temps de lecture', () => {
	it('comme la maquette : 58 s, 1 min 32, 3 min', () => {
		expect(fmtDuration(58_000, tFr)).toBe('58 s')
		expect(fmtDuration(92_000, tFr)).toBe('1 min 32')
		expect(fmtDuration(185_000, tFr)).toBe('3 min 05')
		expect(fmtDuration(180_000, tFr)).toBe('3 min')
		expect(fmtDuration(-5, tFr)).toBe('0 s')
	})
	it('un moment, dans la langue de la page', () => {
		const now = Date.parse('2026-11-19T12:00:00Z')
		expect(ago('2026-11-19T11:56:00Z', 'fr', now)).toBe('il y a 4 minutes')
		expect(ago('2026-11-18T12:00:00Z', 'fr', now)).toBe('hier')
	})
})

describe('le journal raconte les chartes', () => {
	it('une signature, un robot, une version', () => {
		const signed = { action: 'octoguard.charter_signed', actor_username: 'Léa', target_label: 'Léa', metadata: { audience: 'members', version: 2, way: 'hand', read_ms: 92_000 } }
		expect(tFr(`og2.${eventOf(signed).key}`, eventVars(signed, tFr))).toBe('Léa a signé la charte des membres (version 2, à la main, 1 min 32 de lecture)')
		const bot = { action: 'octoguard.charter_bot_stopped', actor_username: 'octoguard:auto', target_label: 'xk_buy_88', metadata: { audience: 'members', trap: 'decoy' } }
		expect(tFr(`og2.${eventOf(bot).key}`, eventVars(bot, tFr))).toBe('Robot arrêté : le compte « xk_buy_88 » a coché la fausse case. Signature refusée.')
		const clock = { ...bot, metadata: { audience: 'members', trap: 'clock' } }
		expect(eventOf(clock).key).toBe('ev_charter_bot_clock')
		const pub = { action: 'octoguard.charter_published', actor_username: 'Jonathan', target_label: null, metadata: { audience: 'team', version: 3, important: true } }
		expect(tFr(`og2.${eventOf(pub).key}`, eventVars(pub, tFr))).toBe('Jonathan a publié la version 3 de la charte de l\'équipe. Changement important : tout le monde re-signe.')
	})
})
