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

const ERRORS: Record<string, string> = {
	ANNOUNCEMENT_MESSAGE_REQUIRED: 'aann.err_message',
	ANNOUNCEMENT_BAD_COLOR:        'aann.err_color',
	ANNOUNCEMENT_BAD_EXPIRY:       'aann.err_expiry',
}
async function errorKey(res: Response, fallback: string): Promise<string> {
	if (res.status === 404) return 'aann.err_gone'
	const json = await res.json().catch(() => ({}))
	return ERRORS[json.code ?? ''] ?? fallback
}

export const actions: Actions = {
	create: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token')
		const fd = await request.formData()
		const message   = String(fd.get('message') ?? '').trim()
		const color     = String(fd.get('color') ?? 'indigo')
		const expires_at = fd.get('expires_at') ? String(fd.get('expires_at')) : null

		if (!message) return fail(400, { errorKey: 'aann.err_message' })

		const res = await apiFetch(fetch, '/admin/announcements', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, color, expires_at }),
		})
		if (!res.ok) return fail(res.status, { errorKey: await errorKey(res, 'aann.err_create') })
		return { ok: true }
	},

	// Modifier une annonce déjà publiée : texte, couleur, expiration.
	// expires_at arrive en ISO (avec fuseau, calculé par le navigateur) ou vide = sans fin.
	update: async ({ request, fetch, cookies }) => {
		const token = cookies.get('token')
		const fd = await request.formData()
		const id         = String(fd.get('id') ?? '')
		const message    = String(fd.get('message') ?? '').trim()
		const color      = String(fd.get('color') ?? 'indigo')
		const expires_at = fd.get('expires_at') ? String(fd.get('expires_at')) : null

		if (!message) return fail(400, { editId: id, errorKey: 'aann.err_message' })

		const res = await apiFetch(fetch, `/admin/announcements/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body: JSON.stringify({ message, color, expires_at }),
		})
		if (!res.ok) return fail(res.status, { editId: id, errorKey: await errorKey(res, 'aann.err_update') })
		return { updated: id }
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
