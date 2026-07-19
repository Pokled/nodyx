import type { Handle, HandleFetch } from '@sveltejs/kit';
import { getLocaleFromAcceptLanguage, isKnownLocale } from '$lib/i18n';

// Make sure /service-worker.js (and any other SW-like files) are never cached
// by intermediate CDNs. Default behaviour: Cloudflare cached service-worker.js
// for ~17 min, so users were stuck on the old SW after a deploy. With
// `cache-control: no-cache, no-store, must-revalidate`, the CDN passes the
// request through every time and the browser only ever sees the latest build.
//
// We also apply this to /manifest.json, because a stale manifest with old
// icon paths can break the PWA install prompt.
const NO_CACHE_PATHS = new Set([
	'/service-worker.js',
	'/sw.js',
	'/manifest.json',
]);

export const handle: Handle = async ({ event, resolve }) => {
	const cookieLocale = event.cookies.get('nodyx_locale');
	const acceptLang = event.request.headers.get('accept-language');
	// The cookie is attacker-settable (and cross-instance via a *.nodyx.org subdomain),
	// and `locale` is injected raw into <html lang="%lang%">. Only accept a locale we
	// actually ship, otherwise a crafted cookie could break out of the attribute (XSS).
	const locale = (isKnownLocale(cookieLocale) ? cookieLocale : getLocaleFromAcceptLanguage(acceptLang)) || 'fr';

	const response = await resolve(event, {
		transformPageChunk: ({ html }) => html.replace('%lang%', locale)
	});
	if (NO_CACHE_PATHS.has(event.url.pathname)) {
		response.headers.set('cache-control', 'no-cache, no-store, must-revalidate');
		response.headers.set('pragma',         'no-cache');
		response.headers.set('expires',        '0');
	} else if (
		!response.headers.has('cache-control') &&
		(response.headers.get('content-type') ?? '').includes('text/html')
	) {
		// Pages SSR (HTML) : jamais servies périmées par le navigateur / SW / CDN.
		// Sans en-tête, certains navigateurs cachent l'HTML de façon heuristique
		// -> page d'accueil figée ("grid builder inactif") en arrivant d'une autre
		// instance (navigation same-site). no-cache force une revalidation à chaque
		// navigation : le serveur renvoie toujours l'HTML SSR frais.
		response.headers.set('cache-control', 'no-cache, must-revalidate');
	}
	return response;
};

// Strip the Origin header for external directory/search requests.
// SvelteKit SSR automatically adds an Origin header to outgoing fetch calls,
// which triggers CORS rejection on remote Nodyx instances (they only whitelist
// their own frontend). The directory API is public — no auth needed, no CORS.
//
// Also forwards the real client IP to the internal backend via X-Forwarded-For.
// Without this, all SSR requests appear as 127.0.0.1 in nodyx-core, breaking
// IP bans, rate limiting, and registration_ip tracking.
export const handleFetch: HandleFetch = ({ event, request, fetch }) => {
	const url = request.url;
	const headers = new Headers(request.headers);

	if (url.includes('/api/directory')) {
		headers.delete('origin');
		return fetch(new Request(url, { method: request.method, headers }));
	}

	// Forward real client IP for SSR calls to the internal backend (127.0.0.1 or localhost)
	if (url.includes('127.0.0.1') || url.includes('localhost')) {
		headers.set('x-forwarded-for', event.getClientAddress());
		return fetch(new Request(request, { headers }));
	}

	return fetch(request);
};
