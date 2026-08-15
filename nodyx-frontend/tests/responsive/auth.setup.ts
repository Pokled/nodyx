import { test as setup, expect } from '@playwright/test'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/**
 * Ouvre une session une seule fois et la range dans un fichier, que les tests
 * authentifiés réutilisent. Évite de se reconnecter à chaque test.
 *
 * Pourquoi ce fichier existe (2026-08-15)
 * ───────────────────────────────────────
 * Toute la partie du produit derrière une connexion échappait aux tests : chat,
 * messages privés, sidebar des salons. C'est précisément là que les défauts ont
 * survécu le plus longtemps. Deux exemples de la même journée :
 *
 *   - la zone de saisie des messages privés passait SOUS la barre de navigation
 *     mobile, parce que la page ne réservait pas `--bottom-nav-h`. Le chat le
 *     faisait, elle non. Trouvé par capture d'écran, pas par un test.
 *   - le menu burger n'ouvrait plus rien après un déploiement, à cause d'un
 *     service worker prenant la main sans recharger.
 *
 * IDENTIFIANTS : jamais dans le dépôt. Ils viennent de l'environnement, et le
 * fichier de session est dans `.gitignore`. Sans eux, les tests authentifiés se
 * sautent proprement au lieu d'échouer.
 *
 *     NODYX_TEST_EMAIL=... NODYX_TEST_PASSWORD=... npm run test:responsive
 */
export const FICHIER_SESSION = 'playwright/.auth/session.json'

/** Au-delà, on considère la session périmée et on se reconnecte. */
const DUREE_SESSION_MS = 6 * 60 * 60 * 1000

setup('ouvrir une session', async ({ page }) => {
	const email = process.env.NODYX_TEST_EMAIL
	const motDePasse = process.env.NODYX_TEST_PASSWORD
	setup.skip(!email || !motDePasse, 'NODYX_TEST_EMAIL / NODYX_TEST_PASSWORD absents')

	// On REUTILISE une session encore fraîche au lieu de se reconnecter.
	// Ce n'est pas une optimisation : se reconnecter à chaque exécution déclenche
	// l'anti-force-brute du serveur (« Trop de tentatives de connexion, réessayez
	// dans 15 minutes »), et la suite entière devient inutilisable. Constaté le
	// 2026-08-15 en montant ces tests, ce qui prouve au passage que la protection
	// fonctionne.
	if (existsSync(FICHIER_SESSION)) {
		const age = Date.now() - statSync(FICHIER_SESSION).mtimeMs
		if (age < DUREE_SESSION_MS) {
			setup.skip(true, `session réutilisée (${Math.round(age / 60000)} min)`)
			return
		}
	}

	await page.goto('/auth/login', { waitUntil: 'domcontentloaded' })

	await page.locator('input[type="email"]').fill(email!)
	await page.locator('input[type="password"]').fill(motDePasse!)
	await page.locator('button[type="submit"]').first().click()

	// La connexion est reussie quand on a quitte la page de connexion.
	await page.waitForURL((u) => !u.pathname.startsWith('/auth/login'), { timeout: 30_000 })

	// Garde-fou : une redirection ne prouve pas une session. On verifie que la
	// barre de navigation affiche bien les entrees reservees aux connectes.
	await expect(page.locator('nav a[href="/dm"]').first()).toBeVisible({ timeout: 15_000 })

	if (!existsSync(dirname(FICHIER_SESSION))) mkdirSync(dirname(FICHIER_SESSION), { recursive: true })
	await page.context().storageState({ path: FICHIER_SESSION })
})
