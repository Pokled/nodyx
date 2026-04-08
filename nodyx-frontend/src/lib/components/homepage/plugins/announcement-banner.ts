import type { WidgetPlugin } from './_types'
import AnnouncementBanner from '../widgets/AnnouncementBanner.svelte'

const plugin: WidgetPlugin = {
	id:        'announcement-banner',
	label:     'Bandeau annonce',
	icon:      '📢',
	desc:      'Bandeau coloré avec message, lien et bouton de fermeture.',
	family:    'content',
	phase:     1,
	component: AnnouncementBanner,
	schema: [
		{
			key: 'text', type: 'text', label: 'Message',
			placeholder: 'Bienvenue sur notre communauté !',
			required: true,
		},
		{
			key: 'color', type: 'color', label: 'Couleur',
			default: '#7c3aed',
		},
		{
			key: 'link_url', type: 'url', label: 'Lien (optionnel)',
			placeholder: '/forum',
		},
		{
			key: 'link_text', type: 'text', label: 'Texte du lien',
			placeholder: 'En savoir plus',
		},
		{
			key: 'dismissable', type: 'boolean', label: 'Peut être fermé par le visiteur',
			default: true,
		},
	],
}

export default plugin
