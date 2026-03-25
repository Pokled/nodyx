import type { HandleFetch } from '@sveltejs/kit';

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
