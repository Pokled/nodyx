import type { PageServerLoad } from './$types'
import { apiFetch }            from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()

	const res = await apiFetch(fetch, '/admin/modules', {
		headers: { Authorization: `Bearer ${token}` },
	})

	const modules: Array<{
		id:         string
		family:     string
		enabled:    boolean
		config:     Record<string, unknown>
		updated_at: string
	}> = res.ok ? await res.json() : []

	return { modules }
}
