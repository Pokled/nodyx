// Signaler un contenu (CDC modération, E2) : une seule fenêtre pour tout le
// site, montée dans le layout racine, ouverte depuis n'importe quel bouton
// « Signaler » (forum, chat, profil).
import { writable } from 'svelte/store'

export type ReportTargetType = 'post' | 'thread' | 'message' | 'user'

export interface ReportRequest {
	type: ReportTargetType
	id: string
	/** Ce que l'utilisateur signale, en clair : « le message de Lisa », « le profil de Tom » */
	label: string
}

export const reportRequest = writable<ReportRequest | null>(null)

export function openReport(req: ReportRequest): void {
	reportRequest.set(req)
}
