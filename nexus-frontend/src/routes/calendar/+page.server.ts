import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token  = cookies.get('token') ?? null;
	const past   = url.searchParams.get('past') === 'true';
	const tag    = url.searchParams.get('tag') ?? '';

	const params = new URLSearchParams({ limit: '50' });
	if (past)  params.set('past', 'true');
	if (tag)   params.set('tags', tag);

	const res  = await apiFetch(fetch, `/events?${params}`);
	const json = res.ok ? await res.json() : { events: [] };

	return { events: json.events ?? [], past, tag, token };
};
