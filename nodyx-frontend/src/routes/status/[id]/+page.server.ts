import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
	const token = cookies.get('token')
	const headers = token ? { Authorization: `Bearer ${token}` } : undefined
	const res = await apiFetch(fetch, `/social/status/${params.id}`, { headers })
	if (!res.ok) throw error(404, 'Publication introuvable')
	const { post, replies } = await res.json()
	return { post, replies: replies ?? [], token: token ?? null }
}
