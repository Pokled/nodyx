// Types partagés Nodyx Deck — utilisés à la fois par DeckPanel (liste) et
// DeckEditor (WYSIWYG). Définis ici pour éviter la divergence entre les
// deux composants (svelte-check les voit comme deux types distincts si on
// les redéclare localement).

export type DeckActionType =
	| 'noop'
	| 'top_clips'
	| 'vod_marker'
	| 'chat_message'
	| 'trigger_command'
	| 'play_audio'
	| 'stop_audio'
	| 'pause_audio'
	| 'navigate_page'
	| 'playlist_control'

export type PlaylistControlCmd =
	| 'play' | 'pause' | 'toggle' | 'skip' | 'prev' | 'stop' | 'volume'

export interface DeckAction {
	type:          DeckActionType
	// top_clips
	overlayId?:    string
	period?:       '7d' | '30d' | 'all'
	count?:        number
	// vod_marker
	description?:  string
	// chat_message
	text?:         string
	// trigger_command
	commandName?:  string
	// play_audio / stop_audio / pause_audio
	// `trackTitle` est mémorisé côté layout pour afficher proprement le bouton
	// même quand la lib n'est pas encore chargée. Backend re-résout via trackId.
	trackId?:      string
	trackTitle?:   string
	// navigate_page : soit cible directe, soit jump relatif. Géré client-side.
	targetPageId?: string
	pageJump?:     'next' | 'prev' | 'home'
	// playlist_control : pilote l'overlay playlist OBS via socket. `cmd`
	// requis ; `playlistId` seulement pour 'play' (switch). `volumeMode` +
	// `volumeValue` pour 'volume'.
	cmd?:          PlaylistControlCmd
	playlistId?:   string
	volumeMode?:   'delta' | 'absolute'
	volumeValue?:  number
}

export interface DeckButton {
	id:        string
	x:         number
	y:         number
	w:         number
	h:         number
	label:     string
	icon:      string
	iconScale?: number          // 1.0 = défaut. Clamp [1, 3] côté backend, sanitize remplit si manquant.
	gradient:  string
	action:    DeckAction
}

// Une page = un écran logique de boutons. V1 : 1 à 8 pages, le streamer
// navigue avec navigate_page ou les chips du bottom dock mobile.
export interface DeckPage {
	id:       string
	name:     string
	color?:   string             // accent hex optionnel pour la chip
	buttons:  DeckButton[]
}

export interface DeckLayout {
	rows:     number
	cols:     number
	pages:    DeckPage[]
}

export interface Deck {
	id:          string
	token:       string
	label:       string
	layout:      DeckLayout
	createdAt:   string
	updatedAt:   string
	lastSeenAt?: string | null
}
