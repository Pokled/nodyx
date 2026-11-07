import type { PageServerLoad } from './$types'
import { apiFetch } from '$lib/api'

// Signalements dans OctoGuard : une seule file pour ceux des membres, ceux
// d'OctoGuard et les contenus retenus à relire (CDC E4h, lots 2 et 3).
const TABS = ['open', 'held', 'done'] as const
export type Tab = (typeof TABS)[number]

export const load: PageServerLoad = async ({ fetch, cookies, url }) => {
	const token = cookies.get('token')
	const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {}
	const asked = url.searchParams.get('tab') ?? 'open'
	const tab: Tab = (TABS as readonly string[]).includes(asked) ? (asked as Tab) : 'open'
	const get = async (path: string) => {
		try { const r = await apiFetch(fetch, path, { headers }); return r.ok ? await r.json() : null } catch { return null }
	}
	// Les compteurs des onglets viennent toujours, la liste seulement pour l'onglet ouvert
	const [reports, held] = await Promise.all([
		get(tab === 'done' ? '/admin/octoguard/reports?limit=200' : '/admin/octoguard/reports?status=open&limit=200'),
		get('/admin/octoguard/held'),
	])
	const counts = (reports?.counts ?? {}) as Record<string, number>
	return {
		tab,
		failed: !reports || !held,
		reports: ((reports?.reports ?? []) as Array<{ status: string }>).filter((r) => (tab === 'done' ? r.status !== 'open' : tab === 'open')),
		held: tab === 'held' ? (held?.held ?? []) : [],
		heldCount: (held?.count as number) ?? 0,
		expiryHours: (held?.expiry_hours as number) ?? 72,
		openCount: counts.open ?? 0,
		doneCount: (counts.actioned ?? 0) + (counts.dismissed ?? 0) + (counts.reviewed ?? 0),
	}
}
