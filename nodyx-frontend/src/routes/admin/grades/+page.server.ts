import { fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()

	// Get the community slug from the instance info
	const infoRes = await apiFetch(fetch, '/instance/info')
	const { slug } = await infoRes.json()

	// Les membres viennent de la liste admin : mêmes membres que partout ailleurs
	// (ni bannis, ni bot), avec leur grade. La liste publique comptait les bannis.
	const [gradesRes, membersRes] = await Promise.all([
		apiFetch(fetch, `/communities/${slug}/grades`),
		apiFetch(fetch, '/admin/members', { headers: { Authorization: `Bearer ${token}` } }),
	])

	const { grades }  = gradesRes.ok  ? await gradesRes.json()  : { grades: [] }
	const { members } = membersRes.ok ? await membersRes.json() : { members: [] }

	return { slug, grades, members }
}

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const infoRes = await apiFetch(fetch, '/instance/info')
		const { slug } = await infoRes.json()
		const form = await request.formData()
		const body = {
			name:     form.get('name')     as string,
			color:    form.get('color')    as string,
			position: Number(form.get('position') ?? 0),
			permissions: {
				can_post:            form.get('can_post')            === 'on',
				can_create_thread:   form.get('can_create_thread')   === 'on',
				can_create_category: form.get('can_create_category') === 'on',
				can_moderate:        form.get('can_moderate')        === 'on',
				can_manage_members:  form.get('can_manage_members')  === 'on',
				can_manage_grades:   form.get('can_manage_grades')   === 'on',
			},
		}
		const res = await apiFetch(fetch, `/communities/${slug}/grades`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		})
		if (!res.ok) return fail(res.status, { error: (await res.json().catch(() => ({}))).error ?? 'Erreur création grade' })
	},

	update: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const infoRes = await apiFetch(fetch, '/instance/info')
		const { slug } = await infoRes.json()
		const form    = await request.formData()
		const gradeId = form.get('grade_id') as string
		const body = {
			name:  form.get('name')  as string,
			color: form.get('color') as string,
			permissions: {
				can_post:            form.get('can_post')            === 'on',
				can_create_thread:   form.get('can_create_thread')   === 'on',
				can_create_category: form.get('can_create_category') === 'on',
				can_moderate:        form.get('can_moderate')        === 'on',
				can_manage_members:  form.get('can_manage_members')  === 'on',
				can_manage_grades:   form.get('can_manage_grades')   === 'on',
			},
		}
		const res = await apiFetch(fetch, `/communities/${slug}/grades/${gradeId}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		})
		if (!res.ok) return fail(res.status, { error: (await res.json().catch(() => ({}))).error ?? 'Erreur modification grade' })
	},

	delete: async ({ fetch, request, cookies }) => {
		const token   = cookies.get('token')!
		const infoRes = await apiFetch(fetch, '/instance/info')
		const { slug } = await infoRes.json()
		const form    = await request.formData()
		const gradeId = form.get('grade_id') as string
		const res = await apiFetch(fetch, `/communities/${slug}/grades/${gradeId}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok && res.status !== 204) return fail(res.status, { error: (await res.json().catch(() => ({}))).error ?? 'Erreur suppression' })
	},

	// Monter / descendre un grade : on renumérote TOUS les grades 0..n dans le
	// nouvel ordre (des positions en double ou à trous rendraient un simple
	// échange de deux valeurs sans effet), puis on n'envoie que ceux qui changent.
	move: async ({ fetch, request, cookies }) => {
		const token   = cookies.get('token')!
		const infoRes = await apiFetch(fetch, '/instance/info')
		const { slug } = await infoRes.json()
		const form    = await request.formData()
		const gradeId = form.get('grade_id') as string
		const dir     = form.get('dir') === 'up' ? -1 : 1

		const listRes = await apiFetch(fetch, `/communities/${slug}/grades`)
		if (!listRes.ok) return fail(400, { errorKey: 'agrade.err_reorder' })
		const { grades } = await listRes.json() as { grades: Array<{ id: string; position: number }> }
		const order = [...grades]
		const from  = order.findIndex(g => g.id === gradeId)
		const to    = from + dir
		if (from < 0 || to < 0 || to >= order.length) return
		;[order[from], order[to]] = [order[to], order[from]]

		for (const [position, g] of order.entries()) {
			if (g.position === position) continue
			const res = await apiFetch(fetch, `/communities/${slug}/grades/${g.id}`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${token}` },
				body: JSON.stringify({ position }),
			})
			if (!res.ok) return fail(400, { errorKey: 'agrade.err_reorder' })
		}
	},

	assign: async ({ fetch, request, cookies }) => {
		const token   = cookies.get('token')!
		const infoRes = await apiFetch(fetch, '/instance/info')
		const { slug } = await infoRes.json()
		const form    = await request.formData()
		const userId  = form.get('user_id')  as string
		const gradeId = form.get('grade_id') as string
		const res = await apiFetch(fetch, `/communities/${slug}/members/${userId}/grade`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({ grade_id: gradeId === '' ? null : gradeId }),
		})
		if (!res.ok) return fail(res.status, { error: (await res.json().catch(() => ({}))).error ?? 'Erreur attribution grade' })
	},
}
