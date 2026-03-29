import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { apiFetch } from '$lib/api';
import { env } from '$env/dynamic/public';

const DIRECTORY_URL = (env.PUBLIC_DIRECTORY_URL ?? 'https://nodyx.org') + '/api/directory';

// URLs stored in DB may include http://localhost:3000 prefix (legacy uploads)
// Normalize to relative path so browser fetches via Vite proxy / reverse proxy
function normalizeUrl(url: string | null): string | null {
	if (!url) return null;
	if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//.test(url)) {
		try { return new URL(url).pathname; } catch { return url; }
	}
	return url;
}

export const load: LayoutServerLoad = async ({ fetch, cookies, request, url }) => {
	const token = cookies.get('token');

	const [infoRes, userRes, directoryRes, announcementRes, modulesRes] = await Promise.all([
		apiFetch(fetch, '/instance/info'),
		token
			? apiFetch(fetch, '/users/me', { headers: { Authorization: `Bearer ${token}` } })
			: Promise.resolve(null),
		globalThis.fetch(DIRECTORY_URL).catch(() => null),
		apiFetch(fetch, '/instance/announcement').catch(() => null),
		apiFetch(fetch, '/admin/modules/public').catch(() => null),
	]);

	const infoJson = infoRes.ok ? await infoRes.json() : null;

	// Module enabled state — used to gate nav items and page access
	const modulesJson = modulesRes?.ok ? await modulesRes.json().catch(() => null) : null
	const modules: Record<string, boolean> = {}
	for (const m of (modulesJson?.modules ?? [])) {
		modules[m.id] = m.enabled
	}
	const announcementJson = announcementRes?.ok ? await announcementRes.json().catch(() => null) : null;
	const activeAnnouncement: { id: string; message: string; color: string } | null = announcementJson?.announcement ?? null;
	const communityName: string      = infoJson?.name       ?? 'Nodyx';
	const communityLogoUrl: string | null   = normalizeUrl(infoJson?.logo_url   ?? null);
	const communityBannerUrl: string | null = normalizeUrl(infoJson?.banner_url ?? null);
	const memberCount: number        = infoJson?.member_count ?? 0;
	const currentSlug: string        = infoJson?.slug ?? '';
	const demoMode: boolean          = infoJson?.demo_mode   ?? false;

	// Toutes les instances du réseau (directory), filtre l'instance courante
	const directoryJson = (directoryRes?.ok) ? await directoryRes.json().catch(() => null) : null;
	const allInstances: Array<{
		slug: string; name: string; url: string;
		logo_url: string | null; members: number; online: number; last_seen: string | null;
	}> = (directoryJson?.instances ?? []).filter((i: { slug: string }) => i.slug !== currentSlug);

	if (!token || !userRes?.ok) {
		return { user: null, communityName, communityLogoUrl, communityBannerUrl, memberCount, unreadCount: 0, token: null, networkInstances: [], directoryInstances: allInstances, activeAnnouncement, modules, demoMode };
	}

	const { user } = await userRes.json();

	// Redirect banned users to the /banned page
	if (user?.is_banned) {
		if (url.pathname !== '/banned' && !url.pathname.startsWith('/reset-password')) {
			throw redirect(302, '/banned');
		}
	}

	// Fetch notifications + user profile theme in parallel (non-blocking)
	let unreadCount = 0;
	let appTheme: Record<string, unknown> | null = null;
	await Promise.all([
		apiFetch(fetch, '/notifications/unread-count', { headers: { Authorization: `Bearer ${token}` } })
			.then(r => r.ok ? r.json() : null)
			.then(j => { if (j) unreadCount = j.count ?? 0 })
			.catch(() => {}),
		apiFetch(fetch, `/users/${user.username}/profile`, { headers: { Authorization: `Bearer ${token}` } })
			.then(r => r.ok ? r.json() : null)
			.then(j => { if (j?.metadata?.theme) appTheme = j.metadata.theme })
			.catch(() => {}),
	]);

	// Galaxy Bar : uniquement les instances où l'user a déclaré avoir un compte
	const linkedSlugs: string[] = user.linked_instances ?? [];
	const networkInstances = allInstances.filter(i => linkedSlugs.includes(i.slug));

	return { user, communityName, communityLogoUrl, communityBannerUrl, memberCount, unreadCount, token: token || null, appTheme, networkInstances, directoryInstances: allInstances, activeAnnouncement, modules, demoMode };
};
