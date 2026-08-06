/**
 * État des traductions, en JSON.
 *
 * Consommé par nodyx.dev et start.nodyx.org pour afficher la barre de
 * progression sans dupliquer le calcul : une seule source de chiffres, celle
 * des fichiers de locale. CORS ouvert, la donnée est publique par nature.
 */
import type { RequestHandler } from './$types'
import { getTranslationProgress } from '$lib/translationProgress'

export const GET: RequestHandler = async () => {
	const progress = getTranslationProgress()

	return new Response(
		JSON.stringify(
			{
				total:         progress.total,
				coreTotal:     progress.coreTotal,
				translatedAll: progress.translatedAll,
				grandTotal:    progress.grandTotal,
				overallPct:    progress.overallPct,
				completeCount: progress.completeCount,
				languages: progress.languages.map((l) => ({
					code:           l.code,
					label:          l.label,
					translated:     l.translated,
					missing:        l.missing,
					pct:            l.pct,
					isSource:       l.isSource,
					isComplete:     l.isComplete,
					isCoreComplete: l.isCoreComplete,
				})),
			},
			null,
			2,
		),
		{
			headers: {
				'content-type':                'application/json; charset=utf-8',
				'access-control-allow-origin': '*',
				// Les chiffres ne bougent qu'au déploiement : une heure de cache suffit.
				'cache-control':               'public, max-age=3600',
			},
		},
	)
}
