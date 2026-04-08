import type { WidgetPlugin } from './_types'
import JoinCard from '../widgets/JoinCard.svelte'

const plugin: WidgetPlugin = {
	id:        'join-card',
	label:     'Carte "Rejoindre"',
	icon:      '👋',
	desc:      'Invite les visiteurs à s\'inscrire. Masqué automatiquement pour les membres.',
	family:    'community',
	phase:     1,
	component: JoinCard,
	schema: [
		{
			key: 'title', type: 'text', label: 'Titre',
			placeholder: 'Rejoignez notre communauté',
		},
		{
			key: 'subtitle', type: 'text', label: 'Sous-titre',
			placeholder: 'Plus de 500 membres actifs, rejoignez l\'aventure.',
		},
		{
			key: 'cta_text', type: 'text', label: 'Texte du bouton',
			placeholder: 'S\'inscrire gratuitement',
		},
		{
			key: 'show_recent_avatars', type: 'boolean',
			label: 'Afficher les avatars des derniers inscrits',
			default: true,
		},
		{
			key: 'show_online_count', type: 'boolean',
			label: 'Afficher le nombre de membres en ligne',
			default: true,
		},
	],
}

export default plugin
