import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()

	const res = await apiFetch(fetch, '/admin/extensions', {
		headers: { Authorization: `Bearer ${token}` },
	}).catch(() => null)

	const json = res?.ok ? await res.json() : { extensions: [] }

	return {
		extensions: (json.extensions ?? []) as Array<{
			id:           string
			manifest:     Record<string, unknown>
			version:      string
			origin:       string
			enabled:      boolean
			granted:      string[]
			installed_at: string
		}>,
	}
}
