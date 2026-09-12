import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const res = await apiFetch(fetch, `/music/categories/${params.slug}`);
	if (res.status === 404) error(404, 'Category not found.');
	if (!res.ok) error(500, 'Server error.');
	const { category, tracks } = await res.json();

	const settingsRes = await apiFetch(fetch, '/music/settings');
	const settingsJson = settingsRes.ok ? await settingsRes.json() : { settings: null };

	return { category, tracks, settings: settingsJson.settings ?? null };
};
