import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent();

	const [posRes, widRes, storeRes] = await Promise.all([
		apiFetch(fetch, '/admin/homepage/positions', {
			headers: { Authorization: `Bearer ${token}` },
		}),
		apiFetch(fetch, '/admin/homepage/widgets', {
			headers: { Authorization: `Bearer ${token}` },
		}),
		apiFetch(fetch, '/widget-store-public'),
	]);

	const [posJson, widJson, storeJson]: any[] = await Promise.all([
		posRes.ok   ? posRes.json()   : { positions: [] },
		widRes.ok   ? widRes.json()   : { widgets: [] },
		storeRes.ok ? storeRes.json() : { widgets: [] },
	]);

	return {
		positions:       posJson.positions  ?? [],
		widgets:         widJson.widgets    ?? [],
		externalWidgets: storeJson.widgets  ?? [],   // widgets installés (manifest + id)
	};
};
