import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const get = async (path: string) => {
		try {
			const res = await apiFetch(fetch, path, { headers })
			return res.ok ? await res.json() : null
		} catch { return null }
	}
	const [rules, stats, settings] = await Promise.all([
		get('/admin/octoguard/rules'),
		get('/admin/octoguard/stats?days=7'),
		get('/admin/octoguard/settings'),
	])
	return {
		rules: rules?.rules ?? [],
		stats: stats?.rules ?? {},
		settings,
		failed: rules === null,
	}
}
