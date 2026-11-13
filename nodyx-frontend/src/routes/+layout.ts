// Les langues se chargent à la demande (voir lib/i18n.ts). Ce chargement s'exécute
// côté serveur ET dans le navigateur avant l'hydratation : la page n'est jamais
// rendue sans ses textes, et le navigateur a exactement ceux du serveur.
import type { LayoutLoad } from './$types'
import { ensureLocale, isKnownLocale } from '$lib/i18n'

export const load: LayoutLoad = async ({ data }) => {
	try {
		await ensureLocale(isKnownLocale(data.ssrLocale) ? data.ssrLocale : 'fr')
	} catch {
		// Fichier de langue introuvable : la page s'affiche quand même. `t` retombe sur
		// les langues déjà chargées, puis sur la clé ; mieux qu'une page d'erreur.
	}
	return data
}
