import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent();
	const auth = { headers: { Authorization: `Bearer ${token}` } };

	const [listRes, storageRes, instanceRes] = await Promise.all([
		apiFetch(fetch, '/admin/backups?limit=50', auth),
		apiFetch(fetch, '/admin/backups/storage', auth),
		apiFetch(fetch, '/instance/info'),
	]);

	const list     = listRes.ok     ? await listRes.json()     : { rows: [], total: 0 };
	const storage  = storageRes.ok  ? await storageRes.json()  : { used: 0, available: 0, total: 0 };
	const instance = instanceRes.ok ? await instanceRes.json() : {};

	return {
		backups:        list.rows ?? [],
		total:          list.total ?? 0,
		storage,
		instanceSlug:   instance.slug ?? '',
		instanceName:   instance.name ?? '',
	};
};
