// Le barème des sanctions, côté écran (lot 4b, CDC §E4i). Aucune chaîne affichée
// ici : seulement des clés et des valeurs. La liste suit EXACTEMENT celle du cœur
// (services/octoguard/ladder.ts), du plus doux au plus ferme.
import { og } from './api'

export const SANCTIONS = ['warn', 'mute_10m', 'mute_1h', 'mute_24h', 'mute_7d', 'ban_1d', 'ban_7d', 'ban_30d'] as const
export type Sanction = (typeof SANCTIONS)[number]
export const kindOf = (s: Sanction): 'warn' | 'mute' | 'ban' => (s === 'warn' ? 'warn' : s.startsWith('mute') ? 'mute' : 'ban')
/** Une exclusion de 7 jours OU PLUS attend un second avis (si la double validation est activée). */
export const needsSecondOpinion = (s: Sanction) => s === 'ban_7d' || s === 'ban_30d'

/** Libellé court d'une option (« Sourdine 1 h »). */
export const optionKey = (s: Sanction) => `og2.lad_o_${s}`
/** La sanction dans une phrase (« sourdine d'une heure »). */
export const phraseKey = (s: Sanction) => `og2.lad_n_${s}`
/** Sa durée seule (« une heure »). */
export const durationKey = (s: Sanction) => `og2.lad_d_${s}`

export type LadderSettings = { steps: Sanction[]; forget_days: number; double_validation: boolean }
export type LadderEntry = {
	id: string; step: number; sanction: Sanction; status: 'applied' | 'pending' | 'refused' | 'expired' | 'undone'
	actor_id: string | null; actor: string | null; second: string | null; reason: string | null
	report_id: string | null; report_category: string | null; created_at: string
}
export type MemberLadder = {
	position: number
	next: { step: number; sanction: Sanction } | null
	pending: LadderEntry | null
	history: LadderEntry[]
	settings: LadderSettings
}

export const loadMemberLadder = (token: string | null, userId: string) => og<MemberLadder>(token, `/ladder/member/${userId}`)

/** Les erreurs du cœur, traduites (jamais la phrase brute). */
export const LADDER_ERR: Record<string, string> = {
	LADDER_STEP_CHANGED: 'og2.lad_err_changed',
	LADDER_MAX_REACHED: 'og2.lad_err_max',
	LADDER_REASON_REQUIRED: 'og2.lad_err_reason',
	LADDER_PENDING_APPROVAL: 'og2.lad_err_pending',
	LADDER_NO_SECOND_VALIDATOR: 'og2.lad_err_no_second',
	LADDER_REPORT_MISMATCH: 'og2.lad_err_report',
	LADDER_EXPIRED: 'og2.lad_err_expired',
	LADDER_APPLY_FAILED: 'og2.lad_err_failed',
	LADDER_STEPS_INVALID: 'og2.lad_err_steps',
	LADDER_FORGET_INVALID: 'og2.lad_err_steps',
	LADDER_NEEDS_TWO: 'og2.lad_err_needs_two',
	CANNOT_APPROVE_OWN: 'og2.lad_err_own',
	ALREADY_DECIDED: 'og2.rp_err_decided',
	ALREADY_UNDONE: 'og2.lad_err_undone',
	NOTHING_TO_UNDO: 'og2.lad_err_undone',
	RANK_TOO_LOW: 'areports.err_rank',
	FORBIDDEN: 'areports.err_forbidden',
}
