import type { Handle } from '@sveltejs/kit'
import { negotiate, isLocale } from '$lib/i18n'

export const handle: Handle = async ({ event, resolve }) => {
	const chosen = event.cookies.get('locale')
	const locale = isLocale(chosen) ? chosen : negotiate(event.request.headers.get('accept-language'))

	// Le `lang` du document suit la langue servie : c'est ce que lisent les
	// lecteurs d'ecran et les moteurs de recherche.
	return resolve(event, { transformPageChunk: ({ html }) => html.replace('%lang%', locale) })
}
