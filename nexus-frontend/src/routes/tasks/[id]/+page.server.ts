import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'
import { error } from '@sveltejs/kit'

export const load: PageServerLoad = async ({ fetch, cookies, params }) => {
  const token = cookies.get('token')
  const res = await apiFetch(fetch, `/tasks/boards/${params.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 404) throw error(404, 'Tableau introuvable')
  if (!res.ok)            throw error(500, 'Erreur de chargement')

  const json = await res.json()
  return {
    board:      json.board,
    canManage:  json.canManage ?? false,
    members:    json.members   ?? [],
  }
}
