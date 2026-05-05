import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent();

	const [gridRes, widgetsRes] = await Promise.all([
		apiFetch(fetch, '/admin/homepage/grid', {
			headers: { Authorization: `Bearer ${token}` },
		}),
		apiFetch(fetch, '/widget-store-public'),
	]);

	const grid = gridRes.ok
		? await gridRes.json()
		: { draft: null, published: null, theme: {} };

	const widgetsJson = widgetsRes.ok ? await widgetsRes.json() : { widgets: [] };
	const installedWidgets = (widgetsJson.widgets ?? [])
		.map((w: { manifest: unknown }) => w.manifest);

	return {
		draft:            grid.draft     ?? null,
		published:        grid.published ?? null,
		theme:            grid.theme     ?? {},
		installedWidgets,
	};
};
