import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10) || 1)
	try {
		const res = await apiFetch(fetch, `/admin/octoguard/logs?page=${page}&limit=50`, { headers })
		if (!res.ok) return { logs: [], total: 0, page, limit: 50, failed: true }
		return { ...(await res.json()), failed: false }
	} catch {
		return { logs: [], total: 0, page, limit: 50, failed: true }
	}
}
