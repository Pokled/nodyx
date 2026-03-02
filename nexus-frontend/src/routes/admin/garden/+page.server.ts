import { fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()
	const res = await apiFetch(fetch, '/garden/seeds/admin/all', {
		headers: { Authorization: `Bearer ${token}` },
	})
	if (!res.ok) return { seeds: [] }
	const { seeds } = await res.json()
	return { seeds }
}

export const actions: Actions = {
	delete: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form  = await request.formData()
		const id    = form.get('id') as string
		const res = await apiFetch(fetch, `/garden/seeds/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
	},

	harvest: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form  = await request.formData()
		const id    = form.get('id') as string
		const res = await apiFetch(fetch, `/garden/seeds/${id}/harvest`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
	},
}
