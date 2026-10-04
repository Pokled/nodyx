import { test, expect, type Page } from '@playwright/test'
import { attendreMesurable } from './_attente'

/**
 * Le panneau des langues (drapeau de l'en-tête).
 *
 * Défaut d'origine, signalé par un utilisateur le 2026-10-04 : ouvrir les
 * langues NAVIGUAIT vers l'accueil, et le panneau remplaçait la page, détruite.
 * « Retour » refermait donc le panneau... sur l'accueil, position de lecture et
 * brouillon perdus. Et recliquer sur le drapeau, panneau ouvert, ne faisait rien.
 *
 * Désormais la page reste montée sous le panneau : on revient exactement là où
 * on était. Le drapeau ouvre ET referme.
 */

const PAGE_LONGUE = '/discover'

/** Ce qui défile vraiment : <main> sur grand écran, la fenêtre sur mobile. */
function position(page: Page) {
	return page.evaluate(() =>
		Math.max(document.querySelector('main.app-shell-main')?.scrollTop ?? 0, window.scrollY),
	)
}

test.describe('panneau des langues', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto(PAGE_LONGUE)
		await attendreMesurable(page)
		// Le bouton est rendu par le serveur AVANT que l'hydratation lui donne son
		// action : un clic trop tôt ne fait rien. On attend que le réseau retombe.
		await page.waitForLoadState('networkidle')
	})

	test('« Retour » ramène là où on était : même page, même état, même position', async ({ page }) => {
		const panneau = page.locator('.lang-view[role="dialog"]')
		// Un témoin dans la page (perdu si elle est recréée) et une position de lecture.
		await page.evaluate(() => {
			const m = document.querySelector('main.app-shell-main')
			m?.querySelector('h1, h2, a, p')?.setAttribute('data-temoin', 'toujours-la')
			if (m && m.scrollHeight > m.clientHeight + 50) m.scrollTop = 300
			else window.scrollTo(0, 300)
		})
		const avant = await position(page)
		expect(avant, 'la page doit défiler pour que le test ait un sens').toBeGreaterThan(0)

		await page.locator('.lang-nav-btn').first().click()
		await expect(panneau).toBeVisible()
		expect(new URL(page.url()).pathname).toBe(PAGE_LONGUE)

		await page.locator('.lang-back').click()
		await expect(panneau).toBeHidden()
		expect(new URL(page.url()).pathname).toBe(PAGE_LONGUE)
		await expect(page.locator('[data-temoin="toujours-la"]')).toHaveCount(1)
		await expect.poll(() => position(page)).toBeGreaterThanOrEqual(avant - 2)
		expect(await position(page)).toBeLessThanOrEqual(avant + 2)
	})

	test('le drapeau ouvre ET referme le panneau', async ({ page }) => {
		const panneau = page.locator('.lang-view[role="dialog"]')
		const drapeau = page.locator('.lang-nav-btn').first()
		await drapeau.click()
		await expect(panneau).toBeVisible()
		await expect(drapeau).toHaveAttribute('aria-expanded', 'true')

		// Comme une vraie personne : un clic à l'endroit du drapeau, quoi qu'il y ait dessus.
		const cadre = await drapeau.boundingBox()
		if (!cadre) throw new Error('drapeau introuvable')
		await page.mouse.click(cadre.x + cadre.width / 2, cadre.y + cadre.height / 2)
		await expect(panneau).toBeHidden()
		await expect(drapeau).toHaveAttribute('aria-expanded', 'false')

		await page.mouse.click(cadre.x + cadre.width / 2, cadre.y + cadre.height / 2)
		await expect(panneau).toBeVisible()
		await page.keyboard.press('Escape')
		await expect(panneau).toBeHidden()
	})
})
