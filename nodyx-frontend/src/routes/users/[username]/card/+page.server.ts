import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	const { username } = params

	const res = await apiFetch(fetch, `/users/${username}/profile`)
	if (res.status === 404) error(404, 'Utilisateur introuvable')
	if (!res.ok)           error(500, 'Erreur serveur')

	const profile = await res.json()

	// Activity (last 12 weeks) — best effort
	let activity: Record<string, number> = {}
	try {
		const ar = await apiFetch(fetch, `/users/${username}/activity`)
		if (ar.ok) activity = (await ar.json()).activity ?? {}
	} catch { /* ignore */ }

	const origin = url.origin

	return { profile, activity, origin }
}
