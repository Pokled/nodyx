import type { WidgetPlugin } from './_types'
import StatsBar from '../widgets/StatsBar.svelte'

const plugin: WidgetPlugin = {
	id:        'stats-bar',
	label:     'Barre de stats',
	icon:      '📊',
	desc:      'Compteurs animés : membres, en ligne, topics, posts.',
	family:    'community',
	phase:     1,
	component: StatsBar,
	schema: [
		{
			key: 'animated_count', type: 'boolean', label: 'Animation des compteurs au chargement',
			default: true,
		},
		{
			key: 'live_updates', type: 'boolean', label: 'Mise à jour en temps réel',
			default: true,
			hint: 'Le compteur de membres en ligne se met à jour automatiquement.',
		},
	],
}

export default plugin
