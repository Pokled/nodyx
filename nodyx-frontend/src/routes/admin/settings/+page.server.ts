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
		const sidebarBgRaw  = (form.get('sidebar_bg') as string | null) || null
		const sidebar_bg    = sidebarBgRaw ? JSON.parse(sidebarBgRaw) : null

		const res = await apiFetch(fetch, '/admin/branding', {
			method:  'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ logo_url, banner_url, sidebar_bg }),
		})
		if (!res.ok) return { error: (await res.json()).error ?? 'Erreur lors de la sauvegarde' }
		return { ok: true }
	},
}
