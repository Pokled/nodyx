import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// Les chartes (lot 7, CDC §E4j) : les deux chartes, chacune avec son brouillon,
// ses versions et ses réglages. Lecture : manage_octoguard ou moderate_members.
export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const [m, t] = await Promise.all([
			apiFetch(fetch, '/admin/charter/members', { headers }),
			apiFetch(fetch, '/admin/charter/team', { headers }),
		])
		if (!m.ok || !t.ok) return { members: null, team: null, failed: true }
		return { members: await m.json(), team: await t.json(), failed: false }
	} catch { return { members: null, team: null, failed: true } }
}
