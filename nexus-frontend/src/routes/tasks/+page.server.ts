import type { PageServerLoad, Actions } from './$types'
import { apiFetch } from '$lib/api'
import { fail, redirect } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies }) => {
  const token = cookies.get('token')
  const res = await apiFetch(fetch, '/tasks/boards', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = res.ok ? await res.json() : { boards: [] }
  return { boards: json.boards ?? [] }
}

export const actions: Actions = {
  create: async ({ fetch, cookies, request }) => {
    const token = cookies.get('token')
    const form  = await request.formData()
    const name        = String(form.get('name') ?? '').trim()
    const description = String(form.get('description') ?? '').trim()

    if (!name) return fail(400, { error: 'Le nom est requis' })

    const res = await apiFetch(fetch, '/tasks/boards', {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, description }),
    })
    if (!res.ok) return fail(res.status, { error: 'Impossible de créer le tableau' })

    const json = await res.json()
    throw redirect(303, `/tasks/${json.id}`)
  },

  delete: async ({ fetch, cookies, request }) => {
    const token = cookies.get('token')
    const form  = await request.formData()
    const id    = String(form.get('id'))

    await apiFetch(fetch, `/tasks/boards/${id}`, {
      method:  'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    return { ok: true }
  },
}
