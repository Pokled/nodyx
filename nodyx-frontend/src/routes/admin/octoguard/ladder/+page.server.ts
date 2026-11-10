import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// Le barème des sanctions (lot 4b) : toute l'équipe le lit, manage_octoguard le règle.
export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const res = await apiFetch(fetch, '/admin/octoguard/ladder/settings', { headers })
		return res.ok ? { ladder: await res.json(), failed: false } : { ladder: null, failed: true }
	} catch { return { ladder: null, failed: true } }
}
