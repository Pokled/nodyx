import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

// Le nouvel éditeur de page d'accueil (lot L1a, SPECS/NODYX_EDITEUR_ACCUEIL_CDC.md §3).
// Mêmes données que l'ancien builder (brouillon, version publiée, thème de la grille,
// widgets installés, extensions), plus ce que les blocs affichent (chiffres de l'instance),
// pour que la page de l'éditeur soit la vraie page, à sa vraie taille.
export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token, ssrLocale } = await parent();
	const auth = { headers: { Authorization: `Bearer ${token}` } };

	const [gridRes, widgetsRes, extensionsRes, infoRes] = await Promise.all([
		apiFetch(fetch, '/admin/homepage/grid', auth),
		apiFetch(fetch, '/widget-store-public').catch(() => null),
		apiFetch(fetch, `/extensions/public?locale=${encodeURIComponent(ssrLocale ?? '')}`).catch(() => null),
		apiFetch(fetch, '/instance/info').catch(() => null),
	]);

	const grid = gridRes.ok ? await gridRes.json() : { draft: null, published: null, theme: {} };
	const widgetsJson = widgetsRes?.ok ? await widgetsRes.json() : { widgets: [] };
	const extensionsJson = extensionsRes?.ok ? await extensionsRes.json() : { extensions: [] };
	const info = infoRes?.ok ? await infoRes.json() : {};

	return {
		draft:     grid.draft     ?? null,
		published: grid.published ?? null,
		theme:     grid.theme     ?? {},
		installedWidgets: Object.fromEntries(
			(widgetsJson.widgets ?? []).map((w: { id: string; manifest: unknown }) => [w.id, w.manifest]),
		),
		extensions: extensionsJson.extensions ?? [],
		instance: {
			name:         info.name         ?? 'Nodyx',
			description:  info.description  ?? '',
			slug:         info.slug         ?? '',
			community_id: info.community_id ?? null,
			member_count: info.member_count ?? 0,
			online_count: info.online_count ?? 0,
			thread_count: info.thread_count ?? 0,
			post_count:   info.post_count   ?? 0,
			logo_url:     info.logo_url     ?? null,
			banner_url:   info.banner_url   ?? null,
		},
	};
};
