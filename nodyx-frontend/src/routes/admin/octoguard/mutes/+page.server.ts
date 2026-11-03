import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const res = await apiFetch(fetch, '/admin/octoguard/mutes?active=true', { headers })
		return res.ok ? { mutes: (await res.json()).mutes ?? [], failed: false } : { mutes: [], failed: true }
	} catch { return { mutes: [], failed: true } }
}
