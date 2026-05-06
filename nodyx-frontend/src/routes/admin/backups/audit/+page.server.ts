import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent();
	const res = await apiFetch(fetch, '/admin/backups/audit?limit=200', {
		headers: { Authorization: `Bearer ${token}` },
	});
	const json = res.ok ? await res.json() : { rows: [], total: 0 };
	return {
		entries: json.rows ?? [],
		total:   json.total ?? 0,
	};
};
