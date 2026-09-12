import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/public';

const DIRECTORY_URL = (env.PUBLIC_DIRECTORY_URL ?? 'https://nodyx.org').replace(/\/$/, '');

export const load: PageServerLoad = async ({ fetch, url }) => {
	const q        = url.searchParams.get('q')?.trim() ?? '';
	const page     = url.searchParams.get('page') ?? '1';
	const type     = url.searchParams.get('type') ?? 'all';   // all | thread | event
	const upcoming = url.searchParams.get('upcoming') ?? '';

	let results: any[] = [];
	let error: string | null = null;

	try {
		const params = new URLSearchParams({ page, limit: '20', type });
		if (q)        params.set('q', q);
		if (upcoming) params.set('upcoming', upcoming);

		// Sans timeout, un directory qui ne répond jamais (pas une erreur immédiate,
		// un vrai silence réseau) bloque le rendu SSR de la page indéfiniment.
		// Même classe d'incident que celui déjà corrigé dans +layout.server.ts
		// (page d'accueil à 27s, trouvé en audit de stabilité, F-040, 2026-09-11).
		const res = await globalThis.fetch(`${DIRECTORY_URL}/api/directory/search?${params}`, {
			signal: AbortSignal.timeout(5000)
		});
		if (res.ok) {
			const json = await res.json();
			results = json.results ?? [];
		} else {
			error = 'Le moteur de recherche global est temporairement indisponible.';
		}
	} catch {
		error = 'Impossible de contacter le répertoire Nodyx.';
	}

	return { q, page: parseInt(page, 10), results, error, type, upcoming };
};
