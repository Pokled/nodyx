import { redirect } from '@sveltejs/kit'
import type { PageServerLoad } from './$types'

// La file de signalements a déménagé dans l'administration (Communauté >
// Signalements), ouverte aux modérateurs. Les anciens liens y mènent.
export const load: PageServerLoad = async ({ url }) => {
	const status = url.searchParams.get('status')
	redirect(301, status ? `/admin/reports?status=${encodeURIComponent(status)}` : '/admin/reports')
}
