import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const res = await apiFetch(fetch, '/admin/octoguard/webhook', { headers })
		return res.ok ? { webhook: await res.json(), failed: false } : { webhook: null, failed: true }
	} catch { return { webhook: null, failed: true } }
}
