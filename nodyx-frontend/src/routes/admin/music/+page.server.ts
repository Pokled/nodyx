import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const res = await apiFetch(fetch, '/music/categories');
	const json = res.ok ? await res.json() : { categories: [] };
	return { categories: json.categories ?? [] };
};
