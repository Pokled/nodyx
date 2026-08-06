import type { WidgetPlugin } from './_types'
import RecentThreads from '../widgets/RecentThreads.svelte'

export default {
	id:      'recent-threads',
	label:   'Threads récents',
	icon:    '💬',
	desc:    'Feed des derniers sujets du forum, style liste ou cards.',
	family:  'community',
	phase:   1,
	component: RecentThreads,
	schema: [
		{
			key: 'heading', type: 'text', label: 'Titre de section',
			placeholder: 'ex : Discussions récentes', default: '',
		},
		{
			key: 'style', type: 'select', label: 'Style d\'affichage', default: 'list',
			options: [
				{ value: 'list',  label: '☰ Liste compacte' },
				{ value: 'cards', label: '⊞ Grille de cartes' },
			],
		},
		{
			key: 'limit', type: 'number', label: 'Nombre de threads', default: 5,
			min: 1, max: 10,
		},
		{
			key: 'category_id', type: 'text', label: 'Filtrer par catégorie (slug ou UUID)',
			placeholder: 'Vide = toutes les catégories', default: '',
		},
		{
			key: 'show_avatar',   type: 'boolean', label: 'Afficher les avatars',   default: true,
		},
		{
			key: 'show_category', type: 'boolean', label: 'Afficher la catégorie',  default: true,
		},
		{
			key: 'show_date',     type: 'boolean', label: 'Afficher la date',       default: true,
		},
		{
			key: 'show_replies',  type: 'boolean', label: 'Afficher nb de réponses', default: true,
		},
	],
} satisfies WidgetPlugin
