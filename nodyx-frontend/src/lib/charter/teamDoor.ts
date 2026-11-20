// La porte de l'équipe (lot 7e) : quand un outil de l'équipe répond CHARTER_TEAM_UNSIGNED
// (requête HTTP ou socket de modération), le layout ouvre la porte de l'équipe.
// L'admin, lui, passe par /admin/team-charter (ses pages chargent leurs données avant
// de s'afficher : une porte dans le layout arriverait après une page d'erreur).

export const TEAM_CHARTER_EVENT = 'nx:charter-team'
export const TEAM_CHARTER_CODE = 'CHARTER_TEAM_UNSIGNED'

/** Une réponse de l'API dit-elle « signe d'abord la charte de l'équipe » ? Ne consomme pas le corps. */
export async function isTeamCharterRefusal(res: Response): Promise<boolean> {
	if (res.status !== 403) return false
	try { return (await res.clone().json())?.code === TEAM_CHARTER_CODE } catch { return false }
}

/** Où revenir après avoir signé : une page de l'admin, jamais une adresse extérieure. */
export function safeAdminNext(next: string | null | undefined): string {
	if (!next || !next.startsWith('/admin') || next.startsWith('//') || next.startsWith('/admin/team-charter')) return '/admin'
	return /^\/admin[\w\-/?=&%.]*$/.test(next) ? next : '/admin'
}
