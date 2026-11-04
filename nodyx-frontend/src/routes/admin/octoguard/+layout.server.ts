import type { LayoutServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// L'état d'OctoGuard affiché sous son nom, dans la colonne (« ● Actif · 7 règles »).
export const load: LayoutServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const get = async (path: string) => {
		try { const r = await apiFetch(fetch, path, { headers }); return r.ok ? await r.json() : null } catch { return null }
	}
	const [settings, rules] = await Promise.all([get('/admin/octoguard/settings'), get('/admin/octoguard/rules')])
	if (!settings || !rules) return { ogStatus: null }
	return { ogStatus: { enabled: !!settings.enabled, active: (rules.rules ?? []).filter((r: any) => r.enabled).length } }
}
