import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { apiFetch } from '$lib/api';
import { env } from '$env/dynamic/public';
import { getLocaleFromAcceptLanguage, isKnownLocale } from '$lib/i18n';

const DIRECTORY_URL = (env.PUBLIC_DIRECTORY_URL ?? 'https://nodyx.org') + '/api/directory';

// Cache mémoire du directory, partagé entre toutes les requêtes SSR du
// process. Le directory est un appel réseau EXTERNE (autre instance, ou
// notre propre URL publique via Cloudflare) : sans timeout ni cache, chaque
// page SSR payait un aller-retour Internet, et un blackhole IPv6 pouvait
// suspendre le rendu ~25 s (incident mesuré : homepage à 27 s). On sert la
// version en cache pendant 5 min et on borne le fetch à 2,5 s ; en cas
// d'échec, on resert la dernière version connue (stale acceptable pour une
// liste d'instances qui bouge rarement).
const DIRECTORY_TTL_MS = 5 * 60 * 1000;
let directoryCache: { data: unknown; fetchedAt: number } = { data: null, fetchedAt: 0 };

async function fetchDirectoryCached(): Promise<unknown> {
	const now = Date.now();
	if (directoryCache.data !== null && now - directoryCache.fetchedAt < DIRECTORY_TTL_MS) {
		return directoryCache.data;
	}
	try {
		const res = await globalThis.fetch(DIRECTORY_URL, { signal: AbortSignal.timeout(2500) });
		if (res?.ok) {
			const json = await res.json();
			directoryCache = { data: json, fetchedAt: now };
			return json;
		}
	} catch {
		// timeout / réseau : on retombe sur le stale ci-dessous
	}
	if (directoryCache.data !== null) {
		directoryCache.fetchedAt = now - DIRECTORY_TTL_MS + 30_000; // retente dans 30 s
		return directoryCache.data;
	}
	return null;
}

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
	const cookieLocale = cookies.get('nodyx_locale');
	const ssrLocale = (isKnownLocale(cookieLocale) ? cookieLocale : getLocaleFromAcceptLanguage(request.headers.get('accept-language'))) || 'fr';

	const [infoRes, userRes, directoryJson, announcementRes, modulesRes] = await Promise.all([
		apiFetch(fetch, '/instance/info'),
		token
			? apiFetch(fetch, '/users/me', { headers: { Authorization: `Bearer ${token}` } })
			: Promise.resolve(null),
		fetchDirectoryCached(),
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
	const nodyxVersion: string       = infoJson?.version     ?? 'unknown';
	const themeCss: string | null    = infoJson?.theme_css   ?? null;
	// Thème imposé par l'owner de l'instance (base de la cascade ; un membre peut le surcharger via son profil)
	const instanceTheme: Record<string, unknown> | null = infoJson?.theme_vars ?? null;
	// Effet de fond optionnel posé par l'owner (ex 'matrix' = pluie de caractères)
	const instanceEffect: string | null = infoJson?.theme_effect ?? null;

	// Toutes les instances du réseau (directory), filtre l'instance courante
	const allInstances: Array<{
		slug: string; name: string; url: string;
		logo_url: string | null; members: number; online: number; last_seen: string | null;
	}> = (((directoryJson as any)?.instances) ?? []).filter((i: { slug: string }) => i.slug !== currentSlug);

	if (!token || !userRes?.ok) {
		return { user: null, communityName, communityLogoUrl, communityBannerUrl, memberCount, unreadCount: 0, token: null, networkInstances: [], directoryInstances: allInstances, activeAnnouncement, modules, demoMode, nodyxVersion, themeCss, instanceTheme, instanceEffect, ssrLocale };
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

	return { user, communityName, communityLogoUrl, communityBannerUrl, memberCount, unreadCount, token: token || null, appTheme, networkInstances, directoryInstances: allInstances, activeAnnouncement, modules, demoMode, nodyxVersion, themeCss, instanceTheme, instanceEffect, ssrLocale };
};
