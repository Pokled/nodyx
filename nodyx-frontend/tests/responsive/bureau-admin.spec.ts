import { test, expect } from '@playwright/test'
import { attendreMesurable } from './_attente'

/**
 * Le nom de l'instance en tête de barre latérale.
 *
 * Défaut trouvé le 11/10/2026 sur toutes les captures : « Nodyx - Hub
 * Communauta ». Le titre a droit à deux lignes, mais un mot plus large que la
 * colonne (« Communautaire », 148 px pour 121) ne se coupe pas : il était rogné.
 * Seulement chez les administrateurs : l'icône d'administration, à côté du
 * titre, lui prend la place qui manque. D'où ce projet connecté en admin.
 */
for (const largeur of [1280, 1440]) {
	test(`barre latérale @${largeur}px : le nom de l'instance n'est pas rogné`, async ({ page }) => {
		await page.setViewportSize({ width: largeur, height: 900 })
		await page.goto('/forum')
		await attendreMesurable(page)
		const titre = page.locator('.panel-head .community-name')
		await expect(titre).toBeVisible()
		const mesure = await titre.evaluate(e => ({ visible: e.clientWidth, contenu: e.scrollWidth }))
		expect(mesure.contenu, `contenu ${mesure.contenu}px pour ${mesure.visible}px visibles`).toBeLessThanOrEqual(mesure.visible + 1)
	})
}

/**
 * La carte résumé des sondages.
 *
 * Défaut trouvé le 12/10/2026 sur les captures : le type s'affichait brut
 * (« choice ») et le compteur « participants » sans nombre, la liste ne
 * renvoyant pas ce champ.
 */
test('sondages : type traduit et compteurs chiffrés', async ({ page }) => {
	await page.goto('/polls')
	await attendreMesurable(page)
	const resumes = page.locator('.poll-summary')
	await expect(resumes.first()).toBeVisible()
	const lus = await resumes.evaluateAll(els => els.map(e => ({
		type: e.querySelector('.ptype-badge')?.textContent?.trim() ?? '',
		meta: [...e.querySelectorAll('.poll-summary-meta > span')].map(s => s.textContent?.trim() ?? ''),
	})))
	for (const r of lus) {
		expect(r.type, 'type affiché brut').not.toMatch(/\b(choice|schedule|ranking)\b/)
		expect(r.meta[0], 'premier compteur sans nombre').toMatch(/^\d/)
	}
})
