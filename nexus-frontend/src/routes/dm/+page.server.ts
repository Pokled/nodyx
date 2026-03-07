import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	if (!token) redirect(303, '/auth/login')

	const res = await apiFetch(fetch, '/dm/conversations', {
		headers: { Authorization: `Bearer ${token}` }
	})

	const { conversations } = res.ok ? await res.json() : { conversations: [] }
	return { conversations, token }
}
