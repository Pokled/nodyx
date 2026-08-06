import type { WidgetPlugin } from './_types'
import SocialLinksBar from '../widgets/SocialLinksBar.svelte'

export default {
	id:      'social-links-bar',
	label:   'Liens sociaux',
	icon:    '🌐',
	desc:    'Barre d\'icônes réseaux sociaux configurable : Discord, Twitch, YouTube, GitHub...',
	family:  'social',
	phase:   1,
	component: SocialLinksBar,
	schema:  [],
	customPanel: true,
} satisfies WidgetPlugin
