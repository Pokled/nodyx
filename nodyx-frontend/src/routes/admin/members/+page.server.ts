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
		const json = await res.json().catch(() => ({}))
		if (!res.ok) return fail(400, { error: json.error })
		// json.ip_ban_applied = null quand « bannir l'IP » a été demandé mais
		// qu'aucune adresse publique n'est connue : le back ne peut pas bannir
		// une IP fantôme, on le dit au lieu de laisser croire que c'est fait.
		return {
			ok: true,
			ipBanRequested:  json.ip_ban_requested ?? false,
			ipBanApplied:    json.ip_ban_applied ?? null,
		}
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

	// Ajout manuel d'un ban email OU domain (juste 'mailinator.com' pour
	// bloquer tout @mailinator.com). Le backend matche déjà email exact +
	// domain via split_part dans /auth/register.
	banEmail: async ({ fetch, request, cookies }) => {
		const token  = cookies.get('token')!
		const data   = await request.formData()
		const email  = (data.get('email')  as string)?.trim()
		const reason = (data.get('reason') as string)?.trim() || undefined
		if (!email) return fail(400, { error: 'Email ou domaine requis' })

		const res = await apiFetch(fetch, '/admin/email-bans', {
			method:  'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type':  'application/json',
			},
			body: JSON.stringify({ email, reason }),
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},

	// Ajout manuel d'un ban IP. Accepte IPv4, IPv6, ou CIDR (ex: 1.2.3.0/24).
	banIp: async ({ fetch, request, cookies }) => {
		const token  = cookies.get('token')!
		const data   = await request.formData()
		const ip     = (data.get('ip')     as string)?.trim()
		const reason = (data.get('reason') as string)?.trim() || undefined
		if (!ip) return fail(400, { error: 'IP requise' })

		const res = await apiFetch(fetch, '/admin/ip-bans', {
			method:  'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type':  'application/json',
			},
			body: JSON.stringify({ ip, reason }),
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error })
		return { ok: true }
	},
}
