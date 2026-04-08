// Schema de configuration pour chaque widget
// Génère automatiquement le formulaire admin — zéro JSON brut pour l'admin

export type FieldType = 'text' | 'textarea' | 'url' | 'number' | 'boolean' | 'select' | 'color' | 'image'

export interface FieldSchema {
	key:         string
	type:        FieldType
	label:       string
	placeholder?: string
	default?:    unknown
	required?:   boolean
	options?:    { value: string; label: string }[]   // pour type 'select'
	min?:        number
	max?:        number
	hint?:       string
}

export interface WidgetSchema {
	label:       string
	description: string
	icon:        string
	fields:      FieldSchema[]
}

export const WIDGET_SCHEMAS: Record<string, WidgetSchema> = {

	'announcement-banner': {
		label:       'Bandeau d\'annonce',
		description: 'Un bandeau d\'information en haut de page.',
		icon:        '📢',
		fields: [
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
	},

	'hero-banner': {
		label:       'Hero Banner',
		description: 'La grande section d\'accueil de votre page.',
		icon:        '🌟',
		fields: [
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
				key: 'overlay_opacity', type: 'number', label: 'Opacité de l\'image (0 à 1)',
				default: 0.5, min: 0, max: 1,
				hint: '0 = image invisible, 1 = image pleine',
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
				label: 'Variantes automatiques (live / événement à venir / nuit)',
				default: true,
				hint: 'Change l\'apparence selon le contexte : stream en live, événement proche, heure de nuit.',
			},
			{
				key: 'night_image_url', type: 'image', label: 'Image de nuit (22h–6h)',
				placeholder: 'https://...',
				hint: 'Image alternative affichée la nuit (optionnel).',
			},
		],
	},

	'stats-bar': {
		label:       'Barre de statistiques',
		description: 'Affiche les compteurs de la communauté en temps réel.',
		icon:        '📊',
		fields: [
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
	},

	'join-card': {
		label:       'Carte "Rejoindre"',
		description: 'Invite les visiteurs à s\'inscrire. Masqué automatiquement pour les membres.',
		icon:        '👋',
		fields: [
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
	},

}
