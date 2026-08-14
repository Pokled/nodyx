import type { LayoutServerLoad } from './$types'
import { negotiate, isLocale } from '$lib/i18n'

export const load: LayoutServerLoad = async ({ request, cookies }) => {
	// Choix explicite d'abord, langue du navigateur ensuite : un visiteur qui a
	// choisi ne doit pas se faire redirigier par son navigateur.
	const chosen = cookies.get('locale')
	const locale = isLocale(chosen) ? chosen : negotiate(request.headers.get('accept-language'))
	return { locale }
}
