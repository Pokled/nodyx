import { redirect, error } from '@sveltejs/kit'
import type { LayoutServerLoad } from './$types'
import { apiFetch } from '$lib/api'
import { mayOpenAdmin, type AdminAccess } from '$lib/adminAccess'

const UNAVAILABLE = 'Service temporairement indisponible'

export const load: LayoutServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token')
	if (!token) redirect(302, `/auth/login?redirectTo=${encodeURIComponent(url.pathname)}`)

	const auth = { headers: { Authorization: `Bearer ${token}` } }

	// Droits dans l'administration : ouvert à toute l'équipe (au moins une
	// permission, socle du rôle + grade). Les admins voient tout, les autres
	// seulement les pages de leurs droits (lib/adminAccess.ts).
	const meRes = await apiFetch(fetch, '/admin/me', auth)
	if (meRes.status === 401) redirect(302, `/auth/login?redirectTo=${encodeURIComponent(url.pathname)}`)
	if (meRes.status === 403) redirect(302, '/')
	if (!meRes.ok) error(503, UNAVAILABLE)
	const access = (await meRes.json()) as AdminAccess

	// Une page hors de ses droits : retour au tableau de bord plutôt qu'un refus sec
	if (!mayOpenAdmin(url.pathname, access)) redirect(302, '/admin')

	const statsRes = await apiFetch(fetch, '/admin/stats', auth)
	if (!statsRes.ok) error(503, UNAVAILABLE)
	const stats = await statsRes.json()

	const isAdmin = access.role === 'owner' || access.role === 'admin'
	const updateRes = isAdmin
		? await apiFetch(fetch, '/admin/update-check', auth).catch(() => null)
		: null
	const updateCheck = updateRes?.ok ? await updateRes.json().catch(() => null) : null

	return { token, stats, updateCheck, access }
}
