import { fail } from '@sveltejs/kit'
import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'

export const load: PageServerLoad = async ({ fetch, parent }) => {
	const { token } = await parent()
	const [infoRes, catRes] = await Promise.all([
		apiFetch(fetch, '/instance/info'),
		apiFetch(fetch, '/instance/categories'),
	])
	const { slug, community_id } = await infoRes.json()
	const { categories } = await catRes.json()
	return { slug, community_id, categories }
}

export const actions: Actions = {
	create: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const infoRes = await apiFetch(fetch, '/instance/info')
		const { community_id } = await infoRes.json()
		const form = await request.formData()
		const parent_id = (form.get('parent_id') as string) || undefined
		const res = await apiFetch(fetch, '/forums/categories', {
			method: 'POST',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify({
				community_id,
				name:        form.get('name')        as string,
				description: form.get('description') as string || undefined,
				parent_id,
			}),
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error ?? 'Erreur création' })
	},

	edit: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form  = await request.formData()
		const id    = form.get('id') as string
		const parent_id = form.get('parent_id') as string
		const body: Record<string, unknown> = {
			name: form.get('name') as string,
		}
		// Toujours envoyée : un champ vidé efface la description (avant, impossible).
		body.description = ((form.get('description') as string) ?? '').trim()
		if (parent_id !== '__unchanged__') body.parent_id = parent_id === '' ? null : parent_id
		const postMinRole = form.get('post_min_role') as string
		if (postMinRole) body.post_min_role = postMinRole

		const res = await apiFetch(fetch, `/admin/categories/${id}`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: JSON.stringify(body),
		})
		if (!res.ok) return fail(400, { error: (await res.json()).error ?? 'Erreur modification' })
	},

	// Monter / descendre une catégorie parmi ses sœurs (même parent) : on
	// renumérote toute la fratrie 0..n dans le nouvel ordre, puis on n'envoie
	// que les positions qui changent.
	move: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form  = await request.formData()
		const id    = form.get('id') as string
		const dir   = form.get('dir') === 'up' ? -1 : 1

		const treeRes = await apiFetch(fetch, '/instance/categories')
		if (!treeRes.ok) return fail(400, { errorKey: 'acat.err_reorder' })
		const { categories } = await treeRes.json()

		type Node = { id: string; position: number; children?: Node[] }
		const findSiblings = (nodes: Node[]): Node[] | null => {
			if (nodes.some(n => n.id === id)) return nodes
			for (const n of nodes) {
				const found = findSiblings(n.children ?? [])
				if (found) return found
			}
			return null
		}
		const siblings = findSiblings(categories)
		if (!siblings) return
		const order = [...siblings]
		const from  = order.findIndex(n => n.id === id)
		const to    = from + dir
		if (to < 0 || to >= order.length) return
		;[order[from], order[to]] = [order[to], order[from]]

		for (const [position, n] of order.entries()) {
			if (n.position === position) continue
			const res = await apiFetch(fetch, `/admin/categories/${n.id}`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${token}` },
				body: JSON.stringify({ position }),
			})
			if (!res.ok) return fail(400, { errorKey: 'acat.err_reorder' })
		}
	},

	delete: async ({ fetch, request, cookies }) => {
		const token = cookies.get('token')!
		const form  = await request.formData()
		const id    = form.get('id') as string
		const res   = await apiFetch(fetch, `/admin/categories/${id}`, {
			method: 'DELETE',
			headers: { Authorization: `Bearer ${token}` },
		})
		if (!res.ok) {
			const json = await res.json()
			return fail(res.status, { error: json.error })
		}
	},
}
