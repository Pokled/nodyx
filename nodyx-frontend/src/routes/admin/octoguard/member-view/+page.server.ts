import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const get = async (path: string, auth = true) => {
		try { const r = await apiFetch(fetch, path, auth ? { headers } : {}); return r.ok ? await r.json() : null } catch { return null }
	}
	const [w, cmds, ch, info] = await Promise.all([
		get('/admin/octoguard/welcome'), get('/admin/octoguard/commands'), get('/chat/channels'), get('/instance/info', false),
	])
	const welcome = w?.welcome ?? null
	const channel = welcome?.channel_id ? (ch?.channels ?? []).find((c: any) => c.id === welcome.channel_id)?.name ?? null : null
	return {
		welcome,
		welcomeChannel: channel,
		commands: (cmds?.commands ?? []).filter((c: any) => c.enabled).slice(0, 4),
		communityName: info?.community?.name ?? info?.name ?? 'Nodyx',
	}
}
