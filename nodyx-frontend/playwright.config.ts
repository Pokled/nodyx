import { defineConfig, devices } from '@playwright/test'

/**
 * Tests de rendu et de responsive.
 *
 * Pourquoi ils existent (2026-08-15)
 * ──────────────────────────────────
 * Vitest ne voit rien de ce qui se passe à l'écran. Une barre de navigation
 * devenue transparente, une page qui déborde à 360px ou une cible tactile de
 * 6px passent tous les contrôles existants : `npm run check`, les quatre portes
 * i18n et le build sont verts pendant que l'interface est cassée.
 *
 * On teste les DEUX moteurs qui divergent vraiment :
 *   - Chromium, pour Chrome, Edge, Opera, Brave, et le futur client Windows
 *   - WebKit, pour Safari, pour TOUS les navigateurs sur iPhone (Apple impose
 *     son moteur), et pour le futur client Linux (Tauri y utilise WebKitGTK)
 * Firefox est volontairement absent en v1 : Gecko diverge peu sur ces
 * propriétés, et chaque moteur coûte du temps de CI.
 *
 * Cible par défaut : l'instance publique. Surchargeable pour tester une autre
 * instance ou une préversion locale :
 *
 *     BASE_URL=http://127.0.0.1:4173 npm run test:responsive
 *
 * NON branché à la CI pour l'instant, à dessein. La règle maison interdit de
 * fusionner sans CI verte ; un test de bout en bout instable deviendrait une
 * taxe permanente sur chaque PR. On le branchera quand ces tests auront prouvé
 * leur stabilité sur plusieurs jours.
 */
export default defineConfig({
	testDir: './tests/responsive',
	// Un test de rendu qui dépend de l'ordre d'exécution ment.
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? 'github' : 'list',

	use: {
		baseURL: process.env.BASE_URL ?? 'https://nodyx.org',
		// Une capture ne sert qu'en cas d'échec, sinon elle encombre.
		screenshot: 'only-on-failure',
		trace: 'retain-on-failure',
		// Le SSR passe par l'API : sur une instance chargée, 15s est court.
		navigationTimeout: 45_000,
	},

	projects: [
		{ name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
		{ name: 'mobile-webkit',   use: { ...devices['iPhone 14'] } },
		{ name: 'tablette-webkit', use: { ...devices['iPad Mini'] } },
	],
})
