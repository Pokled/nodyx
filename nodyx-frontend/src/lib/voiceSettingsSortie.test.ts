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
		const blocs = PANNEAU.split('{#if showVoiceSettings}').slice(1)
		const rendus = blocs.filter((b) => b.slice(0, b.indexOf('{/if}')).includes('<VoiceSettings'))
		expect(rendus.length, 'les deux sites de rendu doivent être présents').toBe(2)
		for (const [i, bloc] of rendus.entries()) {
			expect(bloc.slice(0, bloc.indexOf('{/if}')), `site de rendu ${i + 1} : aucune borne`)
				.toMatch(/max-h-\[calc\(100dvh/)
		}
	})

	it('sort les deux fenêtres de leur arbre avec un portal', () => {
		// LA vraie cause, mesurée chez l'utilisateur (500x996) après deux
		// correctifs qui visaient à côté.
		//
		// La fenêtre est `z-[200]` et elle était quand même RECOUVERTE par
		// l'en-tête de l'application (`NAV.sticky top-0 z-50`, 48px), qui mangeait
		// les 31 premiers pixels de la croix sur 44 :
		//
		//     y=4  -> NAV.sticky top-0 z-50 h-12   (l'en-tête)
		//     y=52 -> LA CROIX                     (enfin)
		//
		// La chaîne des ancêtres dit pourquoi :
		//
		//     panneau            z:200
		//     barre vocale       z:40
		//     DIV.fixed top-12   z:10   <- le plafond
		//
		// Chaque `z-index` sur un `fixed` crée un contexte d'empilement : le 200 ne
		// vaut que dans celui de la barre, qui ne vaut que dans celui à z:10. Face
		// au z-50 de l'en-tête, c'est 10 contre 50. Monter la barre de 40 à 60 était
		// INERTE, mesure à l'appui : le plafond était un cran plus haut.
		//
		// Seul le portal règle ça, en sortant la fenêtre à la racine.
		// On découpe sur le bloc, pas sur une distance en caractères : un simple
		// commentaire ajouté au-dessus suffisait à faire sortir `use:portal` d'une
		// fenêtre fixe, et le test tombait sur du code correct.
		const blocs = PANNEAU.split('{#if showVoiceSettings}').slice(1)
		const rendus = blocs.filter((b) => b.slice(0, b.indexOf('{/if}')).includes('<VoiceSettings'))
		expect(rendus.length, 'les deux sites de rendu doivent être présents').toBe(2)
		for (const [i, bloc] of rendus.entries()) {
			expect(bloc.slice(0, bloc.indexOf('{/if}')), `site de rendu ${i + 1} : pas de portal`)
				.toMatch(/use:portal/)
		}
	})

	it('donne à la croix une cible atteignable au pouce', () => {
		// 44px est le plancher recommandé sur mobile. On tolère plus petit à
		// partir de `sm`, où le pointeur est précis.
		expect(BOUTONS_FERMETURE[0]).toMatch(/w-11 h-11/)
	})
})
