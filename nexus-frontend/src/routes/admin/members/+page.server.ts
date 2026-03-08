import { fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()
	const [membersRes, bansRes, ipBansRes, emailBansRes] = await Promise.all([
		apiFetch(fetch, '/admin/members',    { headers: { Authorization: `Bearer ${token}` } }),
		apiFetch(fetch, '/admin/bans',       { headers: { Authorization: `Bearer ${token}` } }),
		apiFetch(fetch, '/admin/ip-bans',    { headers: { Authorization: `Bearer ${token}` } }),
		apiFetch(fetch, '/admin/email-bans', { headers: { Authorization: `Bearer ${token}` } }),
	])
	const { members } = await membersRes.json()
	const bans       = bansRes.ok      ? await bansRes.json()      : []
	const ipBans     = ipBansRes.ok    ? await ipBansRes.json()    : []
	const emailBans  = emailBansRes.ok ? await emailBansRes.json() : []
	return { members, bans, ipBans, emailBans }
}

export const actions: Actions = {
	changeRole: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const data  = await request.formData()
		const userId = data.get('user_id') as string
		const role   = data.get('role')   as string

		const res = await apiFetch(fetch, `/admin/members/${userId}`, {
			method:  'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ role }),
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},

	kick: async ({ fetch, request, cookies }) => {
		const token  = cookies.get('token')!
		const data   = await request.formData()
		const userId = data.get('user_id') as string

		const res = await apiFetch(fetch, `/admin/members/${userId}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},

	ban: async ({ fetch, request, cookies }) => {
		const token   = cookies.get('token')!
		const data    = await request.formData()
		const userId  = data.get('user_id') as string
		const reason  = (data.get('reason') as string) || undefined
		const ban_ip    = data.get('ban_ip')    === 'true'
		const ban_email = data.get('ban_email') === 'true'

		const res = await apiFetch(fetch, `/admin/members/${userId}/ban`, {
			method:  'POST',
			headers: { Authorization: `Bearer ${token}` },
			body:    JSON.stringify({ reason, ban_ip, ban_email }),
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},

	unban: async ({ fetch, request, cookies }) => {
		const token  = cookies.get('token')!
		const data   = await request.formData()
		const userId = data.get('user_id') as string

		const res = await apiFetch(fetch, `/admin/members/${userId}/ban`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},

	unbanIp: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const data  = await request.formData()
		const ip    = data.get('ip') as string

		const res = await apiFetch(fetch, `/admin/ip-bans/${encodeURIComponent(ip)}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},

	unbanEmail: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const data  = await request.formData()
		const email = data.get('email') as string

		const res = await apiFetch(fetch, `/admin/email-bans/${encodeURIComponent(email)}`, {
			method:  'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},
}
