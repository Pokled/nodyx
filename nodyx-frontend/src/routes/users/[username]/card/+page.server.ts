import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ params, fetch, url }) => {
	const { username } = params

	const res = await apiFetch(fetch, `/users/${username}/profile`)
	if (res.status === 404) error(404, 'Utilisateur introuvable')
	if (!res.ok)           error(500, 'Erreur serveur')

	const profile = await res.json()

	// Activity (last 12 weeks), best effort.
	// L'API renvoie un tableau [{ date, count }] : on le replie en Record<date, count>
	// pour que la heatmap puisse faire ses lookups par date (sinon toutes les cases à 0).
	let activity: Record<string, number> = {}
	try {
		const ar = await apiFetch(fetch, `/users/${username}/activity`)
		if (ar.ok) {
			const raw = (await ar.json()).activity ?? []
			activity = Array.isArray(raw)
				? Object.fromEntries(raw.map((r: { date: string; count: number }) => [r.date, r.count]))
				: raw
		}
	} catch { /* ignore */ }

	const origin = url.origin

	return { profile, activity, origin }
}
