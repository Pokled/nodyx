import { redirect, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ parent }) => {
	const { token, user } = await parent()
	if (!token) redirect(302, '/auth/login?redirectTo=/wiki/new')
	if (!user || !['owner', 'admin', 'moderator'].includes(user.role)) redirect(302, '/wiki')
	return {}
}

export const actions: Actions = {
	default: async ({ request, fetch, cookies }) => {
		const token    = cookies.get('token')
		const formData = await request.formData()

		const title    = (formData.get('title')    as string)?.trim()
		const content  = (formData.get('content')  as string) ?? ''
		const excerpt  = (formData.get('excerpt')  as string)?.trim() || null
		const category = (formData.get('category') as string)?.trim() || null
		const is_public = formData.get('is_public') === 'on'

		if (!title) return fail(400, { error: 'Le titre est obligatoire.' })

		const res = await apiFetch(fetch, '/wiki', {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body:    JSON.stringify({ title, content, excerpt, category, is_public }),
		})

		if (!res.ok) {
			const err = await res.json().catch(() => ({}))
			return fail(res.status, { error: err.error ?? 'Erreur lors de la création.' })
		}

		const { slug } = await res.json()
		redirect(303, `/wiki/${slug}`)
	},
}
