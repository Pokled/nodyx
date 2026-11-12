import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// Le bouclier anti-raid (lot 6) : toute l'équipe le lève et le baisse,
// manage_octoguard règle l'alerte automatique.
export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const res = await apiFetch(fetch, '/admin/octoguard/shield', { headers })
		return res.ok ? { shield: await res.json(), failed: false } : { shield: null, failed: true }
	} catch { return { shield: null, failed: true } }
}
