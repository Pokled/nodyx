import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch }) => {
	const [infoRes, catRes, threadsRes, featuredRes] = await Promise.all([
		apiFetch(fetch, '/instance/info'),
		apiFetch(fetch, '/instance/categories'),
		apiFetch(fetch, '/instance/threads/recent'),
		apiFetch(fetch, '/instance/threads/featured'),
	]);

	const [infoJson, catJson, threadsJson, featuredJson] = await Promise.all([
		infoRes.ok  ? infoRes.json()     : {},
		catRes.ok   ? catRes.json()      : {},
		threadsRes.ok  ? threadsRes.json()  : {},
		featuredRes.ok ? featuredRes.json() : {},
	]);

	return {
		// Normalisation défensive : si l'API est down au démarrage, on ne crashe pas
		instance: {
			name:         infoJson.name         ?? 'Nexus',
			description:  infoJson.description  ?? '',
			language:     infoJson.language      ?? 'fr',
			country:      infoJson.country       ?? '',
			slug:         infoJson.slug          ?? '',
			community_id: infoJson.community_id  ?? null,
			member_count: infoJson.member_count  ?? 0,
			online_count: infoJson.online_count  ?? 0,
			thread_count: infoJson.thread_count  ?? 0,
			post_count:   infoJson.post_count    ?? 0,
			logo_url:     infoJson.logo_url      ?? null,
			banner_url:   infoJson.banner_url    ?? null,
		},
		categories: catJson.categories      ?? [],
		threads:    threadsJson.threads      ?? [],
		articles:   featuredJson.articles    ?? [],
	};
};
