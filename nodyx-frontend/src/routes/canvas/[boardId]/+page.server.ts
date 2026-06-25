import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, cookies, params, parent }) => {
	const { modules } = await parent()
	if (!modules?.canvas) throw error(404, 'Le module Canvas est désactivé sur cette instance.')

	const token = cookies.get('token')
	if (!token) redirect(303, '/auth/login')

	const res = await apiFetch(fetch, `/canvas/${params.boardId}`, {
		headers: { Authorization: `Bearer ${token}` }
	})
	if (!res.ok) throw error(res.status === 404 ? 404 : 403, 'Projet introuvable ou accès refusé.')

	const { board } = await res.json()
	return { board, token }
}
