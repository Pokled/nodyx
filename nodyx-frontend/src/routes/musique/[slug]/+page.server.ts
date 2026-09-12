import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, params, url }) => {
	const res = await apiFetch(fetch, `/music/categories/${params.slug}`);
	if (res.status === 404) error(404, 'Category not found.');
	if (!res.ok) error(500, 'Server error.');
	const { category, tracks } = await res.json();

	const settingsRes = await apiFetch(fetch, '/music/settings');
	const settingsJson = settingsRes.ok ? await settingsRes.json() : { settings: null };

	// ?t=<id> : le lien de partage d'un morceau précis (bouton "Partager" sur
	// chaque piste) porte son propre id, pour que l'aperçu Discord montre CE
	// morceau (titre, image) plutôt que celui de la catégorie entière. Le
	// contenu affiché au visiteur humain ne change pas, seules les balises
	// og: changent (voir +page.svelte).
	const featuredTrackId = url.searchParams.get('t');

	return { category, tracks, settings: settingsJson.settings ?? null, featuredTrackId };
};
