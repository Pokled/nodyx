<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import { PUBLIC_API_URL } from '$env/static/public'

	// ─── Overlay Soundboard (OBS browser source) ────────────────────────────
	// Reçoit les events audio:play/stop/pause depuis le socket /overlay (room
	// soundboard:<ownerUserId>, jointe automatiquement à l'auth si le token
	// correspond à un overlay de type 'soundboard').
	//
	// Player : Web Audio API. Un seul son à la fois, cross-fade rapide quand
	// un nouveau play arrive pendant qu'un autre joue. Fade-in/out paramétrés
	// par piste (depuis la lib audio backend).
	//
	// OSD : carte translucide vignette + titre + artiste + barre de progression,
	// positionnable via config overlay (top-left/top-right/bottom-left/bottom-right/hidden).

	type OsdPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'hidden'

	interface SoundboardConfig {
		osdPosition:   OsdPosition
		osdDurationMs: number   // 0 = persistant tant que le son joue
		masterVolume:  number
	}

	interface AudioPlayPayload {
		trackId:      string
		fileUrl:      string
		mimeType:     string
		title:        string
		artist:       string | null
		thumbnailUrl: string | null
		durationMs:   number | null
		volume:       number
		fadeInMs:     number
		fadeOutMs:    number
		loop:         boolean
	}

	const DEFAULT_CONFIG: SoundboardConfig = {
		osdPosition:   'bottom-right',
		osdDurationMs: 0,
		masterVolume:  1.0,
	}

	const token = $derived(page.params.token ?? '')

	let status   = $state<'loading' | 'ready' | 'invalid' | 'error'>('loading')
	let config   = $state<SoundboardConfig>(DEFAULT_CONFIG)
	let socket: { disconnect: () => void } | null = null

	// Badge "Soundboard prêt" affiché 6s au boot, puis disparaît pour ne pas
	// polluer le stream. Permet de confirmer en preview que la connexion socket
	// est OK, sans gêner en prod OBS.
	let showReadyBadge = $state(false)
	let readyBadgeTimer: ReturnType<typeof setTimeout> | null = null

	// État du player : la piste en cours d'affichage (pour l'OSD) + progress.
	let nowPlaying = $state<AudioPlayPayload | null>(null)
	let progressMs = $state(0)
	let progressTimer: ReturnType<typeof setInterval> | null = null
	let osdHideTimer: ReturnType<typeof setTimeout> | null = null

	// Web Audio internals — pas réactif (manipulé impérativement).
	let audioCtx: AudioContext | null = null
	type ActiveSource = {
		source:   AudioBufferSourceNode | MediaElementAudioSourceNode
		gain:     GainNode
		el:       HTMLAudioElement | null    // si on passe par <audio> stream
		trackId:  string
		startedAt: number                    // performance.now() au démarrage
	}
	let currentActive: ActiveSource | null = null

	function mergeConfig(raw: Record<string, unknown>): SoundboardConfig {
		const positions: OsdPosition[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'hidden']
		const pos = positions.includes(raw.osdPosition as OsdPosition) ? raw.osdPosition as OsdPosition : DEFAULT_CONFIG.osdPosition
		const dur = Number.isFinite(Number(raw.osdDurationMs))
			? Math.max(0, Math.min(30_000, Math.floor(Number(raw.osdDurationMs))))
			: DEFAULT_CONFIG.osdDurationMs
		const vol = Number.isFinite(Number(raw.masterVolume))
			? Math.max(0, Math.min(1.5, Number(raw.masterVolume)))
			: DEFAULT_CONFIG.masterVolume
		return { osdPosition: pos, osdDurationMs: dur, masterVolume: vol }
	}

	function absoluteUrl(relOrAbs: string): string {
		if (!relOrAbs) return ''
		if (relOrAbs.startsWith('http')) return relOrAbs
		const base = PUBLIC_API_URL.replace(/\/api\/v1\/?$/, '')
		return `${base}${relOrAbs}`
	}

	async function bootstrap(): Promise<void> {
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/overlay/lookup/${token}`)
			if (!res.ok) { status = 'invalid'; return }
			const data = await res.json() as {
				ok: boolean
				overlay: { overlayType: string; config: Record<string, unknown> }
			}
			if (!data.ok || data.overlay.overlayType !== 'soundboard') { status = 'invalid'; return }
			config = mergeConfig(data.overlay.config)
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
		s.on('connect',                () => { status = 'ready'; armReadyBadge() })
		s.on('connect_error',          () => { status = 'invalid' })
		s.on('overlay:ready',          () => { status = 'ready'; armReadyBadge() })
		s.on('overlay:config-updated', (data: { config: Record<string, unknown> }) => {
			config = mergeConfig(data.config)
		})
		s.on('audio:play',  (payload: AudioPlayPayload) => { void handlePlay(payload) })
		s.on('audio:stop',  () => { void handleStop() })
		s.on('audio:pause', () => { void handlePause() })
		socket = s
	}

	// Émis vers le backend quand un son finit naturellement (pas loop, pas
	// stoppé manuellement) → le backend pop le suivant de la queue et émet un
	// nouveau audio:play. Auto-chaînage des sons demandés par les viewers.
	type AnySocket = { emit: (event: string, ...args: unknown[]) => unknown } | null
	function notifyEnded(): void {
		const s = socket as AnySocket
		if (s && typeof s.emit === 'function') s.emit('audio:ended')
	}

	// ── Player ──────────────────────────────────────────────────────────────

	function ensureCtx(): AudioContext {
		if (!audioCtx) {
			const Ctor = (window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)
			audioCtx = new Ctor()
		}
		// Resume si suspendu (autoplay policy navigateur). OBS Browser Source
		// est généralement OK (gestures permis dans le wrapper), mais on fait
		// la résume défensivement à chaque play.
		if (audioCtx.state === 'suspended') void audioCtx.resume()
		return audioCtx
	}

	async function fadeGain(gain: GainNode, fromValue: number, toValue: number, durationMs: number): Promise<void> {
		if (!audioCtx) return
		const now = audioCtx.currentTime
		const dur = Math.max(0.001, durationMs / 1000)
		gain.gain.cancelScheduledValues(now)
		gain.gain.setValueAtTime(fromValue, now)
		gain.gain.linearRampToValueAtTime(toValue, now + dur)
		await new Promise(resolve => setTimeout(resolve, durationMs))
	}

	async function stopCurrent(fadeOutMs: number): Promise<void> {
		const active = currentActive
		if (!active) return
		currentActive = null
		try {
			await fadeGain(active.gain, active.gain.gain.value, 0, Math.max(0, fadeOutMs))
		} catch { /* ignore */ }
		try {
			if (active.el) { active.el.pause(); active.el.src = '' }
			else if ('stop' in active.source) (active.source as AudioBufferSourceNode).stop()
		} catch { /* ignore */ }
		try { active.gain.disconnect() } catch { /* ignore */ }
	}

	async function handlePlay(payload: AudioPlayPayload): Promise<void> {
		const ctx = ensureCtx()

		// Cross-fade : on lance le nouveau pendant que l'ancien fade-out.
		const previous = currentActive
		const crossFadeMs = previous ? Math.max(150, Math.min(payload.fadeInMs || 0, 400)) : 0

		// On utilise un HTMLAudioElement pour streamer (évite de tout charger en
		// buffer ; bien pour les WAV de plusieurs MB). Puis on le branche dans
		// le graph Web Audio pour gérer le fade + master volume précisément.
		const el = new Audio()
		el.crossOrigin = 'anonymous'
		el.src = absoluteUrl(payload.fileUrl)
		el.loop = !!payload.loop
		// Pas de muted/autoplay : on contrôle le démarrage manuellement après
		// que ctx soit resume.

		const source = ctx.createMediaElementSource(el)
		const gain   = ctx.createGain()
		gain.gain.value = 0
		source.connect(gain).connect(ctx.destination)

		try {
			await el.play()
		} catch (err) {
			console.warn('[soundboard-overlay] play failed (autoplay policy ?)', err)
			try { gain.disconnect() } catch { /* ignore */ }
			return
		}

		const trackVol = Math.max(0, Math.min(2, payload.volume))
		const masterVol = Math.max(0, Math.min(1.5, config.masterVolume))
		const targetGain = trackVol * masterVol

		currentActive = {
			source,
			gain,
			el,
			trackId:   payload.trackId,
			startedAt: performance.now(),
		}

		nowPlaying = payload
		progressMs = 0
		startProgressTimer()
		armOsdHideTimer(payload)

		// Cross-fade out de l'ancien en parallèle si présent.
		if (previous) {
			fadeGain(previous.gain, previous.gain.gain.value, 0, crossFadeMs).then(() => {
				try { if (previous.el) { previous.el.pause(); previous.el.src = '' } } catch { /* ignore */ }
				try { previous.gain.disconnect() } catch { /* ignore */ }
			})
		}

		// Fade-in jusqu'au target.
		await fadeGain(gain, 0, targetGain, Math.max(0, payload.fadeInMs))

		// Quand l'audio finit naturellement (si pas en loop), on cleanup l'OSD
		// ET on signale au backend qu'il peut enchaîner sur la queue.
		el.onended = () => {
			if (currentActive?.trackId === payload.trackId && !payload.loop) {
				nowPlaying = null
				stopProgressTimer()
				currentActive = null
				notifyEnded()
			}
		}
	}

	async function handleStop(): Promise<void> {
		const fadeMs = nowPlaying?.fadeOutMs ?? 300
		await stopCurrent(fadeMs)
		nowPlaying = null
		stopProgressTimer()
	}

	async function handlePause(): Promise<void> {
		const active = currentActive
		if (!active?.el) return
		try {
			await fadeGain(active.gain, active.gain.gain.value, 0, 200)
			active.el.pause()
		} catch { /* ignore */ }
		stopProgressTimer()
	}

	// ── Progress + OSD timers ───────────────────────────────────────────────

	function startProgressTimer(): void {
		stopProgressTimer()
		progressTimer = setInterval(() => {
			const active = currentActive
			if (!active) { stopProgressTimer(); return }
			progressMs = performance.now() - active.startedAt
		}, 200)
	}

	function stopProgressTimer(): void {
		if (progressTimer) { clearInterval(progressTimer); progressTimer = null }
	}

	function armReadyBadge(): void {
		if (showReadyBadge) return  // déjà affiché : pas de re-trigger en cas de reconnect
		showReadyBadge = true
		if (readyBadgeTimer) clearTimeout(readyBadgeTimer)
		readyBadgeTimer = setTimeout(() => { showReadyBadge = false }, 6_000)
	}

	function armOsdHideTimer(payload: AudioPlayPayload): void {
		if (osdHideTimer) { clearTimeout(osdHideTimer); osdHideTimer = null }
		// osdDurationMs = 0 → l'OSD reste visible tant que le son joue. Loop
		// ou son long sans durée connue : on garde l'OSD jusqu'au stop.
		if (config.osdDurationMs > 0 && !payload.loop) {
			osdHideTimer = setTimeout(() => { nowPlaying = null }, config.osdDurationMs)
		}
	}

	// ── Lifecycle ───────────────────────────────────────────────────────────

	onMount(() => { if (browser) bootstrap() })
	onDestroy(() => {
		if (socket) socket.disconnect()
		stopProgressTimer()
		if (osdHideTimer) clearTimeout(osdHideTimer)
		if (readyBadgeTimer) clearTimeout(readyBadgeTimer)
		void stopCurrent(0)
		if (audioCtx) { void audioCtx.close().catch(() => {}); audioCtx = null }
	})

	// ── Affichage ───────────────────────────────────────────────────────────

	const osdClass = $derived(
		config.osdPosition === 'top-left'     ? 'top-6 left-6' :
		config.osdPosition === 'top-right'    ? 'top-6 right-6' :
		config.osdPosition === 'bottom-left'  ? 'bottom-6 left-6' :
		config.osdPosition === 'bottom-right' ? 'bottom-6 right-6' :
		'hidden'
	)

	const progressPct = $derived(
		nowPlaying?.durationMs && nowPlaying.durationMs > 0
			? Math.min(100, (progressMs / nowPlaying.durationMs) * 100)
			: 0
	)

	function fmtTime(ms: number): string {
		const total = Math.max(0, Math.round(ms / 1000))
		const m = Math.floor(total / 60)
		const s = total % 60
		return `${m}:${s.toString().padStart(2, '0')}`
	}
</script>

<svelte:head>
	<title>Nodyx Soundboard Overlay</title>
	<meta name="viewport" content="width=device-width, initial-scale=1"/>
</svelte:head>

<!-- Fond transparent pour OBS browser source : aucun élément ne doit avoir de
     fond opaque sauf l'OSD lui-même. -->
<div class="fixed inset-0 pointer-events-none">
	{#if status === 'invalid'}
		<div class="absolute top-4 left-4 px-3 py-2 bg-rose-950/90 text-rose-100 text-xs rounded border border-rose-500/60 pointer-events-auto">
			Overlay Soundboard : token invalide ou révoqué.
		</div>
	{:else if status === 'error'}
		<div class="absolute top-4 left-4 px-3 py-2 bg-amber-950/90 text-amber-100 text-xs rounded border border-amber-500/60 pointer-events-auto">
			Connexion impossible. Vérifie le réseau OBS.
		</div>
	{:else if status === 'ready' && showReadyBadge && !nowPlaying}
		<!-- Badge éphémère au boot pour confirmer la connexion en preview navigateur.
		     Disparaît après 6s pour ne pas polluer le stream en prod OBS. -->
		<div class="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-950/85 backdrop-blur-md border border-emerald-500/50 rounded-full shadow-2xl flex items-center gap-2 text-xs pointer-events-none animate-fade-out">
			<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
			<span class="text-zinc-100 font-medium">Soundboard prêt</span>
			<span class="text-zinc-500">— appuie sur un bouton 🎵 de ton Stream Deck</span>
		</div>
	{/if}
	{#if nowPlaying && config.osdPosition !== 'hidden'}
		<!-- OSD : carte qui pop avec la piste en cours -->
		<div class="absolute {osdClass} w-[320px] max-w-[80vw] bg-zinc-950/85 backdrop-blur-md border border-purple-500/40 rounded-lg shadow-2xl overflow-hidden ring-1 ring-white/5">
			<div class="flex items-center gap-3 p-3">
				<div class="w-12 h-12 rounded bg-zinc-900 border border-zinc-800 overflow-hidden grid place-items-center shrink-0">
					{#if nowPlaying.thumbnailUrl}
						<img src={absoluteUrl(nowPlaying.thumbnailUrl)} alt="" class="w-full h-full object-cover"/>
					{:else}
						<svg class="w-5 h-5 text-purple-300" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
							<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
						</svg>
					{/if}
				</div>
				<div class="flex-1 min-w-0">
					<div class="text-sm font-semibold text-white truncate" title={nowPlaying.title}>{nowPlaying.title}</div>
					<div class="text-[11px] text-zinc-400 truncate">{nowPlaying.artist ?? '—'}</div>
				</div>
				<div class="text-[10px] font-mono text-zinc-500 shrink-0">
					{fmtTime(progressMs)}{nowPlaying.durationMs ? ` / ${fmtTime(nowPlaying.durationMs)}` : ''}
				</div>
			</div>
			<div class="h-1 bg-zinc-900">
				<div class="h-full bg-gradient-to-r from-purple-500 to-indigo-400 transition-[width] duration-200"
					style="width: {progressPct}%;"></div>
			</div>
		</div>
	{/if}
</div>

<style>
	:global(html), :global(body) { background: transparent !important; margin: 0; }

	/* Le badge "prêt" fade-out doucement les 2 dernières secondes des 6s
	   d'affichage pour pas disparaître brutalement. */
	.animate-fade-out {
		animation: fadeOut 6s ease-in-out forwards;
	}
	@keyframes fadeOut {
		0%, 66%   { opacity: 1; }
		100%      { opacity: 0; }
	}
</style>
