import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const [catRes, threadsRes] = await Promise.all([
		apiFetch(fetch, '/instance/categories'),
		apiFetch(fetch, '/instance/threads/recent'),
	]);

	const catJson     = catRes.ok     ? await catRes.json()     : {};
	const threadsJson = threadsRes.ok ? await threadsRes.json() : {};

	return {
		categories: catJson.categories ?? [],
		recentThreads: threadsJson.threads ?? [],
	};
};
