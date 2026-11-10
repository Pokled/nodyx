import { describe, it, expect } from 'vitest'
import { OG_NAV } from './nav'
import { mayOpenAdmin, type AdminAccess } from '$lib/adminAccess'

// Ce que chaque profil voit dans le menu d'OctoGuard (même filtre que admin/+layout).
const visible = (access: AdminAccess) =>
	OG_NAV.flatMap((g) => g.items).filter((i) => mayOpenAdmin(i.href, access)).map((i) => i.href)

describe('menu d\'OctoGuard selon les droits', () => {
	it('un admin voit tout', () => {
		expect(visible({ role: 'admin', permissions: [] })).toHaveLength(OG_NAV.flatMap((g) => g.items).length)
	})

	it('un modérateur des membres ne voit que signalements et sourdines', () => {
		expect(visible({ role: 'moderator', permissions: ['moderate_members'] })).toEqual(['/admin/octoguard/reports', '/admin/octoguard/mutes', '/admin/octoguard/ladder'])
	})

	it('le droit « gérer OctoGuard » ouvre les règles, le bac à sable et le journal', () => {
		const v = visible({ role: 'moderator', permissions: ['manage_octoguard'] })
		for (const href of ['/admin/octoguard', '/admin/octoguard/rules', '/admin/octoguard/sandbox', '/admin/octoguard/logs'])
			expect(v).toContain(href)
	})

	it('un membre de l\'équipe sans droit de modération ne voit rien', () => {
		expect(visible({ role: 'moderator', permissions: ['manage_categories'] })).toEqual([])
		expect(visible(null as unknown as AdminAccess)).toEqual([])
	})
})
