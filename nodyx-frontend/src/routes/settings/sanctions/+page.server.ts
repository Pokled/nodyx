import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// OctoGuard lot 8 : mes avertissements et sourdines des 30 derniers jours, pour
// les contester. Le cœur ne renvoie ni le nom de la règle ni celui de l'auteur (D20).
export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	if (!token) redirect(303, '/auth/login')
	try {
		const res = await apiFetch(fetch, '/reports/decisions/mine', { headers: { Authorization: `Bearer ${token}` } })
		if (!res.ok) return { decisions: [], appealDays: 30, failed: true }
		const json = await res.json()
		return { decisions: json.decisions ?? [], appealDays: (json.appeal_days as number) ?? 30, failed: false }
	} catch {
		return { decisions: [], appealDays: 30, failed: true }
	}
}
