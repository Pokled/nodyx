import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, params }) => {
	const res = await apiFetch(fetch, `/music/categories/${params.slug}`);
	if (res.status === 404) error(404, 'Catégorie introuvable.');
	if (!res.ok) error(500, 'Erreur serveur.');
	const { category, tracks } = await res.json();
	return { category, tracks };
};
