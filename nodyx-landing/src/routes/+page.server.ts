import type { PageServerLoad } from './$types'
import { chargerDonnees } from '$lib/donnees.server'

export const load: PageServerLoad = async () => ({ donnees: await chargerDonnees() })
