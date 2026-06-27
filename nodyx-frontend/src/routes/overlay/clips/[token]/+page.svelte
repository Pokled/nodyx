<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { page } from '$app/stores'
	import { browser } from '$app/environment'
	import { PUBLIC_API_URL } from '$env/static/public'
	import { fade } from 'svelte/transition'

	// Clips Player overlay : invisible jusqu'au trigger admin POST /play-clips.
	//
	// Architecture lecture : on EXTRAIT l'URL .mp4 directe depuis le pattern
	// de la thumbnail Twitch (clips-media-assets2.twitch.tv/FOO-preview-WxH.jpg
	// → clips-media-assets2.twitch.tv/FOO.mp4) puis on utilise un <video> natif
	// avec autoplay. Plus fiable que l'iframe embed (Twitch SDK ne supporte
	// pas les clips, et l'iframe statique se fait bloquer par Chrome autoplay
	// policy). Bonus : on a un vrai contrôle (play/pause/ended event).

	const token = $derived(($page.params as { token: string }).token)

	type Clip = {
		id:           string
		embedUrl:     string
		title:        string
		creatorName:  string
		duration:     number
		thumbnailUrl: string
		viewCount:    number
		mp4Url?:      string | null    // URL mp4 signée via GraphQL backend
	}

	// OBS Browser Source autorise nativement l'autoplay (CEF avec --autoplay-policy
	// =no-user-gesture-required). Pas besoin du gate. On le détecte via le user-
	// agent pour bypass automatiquement.
	const isOBS = browser && /OBS\/|obs-browser/i.test(navigator.userAgent)

	let status        = $state<'loading' | 'idle' | 'playing' | 'invalid' | 'error'>('loading')
	let queue         = $state<Clip[]>([])
	let currentIdx    = $state(0)
	let userActivated = $state(isOBS)         // pre-activated dans OBS
	let pageVisible   = $state(true)            // sera mis à jour via visibilitychange
	let mountKey      = $state(0)               // bump pour forcer remount iframe
	let videoEl:        HTMLVideoElement | null = $state(null)
	let socket: { disconnect: () => void } | null = null
	let advanceTimer: ReturnType<typeof setTimeout> | null = null

	const current = $derived<Clip | null>(status === 'playing' && queue[currentIdx] ? queue[currentIdx] : null)

	// Extract mp4 URL from the thumbnail URL pattern Twitch utilise pour ses clips.
	// Marche pour clips-media-assets.twitch.tv et clips-media-assets2.twitch.tv.
	// Si le pattern ne matche pas (cas rare), on tombera en fallback iframe.
	// L'URL mp4 vient maintenant du backend (extraction GraphQL côté serveur,
	// résolu juste avant le dispatch socket). Si null, on fallback iframe.
	const currentMp4 = $derived<string | null>(current?.mp4Url ?? null)

	async function bootstrap(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/lookup/${token}`)
			if (!res.ok) { status = 'invalid'; return }
			const data = await res.json() as { ok: boolean; overlay: { overlayType: string } }
			if (!data.ok || data.overlay.overlayType !== 'clips_player') { status = 'invalid'; return }
			status = 'idle'
			openSocket()
		} catch {
			status = 'error'
		}
	}

	async function openSocket(): Promise<void> {
		const { io } = await import('socket.io-client')
		const s = io(`${PUBLIC_API_URL}/overlay`, {
			auth:       { token },
			transports: ['polling', 'websocket'],
			path:       '/socket.io/',
		})
		s.on('clips:play', (data: { clips: Clip[] }) => {
			if (!data.clips || data.clips.length === 0) return
			if (advanceTimer) clearTimeout(advanceTimer)
			queue      = data.clips
			currentIdx = 0
			status     = 'playing'
		})
		s.on('clips:stop', () => stopAll())
		socket = s
	}

	function advanceNext(): void {
		if (advanceTimer) clearTimeout(advanceTimer); advanceTimer = null
		if (currentIdx + 1 >= queue.length) {
			stopAll()
		} else {
			currentIdx += 1
		}
	}

	function stopAll(): void {
		if (advanceTimer) clearTimeout(advanceTimer); advanceTimer = null
		if (videoEl) { try { videoEl.pause() } catch { /* ignore */ } }
		queue      = []
		currentIdx = 0
		status     = 'idle'
	}

	// Quand current change, on attend que le <video> soit monté puis on appelle
	// .play() manuellement. autoplay attribute marche dans la majorité des cas
	// mais l'appel explicite est un backup pour les contextes serrés (Safari,
	// CEF OBS sans permissions, etc).
	$effect(() => {
		const v = videoEl
		const c = current
		if (v && c && userActivated) {
			// Reset le video element sur new clip (force reload du src)
			v.load()
			const playPromise = v.play()
			if (playPromise && typeof playPromise.catch === 'function') {
				playPromise.catch(err => console.warn('[clips] video.play() rejected:', err.message))
			}
			// Fallback advance timer si l'event 'ended' ne firet pas (clip corrompu, etc).
			if (advanceTimer) clearTimeout(advanceTimer)
			const ms = Math.max(3, c.duration + 1) * 1000
			advanceTimer = setTimeout(advanceNext, ms)
		}
	})

	function handleVisibilityChange(): void {
		const visible = document.visibilityState === 'visible'
		console.log('[clips] visibility →', document.visibilityState)
		if (visible && !pageVisible && status === 'playing') {
			// L'onglet revient au premier plan pendant qu'un clip était en cours :
			// l'iframe Twitch a probablement refusé l'autoplay au mount (page
			// hidden). On force un remount en bumpant la key, ce qui re-déclenche
			// le check autoplay avec visibilityState='visible'.
			console.log('[clips] tab became visible during playback → remount iframe')
			mountKey += 1
		}
		pageVisible = visible
	}

	onMount(() => {
		if (!browser) return
		bootstrap()
		document.addEventListener('visibilitychange', handleVisibilityChange)
		pageVisible = document.visibilityState === 'visible'
	})
	onDestroy(() => {
		if (advanceTimer) clearTimeout(advanceTimer)
		if (socket)       socket.disconnect()
		if (browser)      document.removeEventListener('visibilitychange', handleVisibilityChange)
	})

	function fmtNumber(n: number): string {
		if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
		if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}k`
		return n.toString()
	}
</script>

<svelte:head>
	<title>Overlay clips player</title>
	<style>
		html, body {
			background: transparent !important;
			margin: 0; padding: 0; overflow: hidden; height: 100vh;
		}
	</style>
</svelte:head>

<div class="overlay-root">
	{#if status === 'invalid'}
		<div class="status-msg status-error" transition:fade>Overlay invalide ou révoquée.</div>
	{:else if status === 'error'}
		<div class="status-msg status-error" transition:fade>Connexion Nodyx impossible.</div>
	{:else if !userActivated && (status === 'idle' || status === 'playing')}
		<button type="button" onclick={() => userActivated = true} class="activation-gate">
			<svg class="play-icon" fill="currentColor" viewBox="0 0 20 20"><path d="M6.3 2.84a1 1 0 011.04.06l9 6a1 1 0 010 1.66l-9 6A1 1 0 016 16V4a1 1 0 01.3-.84z"/></svg>
			<div class="gate-text">
				<div class="gate-title">Activer l'overlay clips</div>
				<div class="gate-sub">Clique une fois pour autoriser l'autoplay des clips Twitch. Dans OBS, coche "Control audio via OBS" dans les propriétés du Browser Source — l'autoplay marchera direct sans ce gate.</div>
			</div>
		</button>
	{:else if status === 'playing' && current && userActivated}
		<div class="player">
			{#key `${current.id}-${mountKey}`}
				{#if currentMp4}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						bind:this={videoEl}
						src={currentMp4}
						class="video"
						autoplay
						playsinline
						onended={advanceNext}
						onerror={() => { console.warn('[clips] video error, advancing'); advanceNext() }}
					></video>
				{:else}
					<!-- Fallback iframe pour les clips dont la thumbnail ne match pas le pattern mp4 -->
					<iframe
						src="{current.embedUrl}&parent={browser ? window.location.hostname : ''}&autoplay=true&muted=false"
						title={current.title}
						class="video"
						allow="autoplay; fullscreen"
						allowfullscreen
					></iframe>
				{/if}
			{/key}
			<div class="overlay-info">
				<div class="counter">Clip {currentIdx + 1} / {queue.length}</div>
				<div class="title">{current.title}</div>
				<div class="meta">par {current.creatorName} · {fmtNumber(current.viewCount)} vues</div>
			</div>
			{#if !pageVisible}
				<div class="visibility-warning">
					Onglet en arrière-plan : Twitch bloque l'autoplay. Reviens sur cet onglet pour démarrer, OU teste depuis OBS Browser Source (autoplay y marche).
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.overlay-root {
		position: fixed;
		inset: 0;
		font-family: 'Geist', -apple-system, system-ui, sans-serif;
		/* pointer-events: none ferait échouer le check autoplay de Twitch
		   (qui considère un iframe non-interactif comme "hidden"). On le
		   réserve aux zones non-cliquables uniquement. */
	}

	.activation-gate {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 16px;
		background: linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(8, 12, 26, 0.94));
		color: #fff;
		border: none;
		cursor: pointer;
		pointer-events: auto;
		font-family: inherit;
		padding: 32px;
	}
	.activation-gate:hover { background: linear-gradient(135deg, rgba(15, 23, 42, 0.86), rgba(8, 12, 26, 0.86)); }
	.play-icon { width: 48px; height: 48px; color: var(--nx-cyan); opacity: 0.95; }
	.gate-text { text-align: center; max-width: 480px; }
	.gate-title { font-size: 20px; font-weight: 700; margin-bottom: 6px; color: #fff; }
	.gate-sub { font-size: 13px; color: #94a3b8; line-height: 1.5; }

	.player {
		position: absolute;
		inset: 0;
		background: rgba(0, 0, 0, 0.92);
		visibility: visible;
		opacity: 1;
		display: block;
	}

	.video {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		object-fit: contain;
		background: #000;
		border: 0;
		display: block;
		visibility: visible;
		opacity: 1;
	}

	.visibility-warning {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		padding: 8px 16px;
		border-radius: 8px;
		background: rgba(244, 63, 94, 0.92);
		color: #fff;
		font-size: 13px;
		font-weight: 600;
		text-align: center;
		max-width: 480px;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		pointer-events: none;
	}

	.overlay-info {
		position: absolute;
		bottom: 24px;
		left: 24px;
		right: 24px;
		padding: 12px 16px;
		background: linear-gradient(90deg, rgba(0, 0, 0, 0.75), rgba(0, 0, 0, 0.45));
		border-left: 3px solid var(--nx-cyan);
		border-radius: 6px;
		backdrop-filter: blur(8px);
		color: #f1f5f9;
		max-width: 800px;
		pointer-events: none;
	}

	.counter {
		font-size: 11px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: var(--nx-cyan);
		margin-bottom: 4px;
	}

	.title {
		font-size: 18px;
		font-weight: 700;
		line-height: 1.2;
		text-shadow: 0 2px 8px rgba(0, 0, 0, 0.7);
	}

	.meta {
		font-size: 12px;
		color: #94a3b8;
		margin-top: 2px;
	}

	.status-msg {
		position: absolute;
		top: 12px;
		left: 12px;
		padding: 6px 12px;
		border-radius: 8px;
		font-size: 12px;
		font-weight: 500;
	}
	.status-error {
		background: rgba(239, 68, 68, 0.15);
		color: #fca5a5;
		border: 1px solid rgba(239, 68, 68, 0.4);
	}
</style>
