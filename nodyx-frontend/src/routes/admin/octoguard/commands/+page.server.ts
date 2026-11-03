import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	try {
		const res = await apiFetch(fetch, '/admin/octoguard/commands', { headers })
		return res.ok ? { commands: (await res.json()).commands ?? [], failed: false } : { commands: [], failed: true }
	} catch { return { commands: [], failed: true } }
}
