import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Toute page avec une zone de saisie en bas doit réserver la barre de navigation.
 *
 * Pourquoi (2026-08-15)
 * ────────────────────
 * La barre de navigation mobile est `fixed bottom-0`. Une zone de saisie collée
 * en bas de page passe donc PAR DESSOUS et devient inatteignable : on écrit
 * sous le menu. La variable `--bottom-nav-h` existe pour ça, elle vaut 56px plus
 * la zone sûre du téléphone, et 0 à partir de `lg` où la barre disparaît.
 *
 * `chat/+page.svelte` l'utilisait depuis toujours. `dm/[id]/+page.svelte` ne l'a
 * JAMAIS fait, et personne ne l'avait vu : c'est exactement le genre de défaut
 * qu'un test de rendu ne peut pas attraper, ces deux pages exigeant une session.
 *
 * Ce contrôle lit la SOURCE : si un fichier a une zone basse (`border-t` sur un
 * conteneur `shrink-0`, ou un `sticky/fixed bottom`), il doit mentionner
 * `--bottom-nav-h` quelque part.
 */

const ROUTES = new URL('../routes', import.meta.url).pathname
const EXCEPTIONS = ['/overlay/', '/admin/']

function pages(dossier: string, acc: string[] = []): string[] {
	for (const e of readdirSync(dossier)) {
		const chemin = join(dossier, e)
		if (statSync(chemin).isDirectory()) pages(chemin, acc)
		else if (e === '+page.svelte') acc.push(chemin)
	}
	return acc
}

describe('dégagement de la barre de navigation mobile', () => {
	it('une page avec une zone de saisie en bas réserve --bottom-nav-h', () => {
		const fautifs: string[] = []

		for (const fichier of pages(ROUTES)) {
			if (EXCEPTIONS.some((e) => fichier.includes(e))) continue
			const src = readFileSync(fichier, 'utf8')

			// Une zone de saisie : un champ, ET un conteneur bas identifiable.
			const aUnChamp = /placeholder=|<textarea/.test(src)
			const aUneZoneBasse = /shrink-0[^"]*border-t|sticky bottom-0|fixed bottom-0/.test(src)
			if (!aUnChamp || !aUneZoneBasse) continue

			if (!src.includes('bottom-nav-h')) {
				fautifs.push(fichier.replace(ROUTES, 'routes'))
			}
		}

		expect(
			fautifs,
			'ces pages ont une zone de saisie en bas sans réserver la barre de navigation ; ' +
				'sur mobile on y écrit SOUS le menu. Ajouter ' +
				'`style="padding-bottom: max(1rem, var(--bottom-nav-h))"` sur le conteneur bas.\n' +
				fautifs.join('\n'),
		).toEqual([])
	})
})
