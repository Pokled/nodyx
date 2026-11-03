import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// Le Guide lit l'état réel de l'instance pour sa liste « Avant d'allumer ».
export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const get = async (path: string) => {
		try { const r = await apiFetch(fetch, path, { headers }); return r.ok ? await r.json() : null } catch { return null }
	}
	const [settings, rules, stats, base, welcome] = await Promise.all([
		get('/admin/octoguard/settings'), get('/admin/octoguard/rules'), get('/admin/octoguard/stats?days=7'),
		get('/admin/octoguard/profile/base'), get('/admin/octoguard/welcome'),
	])
	return { settings, rules: rules?.rules ?? [], stats, base, welcome: welcome?.welcome ?? null }
}
