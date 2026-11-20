import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ parent, fetch }) => {
	const { user, token } = await parent()
	if (!user) throw redirect(302, '/login')

	const headers = { Authorization: `Bearer ${token}` }

	const [feedRes, meRes] = await Promise.all([
		apiFetch(fetch, '/social/feed?limit=20', { headers }),
		// L'équipe (moderate_content) peut retirer la publication d'un autre ; le cœur tranche
		apiFetch(fetch, '/admin/me', { headers }).catch(() => null),
	])
	const posts = feedRes.ok ? (await feedRes.json()).posts ?? [] : []
	const access = meRes?.ok ? await meRes.json().catch(() => null) : null
	const canModerate = Array.isArray(access?.permissions) && access.permissions.includes('moderate_content')

	return { posts, canModerate }
}
