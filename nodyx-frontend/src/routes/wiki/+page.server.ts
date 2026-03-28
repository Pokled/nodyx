import { redirect, error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent, url }) => {
	const { token } = await parent()
	if (!token) redirect(302, `/auth/login?redirectTo=/wiki`)

	const category = url.searchParams.get('category') ?? ''
	const search   = url.searchParams.get('search')   ?? ''

	const params = new URLSearchParams()
	if (category) params.set('category', category)
	if (search)   params.set('search',   search)

	const path = `/wiki${params.size ? '?' + params.toString() : ''}`

	const res = await apiFetch(fetch, path, {
		headers: { Authorization: `Bearer ${token}` },
	})

	if (res.status === 503) redirect(302, '/')  // module disabled
	if (!res.ok) error(res.status, 'Erreur lors du chargement du wiki')

	const data = await res.json()
	return {
		pages:      data.pages      as WikiPageSummary[],
		categories: data.categories as string[],
		activeCategory: category,
		search,
	}
}

export interface WikiPageSummary {
	id:               string
	slug:             string
	title:            string
	excerpt:          string | null
	category:         string | null
	is_public:        boolean
	views:            number
	created_at:       string
	updated_at:       string
	author_username:  string | null
	author_avatar:    string | null
}
