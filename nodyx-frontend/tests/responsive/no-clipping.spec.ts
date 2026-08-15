import { test, expect } from '@playwright/test'

/**
 * Contenu ROGNÉ, à ne pas confondre avec le débordement de page.
 *
 * Pourquoi ce fichier existe (2026-08-15)
 * ───────────────────────────────────────
 * `no-overflow.spec.ts` vérifie que la PAGE ne glisse pas latéralement
 * (`scrollWidth > innerWidth`). Il était vert pendant que quatre écrans étaient
 * visiblement cassés, parce qu'un ancêtre en `overflow: hidden` absorbe le
 * débordement : la page ne glisse pas, elle COUPE. Deux défauts distincts, et
 * la suite n'en couvrait qu'un.
 *
 * Le cas qui a motivé ce test : sur le profil, le `<main>` mesurait 1358px dans
 * un conteneur de 374px. Cause, un `items-start` sur un conteneur `flex-col` :
 * l'axe transversal y est HORIZONTAL, et `items-start` demande aux enfants de
 * ne pas s'étirer, donc de prendre la largeur de leur contenu. Ni `min-w-0` ni
 * `flex-1` n'y changent quoi que ce soit.
 */

const PAGES = [
	['profil',           '/users/Pokled'],
	['forum catégorie',  '/forum/annonces'],
	['accueil',          '/'],
]

for (const [nom, chemin] of PAGES) {
	test(`${nom} : aucun élément plus large que l'écran`, async ({ page }, info) => {
		await page.goto(chemin, { waitUntil: 'domcontentloaded' })
		await page.waitForTimeout(1800)

		const coupables = await page.evaluate(() => {
			const vw = window.innerWidth
			const out: { w: number; tag: string; cls: string; txt: string }[] = []

			for (const el of document.querySelectorAll('body *')) {
				const w = el.getBoundingClientRect().width
				if (w <= vw + 8) continue

				// On ne veut QUE l'élément fautif, pas sa lignée : si un enfant est
				// aussi large, c'est lui la cause et le parent ne fait que la subir.
				const enfantAussiLarge = [...el.children].some(
					(c) => c.getBoundingClientRect().width > w - 4,
				)
				if (enfantAussiLarge) continue

				// Un élément volontairement défilable horizontalement est légitime :
				// tableau large, bande de code, carrousel.
				const st = getComputedStyle(el)
				if (st.overflowX === 'auto' || st.overflowX === 'scroll') continue

				// Une DÉCORATION sortie du flux et sans le moindre texte est large
				// à dessein : halo, dégradé, bulle lumineuse. Son rognage par le
				// parent est l'effet recherché, pas un défaut. Sans cette
				// exception, l'accueil remonte `twitch-shine` (869px) et
				// `hb-orb--tl` (500px), qui ne sont pas des bugs.
				const horsFlux = st.position === 'absolute' || st.position === 'fixed'
				if (horsFlux && !(el.textContent || '').trim()) continue

				out.push({
					w: Math.round(w),
					tag: el.tagName.toLowerCase(),
					cls: (el.className?.toString?.() || '').slice(0, 70),
					txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
				})
			}
			return out.sort((a, b) => b.w - a.w).slice(0, 4)
		})

		const largeur = info.project.use.viewport?.width ?? 0
		expect(
			coupables,
			`éléments plus larges que l'écran (${largeur}px) :\n` +
				coupables.map((c) => `  ${c.w}px  <${c.tag}> ${c.cls}\n     « ${c.txt} »`).join('\n'),
		).toEqual([])
	})
}
