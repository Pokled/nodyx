import { describe, it, expect } from 'vitest'
import { safeAdminNext, isTeamCharterRefusal } from './teamDoor'

describe('revenir où l’on allait après avoir signé la charte de l’équipe', () => {
	it('une page de l’admin, avec sa recherche', () => {
		expect(safeAdminNext('/admin/members?q=lea')).toBe('/admin/members?q=lea')
		expect(safeAdminNext('/admin/octoguard/reports')).toBe('/admin/octoguard/reports')
	})
	it('jamais ailleurs : autre site, autre page, boucle, vide', () => {
		for (const n of ['//evil.example/admin', 'https://evil.example', '/forum', '/admin/team-charter', '/admin/team-charter?next=/admin', '/admin/x"onload=1', '', null, undefined])
			expect([n, safeAdminNext(n)]).toEqual([n, '/admin'])
	})
})

describe('reconnaître le refus « signe d’abord la charte de l’équipe »', () => {
	const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
	it('403 + CHARTER_TEAM_UNSIGNED : oui', async () => {
		expect(await isTeamCharterRefusal(res(403, { code: 'CHARTER_TEAM_UNSIGNED' }))).toBe(true)
	})
	it('un autre refus, un autre statut, un corps illisible : non', async () => {
		expect(await isTeamCharterRefusal(res(403, { code: 'FORBIDDEN' }))).toBe(false)
		expect(await isTeamCharterRefusal(res(200, { code: 'CHARTER_TEAM_UNSIGNED' }))).toBe(false)
		expect(await isTeamCharterRefusal(new Response('pas du json', { status: 403 }))).toBe(false)
	})
	it('le corps reste lisible pour l’appelant (on lit une copie)', async () => {
		const r = res(403, { code: 'CHARTER_TEAM_UNSIGNED', error: 'x' })
		await isTeamCharterRefusal(r)
		expect((await r.json()).error).toBe('x')
	})
})
