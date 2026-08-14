import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token, ssrLocale } = await parent();

	const [gridRes, widgetsRes, extensionsRes] = await Promise.all([
		apiFetch(fetch, '/admin/homepage/grid', {
			headers: { Authorization: `Bearer ${token}` },
		}),
		apiFetch(fetch, '/widget-store-public'),
		// Tolerant : un builder ne doit pas devenir inaccessible parce que la
		// liste des extensions repond mal.
		apiFetch(fetch, `/extensions/public?locale=${encodeURIComponent(ssrLocale ?? '')}`).catch(() => null),
	]);

	const grid = gridRes.ok
		? await gridRes.json()
		: { draft: null, published: null, theme: {} };

	const widgetsJson = widgetsRes.ok ? await widgetsRes.json() : { widgets: [] };
	const installedWidgets = (widgetsJson.widgets ?? [])
		.map((w: { manifest: unknown }) => w.manifest);

	const extensionsJson = extensionsRes?.ok ? await extensionsRes.json() : { extensions: [] };

	return {
		draft:            grid.draft     ?? null,
		published:        grid.published ?? null,
		theme:            grid.theme     ?? {},
		installedWidgets,
		extensions:       extensionsJson.extensions ?? [],
	};
};
