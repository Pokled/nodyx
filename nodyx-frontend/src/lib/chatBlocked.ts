// Ce que voit un membre quand le serveur refuse son message (chat ou message privé).
//
// Le cœur envoie `chat:blocked` avec une raison. Certaines sont des codes
// (« muted », « channel_read_only »), d'autres viennent d'OctoGuard avec une clé
// stable, et le filtre de contenu envoie encore une phrase française écrite en
// dur. Règle de cette fonction : la raison brute n'est JAMAIS affichée. Tout ce
// qu'on ne reconnaît pas retombe sur une phrase traduite.

import { octoguardMessage } from './octoguardMessages'

type T = (key: string, vars?: Record<string, string>) => string

export interface BlockedPayload {
	reason?: string | null
	octoguard?: { expires_at?: string | null; i18n_key?: string | null } | null
}

export function blockedMessage(tFn: T, p: BlockedPayload | null | undefined, formatDate: (iso: string) => string = iso => new Date(iso).toLocaleString()): string {
	const reason = p?.reason ?? null
	const og = p?.octoguard ?? null
	// Sourdine posée par l'équipe : une phrase, avec sa fin si elle en a une
	if (reason === 'muted') {
		return og?.expires_at ? tFn('chat.muted_until', { date: formatDate(og.expires_at) }) : tFn('chat.muted')
	}
	if (og?.i18n_key) return octoguardMessage(tFn, og.i18n_key)
	if (reason === 'channel_read_only') return tFn('chat.blocked_read_only')
	// Filtre de contenu (phrase française du cœur) ou raison inconnue
	return tFn('chat.message_refused')
}
