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
	const [settings, rules, stats, logs] = await Promise.all([
		get('/admin/octoguard/settings'),
		get('/admin/octoguard/rules'),
		get('/admin/octoguard/stats?days=7'),
		get('/admin/octoguard/logs?limit=6'),
	])
	return {
		settings,
		rules: rules?.rules ?? [],
		stats,
		logs: logs?.logs ?? [],
		failed: rules === null,
	}
}
