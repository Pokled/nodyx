// L'état du bouclier anti-raid, vu par le membre connecté, PARTAGÉ par toute
// l'application. Le bouclier est baissé presque tout le temps : on ne demande
// pas au serveur à chaque page. Une lecture au plus par minute, et le signal
// temps réel « octoguard:shield » (levé ou baissé par l'équipe) force la relecture.
import { apiFetch } from '$lib/api'

export type ShieldView = { active: boolean; until: string | null; readonly: boolean; team?: boolean; slow_seconds: number }

/** Une lecture du serveur vaut au plus une minute. */
export const SHIELD_TTL_MS = 60_000

let cached: { token: string; at: number; value: ShieldView | null } | null = null
let inflight: Promise<ShieldView | null> | null = null

export async function shieldState(token: string | null | undefined, force = false): Promise<ShieldView | null> {
	if (!token) return null
	const now = Date.now()
	// Levé : on relit à l'heure de fin (il retombe tout seul)
	const expired = cached?.value?.active && cached.value.until && Date.parse(cached.value.until) <= now
	if (!force && !expired && cached && cached.token === token && now - cached.at < SHIELD_TTL_MS) return cached.value
	if (inflight) return inflight
	inflight = (async () => {
		try {
			const res = await apiFetch(fetch, '/reports/shield', { headers: { Authorization: `Bearer ${token}` } })
			const value = res.ok ? ((await res.json()) as ShieldView) : null
			cached = { token, at: Date.now(), value }
			return value
		} catch {
			return cached?.value ?? null
		} finally {
			inflight = null
		}
	})()
	return inflight
}

/** Pour les tests. */
export function _resetShieldState(): void { cached = null; inflight = null }
