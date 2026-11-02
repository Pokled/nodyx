import { fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

const STATUSES = ['open', 'actioned', 'dismissed', 'reviewed'] as const

export const load: PageServerLoad = async ({ fetch, parent, url }) => {
	const { token } = await parent()
	const asked = url.searchParams.get('status') ?? 'open'
	const status = (STATUSES as readonly string[]).includes(asked) ? asked : 'open'
	const res = await apiFetch(fetch, `/admin/octoguard/reports?status=${status}&limit=200`, {
		headers: { Authorization: `Bearer ${token}` },
	})
	const json = res.ok ? await res.json() : { reports: [], counts: {} }
	return { reports: json.reports ?? [], counts: json.counts ?? {}, status }
}

async function patch(fetch: typeof globalThis.fetch, token: string, id: string, body: Record<string, unknown>) {
	const res = await apiFetch(fetch, `/admin/octoguard/reports/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { Authorization: `Bearer ${token}` },
		body: JSON.stringify(body),
	})
	if (res.ok) return null
	const j = await res.json().catch(() => ({}))
	return fail(res.status, { errorKey: j.code === 'RANK_TOO_LOW' ? 'areports.err_rank' : j.code === 'FORBIDDEN' ? 'areports.err_forbidden' : 'areports.err_generic' })
}

export const actions: Actions = {
	// « Je prends » : toute l'équipe voit qui regarde ce dossier
	claim: async ({ fetch, request, cookies }) => {
		const form = await request.formData()
		return (await patch(fetch, cookies.get('token')!, String(form.get('id')), { claim: true })) ?? { ok: true }
	},
	// Clore : sanctionné (avec ou sans suppression du contenu), classé, examiné
	resolve: async ({ fetch, request, cookies }) => {
		const form = await request.formData()
		const status = String(form.get('status'))
		if (!['actioned', 'dismissed', 'reviewed'].includes(status)) return fail(400, { errorKey: 'areports.err_generic' })
		const resolution = String(form.get('resolution') ?? '').trim() || undefined
		const deleteContent = form.get('delete_content') === '1'
		return (await patch(fetch, cookies.get('token')!, String(form.get('id')), { status, resolution, delete_content: deleteContent || undefined })) ?? { ok: true }
	},
}
