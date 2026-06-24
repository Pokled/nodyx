import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, parent }) => {
	const { modules } = await parent()
	if (!modules?.canvas) throw error(404, 'Le module Canvas est désactivé sur cette instance.')

	const token = cookies.get('token')
	if (!token) redirect(303, '/auth/login')

	const headers = { Authorization: `Bearer ${token}` }
	const [mineRes, pubRes] = await Promise.all([
		apiFetch(fetch, '/canvas/boards', { headers }),
		apiFetch(fetch, '/canvas/public', { headers }),
	])
	const { boards }              = mineRes.ok ? await mineRes.json() : { boards: [] }
	const { boards: publicBoards } = pubRes.ok ? await pubRes.json() : { boards: [] }
	return { boards, publicBoards, token }
}
