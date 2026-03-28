import { redirect, error, fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent, params }) => {
	const { token, user } = await parent()
	if (!token) redirect(302, `/auth/login?redirectTo=/wiki/${params.slug}/edit`)

	const res = await apiFetch(fetch, `/wiki/${params.slug}`, {
		headers: { Authorization: `Bearer ${token}` },
	})

	if (res.status === 503) redirect(302, '/')
	if (res.status === 404) error(404, 'Page introuvable')
	if (!res.ok) error(500, 'Erreur')

	const wikiPage = await res.json()

	// Only author or admin/mod can edit
	const canEdit =
		user?.role === 'owner' ||
		user?.role === 'admin' ||
		user?.role === 'moderator' ||
		user?.username === wikiPage.author_username

	if (!canEdit) redirect(302, `/wiki/${params.slug}`)

	return { wikiPage }
}

export const actions: Actions = {
	default: async ({ request, fetch, cookies, params }) => {
		const token    = cookies.get('token')
		const formData = await request.formData()

		const title    = (formData.get('title')    as string)?.trim()
		const content  = (formData.get('content')  as string) ?? ''
		const excerpt  = (formData.get('excerpt')  as string)?.trim() || null
		const category = (formData.get('category') as string)?.trim() || null
		const is_public = formData.get('is_public') === 'on'

		if (!title) return fail(400, { error: 'Le titre est obligatoire.' })

		const res = await apiFetch(fetch, `/wiki/${params.slug}`, {
			method:  'PATCH',
			headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
			body:    JSON.stringify({ title, content, excerpt, category, is_public }),
		})

		if (!res.ok) {
			const err = await res.json().catch(() => ({}))
			return fail(res.status, { error: err.error ?? 'Erreur lors de la mise à jour.' })
		}

		const { slug: newSlug } = await res.json()
		redirect(303, `/wiki/${newSlug}`)
	},
}
