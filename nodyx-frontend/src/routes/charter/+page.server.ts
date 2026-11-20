// La page « La charte » (lot 7d-3, maquette v4 validée le 20/11/2026) : réservée aux
// membres connectés. Un visiteur part à la connexion, puis revient ici.
import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

export type CharterText = {
	version: number | null
	enabled?: boolean
	community: string
	published_at?: string | null
	body_html?: string
	signed?: { version: number; way: 'hand' | 'phrase'; signed_at: string } | null
	team_reader?: boolean
}

export const load: PageServerLoad = async ({ fetch, parent, url }) => {
	const { token } = await parent()
	if (!token) redirect(302, '/auth/login?redirectTo=/charter')
	const headers = { Authorization: `Bearer ${token}` }
	const get = async (aud: 'members' | 'team'): Promise<CharterText | null> => {
		try {
			const res = await apiFetch(fetch, `/charter/${aud}/text`, { headers })
			return res.ok ? await res.json() : null
		} catch { return null }
	}
	const members = await get('members')
	const team = members?.team_reader ? await get('team') : null
	const aud: 'members' | 'team' = url.searchParams.get('aud') === 'team' && team?.version ? 'team' : 'members'
	return { members, team, aud }
}
