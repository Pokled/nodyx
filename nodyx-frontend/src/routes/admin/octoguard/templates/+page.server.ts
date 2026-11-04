import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const get = async (path: string) => {
		try { const r = await apiFetch(fetch, path, { headers }); return r.ok ? await r.json() : null } catch { return null }
	}
	const [base, rules] = await Promise.all([get('/admin/octoguard/profile/base'), get('/admin/octoguard/rules')])
	return { base, rules: rules?.rules ?? [], failed: base === null }
}
