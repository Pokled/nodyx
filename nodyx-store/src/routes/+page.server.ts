import type { PageServerLoad } from './$types'
import { loadRegistry } from '$lib/registryFs'
import { filterEntries, categoriesOf, type Category } from '$lib/registry'

export const load: PageServerLoad = async ({ url }) => {
	const q        = url.searchParams.get('q') ?? ''
	const rawCat   = url.searchParams.get('c')
	const category = (rawCat === 'widgets' || rawCat === 'modules' ? rawCat : undefined) as Category | undefined

	const all = loadRegistry()
	return {
		q,
		category: category ?? null,
		total: all.length,
		extensions: filterEntries(all, { q, category }).map((e) => ({
			id: e.id, label: e.label, description: e.description,
			author: e.author, official: Boolean(e.official), icon: e.icon ?? null,
			categories: categoriesOf(e),
			permissions: e.versions[0]?.permissions?.length ?? 0,
			version: e.versions[e.versions.length - 1]?.version ?? '',
		})),
	}
}
