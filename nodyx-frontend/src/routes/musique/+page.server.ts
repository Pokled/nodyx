import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const [catRes, settingsRes] = await Promise.all([
		apiFetch(fetch, '/music/categories'),
		apiFetch(fetch, '/music/settings'),
	]);
	const catJson      = catRes.ok ? await catRes.json() : { categories: [] };
	const settingsJson = settingsRes.ok ? await settingsRes.json() : { settings: null };
	return {
		categories: catJson.categories ?? [],
		settings:   settingsJson.settings ?? null,
	};
};
