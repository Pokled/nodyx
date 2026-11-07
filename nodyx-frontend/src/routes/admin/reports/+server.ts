import { redirect } from '@sveltejs/kit'
import type { RequestHandler } from './$types'

// Les signalements vivent désormais dans OctoGuard, avec les contenus retenus
// (une seule file, CDC E4h). L'ancienne adresse y mène, onglet compris.
export const GET: RequestHandler = ({ url }) => {
	const status = url.searchParams.get('status')
	redirect(307, status && status !== 'open' ? '/admin/octoguard/reports?tab=done' : '/admin/octoguard/reports')
}
