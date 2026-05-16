// Bibliothèque d'icônes curée pour la personnalisation des canaux.
// Deux familles : "sobre" (Lucide outline, monochrome) et "colore" (Twemoji SVG
// bundle, multicolore, drapeaux inclus). Bundlées localement, zéro CDN.

import { addCollection } from '@iconify/svelte'
import twemojiBundle from './icons/twemoji-bundled.json'

let _registered = false
export function registerChannelIconCollections() {
	if (_registered) return
	addCollection(twemojiBundle as any)
	_registered = true
}

export interface IconEntry {
	id:    string  // identifiant complet, ex: 'lucide:hash', 'twemoji:flag-france'
	label: string  // nom humain pour tooltip
}

export interface IconCategory {
	name:  string
	icons: IconEntry[]
}

// ─── SOBRE (Lucide outline, monochrome) ─────────────────────────────────────

export const SOBRE_CATEGORIES: IconCategory[] = [
	{
		name: 'Communications',
		icons: [
			{ id: 'lucide:hash',           label: 'Hashtag' },
			{ id: 'lucide:message-square', label: 'Message' },
			{ id: 'lucide:message-circle', label: 'Bulle' },
			{ id: 'lucide:megaphone',      label: 'Mégaphone' },
			{ id: 'lucide:bell',           label: 'Cloche' },
			{ id: 'lucide:mail',           label: 'Courrier' },
			{ id: 'lucide:rss',            label: 'Flux' },
			{ id: 'lucide:at-sign',        label: 'Mention' },
		],
	},
	{
		name: 'Voix & son',
		icons: [
			{ id: 'lucide:volume-2',       label: 'Volume' },
			{ id: 'lucide:mic',            label: 'Micro' },
			{ id: 'lucide:headphones',     label: 'Casque' },
			{ id: 'lucide:music',          label: 'Musique' },
			{ id: 'lucide:radio',          label: 'Radio' },
			{ id: 'lucide:speaker',        label: 'Haut-parleur' },
		],
	},
	{
		name: 'Activités',
		icons: [
			{ id: 'lucide:gamepad-2',      label: 'Manette' },
			{ id: 'lucide:dice-5',         label: 'Dé' },
			{ id: 'lucide:trophy',         label: 'Trophée' },
			{ id: 'lucide:target',         label: 'Cible' },
			{ id: 'lucide:camera',         label: 'Photo' },
			{ id: 'lucide:film',           label: 'Cinéma' },
			{ id: 'lucide:image',          label: 'Image' },
			{ id: 'lucide:palette',        label: 'Palette' },
		],
	},
	{
		name: 'Tech',
		icons: [
			{ id: 'lucide:code',           label: 'Code' },
			{ id: 'lucide:terminal',       label: 'Terminal' },
			{ id: 'lucide:cpu',            label: 'Processeur' },
			{ id: 'lucide:server',         label: 'Serveur' },
			{ id: 'lucide:database',       label: 'Base de données' },
			{ id: 'lucide:git-branch',     label: 'Branche Git' },
			{ id: 'lucide:wrench',         label: 'Clé' },
			{ id: 'lucide:bug',            label: 'Bug' },
		],
	},
	{
		name: 'Communauté',
		icons: [
			{ id: 'lucide:users',          label: 'Membres' },
			{ id: 'lucide:user-plus',      label: 'Inviter' },
			{ id: 'lucide:shield',         label: 'Bouclier' },
			{ id: 'lucide:lock',           label: 'Verrou' },
			{ id: 'lucide:globe',          label: 'Globe' },
			{ id: 'lucide:link',           label: 'Lien' },
			{ id: 'lucide:bookmark',       label: 'Signet' },
			{ id: 'lucide:tag',            label: 'Étiquette' },
		],
	},
	{
		name: 'Symboles',
		icons: [
			{ id: 'lucide:star',           label: 'Étoile' },
			{ id: 'lucide:heart',          label: 'Cœur' },
			{ id: 'lucide:flame',          label: 'Flamme' },
			{ id: 'lucide:zap',            label: 'Éclair' },
			{ id: 'lucide:sparkles',       label: 'Étincelles' },
			{ id: 'lucide:flag',           label: 'Drapeau' },
			{ id: 'lucide:pin',            label: 'Épingle' },
			{ id: 'lucide:rocket',         label: 'Fusée' },
		],
	},
]

// ─── COLORÉ (Twemoji bundled) ────────────────────────────────────────────────

export const COLORE_CATEGORIES: IconCategory[] = [
	{
		name: 'Communications',
		icons: [
			{ id: 'twemoji:speech-balloon',   label: 'Bulle' },
			{ id: 'twemoji:megaphone',        label: 'Mégaphone' },
			{ id: 'twemoji:sparkles',         label: 'Étincelles' },
			{ id: 'twemoji:fire',             label: 'Feu' },
			{ id: 'twemoji:party-popper',     label: 'Fête' },
			{ id: 'twemoji:balloon',          label: 'Ballon' },
			{ id: 'twemoji:red-heart',        label: 'Cœur' },
			{ id: 'twemoji:glowing-star',     label: 'Étoile' },
		],
	},
	{
		name: 'Voix & son',
		icons: [
			{ id: 'twemoji:microphone',       label: 'Micro' },
			{ id: 'twemoji:headphone',        label: 'Casque' },
			{ id: 'twemoji:musical-note',     label: 'Note' },
		],
	},
	{
		name: 'Activités',
		icons: [
			{ id: 'twemoji:video-game',       label: 'Manette' },
			{ id: 'twemoji:joystick',         label: 'Joystick' },
			{ id: 'twemoji:trophy',           label: 'Trophée' },
			{ id: 'twemoji:direct-hit',       label: 'Cible' },
			{ id: 'twemoji:framed-picture',   label: 'Cadre' },
			{ id: 'twemoji:clapper-board',    label: 'Cinéma' },
			{ id: 'twemoji:popcorn',          label: 'Pop-corn' },
			{ id: 'twemoji:artist-palette',   label: 'Palette' },
			{ id: 'twemoji:paintbrush',       label: 'Pinceau' },
			{ id: 'twemoji:books',            label: 'Livres' },
			{ id: 'twemoji:calendar',         label: 'Calendrier' },
			{ id: 'twemoji:telescope',        label: 'Télescope' },
		],
	},
	{
		name: 'Tech',
		icons: [
			{ id: 'twemoji:robot',            label: 'Robot' },
			{ id: 'twemoji:gear',             label: 'Engrenage' },
			{ id: 'twemoji:hammer-and-wrench', label: 'Outils' },
			{ id: 'twemoji:high-voltage',     label: 'Éclair' },
			{ id: 'twemoji:light-bulb',       label: 'Ampoule' },
			{ id: 'twemoji:magnifying-glass-tilted-left', label: 'Loupe' },
			{ id: 'twemoji:briefcase',        label: 'Mallette' },
		],
	},
	{
		name: 'Symboles',
		icons: [
			{ id: 'twemoji:rocket',           label: 'Fusée' },
			{ id: 'twemoji:gem-stone',        label: 'Pierre' },
			{ id: 'twemoji:crown',            label: 'Couronne' },
			{ id: 'twemoji:alien',            label: 'Alien' },
			{ id: 'twemoji:ghost',            label: 'Fantôme' },
			{ id: 'twemoji:jack-o-lantern',   label: 'Citrouille' },
			{ id: 'twemoji:sun',              label: 'Soleil' },
			{ id: 'twemoji:crescent-moon',    label: 'Lune' },
			{ id: 'twemoji:cherry-blossom',   label: 'Cerisier' },
			{ id: 'twemoji:four-leaf-clover', label: 'Trèfle' },
			{ id: 'twemoji:droplet',          label: 'Goutte' },
		],
	},
	{
		name: 'Boisson & nourriture',
		icons: [
			{ id: 'twemoji:beer-mug',         label: 'Bière' },
			{ id: 'twemoji:wine-glass',       label: 'Vin' },
			{ id: 'twemoji:pizza',            label: 'Pizza' },
			{ id: 'twemoji:hamburger',        label: 'Burger' },
			{ id: 'twemoji:birthday-cake',    label: 'Gâteau' },
			{ id: 'twemoji:cheese-wedge',     label: 'Fromage' },
		],
	},
	{
		name: 'Mascottes',
		icons: [
			{ id: 'twemoji:dog-face',         label: 'Chien' },
			{ id: 'twemoji:cat-face',         label: 'Chat' },
			{ id: 'twemoji:fox',              label: 'Renard' },
			{ id: 'twemoji:butterfly',        label: 'Papillon' },
		],
	},
	{
		name: 'Drapeaux Europe',
		icons: [
			{ id: 'twemoji:flag-france',         label: 'France' },
			{ id: 'twemoji:flag-germany',        label: 'Allemagne' },
			{ id: 'twemoji:flag-italy',          label: 'Italie' },
			{ id: 'twemoji:flag-spain',          label: 'Espagne' },
			{ id: 'twemoji:flag-portugal',       label: 'Portugal' },
			{ id: 'twemoji:flag-belgium',        label: 'Belgique' },
			{ id: 'twemoji:flag-netherlands',    label: 'Pays-Bas' },
			{ id: 'twemoji:flag-luxembourg',     label: 'Luxembourg' },
			{ id: 'twemoji:flag-switzerland',    label: 'Suisse' },
			{ id: 'twemoji:flag-austria',        label: 'Autriche' },
			{ id: 'twemoji:flag-poland',         label: 'Pologne' },
			{ id: 'twemoji:flag-czechia',        label: 'Tchéquie' },
			{ id: 'twemoji:flag-hungary',        label: 'Hongrie' },
			{ id: 'twemoji:flag-romania',        label: 'Roumanie' },
			{ id: 'twemoji:flag-bulgaria',       label: 'Bulgarie' },
			{ id: 'twemoji:flag-greece',         label: 'Grèce' },
			{ id: 'twemoji:flag-croatia',        label: 'Croatie' },
			{ id: 'twemoji:flag-slovenia',       label: 'Slovénie' },
			{ id: 'twemoji:flag-slovakia',       label: 'Slovaquie' },
			{ id: 'twemoji:flag-denmark',        label: 'Danemark' },
			{ id: 'twemoji:flag-sweden',         label: 'Suède' },
			{ id: 'twemoji:flag-finland',        label: 'Finlande' },
			{ id: 'twemoji:flag-norway',         label: 'Norvège' },
			{ id: 'twemoji:flag-iceland',        label: 'Islande' },
			{ id: 'twemoji:flag-ireland',        label: 'Irlande' },
			{ id: 'twemoji:flag-united-kingdom', label: 'Royaume-Uni' },
			{ id: 'twemoji:flag-european-union', label: 'Union européenne' },
		],
	},
	{
		name: 'Drapeaux monde',
		icons: [
			{ id: 'twemoji:flag-united-states', label: 'États-Unis' },
			{ id: 'twemoji:flag-canada',        label: 'Canada' },
			{ id: 'twemoji:flag-mexico',        label: 'Mexique' },
			{ id: 'twemoji:flag-brazil',        label: 'Brésil' },
			{ id: 'twemoji:flag-japan',         label: 'Japon' },
			{ id: 'twemoji:flag-south-korea',   label: 'Corée du Sud' },
			{ id: 'twemoji:flag-china',         label: 'Chine' },
			{ id: 'twemoji:flag-india',         label: 'Inde' },
			{ id: 'twemoji:flag-russia',        label: 'Russie' },
			{ id: 'twemoji:flag-ukraine',       label: 'Ukraine' },
			{ id: 'twemoji:flag-turkey',        label: 'Turquie' },
			{ id: 'twemoji:flag-morocco',       label: 'Maroc' },
			{ id: 'twemoji:flag-australia',     label: 'Australie' },
		],
	},
]

export function isIconId(value: string | null | undefined): boolean {
	if (!value) return false
	return /^(lucide|twemoji):[a-z0-9-]+$/.test(value)
}
