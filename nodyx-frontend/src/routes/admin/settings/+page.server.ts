import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await apiFetch(fetch, '/instance/info')
	const instance = await res.json()
	return { instance }
}

export const actions: Actions = {
	saveBranding: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form = await request.formData()
		const logo_url      = (form.get('logo_url')   as string | null) || null
		const banner_url    = (form.get('banner_url') as string | null) || null

		// Champ ABSENT du formulaire != champ vide. Une page admin restee ouverte
		// sur un build anterieur ne connait pas `sidebar_bg` et ne l'envoie pas :
		// l'enregistrer effacait alors un fond deja configure, en silence. On ne
		// transmet la cle que si le formulaire l'a reellement portee -- le PATCH
		// cote core distingue deja `undefined` (ne pas toucher) de `null` (effacer).
		const payload: Record<string, unknown> = { logo_url, banner_url }
		if (form.has('sidebar_bg')) {
			const raw = (form.get('sidebar_bg') as string | null) || null
			payload.sidebar_bg = raw ? JSON.parse(raw) : null
		}

		const res = await apiFetch(fetch, '/admin/branding', {
			method:  'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify(payload),
		})
		if (!res.ok) return { error: (await res.json()).error ?? 'Erreur lors de la sauvegarde' }
		return { ok: true }
	},
}
