import type { WidgetPlugin } from './_types'
import ArticlesShowcase from '../widgets/ArticlesShowcase.svelte'

const plugin: WidgetPlugin = {
	id:        'articles-showcase',
	label:     'Vitrine Articles',
	icon:      '📰',
	desc:      'Met en avant les articles du forum avec image, extrait et bouton "Lire la suite". Plusieurs layouts au choix (magazine, grille, horizontal, slider, ticker, headlines).',
	family:    'content',
	phase:     1,
	component: ArticlesShowcase,
	schema: [
		// ── Layout ──
		{
			key: 'layout', type: 'select', label: 'Disposition',
			default: 'magazine',
			options: [
				{ value: 'magazine',   label: 'Magazine (1 hero + grille 2×2)' },
				{ value: 'grid',       label: 'Grille (2 / 3 / 4 colonnes)'    },
				{ value: 'horizontal', label: 'Horizontal (image + texte)'     },
				{ value: 'slider',     label: 'Slider (carrousel)'             },
				{ value: 'ticker',     label: 'Ticker (défilement vertical)'   },
				{ value: 'headlines',  label: 'Headlines (titres numérotés)'   },
			],
			hint: 'Chaque layout a sa personnalité, teste-les pour voir ce qui colle à ta page.',
		},
		{
			key: 'cols', type: 'number', label: 'Colonnes (layout Grille)',
			default: 3, min: 2, max: 4,
			hint: 'Utilisé uniquement pour le layout Grille. 2, 3 ou 4 colonnes.',
		},
		{
			key: 'aspect_ratio', type: 'select', label: 'Ratio des images',
			default: '16:9',
			options: [
				{ value: '16:9', label: '16:9 (standard)'       },
				{ value: '4:3',  label: '4:3 (plus carré)'      },
				{ value: '1:1',  label: '1:1 (carré)'           },
				{ value: '21:9', label: '21:9 (ultra-large)'    },
			],
		},

		// ── Source ──
		{
			key: 'source', type: 'select', label: 'Tri des articles',
			default: 'recent',
			options: [
				{ value: 'recent',      label: 'Plus récents (dernière activité)' },
				{ value: 'popular',     label: 'Plus populaires (nb de posts)'    },
				{ value: 'most_viewed', label: 'Plus vus'                         },
			],
		},
		{
			key: 'category', type: 'text', label: 'Catégorie (optionnel)',
			placeholder: 'slug de la catégorie ou UUID',
			hint: 'Laisse vide pour toutes les catégories.',
		},
		{
			key: 'pinned_only', type: 'boolean', label: 'Articles épinglés uniquement',
			default: false,
			hint: 'Affiche seulement les threads marqués comme épinglés.',
		},
		{
			key: 'count', type: 'number', label: 'Nombre d\'articles',
			default: 6, min: 1, max: 20,
		},

		// ── Titre du widget ──
		{
			key: 'heading', type: 'text', label: 'Titre du bloc',
			placeholder: 'À la une',
			hint: 'Laisse vide pour masquer le titre.',
		},
		{
			key: 'subheading', type: 'text', label: 'Sous-titre',
			placeholder: 'Les derniers articles de la communauté',
		},

		// ── Affichage ──
		{
			key: 'show_excerpt', type: 'boolean', label: 'Afficher l\'extrait',
			default: true,
		},
		{
			key: 'show_author', type: 'boolean', label: 'Afficher l\'auteur',
			default: true,
		},
		{
			key: 'show_date', type: 'boolean', label: 'Afficher la date',
			default: true,
		},
		{
			key: 'show_category', type: 'boolean', label: 'Afficher la catégorie',
			default: true,
		},
		{
			key: 'show_views', type: 'boolean', label: 'Afficher les vues',
			default: false,
		},
		{
			key: 'cta_text', type: 'text', label: 'Texte du bouton',
			default: 'Lire la suite',
		},
		{
			key: 'accent_color', type: 'color', label: 'Couleur d\'accent',
			default: '#a78bfa',
			hint: 'Utilisée pour les badges catégorie, les numéros et le bouton.',
		},

		// ── Slider ──
		{
			key: 'slider_autoplay', type: 'boolean', label: 'Autoplay slider',
			default: true,
			hint: 'Utilisé uniquement pour le layout Slider.',
		},
		{
			key: 'slider_delay_sec', type: 'number', label: 'Délai slider (secondes)',
			default: 6, min: 3, max: 30,
		},
	],
}

export default plugin
