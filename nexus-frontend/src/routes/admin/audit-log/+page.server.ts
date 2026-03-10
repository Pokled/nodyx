import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token  = cookies.get('token')
	const offset = Number(url.searchParams.get('offset') ?? 0)
	const action = url.searchParams.get('action') ?? ''
	const actor  = url.searchParams.get('actor')  ?? ''

	const params = new URLSearchParams({ limit: '50', offset: String(offset) })
	if (action) params.set('action', action)
	if (actor)  params.set('actor', actor)

	const res = await apiFetch(fetch, `/admin/audit-log?${params}`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	const json = res.ok ? await res.json() : { entries: [], total: 0, limit: 50, offset: 0 }

	return {
		entries:  json.entries  ?? [],
		total:    json.total    ?? 0,
		limit:    json.limit    ?? 50,
		offset:   json.offset   ?? 0,
		filterAction: action,
		filterActor:  actor,
	}
}
