import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// Webhooks de la communauté (D38-D39) : destinations, familles, estimations.
export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const res = await apiFetch(fetch, '/admin/webhooks', { headers })
		if (!res.ok) return { failed: true, data: null }
		return { failed: false, data: await res.json() }
	} catch {
		return { failed: true, data: null }
	}
}
