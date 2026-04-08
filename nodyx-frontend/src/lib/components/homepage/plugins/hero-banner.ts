import type { WidgetPlugin } from './_types'
import HeroBanner from '../widgets/HeroBanner.svelte'

const plugin: WidgetPlugin = {
	id:        'hero-banner',
	label:     'Hero Banner',
	icon:      '🌟',
	desc:      'Grande section d\'accueil avec image, titre, CTA et variantes automatiques.',
	family:    'media',
	phase:     1,
	component: HeroBanner,
	schema: [
		{
			key: 'subtitle', type: 'text', label: 'Sous-titre',
			placeholder: 'La communauté gaming la plus soudée du web',
			hint: 'Si vide, utilise la description de l\'instance.',
		},
		{
			key: 'cta_text', type: 'text', label: 'Texte du bouton',
			placeholder: 'Rejoindre la communauté',
		},
		{
			key: 'cta_url', type: 'url', label: 'Lien du bouton',
			placeholder: '/auth/register',
		},
		{
			key: 'background_image_url', type: 'image', label: 'Image de fond (URL)',
			placeholder: 'https://...',
			hint: 'Si vide, utilise le banner de l\'instance.',
		},
		{
			key: 'overlay_opacity', type: 'number', label: 'Opacité du fond (0 à 1)',
			default: 0.5, min: 0, max: 1,
			hint: '0 = transparent, 1 = image pleine',
		},
		{
			key: 'style', type: 'select', label: 'Alignement du texte',
			default: 'centered',
			options: [
				{ value: 'centered', label: 'Centré' },
				{ value: 'left',     label: 'À gauche' },
				{ value: 'split',    label: 'Divisé (texte gauche / image droite)' },
			],
		},
		{
			key: 'enable_variants', type: 'boolean',
			label: 'Variantes automatiques (live / événement / nuit)',
			default: true,
			hint: 'Change l\'apparence selon le contexte : stream en live, événement proche, heure de nuit.',
		},
		{
			key: 'night_image_url', type: 'image', label: 'Image de nuit (22h–6h)',
			placeholder: 'https://...',
			hint: 'Image alternative affichée la nuit (optionnel).',
		},
	],
}

export default plugin
