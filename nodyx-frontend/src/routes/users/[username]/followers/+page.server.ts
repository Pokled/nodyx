import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'
import { error } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, params, cookies }) => {
	const token = cookies.get('token')
	const headers = token ? { Authorization: `Bearer ${token}` } : {}

	const res = await apiFetch(fetch, `/social/${encodeURIComponent(params.username)}/followers?limit=50`, { headers })
	if (!res.ok) error(res.status, 'Impossible de charger les abonnés')
	const { users } = await res.json() as {
		users: Array<{ id: string; username: string; display_name: string | null; avatar_url: string | null; followed_at: string }>
	}

	return {
		username: params.username,
		users,
		mode: 'followers' as const,
	}
}
