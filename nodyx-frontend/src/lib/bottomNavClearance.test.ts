import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Toute page avec une zone de saisie en bas doit réserver la barre de navigation.
 *
 * Pourquoi (2026-08-15)
 * ────────────────────
 * La barre de navigation mobile est `fixed bottom-0`. Une zone de saisie collée
 * en bas de page passe donc PAR DESSOUS et devient inatteignable : on écrit
 * sous le menu. La variable `--bottom-nav-h` existe pour ça, elle vaut 56px plus
 * la zone sûre du téléphone, et 0 à partir de `lg` où la barre disparaît.
 *
 * `chat/+page.svelte` l'utilisait depuis toujours. `dm/[id]/+page.svelte` ne l'a
 * JAMAIS fait, et personne ne l'avait vu : c'est exactement le genre de défaut
 * qu'un test de rendu ne peut pas attraper, ces deux pages exigeant une session.
 *
 * Ce contrôle lit la SOURCE : si un fichier a une zone basse (`border-t` sur un
 * conteneur `shrink-0`, ou un `sticky/fixed bottom`), il doit mentionner
 * `--bottom-nav-h` quelque part.
 */

const ROUTES = new URL('../routes', import.meta.url).pathname
const COMPOSANTS = new URL('./components', import.meta.url).pathname
const EXCEPTIONS = [
	'/overlay/',
	'/admin/',
	// `Table.svelte` a exactement la meme forme que `StageChat` : racine en
	// `h-full flex flex-col`, saisie, rangees `shrink-0`. Aucune heuristique
	// ne peut les distinguer, la difference est SEMANTIQUE : Table est une
	// carte posee dans le flux (jukebox du Canvas), jamais collee au bas de
	// l'ecran. Exception assumee plutot qu'un motif tordu qui finirait par
	// laisser passer un vrai cas.
	'components/Table.svelte',
]

function pages(dossier: string, acc: string[] = []): string[] {
	for (const e of readdirSync(dossier)) {
		const chemin = join(dossier, e)
		if (statSync(chemin).isDirectory()) pages(chemin, acc)
		// Les COMPOSANTS comptent autant que les pages : `StageChat.svelte` porte
		// la saisie du chat d'un salon vocal, il n'a jamais reserve la barre, et
		// ce test ne regardait que les `+page.svelte`. Le champ etait donc
		// entierement cache derriere la barre, sans que rien ne le signale
		// (defaut du 17/08).
		else if (e === '+page.svelte' || e.endsWith('.svelte')) acc.push(chemin)
	}
	return acc
}

describe('dégagement de la barre de navigation mobile', () => {
	it('une page avec une zone de saisie en bas réserve --bottom-nav-h', () => {
		const fautifs: string[] = []

		for (const fichier of [...pages(ROUTES), ...pages(COMPOSANTS)]) {
			if (EXCEPTIONS.some((e) => fichier.includes(e))) continue
			const src = readFileSync(fichier, 'utf8')

			// Une zone de saisie : un champ, ET un conteneur bas identifiable.
			const aUnChamp = /placeholder=|<textarea/.test(src)
			// `border-top` peut vivre dans la CLASSE (`border-t`) ou dans l'attribut
			// STYLE. StageChat utilise la seconde forme, et mon premier motif ne
			// regardait que la premiere : le composant est passe au travers alors
			// que sa saisie etait entierement cachee derriere la barre.
			const aUneZoneBasse =
				/shrink-0[^"]*border-t|sticky bottom-0|fixed bottom-0/.test(src) ||
				/shrink-0[\s\S]{0,120}border-top\s*:/.test(src)
			// Et le composant doit reellement etre ANCRE en bas : pleine hauteur en
			// colonne, ou positionne en bas. Sans cette condition, `Table.svelte`
			// remontait a tort : il a une saisie et des rangees `shrink-0`, mais
			// c'est une carte posee dans le flux, jamais collee au bas de l'ecran.
			const estAncreEnBas =
				/h-full[\s\S]{0,20}flex-col|flex[\s\S]{0,10}h-full[\s\S]{0,20}flex-col/.test(src) ||
				/fixed bottom-0|sticky bottom-0/.test(src)
			if (!aUnChamp || !aUneZoneBasse || !estAncreEnBas) continue

			// Un composant qui expose une propriete de degagement delegue le choix
			// a son appelant : c'est une reponse valable, la Scene n'en veut pas.
			if (!src.includes('bottom-nav-h') && !/reserverBarreBasse/.test(src)) {
				fautifs.push(fichier.replace(ROUTES, 'routes'))
			}
		}

		expect(
			fautifs,
			'ces pages ont une zone de saisie en bas sans réserver la barre de navigation ; ' +
				'sur mobile on y écrit SOUS le menu. Ajouter ' +
				'`style="padding-bottom: max(1rem, var(--bottom-nav-h))"` sur le conteneur bas.\n' +
				fautifs.join('\n'),
		).toEqual([])
	})
})
