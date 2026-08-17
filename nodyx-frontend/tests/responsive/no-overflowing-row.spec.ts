import { test, expect } from '@playwright/test'
import { attendreMesurable } from './_attente'

/**
 * Rangées dont le contenu ne rentre pas.
 *
 * Troisième détecteur, et le plus fin des trois. Les deux autres regardent la
 * page (`no-overflow`) et les éléments géants (`no-clipping`, seuil à 1,5x).
 * Celui-ci attrape ce qui leur échappe : un conteneur de taille normale dont le
 * contenu déborde de quelques dizaines de pixels et se fait couper.
 *
 * Le cas qui l'a motivé, signalé le 2026-08-15 : dans l'en-tête d'un sujet, la
 * rangée « vues / réponses / dernier posteur » était en `flex` SANS `flex-wrap`.
 * Les trois encarts tenaient donc sur une ligne quoi qu'il arrive, et le
 * troisième était tranché au bord de l'écran. Trop petit pour le seuil de
 * `no-clipping`, invisible pour `no-overflow` puisqu'un ancêtre clippait.
 *
 * La mesure : `scrollWidth > clientWidth` sur un élément qui n'est pas censé
 * défiler. C'est la définition même de « du contenu est coupé ici ».
 */

const PAGES = [
	// Un sujet AVEC des reponses d'un autre membre : sans ca l'encart
	// « dernier posteur » ne s'affiche pas et le test ne prouve rien.
	['sujet',           '/forum/annonces/nodyx-v2-0-dm-chiffres-e2e-reactions-typing-sons-a1000001'],
	['forum catégorie', '/forum/annonces'],
	['profil',          '/users/Pokled'],
]

for (const [nom, chemin] of PAGES) {
	test(`${nom} : aucune rangée ne coupe son contenu`, async ({ page }) => {
		await page.goto(chemin, { waitUntil: 'domcontentloaded' })
		await attendreMesurable(page)

		const coupables = await page.evaluate(() => {
			const out: { perdu: number; boite: number; tag: string; cls: string; txt: string }[] = []

			for (const el of document.querySelectorAll('body *')) {
				if (el.namespaceURI === 'http://www.w3.org/2000/svg') continue

				const st = getComputedStyle(el)
				// Défilement horizontal assumé : ce n'est pas une coupure.
				if (st.overflowX === 'auto' || st.overflowX === 'scroll') continue
				// `truncate` coupe VOLONTAIREMENT, avec une ellipse pour le dire.
				if (st.textOverflow === 'ellipsis') continue
				// `overflow: hidden` est une DECISION explicite de l'auteur : « ce qui
				// depasse ici, je le rogne exprès ». Le detecteur n'a pas a la
				// contredire. Sans cette regle, l'en-tete de categorie remontait 80px
				// causes par ses deux halos decoratifs en `absolute -right-20`, larges
				// a dessein et rognes par la carte. Contrepartie assumee : on ne verra
				// pas un `overflow-hidden` pose a la va-vite pour MASQUER un vrai
				// debordement. Les deux autres detecteurs restent la pour ca.
				if (st.overflowX === 'hidden' || st.overflow === 'hidden') continue

				const perdu = el.scrollWidth - el.clientWidth
				// Tolérance de 32px, et non 4. En dessous, c'est presque toujours un
				// débord VOULU (`-mx-4` pour aller bord à bord donne 16px) ou un écart
				// de calcul entre moteurs : WebKit compte le débord par marge négative
				// dans `scrollWidth`, Chromium non, et le profil remontait donc 16px
				// sur l'un et rien sur l'autre.
				// Les vraies coupures sont d'un tout autre ordre : la rangée de
				// statistiques d'un sujet débordait de 182px. Un seuil qui separe
				// franchement les deux vaut mieux qu'un test rouge sur un seul moteur,
				// qu'on finirait par ignorer.
				if (perdu <= 32) continue
				if (el.clientWidth < 60) continue
				if (!(el.textContent || '').trim()) continue

				out.push({
					perdu,
					boite: el.clientWidth,
					tag: el.tagName.toLowerCase(),
					cls: (el.className?.toString?.() || '').slice(0, 65),
					txt: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
				})
			}

			// On ne garde que la coupure la plus profonde de chaque lignée : les
			// ancêtres répètent le même symptôme et noieraient le vrai coupable.
			out.sort((a, b) => b.perdu - a.perdu)
			const vus = new Set<string>()
			return out
				.filter((o) => {
					const cle = o.txt.slice(0, 25)
					if (vus.has(cle)) return false
					vus.add(cle)
					return true
				})
				.slice(0, 4)
		})

		expect(
			coupables,
			'rangées dont le contenu est coupé :\n' +
				coupables
					.map((c) => `  -${c.perdu}px (boîte ${c.boite}px) <${c.tag}> ${c.cls}\n     « ${c.txt} »`)
					.join('\n'),
		).toEqual([])
	})
}
