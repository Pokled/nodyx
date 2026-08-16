import { test, expect } from '@playwright/test'

/**
 * Débordement horizontal, le défaut responsive le plus courant.
 *
 * Au 2026-08-15 l'audit n'en trouvait AUCUN sur ces pages, aux quatre largeurs
 * testées. Ce fichier n'est donc pas un correctif, c'est un garde-fou : il
 * fige un acquis pour qu'une future grille, un tableau ou une image large ne le
 * reprenne pas en silence. Le symptôme côté utilisateur est une page qui
 * « glisse » latéralement et un texte coupé au bord de l'écran.
 */

const PAGES_PUBLIQUES = [
	['accueil',    '/'],
	['forum',      '/forum'],
	['découvrir',  '/discover'],
	['connexion',  '/auth/login'],
	['inscription', '/auth/register'],
]

for (const [nom, chemin] of PAGES_PUBLIQUES) {
	test(`${nom} ne déborde pas horizontalement`, async ({ page }) => {
		await page.goto(chemin, { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(1200)

		const mesure = await page.evaluate(() => {
			const de = document.documentElement
			const vw = window.innerWidth
			const fautifs: { tag: string; cls: string; depassement: number }[] = []

			if (de.scrollWidth > vw + 1) {
				for (const el of document.querySelectorAll('body *')) {
					const r = el.getBoundingClientRect()
					if (r.width === 0 || r.height === 0) continue
					// Un élément fixe plus étroit que l'écran ne déborde pas vraiment.
					if (getComputedStyle(el).position === 'fixed' && r.width <= vw + 2) continue
					if (r.right > vw + 1) {
						fautifs.push({
							tag: el.tagName.toLowerCase(),
							cls: (el.className?.toString?.() || '').slice(0, 80),
							depassement: Math.round(r.right - vw),
						})
					}
				}
				fautifs.sort((a, b) => b.depassement - a.depassement)
			}
			return { scrollWidth: de.scrollWidth, innerWidth: vw, fautifs: fautifs.slice(0, 3) }
		})

		// La tolérance d'un pixel absorbe les arrondis de mise à l'échelle.
		expect(
			mesure.scrollWidth,
			`déborde de ${mesure.scrollWidth - mesure.innerWidth}px. Coupables probables : ` +
				mesure.fautifs.map((f) => `<${f.tag}> ${f.cls} (+${f.depassement}px)`).join(' | '),
		).toBeLessThanOrEqual(mesure.innerWidth + 1)
	})
}
