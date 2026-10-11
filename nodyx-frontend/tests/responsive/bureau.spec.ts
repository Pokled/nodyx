import { test, expect } from '@playwright/test'
import { attendreMesurable } from './_attente'

/**
 * Le forum sur écran de bureau.
 *
 * Défaut trouvé le 11/10/2026 en préparant les captures : à 1440 px de
 * fenêtre, entre la barre latérale et la liste des membres, la liste du forum
 * ne fait que ~550 px. Les colonnes « compteurs » et « dernier message »
 * s'affichaient selon la largeur de la FENÊTRE et écrasaient le nom des
 * catégories : « Bugs & correctifs » sur 3 lignes de 28 px de large.
 *
 * Désormais elles suivent la largeur de la liste (requêtes de conteneur).
 */

for (const largeur of [1280, 1440, 1920]) {
	test(`forum @${largeur}px : chaque nom de catégorie tient sur une ligne`, async ({ page }) => {
		await page.setViewportSize({ width: largeur, height: 900 })
		await page.goto('/forum')
		await attendreMesurable(page)
		const noms = await page.evaluate(() =>
			[...document.querySelectorAll('div.space-y-2 > div a h2, div.space-y-2 > div a .flex-1 > p:first-child')].map(e => {
				const r = e.getBoundingClientRect()
				const ligne = parseFloat(getComputedStyle(e).lineHeight) || 16
				return { nom: e.textContent?.trim() ?? '', lignes: Math.round(r.height / ligne), largeur: Math.round(r.width) }
			}),
		)
		expect(noms.length, 'aucune catégorie trouvée').toBeGreaterThan(0)
		expect(noms.filter(n => n.lignes > 1)).toEqual([])
	})
}
