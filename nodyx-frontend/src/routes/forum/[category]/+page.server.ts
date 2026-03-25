// H:\Projets\Nodyx\nodyx-frontend\src\routes\forum\[category]\ +page.server.ts

import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

function findCategoryInTree(categories: any[], param: string): any {
	for (const cat of categories) {
		if (cat.id === param || cat.slug === param) return cat;
		if (cat.children?.length > 0) {
			const found = findCategoryInTree(cat.children, param);
			if (found) return found;
		}
	}
	return null;
}

export const load: PageServerLoad = async ({ fetch, params }) => {
	// 1. Récupérer les threads (accepte UUID ou slug côté API)
	const threadsRes = await apiFetch(fetch, `/forums/threads?category_id=${params.category}`);
	const threadsJson = await threadsRes.json();

	if (!threadsRes.ok) {
		error(threadsRes.status, threadsJson.error ?? 'Erreur chargement threads');
	}

	// 2. Récupérer l'arbre des catégories
	const categoriesRes = await apiFetch(fetch, `/instance/categories`);
	const categoriesJson = await categoriesRes.json();

	// 3. Trouver la catégorie par ID ou slug
	const category = findCategoryInTree(categoriesJson.categories || [], params.category)
		?? threadsJson.category
		?? { id: params.category, name: 'Discussions', slug: null, description: null };

	// 4. Redirect 301 UUID → slug (SEO canonique)
	if (category.slug && params.category !== category.slug) {
		redirect(301, `/forum/${category.slug}`);
	}

	return {
		threads: threadsJson.threads,
		categoryId: category.id,
		category
	};
};