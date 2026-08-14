import { error } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { loadRegistry } from '$lib/registryFs'
import { latestVersion, categoriesOf } from '$lib/registry'

export const load: PageServerLoad = async ({ params }) => {
	const entry = loadRegistry().find((e) => e.id === params.id)
	if (!entry) throw error(404, 'not_found')

	const latest = latestVersion(entry)
	return {
		entry: {
			...entry,
			categories: categoriesOf(entry),
			versions: [...entry.versions].sort((a, b) => b.version.localeCompare(a.version)),
		},
		latest,
	}
}
