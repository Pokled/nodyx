import { json } from '@sveltejs/kit'
import type { RequestHandler } from './$types'
import { loadRegistry } from '$lib/registryFs'
import { buildIndex } from '$lib/registry'

/**
 * L'index consomme par l'administration de chaque instance.
 *
 * MEME donnee et MEME ordre que le site : une divergence entre ce qu'un humain
 * lit et ce qu'une machine telecharge serait le pire defaut possible pour un
 * magasin.
 *
 * Ouvert a toutes les origines : c'est une liste publique, et une instance qui
 * le consomme est un tiers par definition. Rien de sensible n'y figure.
 */
export const GET: RequestHandler = async () => {
	const index = buildIndex(loadRegistry(), new Date().toISOString())
	return json(index, {
		headers: {
			'Access-Control-Allow-Origin': '*',
			'Cache-Control': 'public, max-age=300',
		},
	})
}
