import { error, fail, redirect } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

// La fiche d'un membre (CDC modération, E3). Toutes les actions passent par
// le cœur, qui revérifie droits et rang : l'interface n'affiche que le permis.

export const load: PageServerLoad = async ({ fetch, parent, params }) => {
	const { token } = await parent()
	const res = await apiFetch(fetch, `/admin/members/${encodeURIComponent(params.userId)}/file`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	if (res.status === 403) redirect(302, '/admin')
	if (!res.ok) error(res.status === 404 ? 404 : 503, res.status === 404 ? 'Not found' : 'Unavailable')
	return { file: await res.json() }
}

async function call(fetch: typeof globalThis.fetch, token: string, path: string, method: string, body?: unknown) {
	const res = await apiFetch(fetch, path, {
		method,
		headers: { Authorization: `Bearer ${token}` },
		...(body !== undefined ? { body: JSON.stringify(body) } : {}),
	})
	if (res.ok) return null
	const j = await res.json().catch(() => ({}))
	const key = j.code === 'RANK_TOO_LOW' ? 'afile.err_rank'
		: j.code === 'FORBIDDEN' ? 'afile.err_forbidden'
		: j.code === 'VALIDATION_ERROR' ? 'afile.err_invalid'
		: 'afile.err_generic'
	return fail(res.status, { errorKey: key })
}

// Durées de sourdine proposées : valeur + unité au format du cœur
const DURATIONS: Record<string, { value: number; unit: 'm' | 'h' | 'd' | 'w' } | null> = {
	'10m': { value: 10, unit: 'm' },
	'1h': { value: 1, unit: 'h' },
	'24h': { value: 24, unit: 'h' },
	'7d': { value: 7, unit: 'd' },
	'forever': null,
}

export const actions: Actions = {
	warn: async ({ fetch, request, cookies, params }) => {
		const f = await request.formData()
		return (await call(fetch, cookies.get('token')!, `/admin/members/${params.userId}/warn`, 'POST',
			{ reason: String(f.get('reason') ?? '').trim() })) ?? { ok: 'warned' }
	},
	mute: async ({ fetch, request, cookies, params }) => {
		const f = await request.formData()
		const d = String(f.get('duration') ?? '1h')
		const reason = String(f.get('reason') ?? '').trim() || undefined
		return (await call(fetch, cookies.get('token')!, '/admin/octoguard/mutes', 'POST',
			{ user_id: params.userId, duration: d in DURATIONS ? DURATIONS[d] : DURATIONS['1h'], reason })) ?? { ok: 'muted' }
	},
	unmute: async ({ fetch, request, cookies }) => {
		const f = await request.formData()
		return (await call(fetch, cookies.get('token')!, `/admin/octoguard/mutes/${encodeURIComponent(String(f.get('mute_id')))}`, 'DELETE')) ?? { ok: 'unmuted' }
	},
	kick: async ({ fetch, cookies, params }) => {
		return (await call(fetch, cookies.get('token')!, `/admin/members/${params.userId}`, 'DELETE')) ?? { ok: 'kicked' }
	},
	ban: async ({ fetch, request, cookies, params }) => {
		const f = await request.formData()
		return (await call(fetch, cookies.get('token')!, `/admin/members/${params.userId}/ban`, 'POST', {
			reason: String(f.get('reason') ?? '').trim() || undefined,
			ban_ip: f.get('ban_ip') === 'on',
			ban_email: f.get('ban_email') === 'on',
		})) ?? { ok: 'banned' }
	},
	unban: async ({ fetch, cookies, params }) => {
		return (await call(fetch, cookies.get('token')!, `/admin/members/${params.userId}/ban`, 'DELETE')) ?? { ok: 'unbanned' }
	},
	note: async ({ fetch, request, cookies, params }) => {
		const f = await request.formData()
		return (await call(fetch, cookies.get('token')!, `/admin/members/${params.userId}/notes`, 'POST',
			{ body: String(f.get('body') ?? '').trim() })) ?? { ok: 'noted' }
	},
	deleteNote: async ({ fetch, request, cookies, params }) => {
		const f = await request.formData()
		return (await call(fetch, cookies.get('token')!, `/admin/members/${params.userId}/notes/${encodeURIComponent(String(f.get('note_id')))}`, 'DELETE')) ?? { ok: 'note_deleted' }
	},
}
