// Types partagés Streamer Hub → Scènes OBS. Miroir des types du service
// backend `obsScenesService.ts`. Définis ici pour éviter la divergence entre
// les sous-composants (ScenesPanel, SceneCanvas, AddSourceModal).

export type ObsSceneSourceType =
	| 'alert_box'
	| 'ticker'
	| 'playlist'
	| 'soundboard_osd'
	| 'goal_bar'
	| 'leaderboard'
	| 'clips_player'
	| 'stream_timer'
	| 'browser_source'
	| 'placeholder_video'

// Canvas de référence en pixels absolus (1920x1080 = 16:9 1080p). Le canvas
// frontend est scalé visuellement mais on stocke et on raisonne en pixels
// pour que le bridge OBS WebSocket (Phase B+) puisse pousser tel quel.
export const CANVAS_WIDTH  = 1920
export const CANVAS_HEIGHT = 1080

export interface ObsSceneSource {
	id:      string
	type:    ObsSceneSourceType
	label:   string
	x:       number
	y:       number
	w:       number
	h:       number
	z:       number
	visible: boolean
	locked:  boolean
	// Config dépendante du type (overlayToken, url, playlistId, kind, etc.).
	// Validée backend dans sanitizeSourceConfig.
	config:  Record<string, unknown>
}

export interface ObsSceneBackground {
	kind:   'none' | 'color' | 'image'
	color?: string
	url?:   string
}

export interface ObsSceneLayout {
	sources:     ObsSceneSource[]
	background?: ObsSceneBackground
}

export interface ObsScene {
	id:          string
	ownerUserId: string
	name:        string
	color:       string | null
	layout:      ObsSceneLayout
	position:    number
	createdAt:   string
	updatedAt:   string
}

// Métadonnées d'affichage par type de source : utilisé pour le catalogue
// "+ Source" et pour le rendu placeholder dans le canvas. Choix de couleurs
// cohérent avec le reste de l'admin (accents par catégorie).
export interface SourceTypeMeta {
	label:       string
	description: string
	icon:        string         // emoji ou symbole
	accent:      string         // hex sans #, pour les badges/bordures
	defaultW:    number
	defaultH:    number
}

// Tailles par défaut = taille NATURELLE du contenu rendu par chaque overlay
// (la taille à laquelle son CSS interne est designé). La source apparaît
// ainsi à la taille où le contenu est lisible. Si le streamer agrandit, le
// contenu suit (scale OBS-style). S'il rétrécit, ça compresse. Pour les
// overlays qui ont un sélecteur de position interne (timer, alert), la
// position interne reste éditable via leur config, indépendamment de la
// taille de la source dans la scène.
export const SOURCE_TYPE_META: Record<ObsSceneSourceType, SourceTypeMeta> = {
	alert_box: {
		label:       'Alert Box',
		description: 'Notifications follow / sub / raid / cheer.',
		icon:        '🔔',
		accent:      'f59e0b',
		defaultW:    640, defaultH: 200,
	},
	ticker: {
		label:       'Event Ticker',
		description: 'Bandeau d\'events qui défile.',
		icon:        '📰',
		accent:      '38bdf8',
		defaultW:    1920, defaultH: 60,
	},
	playlist: {
		label:       'Playlist',
		description: 'Musique d\'ambiance en autoplay loop.',
		icon:        '🎵',
		accent:      'a78bfa',
		defaultW:    360, defaultH: 90,
	},
	soundboard_osd: {
		label:       'Soundboard OSD',
		description: 'Carte affichée quand un son du Stream Deck joue.',
		icon:        '🔊',
		accent:      'c084fc',
		defaultW:    340, defaultH: 90,
	},
	goal_bar: {
		label:       'Goal Bar',
		description: 'Barre d\'objectif (followers, subs, etc.).',
		icon:        '🎯',
		accent:      '34d399',
		defaultW:    420, defaultH: 60,
	},
	leaderboard: {
		label:       'Leaderboard',
		description: 'Top viewers, chat ou donateurs.',
		icon:        '🏆',
		accent:      'fbbf24',
		defaultW:    320, defaultH: 280,
	},
	clips_player: {
		label:       'Clips Player',
		description: 'Lecteur de top clips déclenchable au Deck.',
		icon:        '🎬',
		accent:      'f472b6',
		defaultW:    640, defaultH: 360,
	},
	stream_timer: {
		label:       'Stream Timer',
		description: 'Chrono du stream en cours, format réglable.',
		icon:        '⏱',
		accent:      '60a5fa',
		defaultW:    280, defaultH: 70,
	},
	browser_source: {
		label:       'Browser Source',
		description: 'N\'importe quelle URL (widget externe).',
		icon:        '🌐',
		accent:      '94a3b8',
		defaultW:    480, defaultH: 270,
	},
	placeholder_video: {
		label:       'Source vidéo',
		description: 'Webcam, capture jeu ou image (sera liée à OBS plus tard).',
		icon:        '📹',
		accent:      'ef4444',
		defaultW:    1920, defaultH: 1080,
	},
}

// Set des types qui doivent toujours être rendus avec une viewport iframe
// full-scene (1920×1080). Pour ceux-là, le placement dans la scène n'est
// qu'une bounding box de scale : l'overlay se positionne lui-même.
export const FULL_SCENE_VIEWPORT_TYPES = new Set<ObsSceneSourceType>([
	'alert_box', 'ticker', 'playlist', 'soundboard_osd',
	'goal_bar', 'leaderboard', 'clips_player', 'stream_timer',
])

// Slug de route SvelteKit côté frontend pour chaque type d'overlay Nodyx.
// Sert à construire l'URL preview iframe dans le canvas Scènes. null = pas
// d'URL native (browser_source utilise sa propre URL, placeholder_video n'a
// pas de rendu live, juste un emplacement réservé).
const ROUTE_SLUG: Partial<Record<ObsSceneSourceType, string>> = {
	alert_box:      'alert',
	ticker:         'ticker',
	soundboard_osd: 'soundboard',
	goal_bar:       'goal',
	leaderboard:    'board',
	clips_player:   'clips',
	stream_timer:   'timer',
	playlist:       'playlist',
}

// Construit l'URL d'aperçu live pour une source. Retourne null si la source
// n'a pas (ou pas encore) tout ce qu'il faut pour afficher quelque chose
// (ex : pas d'overlayToken sur une alert_box). Le caller dessine alors le
// placeholder visuel.
export function resolveSourceUrl(
	source: ObsSceneSource,
	origin: string,
): string | null {
	const m = SOURCE_TYPE_META[source.type]
	if (source.type === 'browser_source') {
		const url = typeof source.config.url === 'string' ? source.config.url : ''
		return url || null
	}
	if (source.type === 'placeholder_video') return null
	const slug = ROUTE_SLUG[source.type]
	const token = typeof source.config.overlayToken === 'string' ? source.config.overlayToken : ''
	if (!slug || !token) return null
	const base = `${origin.replace(/\/+$/, '')}/overlay/${slug}/${token}`
	if (source.type === 'playlist' && typeof source.config.playlistId === 'string') {
		return `${base}?id=${encodeURIComponent(source.config.playlistId)}`
	}
	// Hint sous-utilisé pour l'instant : on passera `preview=1` plus tard
	// pour que les overlays sachent qu'ils tournent dans l'éditeur (skip
	// son, désactiver socket coûteux, etc.).
	void m
	return base
}

// Ordre d'affichage dans le catalogue "+ Source". Les types les plus
// communs en premier, le browser libre et le placeholder vidéo à la fin.
export const SOURCE_TYPE_ORDER: ObsSceneSourceType[] = [
	'placeholder_video',
	'alert_box',
	'ticker',
	'playlist',
	'soundboard_osd',
	'goal_bar',
	'leaderboard',
	'clips_player',
	'stream_timer',
	'browser_source',
]
