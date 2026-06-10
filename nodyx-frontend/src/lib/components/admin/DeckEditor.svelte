<script lang="ts">
	import { apiFetch } from '$lib/api'
	import { browser } from '$app/environment'
	import { onMount } from 'svelte'
	import Tooltip from '$lib/components/ui/Tooltip.svelte'
	import QRCode from 'qrcode'
	import type { Deck, DeckAction, DeckActionType as ActionType, DeckButton, DeckLayout, DeckPage } from '$lib/types/deck'

	// Nodyx Deck — éditeur WYSIWYG pour un deck unique. Grille à gauche, panel
	// d'édition de bouton à droite. Save = PATCH du layout entier (JSONB).

	interface Props {
		deck:     Deck
		token:    string                          // admin auth token
		onClose:  () => void
		onSaved?: (d: Deck) => void
		publicBaseUrl: string                     // pour générer l'URL mobile à coller
	}

	let { deck: initialDeck, token, onClose, onSaved, publicBaseUrl }: Props = $props()

	let label  = $state(initialDeck.label)
	let layout = $state<DeckLayout>(normalizeLayout(initialDeck.layout))
	let currentPageId = $state<string>(layout.pages[0]?.id ?? '')
	let selectedId = $state<string | null>(null)
	let busy = $state(false)
	let dirty = $state(false)
	let toast = $state<{ text: string; ok: boolean } | null>(null)
	let editingPageName = $state<string | null>(null)

	// Backwards-compat : un deck V1 peut arriver avec `buttons` à plat.
	function normalizeLayout(raw: DeckLayout | { rows: number; cols: number; buttons?: DeckButton[]; pages?: DeckPage[] }): DeckLayout {
		const r = JSON.parse(JSON.stringify(raw)) as { rows: number; cols: number; buttons?: DeckButton[]; pages?: DeckPage[] }
		if (Array.isArray(r.pages) && r.pages.length > 0) {
			return { rows: r.rows, cols: r.cols, pages: r.pages }
		}
		const legacyButtons = Array.isArray(r.buttons) ? r.buttons : []
		return { rows: r.rows, cols: r.cols, pages: [{ id: newPageId(), name: 'Principal', buttons: legacyButtons }] }
	}

	const currentPage = $derived(layout.pages.find(p => p.id === currentPageId) ?? layout.pages[0])
	const selected = $derived(currentPage?.buttons.find(b => b.id === selectedId) ?? null)
	const deckUrl  = $derived(`${publicBaseUrl}/deck/${initialDeck.token}`)

	const GRADIENT_PRESETS = [
		{ key: 'cyber',   label: 'Cyber',   bg: 'bg-gradient-to-br from-cyan-500 to-indigo-700' },
		{ key: 'neon',    label: 'Néon',    bg: 'bg-gradient-to-br from-pink-500 to-violet-700' },
		{ key: 'inferno', label: 'Inferno', bg: 'bg-gradient-to-br from-orange-400 to-red-700' },
		{ key: 'forest',  label: 'Forest',  bg: 'bg-gradient-to-br from-emerald-400 to-teal-700' },
		{ key: 'minimal', label: 'Minimal', bg: 'bg-gradient-to-br from-slate-700 to-slate-900' },
		{ key: 'sunset',  label: 'Sunset',  bg: 'bg-gradient-to-br from-amber-400 to-rose-600' },
		{ key: 'ocean',   label: 'Ocean',   bg: 'bg-gradient-to-br from-sky-400 to-blue-800' },
		{ key: 'amber',   label: 'Amber',   bg: 'bg-gradient-to-br from-amber-300 to-orange-600' },
	]

	const EMOJI_PRESETS = ['🎬','📍','💬','🤖','🎮','🎙️','🎵','🎤','📣','🚀','🔥','⭐','✨','🎯','💎','🏆','❤️','👋','👀','🎉','💛','🛠️','📅','🔗','🍕','☕','🌙','⚡','✅','🚨','🎨','🧠','💡','📷','🎥','🎧']

	function gradientBgClass(key: string): string {
		const p = GRADIENT_PRESETS.find(x => x.key === key)
		if (p) return p.bg
		return 'bg-gradient-to-br from-cyan-500 to-indigo-700'
	}

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (browser) setTimeout(() => { toast = null }, 2500)
	}

	function newButtonId(): string {
		return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)
	}

	function newPageId(): string {
		return 'p_' + Math.random().toString(36).slice(2, 10)
	}

	function findButtonAt(x: number, y: number): DeckButton | null {
		if (!currentPage) return null
		return currentPage.buttons.find(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h) ?? null
	}

	function onCellClick(x: number, y: number): void {
		if (!currentPage) return
		const existing = findButtonAt(x, y)
		if (existing) {
			selectedId = existing.id
			return
		}
		// Crée un nouveau bouton 1x1 sur ce slot, dans la page courante.
		const id = newButtonId()
		currentPage.buttons.push({
			id, x, y, w: 1, h: 1,
			label:     'Nouveau',
			icon:      '⬜',
			iconScale: 1,
			gradient:  'cyber',
			action:    { type: 'noop' },
		})
		layout = layout
		selectedId = id
		dirty = true
	}

	function removeButton(b: DeckButton): void {
		if (!currentPage) return
		currentPage.buttons = currentPage.buttons.filter(x => x.id !== b.id)
		if (selectedId === b.id) selectedId = null
		layout = layout
		dirty = true
	}

	function updateSelected(patch: Partial<DeckButton>): void {
		if (!selected) return
		Object.assign(selected, patch)
		layout = layout
		dirty = true
	}

	function updateAction(patch: Partial<DeckAction>): void {
		if (!selected) return
		selected.action = { ...selected.action, ...patch }
		layout = layout
		dirty = true
	}

	function setGridSize(rows: number, cols: number): void {
		// On filtre les boutons hors grille dans TOUTES les pages.
		layout = {
			rows,
			cols,
			pages: layout.pages.map(p => ({
				...p,
				buttons: p.buttons.filter(b => b.x + b.w <= cols && b.y + b.h <= rows),
			})),
		}
		dirty = true
	}

	// ── Multi-pages : add / rename / delete / reorder / pick ──────────────────

	function addPage(): void {
		if (layout.pages.length >= 8) { flash('Limite de 8 pages atteinte.', false); return }
		const id = newPageId()
		const name = `Page ${layout.pages.length + 1}`
		layout.pages.push({ id, name, buttons: [] })
		layout = layout
		currentPageId = id
		selectedId = null
		dirty = true
	}

	function selectPage(id: string): void {
		currentPageId = id
		selectedId = null
		editingPageName = null
	}

	function renamePage(id: string, name: string): void {
		const p = layout.pages.find(x => x.id === id)
		if (!p) return
		p.name = name.slice(0, 40) || 'Page'
		layout = layout
		dirty = true
	}

	function setPageColor(id: string, color: string | undefined): void {
		const p = layout.pages.find(x => x.id === id)
		if (!p) return
		p.color = color
		layout = layout
		dirty = true
	}

	function deletePage(id: string): void {
		if (layout.pages.length <= 1) { flash('Il faut au moins une page.', false); return }
		const p = layout.pages.find(x => x.id === id)
		if (!p) return
		if (p.buttons.length > 0 && !confirm(`Supprimer la page "${p.name}" et ses ${p.buttons.length} bouton(s) ?`)) return
		layout.pages = layout.pages.filter(x => x.id !== id)
		if (currentPageId === id) currentPageId = layout.pages[0].id
		// Nettoie les navigate_page qui pointaient vers cette page disparue.
		for (const pg of layout.pages) {
			for (const b of pg.buttons) {
				if (b.action.type === 'navigate_page' && b.action.targetPageId === id) {
					b.action = { type: 'navigate_page', pageJump: 'home' }
				}
			}
		}
		layout = layout
		dirty = true
	}

	function movePage(id: string, dir: -1 | 1): void {
		const i = layout.pages.findIndex(p => p.id === id)
		if (i < 0) return
		const j = i + dir
		if (j < 0 || j >= layout.pages.length) return
		const arr = layout.pages.slice()
		;[arr[i], arr[j]] = [arr[j], arr[i]]
		layout.pages = arr
		dirty = true
	}

	function applyPreset(preset: 'starter' | 'mod' | 'engage'): void {
		// Charge un set de boutons pré-configurés dans une page principale. L'admin
		// peut ensuite ajouter d'autres pages et ajuster.
		const pageId = newPageId()
		if (preset === 'starter') {
			layout = {
				rows: 3, cols: 4,
				pages: [{ id: pageId, name: 'Principal', buttons: [
					{ id: newButtonId(), x: 0, y: 0, w: 1, h: 1, label: 'Top Clips 7j', icon: '🎬', iconScale: 1, gradient: 'cyber',  action: { type: 'top_clips', overlayId: '', period: '7d', count: 5 } },
					{ id: newButtonId(), x: 1, y: 0, w: 1, h: 1, label: 'Marker',        icon: '📍', iconScale: 1, gradient: 'sunset', action: { type: 'vod_marker', description: 'Highlight' } },
					{ id: newButtonId(), x: 2, y: 0, w: 1, h: 1, label: '!discord',      icon: '💬', iconScale: 1, gradient: 'neon',   action: { type: 'trigger_command', commandName: '!discord' } },
					{ id: newButtonId(), x: 3, y: 0, w: 1, h: 1, label: 'Schedule',      icon: '📅', iconScale: 1, gradient: 'forest', action: { type: 'trigger_command', commandName: '!schedule' } },
					{ id: newButtonId(), x: 0, y: 1, w: 2, h: 1, label: 'Hello chat',    icon: '👋', iconScale: 1, gradient: 'ocean',  action: { type: 'chat_message', text: 'Salut à tous, content de vous voir !' } },
					{ id: newButtonId(), x: 2, y: 1, w: 2, h: 1, label: 'Pub Nodyx',     icon: '🚀', iconScale: 1, gradient: 'amber',  action: { type: 'trigger_command', commandName: '!nodyx' } },
				] }],
			}
		} else if (preset === 'mod') {
			layout = {
				rows: 3, cols: 4,
				pages: [{ id: pageId, name: 'Modération', buttons: [
					{ id: newButtonId(), x: 0, y: 0, w: 1, h: 1, label: 'Marker',  icon: '📍', iconScale: 1, gradient: 'sunset',  action: { type: 'vod_marker', description: 'Moment important' } },
					{ id: newButtonId(), x: 1, y: 0, w: 1, h: 1, label: 'Calme',   icon: '🤫', iconScale: 1, gradient: 'minimal', action: { type: 'chat_message', text: 'On respire, on respecte, merci !' } },
					{ id: newButtonId(), x: 2, y: 0, w: 1, h: 1, label: 'Règles',  icon: '📋', iconScale: 1, gradient: 'ocean',   action: { type: 'chat_message', text: 'Petit rappel des règles du chat : respect, bienveillance, on s\'amuse.' } },
					{ id: newButtonId(), x: 3, y: 0, w: 1, h: 1, label: 'Lurkers', icon: '👀', iconScale: 1, gradient: 'forest',  action: { type: 'chat_message', text: 'Merci aux lurkers, votre présence compte aussi !' } },
				] }],
			}
		} else {
			layout = {
				rows: 3, cols: 4,
				pages: [{ id: pageId, name: 'Engagement', buttons: [
					{ id: newButtonId(), x: 0, y: 0, w: 2, h: 1, label: 'Top Clips total', icon: '🏆', iconScale: 1, gradient: 'amber',   action: { type: 'top_clips', overlayId: '', period: 'all', count: 5 } },
					{ id: newButtonId(), x: 2, y: 0, w: 2, h: 1, label: 'Pub Nodyx',       icon: '🚀', iconScale: 1, gradient: 'cyber',   action: { type: 'trigger_command', commandName: '!nodyx' } },
					{ id: newButtonId(), x: 0, y: 1, w: 1, h: 1, label: 'Discord',         icon: '💬', iconScale: 1, gradient: 'neon',    action: { type: 'trigger_command', commandName: '!discord' } },
					{ id: newButtonId(), x: 1, y: 1, w: 1, h: 1, label: 'Schedule',        icon: '📅', iconScale: 1, gradient: 'forest',  action: { type: 'trigger_command', commandName: '!schedule' } },
					{ id: newButtonId(), x: 2, y: 1, w: 1, h: 1, label: 'Social',          icon: '🔗', iconScale: 1, gradient: 'ocean',   action: { type: 'trigger_command', commandName: '!social' } },
					{ id: newButtonId(), x: 3, y: 1, w: 1, h: 1, label: 'Hype',            icon: '🔥', iconScale: 1, gradient: 'inferno', action: { type: 'chat_message', text: 'C\'est parti pour la suite, on monte d\'un cran !' } },
				] }],
			}
		}
		currentPageId = pageId
		selectedId = null
		dirty = true
		flash(`Preset "${preset}" chargé. N'oublie pas de configurer les overlayId si tu utilises Top Clips.`, true)
	}

	async function save(): Promise<void> {
		busy = true
		try {
			const res = await apiFetch(fetch, `/streamer/decks/${initialDeck.id}`, {
				method:  'PATCH',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body:    JSON.stringify({ label, layout }),
			})
			if (res.ok) {
				const data = await res.json() as { deck: Deck }
				flash('Deck enregistré.', true)
				dirty = false
				onSaved?.(data.deck)
			} else {
				flash('Échec de la sauvegarde.', false)
			}
		} catch {
			flash('Erreur réseau.', false)
		} finally {
			busy = false
		}
	}

	function copyDeckUrl(): void {
		if (!browser) return
		navigator.clipboard.writeText(deckUrl).then(
			() => flash('URL copiée. Ouvre-la sur ton tel/tablette.', true),
			() => flash('Impossible de copier (HTTPS requis).', false),
		)
	}

	// ── QR Code (scan depuis le tel) + envoi mail (tablette / 2e écran) ────
	let showShareModal = $state(false)
	let qrDataUrl      = $state<string | null>(null)
	// Le QR donne accès au deck : flouté par défaut, révélé au clic, pour éviter
	// un leak en live par inadvertance.
	let qrRevealed     = $state(false)

	async function openShareModal(): Promise<void> {
		showShareModal = true
		qrRevealed = false   // toujours flouté à l'ouverture
		if (qrDataUrl) return
		try {
			qrDataUrl = await QRCode.toDataURL(deckUrl, {
				width:      400,
				margin:     2,
				color:      { dark: '#0f172a', light: '#ffffff' },
				errorCorrectionLevel: 'M',
			})
		} catch (e) {
			console.warn('[deck-editor] QR generation failed', e)
		}
	}

	function closeShareModal(): void {
		showShareModal = false
		qrRevealed = false   // re-flouté pour la prochaine ouverture
	}

	function sendByEmail(): void {
		if (!browser) return
		const subject = encodeURIComponent(`Nodyx Deck — ${label}`)
		const body    = encodeURIComponent(`Ouvre ce lien depuis ton téléphone ou ta tablette pour utiliser ton Nodyx Deck :\n\n${deckUrl}\n\nAstuce : ajoute-le à l'écran d'accueil de ton appareil pour un effet app.`)
		window.location.href = `mailto:?subject=${subject}&body=${body}`
	}

	// Webshare API native (mobile / desktop modernes)
	function shareNative(): void {
		if (!browser) return
		const nav = navigator as Navigator & { share?: (data: { title?: string; text?: string; url?: string }) => Promise<void> }
		if (typeof nav.share !== 'function') { sendByEmail(); return }
		nav.share({
			title: `Nodyx Deck — ${label}`,
			text:  `Mon Nodyx Deck "${label}"`,
			url:   deckUrl,
		}).catch(() => { /* user a annulé, no-op */ })
	}

	const supportsWebShare = $derived(browser && typeof (navigator as Navigator & { share?: unknown }).share === 'function')

	// Liste des overlays clips_player pour le sélecteur d'action top_clips
	let clipsOverlays = $state<Array<{ id: string; label: string | null }>>([])

	async function loadClipsOverlays(): Promise<void> {
		const res = await apiFetch(fetch, '/streamer/overlays', { headers: { Authorization: `Bearer ${token}` } })
		if (res.ok) {
			const d = await res.json() as { overlays: Array<{ id: string; overlayType: string; label: string | null; revokedAt: string | null }> }
			clipsOverlays = (d.overlays ?? []).filter(o => o.overlayType === 'clips_player' && !o.revokedAt).map(o => ({ id: o.id, label: o.label }))
		}
	}

	// Liste des chat commands custom pour le sélecteur d'action trigger_command
	let customCommands = $state<Array<{ name: string }>>([])

	async function loadCustomCommands(): Promise<void> {
		const res = await apiFetch(fetch, '/streamer/chat-commands', { headers: { Authorization: `Bearer ${token}` } })
		if (res.ok) {
			const d = await res.json() as { commands: Array<{ name: string; enabled: boolean }> }
			customCommands = (d.commands ?? []).filter(c => c.enabled).map(c => ({ name: c.name }))
		}
	}

	// Bibliothèque audio (Soundboard) pour les actions play_audio.
	interface AudioTrackLite {
		id:           string
		title:        string
		artist:       string | null
		durationMs:   number | null
		thumbnailUrl: string | null
	}
	let audioTracks = $state<AudioTrackLite[]>([])
	let audioTracksLoading = $state(true)
	let audioPickerQuery = $state('')

	async function loadAudioTracks(): Promise<void> {
		audioTracksLoading = true
		try {
			const res = await apiFetch(fetch, '/streamer/audio-library', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const d = await res.json() as { tracks: AudioTrackLite[] }
				audioTracks = d.tracks ?? []
				console.log(`[deck-editor] ${audioTracks.length} son(s) chargé(s) depuis le soundboard`)
			} else {
				console.warn(`[deck-editor] échec chargement soundboard : HTTP ${res.status}`)
			}
		} catch (err) {
			console.error('[deck-editor] erreur réseau soundboard', err)
		} finally {
			audioTracksLoading = false
		}
	}

	const audioTracksFiltered = $derived(audioPickerQuery.trim()
		? audioTracks.filter(t => {
			const q = audioPickerQuery.trim().toLowerCase()
			return t.title.toLowerCase().includes(q) || (t.artist ?? '').toLowerCase().includes(q)
		})
		: audioTracks)

	// Playlists du streamer : utilisées par le picker du bouton
	// playlist_control quand cmd='play' (sélection de la playlist à démarrer).
	interface PlaylistLite { id: string; name: string; color: string | null; trackCount: number }
	let playlistsList = $state<PlaylistLite[]>([])
	async function loadPlaylistsList(): Promise<void> {
		try {
			const res = await apiFetch(fetch, '/streamer/audio-library/playlists', { headers: { Authorization: `Bearer ${token}` } })
			if (res.ok) {
				const d = await res.json() as { playlists: PlaylistLite[] }
				playlistsList = d.playlists ?? []
			}
		} catch { /* silencieux : la liste reste vide, l'éditeur reste utilisable */ }
	}

	function audioPickerThumb(t: AudioTrackLite): string {
		// Les thumbnails sont des URL relatives /uploads/... renvoyées par le backend.
		// PUBLIC_API_URL pointe vers /api/v1, on remonte d'un cran.
		if (!t.thumbnailUrl) return ''
		const base = (import.meta.env.PUBLIC_API_URL as string | undefined) ?? ''
		return `${base.replace(/\/api\/v1\/?$/, '')}${t.thumbnailUrl}`
	}

	function fmtDuration(ms: number | null): string {
		if (!ms || ms <= 0) return ''
		const total = Math.round(ms / 1000)
		const m = Math.floor(total / 60)
		const s = total % 60
		return `${m}:${s.toString().padStart(2, '0')}`
	}

	function pickAudioTrack(t: AudioTrackLite): void {
		if (!selected) return
		updateAction({ trackId: t.id, trackTitle: t.title })
		// Auto-fill du label si encore "Nouveau" pour aller plus vite.
		if (selected.label === 'Nouveau' || !selected.label) updateSelected({ label: t.title.slice(0, 40) })
	}

	// Quick-add : pose le son dans la première case libre de la page courante
	// avec un gradient déterministe (même son = même couleur, mémoire visuelle).
	const QUICK_GRADIENTS = ['neon', 'cyber', 'sunset', 'ocean', 'forest', 'amber', 'inferno', 'minimal']
	function gradientForTrack(id: string): string {
		let h = 0
		for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
		return QUICK_GRADIENTS[h % QUICK_GRADIENTS.length]
	}

	function findFirstFreeCell(): { x: number; y: number } | null {
		if (!currentPage) return null
		for (let y = 0; y < layout.rows; y++) {
			for (let x = 0; x < layout.cols; x++) {
				if (!isCellOccupied(x, y, null)) return { x, y }
			}
		}
		return null
	}

	function findFirstFreeCellInPage(pageId: string): { x: number; y: number } | null {
		const page = layout.pages.find(p => p.id === pageId)
		if (!page) return null
		for (let y = 0; y < layout.rows; y++) {
			for (let x = 0; x < layout.cols; x++) {
				const occupied = page.buttons.some(b => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
				if (!occupied) return { x, y }
			}
		}
		return null
	}

	// Déplace le bouton sélectionné vers une autre page (premier slot libre).
	// Sert au sélecteur "Page" dans l'éditeur du bouton.
	function moveSelectedToPage(targetPageId: string): void {
		if (!selected || !currentPage) return
		if (targetPageId === currentPageId) return
		const target = layout.pages.find(p => p.id === targetPageId)
		if (!target) return
		const free = findFirstFreeCellInPage(targetPageId)
		if (!free) { flash(`Page "${target.name}" pleine. Libère une case d'abord.`, false); return }
		const btn = selected
		// Retire de la page courante, place dans la cible avec sa première case libre.
		currentPage.buttons = currentPage.buttons.filter(b => b.id !== btn.id)
		target.buttons.push({ ...btn, x: free.x, y: free.y, w: 1, h: 1 })
		layout = layout
		currentPageId = targetPageId
		// Le bouton reste sélectionné après le move.
		selectedId = btn.id
		dirty = true
		flash(`Bouton déplacé sur "${target.name}".`, true)
	}

	onMount(() => { loadClipsOverlays(); loadCustomCommands(); loadAudioTracks(); loadPlaylistsList() })

	function isCellOccupied(x: number, y: number, exceptId: string | null): boolean {
		if (!currentPage) return false
		return currentPage.buttons.some(b => b.id !== exceptId && x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h)
	}

	// Pure : peut-on déplacer le bouton sélectionné de (dx, dy) sans clash ?
	// Utilisé par les fonctions d'action ET par l'UI pour disabled visuel.
	function canMove(dx: number, dy: number): boolean {
		if (!selected) return false
		const nx = selected.x + dx
		const ny = selected.y + dy
		if (nx < 0 || ny < 0 || nx + selected.w > layout.cols || ny + selected.h > layout.rows) return false
		for (let cx = nx; cx < nx + selected.w; cx++) {
			for (let cy = ny; cy < ny + selected.h; cy++) {
				if (isCellOccupied(cx, cy, selected.id)) return false
			}
		}
		return true
	}

	function canResize(dw: number, dh: number): boolean {
		if (!selected) return false
		const nw = selected.w + dw
		const nh = selected.h + dh
		if (nw < 1 || nh < 1) return false
		if (selected.x + nw > layout.cols || selected.y + nh > layout.rows) return false
		for (let cx = selected.x; cx < selected.x + nw; cx++) {
			for (let cy = selected.y; cy < selected.y + nh; cy++) {
				if (isCellOccupied(cx, cy, selected.id)) return false
			}
		}
		return true
	}

	function moveSelected(dx: number, dy: number): void {
		if (!selected || !canMove(dx, dy)) return
		selected.x = selected.x + dx
		selected.y = selected.y + dy
		layout = layout
		dirty = true
	}

	function resizeSelected(dw: number, dh: number): void {
		if (!selected || !canResize(dw, dh)) return
		selected.w = selected.w + dw
		selected.h = selected.h + dh
		layout = layout
		dirty = true
	}
</script>

<div class="space-y-4">
	<!-- Header sticky : label + actions -->
	<div class="flex items-center justify-between gap-3 flex-wrap pb-3 border-b border-slate-700/60">
		<div class="flex items-center gap-3 flex-1 min-w-0">
			<button type="button" onclick={onClose}
				class="text-xs text-slate-400 hover:text-white inline-flex items-center gap-1">
				← Decks
			</button>
			<input type="text" bind:value={label} maxlength="100"
				oninput={() => { dirty = true }}
				class="flex-1 min-w-0 max-w-md rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-3 py-1.5 text-sm font-semibold text-white outline-none transition-colors"/>
		</div>
		<div class="flex items-center gap-2 flex-wrap">
			<button type="button" onclick={openShareModal}
				class="text-[11px] bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors font-semibold">
				📱 Connecter un appareil
			</button>
			<a href={deckUrl} target="_blank" rel="noopener noreferrer"
				class="text-[11px] bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/60 text-slate-200 px-3 py-1.5 rounded inline-flex items-center gap-1.5 transition-colors">
				↗ Aperçu
			</a>
			<button type="button" onclick={save} disabled={busy || !dirty}
				class="text-xs bg-indigo-500/20 hover:bg-indigo-500/30 disabled:opacity-30 border border-indigo-500/50 text-indigo-100 px-4 py-1.5 rounded font-semibold transition-colors">
				{busy ? 'Sauvegarde…' : dirty ? 'Enregistrer' : 'À jour'}
			</button>
		</div>
	</div>

	<!-- Share Modal : QR code + alternatives pour tablette -->
	{#if showShareModal}
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
		<div class="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
			onclick={(e) => { if (e.target === e.currentTarget) closeShareModal() }}>
			<div class="w-full max-w-md rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-5 space-y-4 shadow-2xl">

				<div class="flex items-center justify-between gap-2">
					<h3 class="text-sm font-semibold text-white inline-flex items-center gap-2">
						<span>📱</span> Connecter ton appareil
					</h3>
					<button type="button" onclick={closeShareModal}
						class="p-1 rounded text-slate-400 hover:text-white hover:bg-slate-800" aria-label="Fermer">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
					</button>
				</div>

				<!-- Tabs internes : QR / Autre -->
				<div>
					<div class="text-[10px] uppercase tracking-widest font-semibold text-cyan-300 mb-1.5">Méthode rapide : QR code</div>
					<div class="relative rounded-xl bg-white p-3 mx-auto overflow-hidden" style="max-width: 280px;">
						{#if qrDataUrl}
							<img src={qrDataUrl} alt="QR code Nodyx Deck"
								class="w-full h-auto block transition-[filter] duration-200 {qrRevealed ? '' : 'blur-xl'}"/>
						{:else}
							<div class="aspect-square grid place-items-center text-slate-400 text-xs">Génération…</div>
						{/if}

						<!-- Overlay anti-leak : il faut cliquer pour révéler le QR -->
						{#if qrDataUrl && !qrRevealed}
							<button type="button" onclick={() => qrRevealed = true}
								class="absolute inset-0 grid place-items-center bg-slate-950/50 backdrop-blur-[2px] cursor-pointer group">
								<span class="flex flex-col items-center gap-1.5 px-4 py-3 rounded-xl bg-slate-900/90 border border-cyan-500/40 text-white group-hover:border-cyan-400 transition-colors">
									<svg class="w-5 h-5 text-cyan-300" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
									<span class="text-xs font-semibold">Cliquer pour afficher le QR</span>
									<span class="text-[10px] text-slate-400 font-normal">Évite de le montrer en live</span>
								</span>
							</button>
						{/if}
					</div>
					<div class="flex items-center justify-center gap-2 mt-2">
						<span class="text-[11px] text-slate-400 text-center leading-snug">
							{#if qrRevealed}
								Ouvre l'appareil photo de ton téléphone et scanne.
							{:else}
								QR masqué par sécurité (accès au deck). Clique dessus pour l'afficher.
							{/if}
						</span>
						{#if qrRevealed}
							<button type="button" onclick={() => qrRevealed = false}
								class="text-[11px] text-cyan-300 hover:text-cyan-200 shrink-0 underline">Masquer</button>
						{/if}
					</div>
				</div>

				<!-- Alternatives pour tablette / 2e écran -->
				<div class="border-t border-slate-700/60 pt-3 space-y-2">
					<div class="text-[10px] uppercase tracking-widest font-semibold text-slate-400">Pas de caméra ? Autres options</div>

					{#if supportsWebShare}
						<button type="button" onclick={shareNative}
							class="w-full text-left text-xs bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/40 text-cyan-100 px-3 py-2 rounded inline-flex items-center gap-2 transition-colors">
							<span>📤</span>
							<span class="flex-1">Partager via les apps de mon appareil</span>
						</button>
					{/if}

					<button type="button" onclick={sendByEmail}
						class="w-full text-left text-xs bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/60 text-slate-200 px-3 py-2 rounded inline-flex items-center gap-2 transition-colors">
						<span>✉️</span>
						<span class="flex-1">M'envoyer le lien par email</span>
					</button>

					<button type="button" onclick={copyDeckUrl}
						class="w-full text-left text-xs bg-slate-700/40 hover:bg-slate-700/60 border border-slate-600/60 text-slate-200 px-3 py-2 rounded inline-flex items-center gap-2 transition-colors">
						<span>🔗</span>
						<span class="flex-1">Copier l'URL (puis colle dans le navigateur de la tablette)</span>
					</button>

					<details class="text-[11px] text-slate-400">
						<summary class="cursor-pointer hover:text-slate-200">Afficher l'URL complète</summary>
						<code class="block mt-1.5 px-2 py-1.5 rounded bg-slate-950 border border-slate-700/60 text-[10px] break-all">{deckUrl}</code>
					</details>
				</div>

				<div class="text-[10px] text-slate-500 text-center italic">
					Astuce : sur ton tel ou ta tablette, ajoute la page à l'écran d'accueil (option du navigateur) pour avoir un effet app.
				</div>
			</div>
		</div>
	{/if}

	{#if toast}
		<div class="rounded p-2 text-xs flex items-center gap-2 {toast.ok ? 'border border-emerald-500/40 bg-emerald-500/10 text-emerald-200' : 'border border-rose-500/40 bg-rose-500/10 text-rose-200'}">
			<span class="w-1.5 h-1.5 rounded-full {toast.ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>
			{toast.text}
		</div>
	{/if}

	<!-- Presets -->
	<div class="rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3">
		<div class="flex items-center gap-2 mb-2">
			<svg class="w-3.5 h-3.5 text-cyan-400" fill="currentColor" viewBox="0 0 20 20"><path d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"/></svg>
			<span class="text-[11px] uppercase tracking-widest font-semibold text-cyan-300">Presets de deck</span>
			<Tooltip text="Remplace ton layout actuel par un ensemble de boutons pré-configurés. Tu peux ensuite ajuster chaque bouton avant d'enregistrer." variant="tip"/>
		</div>
		<div class="flex flex-wrap gap-1.5">
			<button type="button" onclick={() => applyPreset('starter')}
				class="text-[11px] bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-100 px-2.5 py-1 rounded transition-colors">
				🎮 Pack Démarrage
			</button>
			<button type="button" onclick={() => applyPreset('mod')}
				class="text-[11px] bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-100 px-2.5 py-1 rounded transition-colors">
				🛡️ Pack Modération
			</button>
			<button type="button" onclick={() => applyPreset('engage')}
				class="text-[11px] bg-cyan-500/10 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-100 px-2.5 py-1 rounded transition-colors">
				🔥 Pack Engagement
			</button>
		</div>
	</div>

	<!-- Pages : pill bar avec drag-to-reorder, rename inline, point couleur, suppr -->
	<div class="rounded-xl border border-indigo-500/30 bg-gradient-to-r from-indigo-950/30 via-slate-900/50 to-purple-950/30 p-2.5">
		<div class="flex items-center gap-2 mb-2">
			<svg class="w-3.5 h-3.5 text-indigo-300" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
				<rect x="3" y="3" width="7" height="7"/>
				<rect x="14" y="3" width="7" height="7"/>
				<rect x="3" y="14" width="7" height="7"/>
				<rect x="14" y="14" width="7" height="7"/>
			</svg>
			<span class="text-[11px] uppercase tracking-widest font-semibold text-indigo-200">Pages</span>
			<Tooltip text="Organise tes boutons en plusieurs écrans. Sur le téléphone, le streamer navigue via les pastilles en bas. Tu peux aussi créer un bouton d'action 'Naviguer' pour sauter entre pages." variant="tip"/>
			<div class="ml-auto flex items-center gap-1.5">
				<span class="text-[10px] text-slate-500 font-mono">{layout.pages.length}/8</span>
				<button type="button" onclick={addPage} disabled={layout.pages.length >= 8}
					class="text-[11px] bg-indigo-500/20 hover:bg-indigo-500/35 disabled:opacity-30 border border-indigo-500/50 text-indigo-100 px-2 py-0.5 rounded inline-flex items-center gap-1 transition-colors font-semibold">
					<span>+</span> Nouvelle page
				</button>
			</div>
		</div>
		<div class="flex items-center gap-1.5 flex-wrap">
			{#each layout.pages as p, i (p.id)}
				{@const active = p.id === currentPageId}
				{@const accent = p.color ? `--page-accent: ${p.color};` : '--page-accent: #818cf8;'}
				<div class="group relative inline-flex items-center gap-1 transition-all
						{active ? 'bg-gradient-to-br from-indigo-500/30 to-purple-500/20 border-indigo-400/70 shadow-lg shadow-indigo-500/20' : 'bg-slate-900/60 border-slate-700/60 hover:border-slate-600'}
						border rounded-lg pl-1.5 pr-1 py-0.5"
					style={accent}>
					<!-- Dot couleur de la page (cliquable = picker) -->
					<label class="relative cursor-pointer shrink-0" title="Choisir une couleur d'accent">
						<span class="block w-2.5 h-2.5 rounded-full ring-1 ring-white/20"
							style="background: var(--page-accent);"></span>
						<input type="color" value={p.color ?? '#818cf8'}
							oninput={(e) => setPageColor(p.id, e.currentTarget.value)}
							class="absolute inset-0 opacity-0 cursor-pointer w-full h-full"/>
					</label>
					{#if editingPageName === p.id}
						<input type="text" value={p.name} maxlength="40" autofocus
							oninput={(e) => renamePage(p.id, e.currentTarget.value)}
							onblur={() => editingPageName = null}
							onkeydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') editingPageName = null }}
							class="bg-slate-950/80 border border-indigo-500/40 rounded px-1.5 py-0.5 text-xs text-white outline-none w-24"/>
					{:else}
						<button type="button" onclick={() => selectPage(p.id)} ondblclick={() => editingPageName = p.id}
							class="text-xs font-semibold pl-0.5 pr-1 py-0.5 transition-colors {active ? 'text-white' : 'text-slate-300 hover:text-white'}"
							title="Cliquer pour ouvrir, double-cliquer pour renommer">
							{p.name}
						</button>
						<span class="text-[9px] font-mono text-slate-500 px-0.5">{p.buttons.length}</span>
					{/if}
					<!-- Actions de la page (rename / reorder / delete) — apparaissent au hover -->
					<div class="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 pl-0.5">
						<button type="button" onclick={() => editingPageName = p.id}
							class="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/60" title="Renommer">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
						</button>
						<button type="button" onclick={() => movePage(p.id, -1)} disabled={i === 0}
							class="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-20" title="Déplacer à gauche">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
						</button>
						<button type="button" onclick={() => movePage(p.id, 1)} disabled={i === layout.pages.length - 1}
							class="p-0.5 rounded text-slate-400 hover:text-white hover:bg-slate-700/60 disabled:opacity-20" title="Déplacer à droite">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
						</button>
						<button type="button" onclick={() => deletePage(p.id)} disabled={layout.pages.length <= 1}
							class="p-0.5 rounded text-slate-400 hover:text-rose-300 hover:bg-rose-900/40 disabled:opacity-20" title="Supprimer la page">
							<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6"/></svg>
						</button>
					</div>
				</div>
			{/each}
		</div>
	</div>

	<!-- Grille + Panel -->
	<div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">

		<!-- Grille WYSIWYG -->
		<div class="space-y-3">
			<div class="flex items-center justify-between gap-2 flex-wrap">
				<div class="flex items-center gap-1.5">
					<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Layout</span>
					<Tooltip text="Clique sur une case vide pour créer un bouton, ou sur un bouton existant pour l'éditer à droite." variant="tip"/>
					{#if currentPage}<span class="text-[10px] text-slate-500">— page <span class="text-indigo-300 font-semibold">{currentPage.name}</span></span>{/if}
				</div>
				<div class="flex items-center gap-2">
					<label class="flex items-center gap-1.5 text-[11px] text-slate-400">
						<span>Cols</span>
						<input type="number" min="1" max="8" value={layout.cols}
							oninput={(e) => setGridSize(layout.rows, Math.max(1, Math.min(8, parseInt(e.currentTarget.value) || layout.cols)))}
							class="w-12 rounded bg-slate-950 border border-slate-700/60 px-2 py-0.5 text-sm text-white outline-none focus:border-cyan-500/60"/>
					</label>
					<label class="flex items-center gap-1.5 text-[11px] text-slate-400">
						<span>Rows</span>
						<input type="number" min="1" max="8" value={layout.rows}
							oninput={(e) => setGridSize(Math.max(1, Math.min(8, parseInt(e.currentTarget.value) || layout.rows)), layout.cols)}
							class="w-12 rounded bg-slate-950 border border-slate-700/60 px-2 py-0.5 text-sm text-white outline-none focus:border-cyan-500/60"/>
					</label>
				</div>
			</div>

			<!-- Frame mobile mockup -->
			<div class="mx-auto" style="max-width: 480px;">
				<div class="rounded-[2.5rem] border-4 border-slate-700 bg-slate-950 p-2 shadow-2xl">
					<div class="rounded-[2rem] bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 aspect-[3/4] p-3 relative overflow-hidden">
						<!-- Notch décorative -->
						<div class="absolute top-0 left-1/2 -translate-x-1/2 w-20 h-4 bg-slate-700 rounded-b-2xl"></div>

						<div class="h-full pt-4 grid gap-1.5"
							style="grid-template-columns: repeat({layout.cols}, minmax(0, 1fr)); grid-template-rows: repeat({layout.rows}, minmax(0, 1fr));">

							<!-- Cellules de la grille (vide ou bouton) -->
							{#each Array(layout.rows * layout.cols) as _, idx (idx)}
								{@const cx = idx % layout.cols}
								{@const cy = Math.floor(idx / layout.cols)}
								{@const occupied = isCellOccupied(cx, cy, null)}
								{#if !occupied}
									<button type="button" onclick={() => onCellClick(cx, cy)}
										style="grid-column: {cx + 1}; grid-row: {cy + 1};"
										class="rounded-lg border border-dashed border-slate-700/60 hover:border-cyan-500/60 hover:bg-cyan-500/10 transition-colors flex items-center justify-center text-slate-700 hover:text-cyan-400 text-lg">
										+
									</button>
								{/if}
							{/each}

							<!-- Boutons configurés de la page courante -->
							{#each currentPage?.buttons ?? [] as b (b.id)}
								<button type="button" onclick={() => onCellClick(b.x, b.y)}
									style="grid-column: {b.x + 1} / span {b.w}; grid-row: {b.y + 1} / span {b.h};"
									class="relative rounded-lg shadow-lg border overflow-hidden transition-all active:scale-95
										{gradientBgClass(b.gradient)}
										{selectedId === b.id ? 'border-white ring-2 ring-cyan-400/80' : 'border-white/10'}">
									<div class="h-full flex flex-col items-center justify-center gap-0.5 p-1">
										<div class="leading-none drop-shadow-md" style="font-size: {1.5 * (b.iconScale ?? 1)}rem">{b.icon}</div>
										<div class="text-[9px] font-semibold text-white drop-shadow line-clamp-2">{b.label}</div>
									</div>
								</button>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Panel d'édition du bouton sélectionné -->
		<aside class="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3 space-y-3 lg:max-h-[80vh] lg:overflow-y-auto">
			{#if !selected}
				<div class="text-center py-8 text-xs text-slate-500 space-y-1">
					<div class="text-3xl mb-2">🎛️</div>
					<div>Aucun bouton sélectionné</div>
					<div class="text-[10px]">Clique sur une case vide pour ajouter un bouton, ou sur un bouton existant pour l'éditer.</div>
				</div>
			{:else}
				<div class="flex items-center justify-between gap-2">
					<span class="text-[11px] uppercase tracking-widest font-semibold text-cyan-300">Bouton</span>
					<button type="button" onclick={() => selected && removeButton(selected)}
						class="text-[10px] bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/40 text-rose-200 px-2 py-0.5 rounded transition-colors">
						Suppr
					</button>
				</div>

				<div>
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Label</span>
						<Tooltip text="Texte affiché sur le bouton. Court et clair (40 chars max)."/>
					</div>
					<input type="text" value={selected.label} oninput={(e) => updateSelected({ label: e.currentTarget.value.slice(0, 40) })}
						class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-2.5 py-1 text-sm text-white outline-none"/>
				</div>

				<div>
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Icône</span>
						<Tooltip text="Emoji affiché en gros sur le bouton. Clique sur un emoji du panel, ou tape directement le tien."/>
					</div>
					<input type="text" value={selected.icon} oninput={(e) => updateSelected({ icon: e.currentTarget.value.slice(0, 8) })}
						class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-2.5 py-1 text-lg text-white outline-none text-center"/>
					<div class="mt-1.5 grid grid-cols-9 gap-0.5">
						{#each EMOJI_PRESETS as e (e)}
							<button type="button" onclick={() => updateSelected({ icon: e })}
								class="aspect-square rounded text-base hover:bg-slate-800 transition-colors {selected.icon === e ? 'bg-cyan-500/20 ring-1 ring-cyan-500/50' : ''}">
								{e}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Couleur (gradient)</span>
						<Tooltip text="Palette de couleurs du bouton. Tu peux aussi taper un gradient custom dans le format hex/hex (ex: ff6b6b/4ecdc4)."/>
					</div>
					<div class="mt-1.5 grid grid-cols-4 gap-1.5">
						{#each GRADIENT_PRESETS as p (p.key)}
							<button type="button" onclick={() => updateSelected({ gradient: p.key })}
								title={p.label}
								class="h-8 rounded-md {p.bg} {selected.gradient === p.key ? 'ring-2 ring-white' : 'ring-1 ring-white/10'} transition-all">
							</button>
						{/each}
					</div>
				</div>

				<!-- Page : permet de déplacer le bouton vers une autre page sans le
					 recréer. Le bouton arrive dans la 1ère case libre de la page cible. -->
				{#if layout.pages.length > 1}
					<div>
						<div class="flex items-center gap-1.5">
							<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Page</span>
							<Tooltip text="Déplace ce bouton vers une autre page. Il se place automatiquement dans la première case libre."/>
						</div>
						<select value={currentPageId}
							onchange={(e) => moveSelectedToPage(e.currentTarget.value)}
							class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-2 py-1 text-xs text-white outline-none">
							{#each layout.pages as p (p.id)}
								{@const free = layout.rows * layout.cols - p.buttons.reduce((n, b) => n + b.w * b.h, 0)}
								<option value={p.id}>{p.name}{p.id === currentPageId ? ' (actuelle)' : ` — ${free} libre${free > 1 ? 's' : ''}`}</option>
							{/each}
						</select>
					</div>
				{/if}

				<!-- Position + taille : boutons disabled visuellement quand l'action est impossible
					 (bord de grille atteint, ou cellule voisine occupée). -->
				<div>
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Position et taille</span>
						<Tooltip text="Flèches pour déplacer, +/- pour redimensionner. Un bouton grisé signifie que l'action est bloquée (bord de grille ou cellule voisine occupée)."/>
					</div>
					<div class="mt-1.5 grid grid-cols-2 gap-2">
						<div class="rounded-md border border-slate-700/60 p-1.5">
							<div class="text-[9px] text-slate-500 mb-1 text-center">Déplacer</div>
							<div class="grid grid-cols-3 gap-0.5 text-center">
								<span></span>
								<button type="button" disabled={!canMove(0, -1)} onclick={() => moveSelected(0, -1)}
									title={canMove(0, -1) ? 'Vers le haut' : 'Bord supérieur ou case occupée'}
									class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-xs">↑</button>
								<span></span>
								<button type="button" disabled={!canMove(-1, 0)} onclick={() => moveSelected(-1, 0)}
									title={canMove(-1, 0) ? 'Vers la gauche' : 'Bord gauche ou case occupée'}
									class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-xs">←</button>
								<span class="text-[9px] text-slate-500 self-center">{selected.x},{selected.y}</span>
								<button type="button" disabled={!canMove(1, 0)} onclick={() => moveSelected(1, 0)}
									title={canMove(1, 0) ? 'Vers la droite' : 'Bord droit ou case occupée'}
									class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-xs">→</button>
								<span></span>
								<button type="button" disabled={!canMove(0, 1)} onclick={() => moveSelected(0, 1)}
									title={canMove(0, 1) ? 'Vers le bas' : 'Bord inférieur ou case occupée'}
									class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-xs">↓</button>
								<span></span>
							</div>
						</div>
						<div class="rounded-md border border-slate-700/60 p-1.5">
							<div class="text-[9px] text-slate-500 mb-1 text-center">Taille</div>
							<div class="grid grid-cols-2 gap-0.5">
								<div class="text-[9px] text-slate-500 text-center self-center">{selected.w} × {selected.h}</div>
								<div class="grid grid-cols-2 gap-0.5">
									<button type="button" disabled={!canResize(1, 0)} onclick={() => resizeSelected(1, 0)}
										title={canResize(1, 0) ? 'Agrandir en largeur' : 'Limite atteinte ou case voisine occupée'}
										class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-[10px]">+L</button>
									<button type="button" disabled={!canResize(-1, 0)} onclick={() => resizeSelected(-1, 0)}
										title={canResize(-1, 0) ? 'Réduire en largeur' : 'Largeur minimale atteinte'}
										class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-[10px]">-L</button>
									<button type="button" disabled={!canResize(0, 1)} onclick={() => resizeSelected(0, 1)}
										title={canResize(0, 1) ? 'Agrandir en hauteur' : 'Limite atteinte ou case voisine occupée'}
										class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-[10px]">+H</button>
									<button type="button" disabled={!canResize(0, -1)} onclick={() => resizeSelected(0, -1)}
										title={canResize(0, -1) ? 'Réduire en hauteur' : 'Hauteur minimale atteinte'}
										class="rounded bg-slate-800/60 hover:bg-slate-700 disabled:bg-slate-900/40 disabled:text-slate-700 disabled:cursor-not-allowed text-slate-300 px-1 py-0.5 text-[10px]">-H</button>
								</div>
							</div>
						</div>
					</div>
				</div>

				<!-- Taille de l'icône : slider 1× à 3× -->
				<div>
					<div class="flex items-center justify-between gap-1.5">
						<div class="flex items-center gap-1.5">
							<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Taille de l'icône</span>
							<Tooltip text="Multiplicateur appliqué à la taille par défaut de l'icône dans ce bouton. 1× = normal, 3× = très gros (idéal pour les emojis qu'on veut bien voir de loin)."/>
						</div>
						<span class="text-[10px] text-slate-400 font-mono">{(selected.iconScale ?? 1).toFixed(1)}×</span>
					</div>
					<input type="range" min="1" max="3" step="0.1" value={selected.iconScale ?? 1}
						oninput={(e) => updateSelected({ iconScale: parseFloat((e.target as HTMLInputElement).value) })}
						class="mt-1.5 w-full accent-cyan-500"/>
				</div>

				<!-- Action -->
				<div class="pt-2 border-t border-slate-700/60">
					<div class="flex items-center gap-1.5">
						<span class="text-[10px] uppercase tracking-wide font-semibold text-slate-400">Action</span>
						<Tooltip text="Ce qui se passe quand tu touches le bouton sur ton tel. Top Clips lance ton player, Marker pose un repère VOD, Message envoie un texte libre dans le chat, Commande déclenche une commande chat custom (!discord, !schedule, etc.)."/>
					</div>
					<select value={selected.action.type}
						onchange={(e) => updateAction({ type: e.currentTarget.value as ActionType })}
						class="mt-1 w-full rounded bg-slate-950 border border-slate-700/60 focus:border-cyan-500/60 px-2.5 py-1 text-xs text-white outline-none">
						<optgroup label="Stream">
							<option value="top_clips">🎬 Lancer Top Clips</option>
							<option value="vod_marker">📍 Placer un marker VOD</option>
						</optgroup>
						<optgroup label="Chat">
							<option value="chat_message">💬 Message chat libre</option>
							<option value="trigger_command">🤖 Déclencher commande chat</option>
						</optgroup>
						<optgroup label="Soundboard">
							<option value="play_audio">🎵 Jouer un son</option>
							<option value="stop_audio">⏹ Couper tous les sons</option>
							<option value="pause_audio">⏸ Mettre en pause</option>
						</optgroup>
						<optgroup label="Playlist (overlay OBS)">
							<option value="playlist_control">🎛 Contrôle playlist</option>
						</optgroup>
						<optgroup label="Navigation">
							<option value="navigate_page">📑 Aller à une page</option>
						</optgroup>
						<option value="noop">— Aucune (placeholder)</option>
					</select>

					{#if selected.action.type === 'top_clips'}
						<div class="mt-2 space-y-2">
							<label class="block">
								<span class="text-[9px] uppercase font-semibold text-slate-500">Overlay cible</span>
								<select value={selected.action.overlayId ?? ''}
									onchange={(e) => updateAction({ overlayId: e.currentTarget.value })}
									class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-cyan-500/60">
									<option value="">— Choisir un overlay clips_player —</option>
									{#each clipsOverlays as o (o.id)}
										<option value={o.id}>{o.label || `#${o.id.slice(0, 6)}`}</option>
									{/each}
								</select>
							</label>
							<div class="grid grid-cols-2 gap-2">
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-slate-500">Période</span>
									<select value={selected.action.period ?? '7d'}
										onchange={(e) => updateAction({ period: e.currentTarget.value as '7d' | '30d' | 'all' })}
										class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-cyan-500/60">
										<option value="7d">7 jours</option>
										<option value="30d">30 jours</option>
										<option value="all">Total</option>
									</select>
								</label>
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-slate-500">Nombre</span>
									<input type="number" min="1" max="20" value={selected.action.count ?? 5}
										oninput={(e) => updateAction({ count: Math.max(1, Math.min(20, parseInt(e.currentTarget.value) || 5)) })}
										class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-cyan-500/60"/>
								</label>
							</div>
						</div>
					{:else if selected.action.type === 'vod_marker'}
						<label class="block mt-2">
							<span class="text-[9px] uppercase font-semibold text-slate-500">Description (140 chars max)</span>
							<input type="text" value={selected.action.description ?? ''}
								oninput={(e) => updateAction({ description: e.currentTarget.value.slice(0, 140) })}
								placeholder="Highlight"
								class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-cyan-500/60"/>
						</label>
					{:else if selected.action.type === 'chat_message'}
						<label class="block mt-2">
							<span class="text-[9px] uppercase font-semibold text-slate-500">Texte (500 chars max)</span>
							<textarea rows="3" value={selected.action.text ?? ''}
								oninput={(e) => updateAction({ text: e.currentTarget.value.slice(0, 500) })}
								placeholder="Salut à tous !"
								class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-cyan-500/60 resize-none"></textarea>
						</label>
					{:else if selected.action.type === 'trigger_command'}
						<label class="block mt-2">
							<span class="text-[9px] uppercase font-semibold text-slate-500">Commande à déclencher</span>
							{#if customCommands.length > 0}
								<select value={selected.action.commandName ?? ''}
									onchange={(e) => updateAction({ commandName: e.currentTarget.value })}
									class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-cyan-500/60">
									<option value="">— Choisir une commande custom —</option>
									{#each customCommands as c (c.name)}
										<option value={c.name}>{c.name}</option>
									{/each}
								</select>
							{:else}
								<div class="mt-0.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
									Aucune commande custom. Crée-en dans le tab Bot Chat.
								</div>
							{/if}
						</label>
					{:else if selected.action.type === 'play_audio'}
						<!-- Soundboard picker : recherche + grille de vignettes -->
						<div class="mt-2 space-y-2">
							<div class="flex items-center gap-1.5">
								<span class="text-[9px] uppercase font-semibold text-slate-500">Son sélectionné</span>
								<Tooltip text="La piste sera jouée dans l'overlay Soundboard (browser source OBS). La lecture se fait côté stream, pas sur ton téléphone."/>
							</div>
							{#if selected.action.trackId && selected.action.trackTitle}
								<div class="flex items-center gap-2 bg-gradient-to-r from-purple-500/15 to-indigo-500/10 border border-purple-500/40 rounded px-2 py-1.5">
									<span class="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0"></span>
									<div class="text-xs font-medium text-purple-100 truncate flex-1 min-w-0">{selected.action.trackTitle}</div>
									<button type="button" onclick={() => updateAction({ trackId: undefined, trackTitle: undefined })}
										class="text-[10px] text-slate-400 hover:text-rose-300" title="Désélectionner">✕</button>
								</div>
							{/if}
							<div class="relative">
								<svg class="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
									<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
								</svg>
								<input type="search" bind:value={audioPickerQuery} placeholder="Chercher dans le soundboard"
									class="w-full bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 pl-7 pr-2 py-1 text-xs text-white placeholder-slate-600 outline-none rounded"/>
							</div>
							{#if audioTracksLoading}
								<div class="text-[10px] text-slate-500 text-center py-2">Chargement de la bibliothèque…</div>
							{:else if audioTracks.length === 0}
								<div class="text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
									Bibliothèque vide. Upload des sons dans le tab Soundboard.
								</div>
							{:else}
								<div class="max-h-56 overflow-y-auto space-y-1 pr-0.5">
									{#each audioTracksFiltered as t (t.id)}
										{@const isSel = selected.action.trackId === t.id}
										<button type="button" onclick={() => pickAudioTrack(t)}
											class="w-full flex items-center gap-2 text-left p-1.5 rounded border transition-colors
												{isSel ? 'bg-purple-500/20 border-purple-500/60' : 'bg-slate-900/60 border-slate-800 hover:border-purple-500/40 hover:bg-purple-500/10'}">
											<div class="w-8 h-8 bg-slate-950 border border-slate-700/60 rounded overflow-hidden grid place-items-center shrink-0">
												{#if t.thumbnailUrl}
													<img src={audioPickerThumb(t)} alt="" class="w-full h-full object-cover" loading="lazy"/>
												{:else}
													<svg class="w-3 h-3 text-slate-600" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
														<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
													</svg>
												{/if}
											</div>
											<div class="flex-1 min-w-0">
												<div class="text-xs font-medium text-white truncate">{t.title}</div>
												<div class="text-[10px] text-slate-500 truncate">{t.artist ?? '—'}</div>
											</div>
											{#if t.durationMs}
												<div class="text-[10px] font-mono text-slate-500 shrink-0">{fmtDuration(t.durationMs)}</div>
											{/if}
										</button>
									{/each}
									{#if audioTracksFiltered.length === 0}
										<div class="text-[10px] text-slate-500 text-center py-2">Aucun résultat</div>
									{/if}
								</div>
							{/if}
						</div>
					{:else if selected.action.type === 'stop_audio'}
						<div class="mt-2 text-[10px] text-slate-400 bg-slate-900/40 border border-slate-700/60 rounded px-2 py-1.5 leading-snug">
							Coupe immédiatement la lecture en cours dans l'overlay Soundboard (avec fade-out si configuré sur la piste).
						</div>
					{:else if selected.action.type === 'pause_audio'}
						<div class="mt-2 text-[10px] text-slate-400 bg-slate-900/40 border border-slate-700/60 rounded px-2 py-1.5 leading-snug">
							Met en pause la piste en cours. Ré-appuyer sur le bouton Jouer la reprend.
						</div>
					{:else if selected.action.type === 'playlist_control'}
						<!-- Picker commande playlist : pilote l'overlay OBS via socket.
						     Seul 'play' nécessite une playlist cible (switch). Le reste
						     agit sur la playlist en cours. -->
						<div class="mt-2 space-y-2">
							<div class="flex items-center gap-1.5">
								<span class="text-[9px] uppercase font-semibold text-slate-500">Commande</span>
								<Tooltip text="play = démarre / switche sur une playlist précise. toggle = bascule lecture / pause. skip/prev = changer de piste. stop = arrête et remet à zéro. volume = ajuste le volume de l'overlay."/>
							</div>
							<select value={selected.action.cmd ?? 'toggle'}
								onchange={(e) => updateAction({ cmd: e.currentTarget.value as 'play' | 'pause' | 'toggle' | 'skip' | 'prev' | 'stop' | 'volume' })}
								class="w-full rounded bg-slate-950 border border-slate-700/60 focus:border-purple-500/60 px-2 py-1 text-xs text-white outline-none">
								<option value="play">▶ Démarrer une playlist (switch)</option>
								<option value="toggle">⏯ Play / Pause (toggle)</option>
								<option value="pause">⏸ Pause</option>
								<option value="skip">⏭ Suivant</option>
								<option value="prev">⏮ Précédent</option>
								<option value="stop">⏹ Stop + reset</option>
								<option value="volume">🔊 Ajuster le volume</option>
							</select>

							{#if selected.action.cmd === 'play'}
								<label class="block">
									<span class="text-[9px] uppercase font-semibold text-slate-500">Playlist à démarrer</span>
									{#if playlistsList.length > 0}
										<select value={selected.action.playlistId ?? ''}
											onchange={(e) => updateAction({ playlistId: e.currentTarget.value || undefined })}
											class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-purple-500/60">
											<option value="">— Choisir une playlist —</option>
											{#each playlistsList as p (p.id)}
												<option value={p.id}>{p.name} ({p.trackCount})</option>
											{/each}
										</select>
									{:else}
										<div class="mt-0.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1.5">
											Aucune playlist. Crée-en dans le tab Soundboard.
										</div>
									{/if}
								</label>
							{:else if selected.action.cmd === 'volume'}
								<div class="grid grid-cols-2 gap-2">
									<label class="block">
										<span class="text-[9px] uppercase font-semibold text-slate-500">Mode</span>
										<select value={selected.action.volumeMode ?? 'delta'}
											onchange={(e) => updateAction({ volumeMode: e.currentTarget.value as 'delta' | 'absolute' })}
											class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-purple-500/60">
											<option value="delta">Relatif (+/-)</option>
											<option value="absolute">Absolu (0-100%)</option>
										</select>
									</label>
									<label class="block">
										<span class="text-[9px] uppercase font-semibold text-slate-500">Valeur</span>
										<input type="number" step="0.05" min={selected.action.volumeMode === 'absolute' ? 0 : -1} max="1"
											value={selected.action.volumeValue ?? (selected.action.volumeMode === 'absolute' ? 0.6 : 0.05)}
											oninput={(e) => updateAction({ volumeValue: Math.max(-1, Math.min(1, parseFloat(e.currentTarget.value) || 0)) })}
											class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-purple-500/60"/>
									</label>
								</div>
								<div class="text-[10px] text-slate-500 leading-snug">
									Ex : <span class="text-slate-300 font-mono">delta +0.05</span> = bouton « Volume +5% », <span class="text-slate-300 font-mono">absolu 0.0</span> = mute.
								</div>
							{:else}
								<div class="text-[10px] text-slate-400 bg-slate-900/40 border border-slate-700/60 rounded px-2 py-1.5 leading-snug">
									Cette commande agit sur l'overlay playlist actuellement actif dans OBS.
								</div>
							{/if}
						</div>
					{:else if selected.action.type === 'navigate_page'}
						<div class="mt-2 space-y-2">
							<div class="flex items-center gap-1.5">
								<span class="text-[9px] uppercase font-semibold text-slate-500">Cible</span>
								<Tooltip text="Saute vers une page précise, ou utilise un mouvement relatif (suivante / précédente / accueil)."/>
							</div>
							<div class="grid grid-cols-3 gap-1 bg-slate-900/60 border border-slate-800 p-0.5 rounded">
								{#each (['home', 'prev', 'next'] as const) as j (j)}
									{@const isSel = selected.action.pageJump === j && !selected.action.targetPageId}
									<button type="button" onclick={() => updateAction({ pageJump: j, targetPageId: undefined })}
										class="text-[10px] px-2 py-1 rounded transition-colors {isSel ? 'bg-indigo-500/30 text-indigo-100' : 'text-slate-400 hover:text-white'}">
										{j === 'home' ? '⌂ Accueil' : j === 'prev' ? '← Préc.' : 'Suiv. →'}
									</button>
								{/each}
							</div>
							<div>
								<span class="text-[9px] uppercase font-semibold text-slate-500">ou page précise</span>
								<select value={selected.action.targetPageId ?? ''}
									onchange={(e) => updateAction({ targetPageId: e.currentTarget.value || undefined, pageJump: e.currentTarget.value ? undefined : selected.action.pageJump })}
									class="mt-0.5 w-full rounded bg-slate-950 border border-slate-700/60 px-2 py-1 text-xs text-white outline-none focus:border-indigo-500/60">
									<option value="">— Choisir une page —</option>
									{#each layout.pages.filter(p => p.id !== currentPageId) as p (p.id)}
										<option value={p.id}>{p.name}</option>
									{/each}
								</select>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</aside>
	</div>
</div>
