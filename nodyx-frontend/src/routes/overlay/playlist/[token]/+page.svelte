<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import { PUBLIC_API_URL } from '$env/static/public'

	// ─── Overlay Playlist (OBS browser source) ──────────────────────────────
	// Lit une playlist du streamer en autoplay loop pour servir de musique
	// de fond ou d'ambiance sur une scène OBS. Une URL par playlist, à coller
	// dans une Browser Source.
	//
	// URL :
	//   /overlay/playlist/<token>?id=<playlistId>[&shuffle=1][&ui=mini|hidden][&volume=0-1]
	//
	// Le token est le token d'overlay "playlist" du streamer (un seul par
	// streamer, partagé entre toutes ses playlists). La playlist ciblée est
	// passée en query : on peut donc avoir 5 Browser Sources OBS (une par
	// scène) qui pointent toutes vers le même token avec des id différents.
	//
	// Pas de socket ici : c'est de la lecture en boucle, le streamer édite
	// la playlist côté admin et l'overlay reflète au prochain cycle (ou au
	// prochain refresh OBS s'il est impatient).

	interface Track {
		id:            string
		title:         string
		artist:        string | null
		thumbnailUrl:  string | null
		fileUrl:       string
		mimeType:      string
		durationMs:    number | null
		volumeDefault: number
		fadeInMs:      number
		fadeOutMs:     number
		loop:          boolean
	}

	interface Playlist {
		id:          string
		name:        string
		description: string | null
		color:       string | null
	}

	type UiMode = 'mini' | 'hidden'

	const token = $derived(page.params.token ?? '')

	// Lecture sûre des query params : page.url peut être stale en SSR, on
	// lit côté client uniquement.
	let playlistId = $state('')
	let shuffle    = $state(false)
	let ui         = $state<UiMode>('mini')
	let volume     = $state(0.6)

	let status     = $state<'loading' | 'ready' | 'empty' | 'invalid' | 'error'>('loading')
	let playlist   = $state<Playlist | null>(null)
	let tracks     = $state<Track[]>([])
	let order      = $state<number[]>([])      // ordre courant (indices dans `tracks`)
	let cursor     = $state(0)                 // position dans `order`
	let progressMs = $state(0)
	let durationMs = $state(0)
	let needsClick = $state(false)             // autoplay bloqué par browser policy
	let lastError  = $state<string | null>(null)

	// État réactif pour l'OSD : on met à jour le current à chaque changement
	// de cursor pour que la carte affiche le bon titre.
	const current = $derived<Track | null>(
		tracks.length > 0 && order.length > 0 ? tracks[order[cursor]] ?? null : null,
	)

	let audioEl: HTMLAudioElement | null = null
	let progressTimer: ReturnType<typeof setInterval> | null = null
	let refreshTimer:  ReturnType<typeof setInterval> | null = null
	let socket: { disconnect: () => void } | null = null
	let paused = $state(false)

	// Toast OSD éphémère affiché en haut au reçu d'une commande Deck (skip,
	// pause, volume...). Confirme visuellement la prise en compte côté streamer
	// sans polluer la scène longtemps.
	let cmdToast = $state<string | null>(null)
	let cmdToastTimer: ReturnType<typeof setTimeout> | null = null
	function flashCmd(text: string): void {
		cmdToast = text
		if (cmdToastTimer) clearTimeout(cmdToastTimer)
		cmdToastTimer = setTimeout(() => { cmdToast = null }, 1800)
	}

	function absoluteUrl(rel: string): string {
		if (!rel) return ''
		if (rel.startsWith('http')) return rel
		const base = PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '')
		return `${base}${rel}`
	}

	function fmtTime(ms: number): string {
		const total = Math.max(0, Math.round(ms / 1000))
		const m = Math.floor(total / 60)
		const s = total % 60
		return `${m}:${s.toString().padStart(2, '0')}`
	}

	// Mélange Fisher-Yates des indices [0..n-1].
	function shuffleOrder(n: number): number[] {
		const arr = Array.from({ length: n }, (_, i) => i)
		for (let i = arr.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1))
			;[arr[i], arr[j]] = [arr[j], arr[i]]
		}
		return arr
	}

	function rebuildOrder(): void {
		const n = tracks.length
		if (n === 0) { order = []; cursor = 0; return }
		order = shuffle ? shuffleOrder(n) : Array.from({ length: n }, (_, i) => i)
		cursor = 0
	}

	async function load(): Promise<void> {
		if (!token || !playlistId) { status = 'invalid'; return }
		try {
			const res = await fetch(
				`${PUBLIC_API_URL}/api/v1/streamer/overlay/playlist/${token}/${playlistId}`,
			)
			if (res.status === 404) { status = 'invalid'; return }
			if (!res.ok) { status = 'error'; return }
			const data = await res.json() as { ok: boolean; playlist: Playlist; tracks: Track[] }
			playlist = data.playlist
			tracks   = data.tracks ?? []
			if (tracks.length === 0) { status = 'empty'; return }
			rebuildOrder()
			status = 'ready'
		} catch {
			status = 'error'
		}
	}

	// Lance la lecture du track à la position `cursor` dans `order`.
	function playCurrent(): void {
		if (!browser || !audioEl || !current) return
		try {
			audioEl.src    = absoluteUrl(current.fileUrl)
			audioEl.volume = effectiveVolume()
			audioEl.loop   = false      // on enchaîne nous-mêmes (loop playlist != loop track)
			paused = false
			const p = audioEl.play()
			if (p && typeof p.catch === 'function') {
				p.catch(() => { needsClick = true })
			}
		} catch {
			needsClick = true
		}
	}

	function effectiveVolume(): number {
		const v = volume * (current?.volumeDefault ?? 1)
		return Math.max(0, Math.min(1, v))
	}

	function applyVolume(): void {
		if (audioEl) audioEl.volume = effectiveVolume()
	}

	function advance(): void {
		if (order.length === 0) return
		cursor = (cursor + 1) % order.length
		// Au tour suivant, si shuffle, on rebrasse pour éviter de retomber
		// toujours sur le même premier élément en repassant à 0.
		if (cursor === 0 && shuffle) order = shuffleOrder(tracks.length)
		playCurrent()
	}

	function onEnded(): void { advance() }

	function onTimeUpdate(): void {
		if (!audioEl) return
		progressMs = Math.floor(audioEl.currentTime * 1000)
		durationMs = Math.floor((audioEl.duration || 0) * 1000)
	}

	function onError(): void {
		// On skip le track fautif après un court délai pour éviter une boucle
		// serrée si tous les fichiers sont KO.
		lastError = current?.title ?? 'erreur lecture'
		setTimeout(advance, 800)
	}

	// Déclenche la première lecture après un click utilisateur (preview OBS).
	function startFromClick(): void {
		needsClick = false
		playCurrent()
	}

	onMount(() => {
		if (!browser) return
		// Parse query
		const params = page.url.searchParams
		playlistId = params.get('id') ?? ''
		shuffle    = params.get('shuffle') === '1' || params.get('shuffle') === 'true'
		const uiQ  = params.get('ui')
		if (uiQ === 'hidden' || uiQ === 'mini') ui = uiQ
		const volQ = Number(params.get('volume'))
		if (Number.isFinite(volQ) && volQ >= 0 && volQ <= 1) volume = volQ

		audioEl = new Audio()
		audioEl.preload = 'auto'
		audioEl.crossOrigin = 'anonymous'
		audioEl.addEventListener('ended', onEnded)
		audioEl.addEventListener('timeupdate', onTimeUpdate)
		audioEl.addEventListener('error', onError)

		// Watchdog : si le track n'a pas avancé depuis 3s ET pas en pause →
		// on force advance pour éviter un freeze sur un fichier corrompu.
		progressTimer = setInterval(() => {
			if (!audioEl || audioEl.paused) return
			// rien à faire ici en V1, on laisse onTimeUpdate gérer
		}, 500)

		// Refresh des tracks toutes les 60s : permet au streamer d'ajouter/
		// retirer un son sans redémarrer l'overlay OBS. On garde le cursor
		// courant si le track joué existe encore (par id), sinon on relance.
		refreshTimer = setInterval(async () => {
			if (status !== 'ready' || !playlistId) return
			const playingId = current?.id ?? null
			const prevIds = tracks.map(t => t.id).join(',')
			await load()
			if (status !== 'ready') return
			const newIds = tracks.map(t => t.id).join(',')
			if (newIds === prevIds) return       // pas de changement, on laisse jouer
			// Si le track en cours est toujours là, on positionne le cursor dessus
			// sans interrompre la lecture. Sinon on enchaîne sur le suivant.
			const idx = playingId ? tracks.findIndex(t => t.id === playingId) : -1
			if (idx >= 0) {
				const newCursor = order.indexOf(idx) >= 0 ? order.indexOf(idx) : 0
				cursor = newCursor
			} else {
				advance()
			}
		}, 60_000)

		load().then(() => {
			if (status === 'ready') playCurrent()
		})

		// Socket /overlay : reçoit les commandes émises par le Stream Deck quand
		// le streamer presse un bouton 'playlist_control'. La même connexion sert
		// à tous les overlays playlist du streamer (room playlist:<owner>), donc
		// si plusieurs Browser Sources OBS pointent ici, elles reçoivent toutes
		// la commande en parallèle (comportement voulu : OBS coupe l'audio des
		// sources cachées, mais les états restent cohérents au switch de scène).
		void openSocket()
	})

	async function openSocket(): Promise<void> {
		try {
			const { io } = await import('socket.io-client')
			const s = io(`${PUBLIC_API_URL}/overlay`, {
				auth:       { token },
				transports: ['polling', 'websocket'],
				path:       '/socket.io/',
			})
			s.on('playlist:control', (payload: {
				cmd:         'play' | 'pause' | 'toggle' | 'skip' | 'prev' | 'stop' | 'volume'
				playlistId?: string
				volumeMode?: 'delta' | 'absolute'
				volumeValue?: number
			}) => { void handleControl(payload) })
			socket = s
		} catch {
			// pas de socket = pas grave, l'overlay continue à jouer en autoplay
			// loop sans pouvoir être piloté à distance.
		}
	}

	async function handleControl(p: {
		cmd:         'play' | 'pause' | 'toggle' | 'skip' | 'prev' | 'stop' | 'volume'
		playlistId?: string
		volumeMode?: 'delta' | 'absolute'
		volumeValue?: number
	}): Promise<void> {
		if (!audioEl) return
		switch (p.cmd) {
			case 'play': {
				if (p.playlistId && p.playlistId !== playlistId) {
					// Switch sur une autre playlist : reload + autoplay
					playlistId = p.playlistId
					await load()
					if (status === 'ready') playCurrent()
					flashCmd(`▶ ${playlist?.name ?? 'Playlist'}`)
				} else if (audioEl.paused) {
					audioEl.play().catch(() => {})
					paused = false
					flashCmd('▶ Reprise')
				} else if (status !== 'ready') {
					// Pas de track joué (overlay venait juste d'être ouvert sans
					// autoplay), on relance.
					playCurrent()
					flashCmd('▶ Lecture')
				}
				break
			}
			case 'pause': {
				audioEl.pause()
				paused = true
				flashCmd('⏸ Pause')
				break
			}
			case 'toggle': {
				if (audioEl.paused) {
					audioEl.play().catch(() => {})
					paused = false
					flashCmd('▶ Reprise')
				} else {
					audioEl.pause()
					paused = true
					flashCmd('⏸ Pause')
				}
				break
			}
			case 'skip': {
				advance()
				flashCmd('⏭ Suivant')
				break
			}
			case 'prev': {
				if (order.length === 0) break
				cursor = (cursor - 1 + order.length) % order.length
				playCurrent()
				flashCmd('⏮ Précédent')
				break
			}
			case 'stop': {
				audioEl.pause()
				audioEl.currentTime = 0
				cursor = 0
				paused = true
				flashCmd('⏹ Stop')
				break
			}
			case 'volume': {
				const val = Number.isFinite(p.volumeValue) ? Number(p.volumeValue) : 0
				if (p.volumeMode === 'absolute') {
					volume = Math.max(0, Math.min(1, val))
				} else {
					volume = Math.max(0, Math.min(1, volume + val))
				}
				applyVolume()
				flashCmd(`🔊 ${Math.round(volume * 100)}%`)
				break
			}
		}
	}

	onDestroy(() => {
		if (progressTimer)  clearInterval(progressTimer)
		if (refreshTimer)   clearInterval(refreshTimer)
		if (cmdToastTimer)  clearTimeout(cmdToastTimer)
		if (socket) { socket.disconnect(); socket = null }
		if (audioEl) {
			audioEl.removeEventListener('ended', onEnded)
			audioEl.removeEventListener('timeupdate', onTimeUpdate)
			audioEl.removeEventListener('error', onError)
			audioEl.pause()
			audioEl.src = ''
			audioEl = null
		}
	})

	const pct = $derived(durationMs > 0 ? Math.min(100, (progressMs / durationMs) * 100) : 0)
	const accent = $derived(playlist?.color ?? '#a78bfa')
</script>

<svelte:head>
	<title>{playlist?.name ?? 'Playlist'} — Overlay</title>
	<style>
		html, body { background: transparent !important; margin: 0; padding: 0; }
	</style>
</svelte:head>

{#if cmdToast}
	<!-- Toast Deck : commande prise en compte, affiché 1.8s. Bandeau haut-droite
	     pour ne pas se confondre avec l'OSD courante bas-droite. -->
	<div class="fixed top-3 right-3 px-3 py-1.5 rounded-md bg-purple-950/85 backdrop-blur-md border border-purple-500/60 text-purple-100 text-xs font-medium shadow-2xl pointer-events-none">
		{cmdToast}
	</div>
{/if}

{#if needsClick}
	<!-- Preview : OBS autorise l'autoplay, mais en navigateur il faut un click.
	     On affiche une bannière cliquable seulement quand l'autoplay a échoué. -->
	<button type="button" onclick={startFromClick}
		class="fixed inset-0 grid place-items-center bg-black/40 backdrop-blur-sm cursor-pointer">
		<div class="px-5 py-3 rounded-lg bg-zinc-900/90 border border-zinc-700 text-zinc-100 text-sm font-medium shadow-2xl">
			▶ Cliquer pour démarrer
		</div>
	</button>
{/if}

{#if status === 'invalid'}
	<div class="fixed top-3 left-3 px-3 py-1.5 rounded-md bg-rose-950/85 border border-rose-700 text-rose-100 text-xs font-medium">
		Lien d'overlay invalide ou playlist supprimée.
	</div>
{:else if status === 'error'}
	<div class="fixed top-3 left-3 px-3 py-1.5 rounded-md bg-rose-950/85 border border-rose-700 text-rose-100 text-xs font-medium">
		Erreur de chargement.
	</div>
{:else if status === 'empty'}
	<div class="fixed top-3 left-3 px-3 py-1.5 rounded-md bg-amber-950/85 border border-amber-700 text-amber-100 text-xs font-medium">
		Playlist vide. Ajoute des sons depuis l'admin.
	</div>
{:else if status === 'ready' && current && ui === 'mini'}
	<!-- OSD minimaliste, bas-droite, transparent : adapté à une Browser Source
	     OBS de 360x90 (recommandé). On ne dessine rien d'autre pour ne pas
	     polluer la scène. -->
	<div class="fixed bottom-3 right-3 flex items-center gap-3 px-3 py-2 rounded-lg
		bg-zinc-950/80 backdrop-blur-md border border-zinc-800/80 shadow-2xl
		text-zinc-100 max-w-[360px]"
		style="border-left: 3px solid {accent};">
		<!-- Pochette -->
		<div class="w-11 h-11 rounded bg-zinc-950 border border-zinc-800 overflow-hidden shrink-0 grid place-items-center">
			{#if current.thumbnailUrl}
				<img src={absoluteUrl(current.thumbnailUrl)} alt="" class="w-full h-full object-cover"/>
			{:else}
				<svg class="w-4 h-4 text-zinc-600" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
					<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
				</svg>
			{/if}
		</div>
		<!-- Texte + barre -->
		<div class="min-w-0 flex-1">
			<div class="flex items-baseline gap-2 mb-0.5">
				<span class="text-[9px] uppercase tracking-widest font-bold" style="color: {accent};">{paused ? '⏸' : '▶'} {playlist?.name ?? ''}</span>
			</div>
			<div class="text-sm font-medium truncate" title={current.title}>{current.title}</div>
			<div class="text-[11px] text-zinc-400 truncate flex items-center gap-1.5">
				<span class="truncate">{current.artist ?? '—'}</span>
				<span class="text-zinc-600 font-mono shrink-0">· {fmtTime(progressMs)} / {fmtTime(durationMs)}</span>
			</div>
			<!-- Barre de progression -->
			<div class="mt-1 h-0.5 bg-zinc-800 rounded-full overflow-hidden">
				<div class="h-full transition-[width] duration-200" style="width: {pct}%; background: {accent};"></div>
			</div>
		</div>
	</div>
{/if}
