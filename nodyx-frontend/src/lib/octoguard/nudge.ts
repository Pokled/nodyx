// « Tu es sûr ? » avant d'envoyer (OctoGuard 2, lot 5).
// Avant l'envoi, on demande au serveur ce qu'OctoGuard ferait de ce texte.
// Rien n'est enregistré. Au moindre souci (réseau lent, erreur), on n'annonce
// rien et le message part : le moteur le jugera de toute façon pour de vrai.
import { apiFetch } from '$lib/api'

export type NudgeOutcome = 'hold' | 'refuse' | 'warn' | 'sanction'
export type NudgeKind = 'words' | 'links' | 'caps' | 'mentions' | 'other'
export interface Nudge { outcome: NudgeOutcome; kind: NudgeKind }

const OUTCOMES: readonly string[] = ['hold', 'refuse', 'warn', 'sanction']
const KINDS: readonly string[] = ['words', 'links', 'caps', 'mentions', 'other']

/** Au-delà, l'envoi n'attend plus la réponse. */
export const PRECHECK_TIMEOUT_MS = 1500
/** L'état « allumé » est relu au plus toutes les 5 minutes. */
const ENABLED_TTL_MS = 5 * 60_000

let cache: { enabled: boolean; at: number } | null = null

function auth(token: string | null | undefined): Record<string, string> {
	return token ? { Authorization: `Bearer ${token}` } : {}
}

/** Réponse du serveur ramenée à ce que l'écran sait afficher, sinon null. */
export function parseNudge(v: unknown): Nudge | null {
	if (!v || typeof v !== 'object') return null
	const { outcome, kind } = v as Record<string, unknown>
	if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome)) return null
	return { outcome: outcome as NudgeOutcome, kind: (typeof kind === 'string' && KINDS.includes(kind) ? kind : 'other') as NudgeKind }
}

export async function nudgeEnabled(token: string | null | undefined): Promise<boolean> {
	if (!token) return false
	if (cache && Date.now() - cache.at < ENABLED_TTL_MS) return cache.enabled
	try {
		const res = await apiFetch(fetch, '/reports/precheck', { headers: auth(token) })
		const enabled = res.ok && (await res.json().catch(() => ({}))).enabled === true
		cache = { enabled, at: Date.now() }
		return enabled
	} catch {
		return false
	}
}

/** Ce qu'OctoGuard ferait de ce texte, ou null (le message passerait, ou on ne sait pas). */
export async function precheckMessage(
	token: string | null | undefined,
	surface: 'chat' | 'forum',
	content: string,
	title?: string | null,
): Promise<Nudge | null> {
	if (!(await nudgeEnabled(token))) return null
	const ctrl = new AbortController()
	const timer = setTimeout(() => ctrl.abort(), PRECHECK_TIMEOUT_MS)
	try {
		const res = await apiFetch(fetch, '/reports/precheck', {
			method: 'POST',
			headers: auth(token),
			body: JSON.stringify({ surface, content, ...(title ? { title } : {}) }),
			signal: ctrl.signal,
		})
		if (!res.ok) return null
		const json = await res.json().catch(() => ({}))
		// Éteint entre-temps par l'admin : on le retient tout de suite
		if (json.enabled === false) cache = { enabled: false, at: Date.now() }
		return parseNudge(json.nudge)
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}

/** Pour les tests. */
export function _resetNudgeCache(): void { cache = null }
