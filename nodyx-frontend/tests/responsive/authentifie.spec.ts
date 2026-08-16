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

	/**
	 * Defaut du 16/08 : ouvrir le tiroir, le fermer par la CROIX du panneau, puis
	 * le rouvrir au burger donnait un ecran floute SANS sidebar.
	 *
	 * La croix pose `panelCollapsed = true` en fermant, et la regle
	 * `.panel.collapsed` porte son propre `translateX(-100%)`. Rouvrir remettait
	 * donc `gallerySidebarOpen` a vrai (le voile revenait) pendant que le panneau
	 * restait hors ecran. Le symptome semblait aleatoire : il dependait en fait
	 * de la FACON dont on avait ferme la fois precedente.
	 */
	test('rouvrir apres une fermeture par la croix montre bien le panneau', async ({ page }, info) => {
		test.skip(info.project.name.startsWith('tablette'), 'le tiroir n existe pas des lg')

		await page.goto('/forum', { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(1800)

		const burger = page.locator('[aria-controls="galaxy-sidebar"]')
		const posX = () =>
			page.evaluate(() => {
				const t = [...document.querySelectorAll('.nodyx-sb .panel')]
				const el = t[t.length - 1]
				return el ? Math.round(el.getBoundingClientRect().x) : NaN
			})

		await burger.click()
		await page.waitForTimeout(700)
		expect(await posX(), 'le panneau ne s ouvre pas la premiere fois').toBe(0)

		const croix = page.locator('.nodyx-sb .panel .close').last()
		test.skip((await croix.count()) === 0, 'croix de fermeture introuvable')
		await croix.click()
		await page.waitForTimeout(700)

		await burger.click()
		await page.waitForTimeout(900)
		expect(
			await posX(),
			'panneau hors ecran apres une fermeture par la croix : `panelCollapsed` n a pas ete remis a zero',
		).toBe(0)
	})

	/**
	 * Defaut du 16/08 : sur un salon VOCAL, le chat du salon s'ouvrait par defaut,
	 * y compris sur telephone ou il mangeait la moitie de l'ecran. On vient
	 * pourtant d'abord pour rejoindre la voix.
	 *
	 * Le test NETTOIE le choix stocke avant de mesurer : la session Playwright
	 * embarque le localStorage, et un choix explicite de l'utilisateur doit etre
	 * respecte. Sans ce nettoyage, on mesurerait une preference, pas le defaut.
	 */
	test('le chat d un salon vocal reste ferme par defaut sur telephone', async ({ page }, info) => {
		test.skip(info.project.name.startsWith('tablette'), 'ce defaut ne concerne que le mobile')

		await page.goto('/chat', { waitUntil: 'domcontentloaded' })
		await page.evaluate(() => localStorage.removeItem('nodyx:voice:chat'))
		await page.goto('/chat?channel=a3010bd6-cc2e-4ab5-9b6a-8a9046ffbbe5', {
			waitUntil: 'domcontentloaded',
		})
		await page.waitForTimeout(2500)

		const panneau = await page.evaluate(() => {
			const entete = [...document.querySelectorAll('*')].find((e) =>
				/chat du salon|room chat/i.test(e.textContent ?? '') && e.children.length < 4,
			)
			return entete ? Math.round(entete.getBoundingClientRect().width) : 0
		})
		expect(panneau, 'le chat du salon est ouvert par defaut sur telephone').toBe(0)

		// Et le bouton qui l'ouvre doit etre attrapable au pouce.
		const bouton = page.locator('button[aria-label*="chat" i]').first()
		if (await bouton.count()) {
			const b = await bouton.boundingBox()
			expect(Math.round(b!.width), 'bouton d ouverture du chat trop etroit').toBeGreaterThanOrEqual(40)
		}
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
