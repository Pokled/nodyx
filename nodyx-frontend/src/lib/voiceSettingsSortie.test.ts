import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * La sortie des paramètres audio doit rester atteignable, même après défilement.
 *
 * Pourquoi (2026-08-17)
 * ────────────────────
 * Ce défaut a été signalé TROIS fois d'affilée, sous trois formes différentes,
 * et les deux premiers correctifs étaient incomplets :
 *
 *  1. « on ne peut plus sortir des paramètres audio » : il n'y avait aucune
 *     croix. Ajoutée.
 *  2. « j'ai la croix 2 fois » : trois affordances de fermeture s'étaient
 *     empilées au fil des passes. Deux supprimées.
 *  3. « la croix est coupée » : le panneau avait simplement été FAIT DÉFILER, et
 *     l'en-tête était parti vers le haut avec le contenu. Il ne restait que
 *     l'arc inférieur du cercle.
 *
 * Le troisième est le plus vicieux : la croix EXISTE, elle est unique, elle est
 * assez grande, elle passe toute revue de code, et l'utilisateur ne peut quand
 * même pas sortir dès qu'il touche à un réglage un peu bas dans la liste.
 *
 * Ce contrôle lit la SOURCE, parce qu'aucun test de rendu ne verrait ces trois
 * défauts : le panneau exige une session, un salon vocal et un micro.
 *
 * Il tombe sur chacune des trois versions fautives : zéro croix (1), plus d'une
 * croix (2), croix non collée en haut (3).
 */

const SOURCE = readFileSync(
	new URL('./components/VoiceSettings.svelte', import.meta.url).pathname,
	'utf-8',
)
const PANNEAU = readFileSync(
	new URL('./components/VoicePanel.svelte', import.meta.url).pathname,
	'utf-8',
)

/** Un bouton dont le libellé d'accessibilité parle de fermeture. */
const BOUTONS_FERMETURE = SOURCE.match(/<button[^>]*aria-label=\{?[^>]*close[^>]*>/gi) ?? []

describe('sortie des paramètres audio', () => {
	it('offre exactement une croix de fermeture', () => {
		// Zéro : on reste piégé dans le panneau (défaut d'origine).
		// Deux ou plus : l'utilisateur ne sait plus laquelle est la bonne.
		expect(BOUTONS_FERMETURE).toHaveLength(1)
	})

	it('rend cette croix conditionnelle au rappel de fermeture', () => {
		// Sans `onclose`, le bouton ne ferait rien : mieux vaut ne pas l'afficher
		// que d'afficher une sortie morte.
		expect(SOURCE).toMatch(/\{#if onclose\}/)
		expect(SOURCE).toMatch(/onclick=\{onclose\}/)
	})

	it("garde l'en-tête collé en haut de la zone qui défile", () => {
		// LE défaut du 17/08. Le conteneur parent est `overflow-y-auto` : sans
		// `sticky top-0`, l'en-tête défile avec les réglages et la seule sortie
		// disparaît par le haut.
		const enTete = SOURCE.match(/<div class="([^"]*sticky[^"]*)"[\s\S]{0,400}?\{#if onclose\}/)
		expect(enTete, "l'en-tête portant la croix n'est pas collé en haut").not.toBeNull()
		expect(enTete![1]).toMatch(/\bsticky\b/)
		expect(enTete![1]).toMatch(/\btop-0\b/)
		// Fond opaque, sinon les réglages se voient passer sous l'en-tête.
		expect(enTete![1]).toMatch(/\bbg-/)
	})

	it("borne la fenêtre à la hauteur de l'écran", () => {
		// LE vrai défaut du 17/08, celui que le collage seul ne corrigeait pas.
		//
		// Mesuré sur la prod : la fenêtre ancrée en bas faisait 619px de haut sur
		// un écran de 600px. Ancrée par `bottom-24`, son sommet tombait à -115px,
		// et `overflow-hidden` interdisait tout défilement. L'excédent n'était pas
		// atteignable, il était AMPUTÉ, avec l'en-tête et la croix dedans.
		//
		// Un en-tête `sticky` ne sert à rien sans zone défilante : c'est pourquoi
		// ce contrôle vit à côté de celui du collage, pas à sa place.
		const conteneurs = PANNEAU.split('<VoiceSettings').slice(0, -1)
		expect(conteneurs.length, 'les deux sites de rendu doivent être présents').toBe(2)
		for (const [i, amont] of conteneurs.entries()) {
			// On regarde le conteneur immédiat, pas toute la page.
			const proche = amont.slice(-700)
			expect(proche, `site de rendu ${i + 1} : aucune borne sur la hauteur`).toMatch(
				/max-h-\[calc\(100dvh/,
			)
		}
	})

	it("fait passer la barre flottante au-dessus de l'en-tête pendant l'ouverture", () => {
		// LA vraie cause, mesurée dans le navigateur de l'utilisateur (500x996).
		//
		// Le panneau des réglages est `fixed inset-0 z-[200]`, mais il descend de la
		// barre vocale flottante, qui portait un `z-40` fixe. Un `z-index` sur un
		// élément `fixed` crée un contexte d'empilement : le 200 du panneau ne vaut
		// QUE dans ce contexte. À l'étage du dessus la comparaison est 40 contre le
		// `z-50` de l'en-tête de l'application, et l'en-tête gagne. Ses 48px
		// recouvraient les 31 premiers pixels de la croix, sur 44 :
		//
		//     y=4  -> NAV.sticky top-0 z-50 h-12   (l'en-tête, pas le panneau)
		//     y=52 -> LA CROIX                     (enfin, sous les 48px)
		//
		// Le panneau n'était ni coupé ni rogné : il était RECOUVERT. C'est pourquoi
		// ni le collage en haut ni le bornage à l'écran n'y pouvaient rien.
		const barre = PANNEAU.match(/<div class='fixed left-0[^']*'/)
		expect(barre, 'barre vocale flottante introuvable').not.toBeNull()
		expect(barre![0], "le `z` de la barre doit dépendre de l'ouverture des réglages").toMatch(
			/showVoiceSettings \?/,
		)
		// Doit dépasser le `z-50` de l'en-tête, sinon le correctif ne corrige rien.
		const ouvert = barre![0].match(/showVoiceSettings \? "z-\[(\d+)\]"/)
		expect(ouvert, 'valeur du `z` en position ouverte illisible').not.toBeNull()
		expect(Number(ouvert![1])).toBeGreaterThan(50)
	})

	it('donne à la croix une cible atteignable au pouce', () => {
		// 44px est le plancher recommandé sur mobile. On tolère plus petit à
		// partir de `sm`, où le pointeur est précis.
		expect(BOUTONS_FERMETURE[0]).toMatch(/w-11 h-11/)
	})
})
