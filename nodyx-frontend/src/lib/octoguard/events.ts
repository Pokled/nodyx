// Les événements d'OctoGuard (admin_audit_log), racontés en phrases.
// Partagé par la Vue d'ensemble et le Journal. Aucune chaîne affichée ici.
import { LEVEL_ICON, type Level } from './rules'

export type EventKind = Level | 'ok' | 'acc'
export type OgLog = {
	id: string; action: string; actor_username: string | null; target_type: string | null; target_id: string | null
	target_label: string | null; metadata: Record<string, any> | null; created_at: string; undone?: boolean
	false_positive?: boolean; normal?: boolean
}

export const KIND_ICON: Record<EventKind, string> = {
	...LEVEL_ICON,
	ok: 'M9 14L4 9l5-5 M4 9h11a5 5 0 010 10h-3',
	acc: 'M4 7h10 M18 7h2 M4 17h4 M12 17h8 M16 5a2 2 0 100 4 2 2 0 000-4z M10 15a2 2 0 100 4 2 2 0 000-4z',
}

/** Qui a agi : le moteur, l'équipe, ou rien (observation). */
export type EventSource = 'octoguard' | 'team' | 'observed'

const ladderKind = (s: unknown): 'warn' | 'mute' | 'ban' =>
	typeof s === 'string' && s.startsWith('mute') ? 'mute' : typeof s === 'string' && s.startsWith('ban') ? 'ban' : 'warn'

/**
 * Les valeurs qu'une phrase du journal peut utiliser. Le barème a besoin de plus
 * que la règle et l'auteur : le membre visé, la durée, l'étape.
 */
export function eventVars(l: Pick<OgLog, 'metadata' | 'actor_username' | 'target_label'>, tFn: (k: string, v?: Record<string, string | number>) => string): Record<string, string | number> {
	const md = l.metadata ?? {}
	return {
		rule: md.rule_name ?? '',
		who: l.actor_username ?? '',
		name: l.target_label ?? '',
		step: md.step ?? '',
		d: typeof md.sanction === 'string' && md.sanction !== 'warn' ? tFn(`og2.lad_d_${md.sanction}`) : '',
	}
}

export function eventOf(l: Pick<OgLog, 'action' | 'metadata'>): { kind: EventKind; key: string; source: EventSource } {
	// Le nom d'action sans son préfixe « octoguard. » : ce ne sont pas des clés de traduction.
	const a = l.action.replace(/^octoguard\./, '')
	const auto = l.metadata?.actor === 'octoguard:auto' || !!l.metadata?.rule_id
	if (a.startsWith('would_')) return { kind: 'observe', key: 'ev_would', source: 'observed' }
	switch (a) {
		case 'delete_message': return { kind: 'delete', key: 'ev_delete', source: 'octoguard' }
		case 'warn_user': return { kind: 'warn', key: 'ev_warn', source: 'octoguard' }
		case 'mute_user': return { kind: 'delete', key: auto ? 'ev_mute' : 'ev_mute_team', source: auto ? 'octoguard' : 'team' }
		case 'unmute_user': return { kind: 'ok', key: 'ev_unmute', source: auto ? 'octoguard' : 'team' }
		case 'ban_temp_user': return { kind: 'delete', key: 'ev_ban_temp', source: 'octoguard' }
		case 'escalation_mute': case 'escalation_ban_temp': return { kind: 'delete', key: 'ev_escalation', source: 'octoguard' }
		case 'report_filed': case 'notify': return { kind: 'report', key: 'ev_report', source: 'octoguard' }
		case 'action_undone': return { kind: 'ok', key: 'ev_undone', source: 'team' }
		case 'false_positive': return { kind: 'ok', key: 'ev_false_positive', source: 'team' }
		case 'observed_normal': return { kind: 'ok', key: 'ev_observed_normal', source: 'team' }
		case 'message_held': return { kind: 'hold', key: 'ev_held', source: 'octoguard' }
		case 'held_approved': return { kind: 'ok', key: 'ev_held_approved', source: 'team' }
		case 'held_refused': return { kind: 'delete', key: 'ev_held_refused', source: 'team' }
		case 'held_expired': return { kind: 'observe', key: 'ev_held_expired', source: 'octoguard' }
		case 'hate_symbol_blocked': return { kind: 'delete', key: 'ev_hate', source: 'octoguard' }
		// Le barème (lot 4b) : la phrase dépend de la sanction (« a mis Rémi en sourdine 1 heure »)
		case 'ladder_applied': {
			const k = ladderKind(l.metadata?.sanction)
			return { kind: k === 'warn' ? 'warn' : 'delete', key: `ev_ladder_applied_${k}`, source: 'team' }
		}
		case 'ladder_approved': return { kind: 'delete', key: 'ev_ladder_approved', source: 'team' }
		case 'ladder_proposed': return { kind: 'report', key: 'ev_ladder_proposed', source: 'team' }
		case 'ladder_refused': return { kind: 'ok', key: 'ev_ladder_refused', source: 'team' }
		case 'ladder_expired': return { kind: 'observe', key: 'ev_ladder_expired', source: 'octoguard' }
		case 'ladder_undone': return { kind: 'ok', key: 'ev_ladder_undone', source: 'team' }
		case 'ladder_settings': return { kind: 'acc', key: 'ev_config', source: 'team' }
	}
	if (/^(rule|profile|command|welcome|webhook)_/.test(a)) return { kind: 'acc', key: 'ev_config', source: 'team' }
	return { kind: 'observe', key: 'ev_other', source: auto ? 'octoguard' : 'team' }
}
