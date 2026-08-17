import { test, expect } from '@playwright/test'
import { attendreMesurable } from './_attente'

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
		await attendreMesurable(page)

		const coupables = await page.evaluate(() => {
			const vw = window.innerWidth
			const out: { w: number; tag: string; cls: string; txt: string }[] = []

			// Un élément est-il posé dans un conteneur qui défile horizontalement ?
			// Alors sa largeur est voulue : frise d'activité, tableau, carrousel.
			const dansUnDefilement = (el: Element) => {
				let p = el.parentElement
				while (p && p !== document.body) {
					const o = getComputedStyle(p).overflowX
					if (o === 'auto' || o === 'scroll') return true
					p = p.parentElement
				}
				return false
			}

			for (const el of document.querySelectorAll('body *')) {
				const w = el.getBoundingClientRect().width
				// Seuil a 1,5x l'ecran, et non « plus large que l'ecran ».
				// Plusieurs conteneurs debordent VOLONTAIREMENT de quelques dizaines
				// de pixels : le profil utilise `-mx-4` pour aller bord a bord, ce qui
				// donne 422px dans un ecran de 390 sans rien couper. Les catastrophes
				// reelles sont d'un tout autre ordre : le <main> du profil mesurait
				// 1358px pour 374, soit 3,5x. Un seuil grossier qui attrape ce qui
				// casse vaut mieux qu'un test precis qu'on desactive au bout d'une
				// semaine parce qu'il est rouge en permanence.
				if (w <= vw * 1.5) continue

				// `<rect>`, `<path>`, `<circle>` : des primitives de DESSIN, pas de
				// la mise en page. Le profil en remontait dix, toutes fausses.
				if (el.namespaceURI === 'http://www.w3.org/2000/svg') continue

				// Sans texte, rien n'est illisible : bannière pleine largeur, halo,
				// grille de cellules colorées. On traque du contenu coupé, pas des
				// pixels qui dépassent.
				if (!(el.textContent || '').trim()) continue

				if (dansUnDefilement(el)) continue

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
