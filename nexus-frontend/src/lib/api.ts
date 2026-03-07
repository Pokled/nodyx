import { browser } from '$app/environment'
import { PUBLIC_API_URL } from '$env/static/public'

// SSR (Node.js) : appel direct au backend, jamais via proxy/DNS externe
// Browser : URL relative → proxy Vite en dev, reverse proxy (Caddy) en prod
// PRIVATE_API_SSR_URL dans .env permet aux instances secondaires de cibler un port différent
export const API_URL = browser
	? `${PUBLIC_API_URL}/api/v1`
	: (process.env.PRIVATE_API_SSR_URL ?? 'http://127.0.0.1:3000/api/v1')

export interface ApiError {
	error: string;
	code: string;
}

export async function apiFetch(
	fetch: typeof globalThis.fetch,
	path: string,
	options: RequestInit = {}
): Promise<Response> {
	const hasBody = options.body !== undefined && options.body !== null;
	return fetch(`${API_URL}${path}`, {
		...options,
		headers: {
			...(hasBody ? { 'Content-Type': 'application/json' } : {}),
			...options.headers,
		}
	});
}
