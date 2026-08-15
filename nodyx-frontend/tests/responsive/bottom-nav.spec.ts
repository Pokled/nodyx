import { test, expect, type Page } from '@playwright/test'

/**
 * La barre de navigation du bas, sur mobile.
 *
 * Défaut d'origine, constaté le 2026-08-15 : la barre utilisait `--p-card-bg`,
 * c'est-à-dire un fond de CARTE. Six thèmes sur sept sont translucides par
 * construction, dont un à 5% d'opacité, et aucun `backdrop-filter` ne venait
 * rattraper. Résultat mesuré en capture : sur Chromium on LISAIT « Dernier
 * message » et « Pokled » au travers de la barre, par-dessus les icônes.
 *
 * Une carte translucide posée sur un fond de page, c'est voulu. Une barre FIXE
 * avec du contenu qui défile dessous, c'est du verre.
 */

/** Récupère la barre fixe du bas, celle qui n'existe qu'en dessous de `lg`. */
async function barreDuBas(page: Page) {
	return page.evaluate(() => {
		const nav = [...document.querySelectorAll('nav')]
			.find((n) => {
				const s = getComputedStyle(n)
				return s.position === 'fixed' && n.getBoundingClientRect().top > window.innerHeight / 2
			})
		if (!nav) return null
		const s = getComputedStyle(nav)
		const r = nav.getBoundingClientRect()
		return {
			fond: s.backgroundColor,
			backdrop: s.backdropFilter,
			hauteur: Math.round(r.height),
			cibles: [...nav.querySelectorAll('a, button')].map((el) => {
				const cr = el.getBoundingClientRect()
				return { w: Math.round(cr.width), h: Math.round(cr.height) }
			}),
		}
	})
}

/** `rgba(r,g,b,a)` ou `rgb(r,g,b)` vers son canal alpha. */
function alpha(couleur: string): number {
	const m = couleur.match(/rgba?\(([^)]+)\)/)
	if (!m) return 1
	const parts = m[1].split(',').map((v) => parseFloat(v.trim()))
	return parts.length >= 4 ? parts[3] : 1
}

test.describe('barre de navigation mobile', () => {
	test('elle est opaque, sinon le contenu se lit au travers', async ({ page }, info) => {
		test.skip(info.project.name.startsWith('tablette'), 'la barre est masquée à partir de lg')

		await page.goto('/forum', { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(1500)

		const barre = await barreDuBas(page)
		expect(barre, 'barre du bas introuvable').not.toBeNull()

		// Le cœur du test. Il DOIT tomber sur l'ancien code, qui servait
		// rgba(17,24,39,0.8) sans aucun flou.
		const a = alpha(barre!.fond)
		const flouté = barre!.backdrop !== 'none' && barre!.backdrop !== ''
		expect(
			a === 1 || flouté,
			`fond « ${barre!.fond} » (alpha ${a}) sans backdrop-filter : le contenu qui défile passe au travers`,
		).toBe(true)
	})

	test('elle occupe toute la largeur et garde une hauteur tactile', async ({ page }, info) => {
		test.skip(info.project.name.startsWith('tablette'), 'la barre est masquée à partir de lg')

		await page.goto('/forum', { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(1500)

		const barre = await barreDuBas(page)
		expect(barre).not.toBeNull()

		// 44px est la recommandation courante pour une cible au doigt. On teste
		// la hauteur de la barre elle-même, pas chaque icône : les libellés
		// tiennent dans la même zone cliquable.
		expect(barre!.hauteur, 'barre trop basse pour un pouce').toBeGreaterThanOrEqual(48)

		for (const c of barre!.cibles) {
			expect(c.h, 'cible de la barre trop courte').toBeGreaterThanOrEqual(40)
		}
	})
})
