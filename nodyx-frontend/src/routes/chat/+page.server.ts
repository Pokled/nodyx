import type { PageServerLoad } from './$types';
import { redirect } from '@sveltejs/kit';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, cookies }) => {
	const token = cookies.get('token');
	if (!token) throw redirect(302, '/auth/login');

	const res = await apiFetch(fetch, '/chat/channels', {
		headers: { Authorization: `Bearer ${token}` },
	});

	const channels = res.ok ? (await res.json()).channels ?? [] : [];

	// Extensions installées avec une surface `activity` : ce sont les jeux
	// jouables dans un canal vocal (cf SPECS/NODYX_ACTIVITIES_CDC.md).
	const extRes = await apiFetch(fetch, '/extensions/public');
	const extensions = extRes.ok ? (await extRes.json()).extensions ?? [] : [];
	const activities = extensions.flatMap((e: any) =>
		(e.surfaces ?? [])
			.filter((s: any) => s.type === 'activity' && s.appUrl)
			.map((s: any) => ({
				id: e.id,
				version: e.version,
				surfaceId: s.id,
				appUrl: s.appUrl,
				label: s.label ?? e.label,
				tagline: e.tagline ?? null,
				description: s.description ?? e.description ?? null,
				icon: e.icon ?? null,
				screenshots: e.screenshots ?? [],
				family: e.family ?? 'gaming',
				author: e.author ?? null,
			})),
	);

	return { channels, token, activities };
};
