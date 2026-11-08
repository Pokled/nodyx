import { describe, it, expect } from 'vitest'
import fr from './locales/fr.json'
import en from './locales/en.json'
import { blockedMessage } from './chatBlocked'

// Un tFn qui lit les vrais fichiers de langue : une clé absente ressortirait telle quelle
const make = (dict: Record<string, string>) => (k: string, vars: Record<string, string> = {}) =>
	(dict[k] ?? `!!${k}`).replace(/\{\{(\w+)\}\}/g, (_, v) => vars[v] ?? '')

// Les phrases que le cœur envoie EN DUR aujourd'hui (services/contentFilter.ts)
const CORE_PROSE = [
	'Contenu refusé : symbole haineux ou interdit détecté',
	"Contenu refusé : correspond à un filtre de l'administrateur",
]

describe('ce que voit un membre dont le message est refusé', () => {
	for (const [lang, dict] of [['fr', fr], ['en', en]] as const) {
		const t = make(dict as Record<string, string>)
		const cases = [
			{ reason: 'channel_read_only' },
			{ reason: 'muted' },
			{ reason: 'muted', octoguard: { expires_at: '2026-11-08T20:00:00Z' } },
			{ reason: 'octoguard', octoguard: { i18n_key: 'octoguard' + '.message.deleted' } },
			{ reason: 'OCTOGUARD_HELD_LIMIT', octoguard: { i18n_key: 'octoguard' + '.held_limit' } },
			...CORE_PROSE.map(reason => ({ reason })),
			{ reason: 'une_raison_qui_n_existe_pas_encore' },
			{},
			null,
		]
		it(`${lang} : toujours une vraie phrase traduite, jamais une clé manquante`, () => {
			for (const c of cases) {
				const out = blockedMessage(t, c, () => '8 nov.')
				expect(out, JSON.stringify(c)).not.toMatch(/^!!/)
				expect(out.length).toBeGreaterThan(10)
			}
		})
		it(`${lang} : la raison brute du cœur n'est jamais affichée`, () => {
			for (const reason of ['channel_read_only', 'une_raison_qui_n_existe_pas_encore', ...CORE_PROSE]) {
				expect(blockedMessage(t, { reason })).not.toContain(reason)
			}
		})
	}

	it('chaque cas a SA phrase : lecture seule, sourdine datée, OctoGuard, refus général', () => {
		const t = make(fr as Record<string, string>)
		expect(blockedMessage(t, { reason: 'channel_read_only' })).toBe(fr['chat.blocked_read_only'])
		expect(blockedMessage(t, { reason: 'muted' })).toBe(fr['chat.muted'])
		expect(blockedMessage(t, { reason: 'muted', octoguard: { expires_at: 'x' } }, () => '8 nov.')).toContain('8 nov.')
		expect(blockedMessage(t, { reason: 'octoguard', octoguard: { i18n_key: 'octoguard' + '.held_edit' } })).toBe(fr['ogmsg.held_edit'])
		expect(blockedMessage(t, { reason: CORE_PROSE[0] })).toBe(fr['chat.message_refused'])
	})

	it('un membre anglophone ne lit plus de français quand le filtre refuse son message', () => {
		const out = blockedMessage(make(en as Record<string, string>), { reason: CORE_PROSE[0] })
		expect(out).toBe(en['chat.message_refused'])
		expect(out).not.toMatch(/refusé|interdit/)
	})
})
