import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const res = await apiFetch(fetch, '/admin/octoguard/profile/base', { headers })
		return res.ok ? { base: await res.json(), failed: false } : { base: null, failed: true }
	} catch { return { base: null, failed: true } }
}
