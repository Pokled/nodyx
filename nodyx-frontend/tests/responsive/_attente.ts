import type { Page } from '@playwright/test'

/**
 * Attend que la page soit MESURABLE, au lieu d'un délai fixe.
 *
 * Deux problèmes distincts à absorber, tous deux constatés le 2026-08-16.
 *
 * 1. LES POLICES. Tant qu'elles ne sont pas chargées, les textes sont rendus
 *    avec une police de repli dont les largeurs diffèrent. Or ces tests mesurent
 *    précisément des largeurs. Un délai fixe suffisait à vide mais pas sous
 *    charge : le test du profil tombait dans la suite complète alors qu'il
 *    passait isolé.
 *
 * 2. LA PAGE QUI SE RECHARGE SOUS NOS PIEDS. Le service worker recharge la page
 *    dès qu'une nouvelle version prend le contrôle, ce qui arrive précisément au
 *    premier chargement après un déploiement, c'est-à-dire au pire moment pour
 *    une suite de tests. Un `page.evaluate` en cours meurt alors avec
 *    « Execution context was destroyed ». Ma première version de cette aide ne
 *    le gérait pas et a fait passer la suite de 1 à 11 échecs.
 *
 * D'où : on attend l'état `load`, on tolère une destruction de contexte, et on
 * réessaie une fois la navigation retombée.
 */
export async function attendreMesurable(page: Page): Promise<void> {
	for (let essai = 0; essai < 3; essai++) {
		try {
			await page.waitForLoadState('load', { timeout: 20_000 })
			await page.evaluate(() => document.fonts?.ready ?? Promise.resolve())
			// Deux images successives sans changement de mise en page.
			await page.evaluate(
				() =>
					new Promise<void>((ok) =>
						requestAnimationFrame(() => requestAnimationFrame(() => ok())),
					),
			)
			return
		} catch (e) {
			// Contexte detruit par une navigation ou un rechargement du service
			// worker : on laisse la page se reposer et on recommence.
			const msg = String(e)
			const navigation =
				msg.includes('Execution context was destroyed') ||
				msg.includes('navigating and changing the content')
			if (!navigation || essai === 2) throw e
			await page.waitForTimeout(1200)
		}
	}
}
