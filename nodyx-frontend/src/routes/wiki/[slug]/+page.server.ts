import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent, params }) => {
	const { token } = await parent()
	if (!token) redirect(302, `/auth/login?redirectTo=/wiki/${params.slug}`)

	const res = await apiFetch(fetch, `/wiki/${params.slug}`, {
		headers: { Authorization: `Bearer ${token}` },
	})

	if (res.status === 503) redirect(302, '/')
	if (res.status === 404) error(404, 'Page introuvable')
	if (!res.ok) error(500, 'Erreur')

	const wikiPage = await res.json()
	return { wikiPage }
}
