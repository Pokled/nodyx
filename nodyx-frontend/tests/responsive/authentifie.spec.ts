import { test, expect } from '@playwright/test'

/**
 * Les pages qui exigent une connexion, jamais couvertes jusqu'ici.
 *
 * Ces écrans ont accumulé les défauts précisément parce qu'aucun test ne les
 * atteignait. Chacun des contrôles ci-dessous correspond à un défaut REEL,
 * trouvé par capture d'écran le 2026-08-15, pas à une précaution théorique.
 */

test.describe('pages authentifiées', () => {
	test.skip(
		!process.env.NODYX_TEST_EMAIL || !process.env.NODYX_TEST_PASSWORD,
		'identifiants de test absents',
	)

	/**
	 * Défaut d'origine : la zone de saisie des messages privés passait SOUS la
	 * barre de navigation mobile. `chat` réservait `--bottom-nav-h`, `dm/[id]`
	 * ne l'a jamais fait, et on écrivait sous le menu.
	 */
	test('la saisie des messages privés reste au-dessus de la barre', async ({ page }, info) => {
		test.skip(info.project.name.startsWith('tablette'), 'la barre du bas est masquée dès lg')

		await page.goto('/dm', { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(2000)

		const conversation = page.locator('a[href^="/dm/"]').first()
		test.skip((await conversation.count()) === 0, 'aucune conversation sur ce compte')
		await conversation.click()
		await page.waitForTimeout(2500)

		const mesure = await page.evaluate(() => {
			const champ = document.querySelector('textarea, [contenteditable="true"]')
			const barre = [...document.querySelectorAll('nav')].find(
				(n) =>
					getComputedStyle(n).position === 'fixed' &&
					n.getBoundingClientRect().top > window.innerHeight / 2,
			)
			if (!champ || !barre) return null
			const c = champ.getBoundingClientRect()
			const b = barre.getBoundingClientRect()
			// Recouvrement vertical : positif = le champ passe sous la barre.
			return { recouvrement: Math.round(c.bottom - b.top), champBas: Math.round(c.bottom) }
		})

		expect(mesure, 'champ de saisie ou barre introuvable').not.toBeNull()
		expect(
			mesure!.recouvrement,
			`la zone de saisie passe de ${mesure!.recouvrement}px sous la barre de navigation`,
		).toBeLessThanOrEqual(0)
	})

	/**
	 * Défaut d'origine : après un déploiement, le service worker prenait la main
	 * sans recharger et l'hydratation cassait. Le burger ne répondait plus.
	 */
	test('le menu burger ouvre bien la sidebar', async ({ page }, info) => {
		test.skip(info.project.name.startsWith('tablette'), 'le burger est masqué dès lg')

		await page.goto('/forum', { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(2000)

		const burger = page.locator('[aria-controls="galaxy-sidebar"]')
		await expect(burger).toBeVisible()

		const avant = await page.evaluate(
			() => Math.round(document.querySelector('.nodyx-sb .panel')?.getBoundingClientRect().x ?? NaN),
		)
		await burger.click()
		await page.waitForTimeout(800)
		const apres = await page.evaluate(
			() => Math.round(document.querySelector('.nodyx-sb .panel')?.getBoundingClientRect().x ?? NaN),
		)

		expect(avant, 'panneau introuvable').not.toBeNaN()
		expect(
			apres,
			`le panneau n'a pas bougé au clic (avant ${avant}px, après ${apres}px)`,
		).toBeGreaterThan(avant)
	})

	/** Le burger doit rester attrapable au pouce : 44px est la recommandation. */
	test('le burger est assez grand pour un pouce', async ({ page }, info) => {
		test.skip(info.project.name.startsWith('tablette'), 'le burger est masqué dès lg')

		await page.goto('/forum', { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(1500)

		const boite = await page.locator('[aria-controls="galaxy-sidebar"]').boundingBox()
		expect(boite, 'burger introuvable').not.toBeNull()
		expect(Math.round(boite!.width)).toBeGreaterThanOrEqual(40)
		expect(Math.round(boite!.height)).toBeGreaterThanOrEqual(40)
	})
})
