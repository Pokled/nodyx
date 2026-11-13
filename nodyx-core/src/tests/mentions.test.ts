// ─── resolveMentions : plafond + périmètre communauté ───────────────────────
//
// Trouvé en audit de la couche temps réel le 16/09 : un seul message pouvait
// porter un nombre illimité de mentions distinctes, chacune déclenchant un
// fetchSockets + un INSERT + un COUNT + un SELECT + un Web Push — un compte
// membre ordinaire pouvait ainsi amplifier un seul message en dizaines de
// milliers de requêtes. La résolution n'était pas non plus scopée à la
// communauté du canal : un utilisateur exclu pouvait quand même être notifié.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const dbQuery = vi.fn()
vi.mock('../config/database', () => ({
	db: { query: (...a: unknown[]) => dbQuery(...a) },
}))

beforeEach(() => {
	dbQuery.mockReset()
})

describe('resolveMentions', () => {
	it('ne dépasse jamais MAX_MENTIONS_PER_MESSAGE quel que soit le nombre de @mentions dans le texte', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [] })

		const manyMentions = Array.from({ length: 1000 }, (_, i) => `@user${i}`).join(' ')
		await resolveMentions(manyMentions, 'community-1')

		expect(dbQuery).toHaveBeenCalledTimes(1)
		const [, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
		const usernamesQueried = params[0]
		expect(usernamesQueried.length).toBeLessThanOrEqual(20)
	})

	it('scope la résolution à la communauté fournie', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [{ id: 'user-a' }] })

		await resolveMentions('salut @alice', 'community-42')

		const [sql, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
		expect(sql).toMatch(/community_members/)
		expect(sql).toMatch(/cm\.community_id\s*=\s*\$2/)
		expect(params[1]).toBe('community-42')
	})

	it("ne fait aucune requête DB s'il n'y a aucune mention", async () => {
		const { resolveMentions } = await import('../utils/mentions')
		const result = await resolveMentions('aucune mention ici', 'community-1')
		expect(result).toEqual([])
		expect(dbQuery).not.toHaveBeenCalled()
	})

	it('déduplique les mentions répétées avant de plafonner', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [] })

		await resolveMentions('@bob @bob @bob @bob', 'community-1')

		const [, params] = dbQuery.mock.calls[0] as [string, [string[], string]]
		expect(params[0]).toEqual(['bob'])
	})
})

describe('resolveMentions : la mention liée à la personne (D49)', () => {
	const A = '11111111-1111-4111-8111-111111111111'
	const B = '22222222-2222-4222-8222-222222222222'

	it('lit la marque data-mention, et pas son texte comme un pseudo', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [{ id: A }] })
		await resolveMentions(`<p>Merci <span data-mention="u:${A}">@Léa la-grande</span> !</p>`, 'c1')
		const [, params] = dbQuery.mock.calls[0] as [string, [string[], string, string[]]]
		expect(params[2]).toEqual([A])
		expect(params[0]).toEqual([])   // « @Léa la-grande » n'est pas lu comme le pseudo « léa »
	})

	it('comprend les deux formes dans un même message', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [] })
		await resolveMentions(`<p><span data-mention="u:${A}">@Léa</span> et @bob</p>`, 'c1')
		const [sql, params] = dbQuery.mock.calls[0] as [string, [string[], string, string[]]]
		expect(params[0]).toEqual(['bob'])
		expect(params[2]).toEqual([A])
		expect(sql).toMatch(/cm\.community_id\s*=\s*\$2/)
	})

	it('le plafond de 20 porte sur l’ensemble des deux formes', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValueOnce({ rows: [] })
		const marks = Array.from({ length: 15 }, (_, i) => `<span data-mention="u:${String(i).padStart(8, '0')}-1111-4111-8111-111111111111">@x</span>`).join(' ')
		const legacy = Array.from({ length: 15 }, (_, i) => `@user${i}`).join(' ')
		await resolveMentions(marks + ' ' + legacy, 'c1')
		const [, params] = dbQuery.mock.calls[0] as [string, [string[], string, string[]]]
		expect(params[0].length + params[2].length).toBe(20)
	})

	it('une marque à la valeur invalide n’est pas une mention', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		const r = await resolveMentions(`<span data-mention="u:pas-un-id">@x</span>`, 'c1')
		expect(r).toEqual([])
		expect(dbQuery).not.toHaveBeenCalled()
	})

	it('un texte hostile de 500 Ko se lit vite', async () => {
		const { resolveMentions } = await import('../utils/mentions')
		dbQuery.mockResolvedValue({ rows: [] })
		const hostile = '<span data-mention="u:' + 'a'.repeat(250_000) + '<span ' + 'data-mention '.repeat(20_000)
		const t = performance.now(); await resolveMentions(hostile, 'c1')
		expect(performance.now() - t).toBeLessThan(500)
	})
})
