// Appels à l'API d'OctoGuard depuis le navigateur (jeton de la session).
import { apiFetch } from '$lib/api'

export class OgError extends Error {
	constructor(message: string, public code: string | null, public status: number) { super(message) }
}

export async function og<T = any>(token: string | null | undefined, path: string, method = 'GET', body?: unknown): Promise<T> {
	const res = await apiFetch(fetch, `/admin/octoguard${path}`, {
		method,
		headers: token ? { Authorization: `Bearer ${token}` } : {},
		body: body === undefined ? undefined : JSON.stringify(body),
	})
	const json = await res.json().catch(() => ({}))
	if (!res.ok) throw new OgError(json.error ?? String(res.status), json.code ?? null, res.status)
	return json as T
}
