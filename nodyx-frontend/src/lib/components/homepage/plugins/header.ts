import type { WidgetPlugin } from './_types'
import Header from '../widgets/Header.svelte'

const plugin: WidgetPlugin = {
	id:        'header',
	label:     'En-tête',
	icon:      '🪧',
	desc:      'En-tête de communauté entièrement personnalisable : image de fond et logo uploadables et positionnables, texte avec couleur/police au choix, chaque élément indépendamment affichable ou non.',
	family:    'media',
	phase:     1,
	component: Header,
	schema:    [],
	customPanel: true,
}

export default plugin
