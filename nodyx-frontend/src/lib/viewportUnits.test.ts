import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Garde-fou : plus de `100vh` dans le frontend utilisateur.
 *
 * Pourquoi (2026-08-15)
 * ────────────────────
 * Sur mobile, `100vh` vaut la hauteur de l'écran barre d'URL RÉTRACTÉE, donc
 * toujours plus que la zone réellement visible. Une racine en `min-h-screen`
 * rend chaque page systématiquement plus haute que l'écran, ce qui produit un
 * défilement parasite partout. `100dvh` (dynamic viewport height) existe
 * précisément pour ça et est supporté partout aujourd'hui.
 *
 * Ce contrôle est une lecture de SOURCE, pas un test de rendu : Playwright ne
 * peut pas distinguer un `100vh` d'un `100dvh` une fois la page peinte, et le
 * symptôme (quelques pixels de défilement en trop) est trop ténu pour être
 * mesuré de façon fiable. Un grep est ici plus honnête qu'un test instable.
 *
 * DEUX EXCEPTIONS LÉGITIMES, à ne jamais « corriger » :
 *
 *   - `src/routes/overlay/**` : sources navigateur pour OBS. Fenêtre de taille
 *     fixe, aucune barre d'URL, `100vh` y est exactement ce qu'il faut.
 *   - `src/routes/admin/**` : le panneau d'administration n'est pas encore
 *     passé au responsive (chantier suivant). Retirer cette exception quand ce
 *     sera fait, ce test le signalera tout seul.
 */

const RACINE = new URL('../', import.meta.url).pathname
const EXCEPTIONS = ['/routes/overlay/', '/routes/admin/']
const INTERDIT = /\bmin-h-screen\b|\bh-screen\b|\b100vh\b/

function fichiersSources(dossier: string, acc: string[] = []): string[] {
	for (const entree of readdirSync(dossier)) {
		const chemin = join(dossier, entree)
		if (statSync(chemin).isDirectory()) {
			if (entree === 'node_modules' || entree.startsWith('.')) continue
			fichiersSources(chemin, acc)
		} else if (/\.(svelte|css)$/.test(entree)) {
			acc.push(chemin)
		}
	}
	return acc
}

describe('unités de viewport', () => {
	it('le frontend utilisateur n utilise plus 100vh, seulement 100dvh', () => {
		const fautifs: string[] = []

		for (const fichier of fichiersSources(RACINE)) {
			if (EXCEPTIONS.some((e) => fichier.includes(e))) continue
			const lignes = readFileSync(fichier, 'utf8').split('\n')
			lignes.forEach((ligne, i) => {
				// Un commentaire qui MENTIONNE la classe n'est pas un usage.
				const nu = ligne.replace(/\/\/.*$/, '').replace(/<!--.*?-->/g, '')
				if (INTERDIT.test(nu)) {
					fautifs.push(`${fichier.replace(RACINE, '')}:${i + 1}  ${ligne.trim().slice(0, 80)}`)
				}
			})
		}

		expect(
			fautifs,
			'Utiliser 100dvh / min-h-dvh / h-dvh. Sur mobile 100vh dépasse la zone visible ' +
				'et fabrique un défilement parasite sur toute la page.\n' +
				fautifs.join('\n'),
		).toEqual([])
	})

	it('les overlays OBS gardent 100vh, qui y est correct', () => {
		// Le pendant du test précédent : il doit rester vrai que les overlays
		// n'ont PAS été « corrigés » par un remplacement global trop large.
		const overlays = fichiersSources(join(RACINE, 'routes/overlay'))
		const avec100vh = overlays.filter((f) => /\b100vh\b/.test(readFileSync(f, 'utf8')))
		expect(avec100vh.length, 'les overlays OBS ont perdu leur 100vh').toBeGreaterThan(0)
	})
})
