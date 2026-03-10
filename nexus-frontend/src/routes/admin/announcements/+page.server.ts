import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token')
	const res = await apiFetch(fetch, '/admin/announcements', {
		headers: { Authorization: `Bearer ${token}` },
	})
	const json = res.ok ? await res.json() : { announcements: [] }
	return { announcements: json.announcements ?? [] }
}

export const actions: Actions = {
	create: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token')
		const fd = await request.formData()
		const message   = String(fd.get('message') ?? '').trim()
		const color     = String(fd.get('color') ?? 'indigo')
		const expires_at = fd.get('expires_at') ? String(fd.get('expires_at')) : null

		if (!message) return fail(400, { error: 'Le message est requis.' })

		const res = await apiFetch(fetch, '/admin/announcements', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, color, expires_at }),
		})
		if (!res.ok) return fail(res.status, { error: 'Erreur lors de la création.' })
		return { ok: true }
	},

	toggle: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token')
		const fd = await request.formData()
		const id = String(fd.get('id'))
		const is_active = fd.get('is_active') === 'true'

		await apiFetch(fetch, `/admin/announcements/${id}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ is_active }),
		})
		return { ok: true }
	},

	delete: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token')
		const fd = await request.formData()
		const id = String(fd.get('id'))

		await apiFetch(fetch, `/admin/announcements/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		return { ok: true }
	},
}
