import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const get = async (path: string, auth = true) => {
		try { const r = await apiFetch(fetch, path, auth ? { headers } : {}); return r.ok ? await r.json() : null } catch { return null }
	}
	const [w, ch, info] = await Promise.all([get('/admin/octoguard/welcome'), get('/chat/channels'), get('/instance/info', false)])
	const slug = info?.community?.slug ?? info?.slug ?? null
	const gr = slug ? await get(`/communities/${encodeURIComponent(slug)}/grades`, false) : null
	return {
		welcome: w?.welcome ?? null,
		channels: (ch?.channels ?? []).filter((c: any) => (c.type ?? 'text') === 'text').map((c: any) => ({ id: c.id, name: c.name })),
		grades: (gr?.grades ?? []).map((g: any) => ({ id: g.id, name: g.name })),
		communityName: info?.community?.name ?? info?.name ?? 'Nodyx',
		failed: w === null,
	}
}
