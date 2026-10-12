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
