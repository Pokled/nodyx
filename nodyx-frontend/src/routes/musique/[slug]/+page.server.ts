import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const res = await apiFetch(fetch, `/music/categories/${params.slug}`);
	if (res.status === 404) error(404, 'Category not found.');
	if (!res.ok) error(500, 'Server error.');
	const { category, tracks } = await res.json();

	// Même lettre de "côté" que sur /musique : dérivée du rang dans la liste
	// affichée (pas de la colonne position brute, qui peut avoir des trous
	// après une suppression de catégorie).
	const listRes = await apiFetch(fetch, '/music/categories');
	let index = 0;
	if (listRes.ok) {
		const { categories } = await listRes.json();
		const found = (categories as { id: string }[]).findIndex((c) => c.id === category.id);
		if (found >= 0) index = found;
	}

	return { category, tracks, index };
};
