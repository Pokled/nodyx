import type { PageServerLoad } from './$types';
import { apiFetch } from '$lib/api';

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { modules } = await parent()

	const [infoRes, catRes, threadsRes, featuredRes, eventsRes, homepageRes, widgetStoreRes] = await Promise.all([
		apiFetch(fetch, '/instance/info'),
		apiFetch(fetch, '/instance/categories'),
		apiFetch(fetch, '/instance/threads/recent'),
		apiFetch(fetch, '/instance/threads/featured'),
		modules['events-public'] ? apiFetch(fetch, '/instance/events-public?limit=4') : Promise.resolve(null),
		apiFetch(fetch, '/instance/homepage'),
		apiFetch(fetch, '/widget-store-public'),
	]);

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const [infoJson, catJson, threadsJson, featuredJson, eventsJson, homepageJson, widgetStoreJson]: any[] = await Promise.all([
		infoRes.ok          ? infoRes.json()          : {},
		catRes.ok           ? catRes.json()           : {},
		threadsRes.ok       ? threadsRes.json()       : {},
		featuredRes.ok      ? featuredRes.json()      : {},
		eventsRes?.ok       ? eventsRes.json()        : {},
		homepageRes.ok      ? homepageRes.json()      : { positions: [] },
		widgetStoreRes?.ok  ? widgetStoreRes.json()   : { widgets: [] },
	]);

	// Resolve hero-banner dynamic variant server-side (live > event > night > default)
	// and inject into the hero-banner widget config so the component gets it pre-resolved
	let heroVariant: 'live' | 'event' | 'night' | 'default' = 'default'
	let featuredEvent: Record<string, unknown> | null = null

	const now = new Date()
	const hour = now.getHours()

	// Check for featured event in next 72h
	if (eventsJson?.events?.length > 0) {
		const upcoming = eventsJson.events.find((e: any) =>
			e.tags?.includes('featured') || e.is_featured
		)
		if (upcoming) {
			heroVariant = 'event'
			featuredEvent = upcoming
		}
	}

	// Night variant (22h–6h)
	if (heroVariant === 'default' && (hour >= 22 || hour < 6)) {
		heroVariant = 'night'
	}

	// Inject variant into homepage data
	const positions = (homepageJson.positions ?? []).map((pos: any) => ({
		...pos,
		widgets: (pos.widgets ?? []).map((w: any) => {
			if (w.widget_type === 'hero-banner') {
				return {
					...w,
					config: {
						...w.config,
						_variant: heroVariant,
						_featured_event: featuredEvent,
					},
				}
			}
			return w
		}),
	}))

	return {
		// Normalisation défensive : si l'API est down au démarrage, on ne crashe pas
		instance: {
			name:         infoJson.name         ?? 'Nodyx',
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
			version:      infoJson.version       ?? null,
		},
		categories:    catJson.categories      ?? [],
		threads:       threadsJson.threads      ?? [],
		articles:      featuredJson.articles    ?? [],
		publicEvents:  eventsJson?.events       ?? [],
		// Homepage builder positions
		homepagePositions: positions,
		// Installed widgets (externe → Web Components) : Record<id, manifest>
		installedWidgets: Object.fromEntries(
			(widgetStoreJson.widgets ?? []).map((w: any) => [w.id, w.manifest])
		),
	};
};
