<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { page } from '$app/state'
	import { PUBLIC_API_URL } from '$env/static/public'

	// Screen Wake Lock API : empêche l'écran de s'éteindre pendant que le deck
	// est ouvert. Standard W3C, supportée par Chrome Android, Safari iOS 16.4+,
	// Edge, etc. Pas de polling, pas de hack vidéo : l'OS gère, conso quasi
	// nulle (juste l'écran allumé). Auto-released sur background, on re-demande
	// au foreground via visibilitychange.
	interface WakeLockSentinelLike {
		released: boolean
		release:  () => Promise<void>
		addEventListener: (type: 'release', listener: () => void) => void
	}
	interface WakeLockApi {
		request: (type: 'screen') => Promise<WakeLockSentinelLike>
	}

	// Nodyx Deck — page mobile-first qui s'ouvre via une URL token-auth.
	// Plein écran sans scroll, boutons tactiles avec gradient + haptic.

	type ActionType =
		| 'noop' | 'top_clips' | 'vod_marker' | 'chat_message' | 'trigger_command'
		| 'play_audio' | 'stop_audio' | 'pause_audio' | 'navigate_page'

	interface DeckAction {
		type:          ActionType
		trackTitle?:   string
		targetPageId?: string
		pageJump?:     'next' | 'prev' | 'home'
	}

	interface DeckButton {
		id:         string
		x:          number
		y:          number
		w:          number
		h:          number
		label:      string
		icon:       string
		iconScale?: number   // 1.0 = défaut
		gradient:   string
		action:     DeckAction
	}

	interface DeckPage {
		id:      string
		name:    string
		color?:  string
		buttons: DeckButton[]
	}

	interface DeckLayout {
		rows:    number
		cols:    number
		pages:   DeckPage[]
	}

	interface Deck {
		id:     string
		label:  string
		layout: DeckLayout
	}

	let status   = $state<'loading' | 'invalid' | 'ready' | 'error'>('loading')
	let deck     = $state<Deck | null>(null)
	let pressing = $state<string | null>(null)
	let toast    = $state<{ text: string; ok: boolean } | null>(null)
	let toastT: ReturnType<typeof setTimeout> | null = null
	let currentPageId = $state<string>('')

	const currentPage = $derived<DeckPage | null>(
		deck ? (deck.layout.pages.find(p => p.id === currentPageId) ?? deck.layout.pages[0] ?? null) : null
	)

	// Wake Lock state
	let wakeLockSentinel: WakeLockSentinelLike | null = null
	let wakeLockSupported = $state(false)
	let wakeLockActive    = $state(false)
	let wakeLockUserOff   = $state(false)   // user a explicitement désactivé

	// Plein écran : masque la barre d'URL du navigateur. Marche sur Android/desktop
	// (Fullscreen API). iOS ne le supporte pas pour une page : on s'appuie sur
	// "Ajouter à l'écran d'accueil" (meta plus bas) pour un vrai mode app.
	let fullscreenSupported = $state(false)
	let isFullscreen        = $state(false)

	// ── Affichage : modes (boutons / chat / mixte) + chat Twitch embed ─────────
	// Mono-écran : le streamer peut garder son chat sous les yeux sur le Deck.
	type DeckMode = 'buttons' | 'chat' | 'mixed'
	let mode          = $state<DeckMode>('buttons')
	let splitRatio    = $state(0.55)        // part de l'espace donnée aux BOUTONS (0.2 à 0.8)
	let twitchChannel = $state<string | null>(null)
	let dragging      = $state(false)
	let splitBox  = $state<HTMLElement | null>(null) // conteneur du mode mixte (pour le drag)

	const token = $derived(page.params.token ?? '')

	// URL du chat Twitch embed. parent = domaine courant (marche pour nodyx.org
	// comme pour n'importe quelle instance auto-hébergée). darkpopout = thème sombre.
	const chatEmbedUrl = $derived(
		browser && twitchChannel
			? `https://www.twitch.tv/embed/${encodeURIComponent(twitchChannel)}/chat?parent=${location.hostname}&darkpopout`
			: null
	)

	async function bootstrap(): Promise<void> {
		if (!token) { status = 'invalid'; return }
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/deck/lookup/${token}`)
			if (!res.ok) { status = 'invalid'; return }
			const data = await res.json() as { ok: boolean; deck: Deck; twitchChannel?: string | null }
			deck          = data.deck
			twitchChannel = data.twitchChannel ?? null
			// Backwards-compat : si le backend renvoie encore l'ancien format flat,
			// on wrap dans une page unique pour ne pas planter.
			if (!Array.isArray(deck.layout.pages) || deck.layout.pages.length === 0) {
				const legacy = (deck.layout as unknown as { buttons?: DeckButton[] }).buttons ?? []
				deck.layout.pages = [{ id: 'p1', name: 'Principal', buttons: legacy }]
			}
			currentPageId = deck.layout.pages[0].id
			status        = 'ready'
		} catch {
			status = 'error'
		}
	}

	function flash(text: string, ok: boolean): void {
		toast = { text, ok }
		if (toastT) clearTimeout(toastT)
		toastT = setTimeout(() => { toast = null }, 2800)
	}

	function vibrate(ms: number | number[]): void {
		if (!browser) return
		const n = navigator as Navigator & { vibrate?: (ms: number | number[]) => boolean }
		if (typeof n.vibrate === 'function') n.vibrate(ms)
	}

	function navigateRelative(jump: 'next' | 'prev' | 'home'): void {
		if (!deck) return
		const pages = deck.layout.pages
		if (pages.length <= 1) return
		const i = pages.findIndex(p => p.id === currentPageId)
		if (jump === 'home')      currentPageId = pages[0].id
		else if (jump === 'prev') currentPageId = pages[(i - 1 + pages.length) % pages.length].id
		else                       currentPageId = pages[(i + 1) % pages.length].id
	}

	async function press(b: DeckButton): Promise<void> {
		if (pressing) return
		// navigate_page : pur client, pas de round-trip.
		if (b.action.type === 'navigate_page') {
			vibrate(15)
			if (b.action.targetPageId && deck?.layout.pages.some(p => p.id === b.action.targetPageId)) {
				currentPageId = b.action.targetPageId
			} else if (b.action.pageJump) {
				navigateRelative(b.action.pageJump)
			}
			return
		}
		pressing = b.id
		vibrate(20)
		try {
			const res = await fetch(`${PUBLIC_API_URL}/api/v1/streamer/deck/${token}/action`, {
				method:  'POST',
				headers: { 'Content-Type': 'application/json' },
				body:    JSON.stringify({ buttonId: b.id }),
			})
			const data = await res.json().catch(() => ({})) as { ok?: boolean; message?: string }
			flash(data.message ?? (data.ok ? 'OK' : 'Échec'), !!data.ok)
			if (data.ok) vibrate([30, 40, 30])
		} catch {
			flash('Erreur réseau', false)
		} finally {
			pressing = null
		}
	}

	// ── Gradient resolution ─────────────────────────────────────────────────
	// Les presets sont mappés vers des classes Tailwind. Le format custom
	// "from/to" en hex est rendu via style inline.

	function gradientStyle(g: string): { class: string; style: string } {
		// Preset connu
		const presets: Record<string, string> = {
			cyber:   'bg-gradient-to-br from-cyan-500 to-indigo-700',
			neon:    'bg-gradient-to-br from-pink-500 to-violet-700',
			inferno: 'bg-gradient-to-br from-orange-400 to-red-700',
			forest:  'bg-gradient-to-br from-emerald-400 to-teal-700',
			minimal: 'bg-gradient-to-br from-slate-700 to-slate-900',
			sunset:  'bg-gradient-to-br from-amber-400 to-rose-600',
			ocean:   'bg-gradient-to-br from-sky-400 to-blue-800',
			amber:   'bg-gradient-to-br from-amber-300 to-orange-600',
		}
		if (presets[g]) return { class: presets[g], style: '' }
		// Custom hex/hex
		const m = g.match(/^#?([a-f0-9]{6})\/#?([a-f0-9]{6})$/i)
		if (m) return { class: '', style: `background-image: linear-gradient(135deg, #${m[1]}, #${m[2]});` }
		return { class: presets.cyber, style: '' }
	}

	async function requestWakeLock(): Promise<void> {
		if (!browser || wakeLockUserOff) return
		const nav = navigator as Navigator & { wakeLock?: WakeLockApi }
		if (!nav.wakeLock) return
		try {
			wakeLockSentinel = await nav.wakeLock.request('screen')
			wakeLockActive = true
			wakeLockSentinel.addEventListener('release', () => {
				wakeLockActive = false
				wakeLockSentinel = null
			})
		} catch (err) {
			console.warn('[deck] wakeLock request failed', err)
		}
	}

	async function releaseWakeLock(): Promise<void> {
		if (!wakeLockSentinel) return
		try { await wakeLockSentinel.release() } catch { /* ignore */ }
		wakeLockSentinel = null
		wakeLockActive = false
	}

	async function toggleWakeLock(): Promise<void> {
		if (wakeLockActive) {
			wakeLockUserOff = true
			await releaseWakeLock()
			flash('Écran libre (peut s\'éteindre)', true)
		} else {
			wakeLockUserOff = false
			await requestWakeLock()
			flash(wakeLockActive ? 'Écran maintenu allumé' : 'Wake Lock indisponible', wakeLockActive)
		}
	}

	function handleVisibilityChange(): void {
		// L'OS release automatiquement le wakeLock quand la page passe en
		// background. Au retour, on le re-demande (sauf si l'user l'a coupé).
		if (!browser) return
		if (document.visibilityState === 'visible' && !wakeLockActive && !wakeLockUserOff) {
			requestWakeLock()
		}
	}

	// ── Plein écran ───────────────────────────────────────────────────────────
	function onFsChange(): void {
		if (browser) isFullscreen = !!document.fullscreenElement
	}
	async function toggleFullscreen(): Promise<void> {
		if (!browser) return
		vibrate(15)
		try {
			if (document.fullscreenElement) await document.exitFullscreen()
			else await document.documentElement.requestFullscreen()
		} catch (e) {
			console.warn('[deck] fullscreen indisponible', e)
		}
	}

	// ── Modes + persistance (par deck) ────────────────────────────────────────
	function lsKey(suffix: string): string { return `deck:${token}:${suffix}` }

	function setMode(m: DeckMode): void {
		mode = m
		if (browser) { try { localStorage.setItem(lsKey('mode'), m) } catch { /* quota / private mode */ } }
	}

	function persistRatio(): void {
		if (browser) { try { localStorage.setItem(lsKey('ratio'), String(splitRatio)) } catch { /* ignore */ } }
	}

	// ── Drag du séparateur en mode mixte ──────────────────────────────────────
	// Split vertical en portrait (boutons haut / chat bas), horizontal en paysage
	// (boutons gauche / chat droite). Le ratio est borné 20%-80% et mémorisé.
	function startDrag(e: PointerEvent): void {
		dragging = true
		e.preventDefault()
		;(e.currentTarget as Element).setPointerCapture?.(e.pointerId)
	}
	function onDrag(e: PointerEvent): void {
		if (!dragging || !splitBox) return
		const r = splitBox.getBoundingClientRect()
		// L'axe se déduit des dimensions réelles du conteneur (toujours justes,
		// quelle que soit l'orientation), pas d'une détection JS fragile.
		const frac = r.width > r.height
			? (e.clientX - r.left) / r.width
			: (e.clientY - r.top) / r.height
		splitRatio = Math.min(0.8, Math.max(0.2, frac))
	}
	function endDrag(): void {
		if (!dragging) return
		dragging = false
		persistRatio()
	}

	onMount(() => {
		bootstrap()
		if (!browser) return
		const nav = navigator as Navigator & { wakeLock?: WakeLockApi }
		wakeLockSupported = !!nav.wakeLock
		if (wakeLockSupported) {
			requestWakeLock()
			document.addEventListener('visibilitychange', handleVisibilityChange)
		}
		fullscreenSupported = !!document.fullscreenEnabled
		document.addEventListener('fullscreenchange', onFsChange)
		// Restaure le mode + le ratio choisis sur cet appareil.
		try {
			const m = localStorage.getItem(lsKey('mode'))
			if (m === 'buttons' || m === 'chat' || m === 'mixed') mode = m
			const r = parseFloat(localStorage.getItem(lsKey('ratio')) ?? '')
			if (!Number.isNaN(r)) splitRatio = Math.min(0.8, Math.max(0.2, r))
		} catch { /* ignore */ }
		// L'orientation du split est gérée en CSS (variantes landscape:), pas en JS :
		// instantané et fiable sur mobile, sans souci de timing d'event.
	})

	onDestroy(() => {
		if (browser) {
			document.removeEventListener('visibilitychange', handleVisibilityChange)
			document.removeEventListener('fullscreenchange', onFsChange)
		}
		releaseWakeLock()
	})
</script>

<svelte:head>
	<title>{deck?.label ?? 'Nodyx Deck'}</title>
	<meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no, viewport-fit=cover"/>
	<meta name="theme-color" content="#0f172a"/>
	<!-- "Ajouter à l'écran d'accueil" lance le Deck sans barre d'URL (iOS + Android) -->
	<meta name="mobile-web-app-capable" content="yes"/>
	<meta name="apple-mobile-web-app-capable" content="yes"/>
	<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>
</svelte:head>

<div class="fixed inset-0 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white overflow-hidden select-none touch-manipulation">

	{#if status === 'loading'}
		<div class="h-full grid place-items-center">
			<div class="flex flex-col items-center gap-3">
				<div class="w-8 h-8 border-2 border-cyan-500/30 border-t-cyan-400 rounded-full animate-spin"></div>
				<div class="text-xs text-slate-400">Chargement du deck…</div>
			</div>
		</div>
	{:else if status === 'invalid'}
		<div class="h-full grid place-items-center px-6">
			<div class="text-center space-y-2">
				<div class="text-rose-400 text-4xl">🔒</div>
				<div class="text-sm text-rose-200">Token invalide ou révoqué.</div>
				<div class="text-[11px] text-slate-500">Demande un nouveau lien au streamer.</div>
			</div>
		</div>
	{:else if status === 'error'}
		<div class="h-full grid place-items-center px-6">
			<div class="text-center space-y-2">
				<div class="text-amber-400 text-4xl">⚠️</div>
				<div class="text-sm text-amber-200">Impossible de se connecter au serveur.</div>
				<button onclick={bootstrap} type="button"
					class="mt-2 text-xs bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-100 px-4 py-1.5 rounded">
					Réessayer
				</button>
			</div>
		</div>
	{:else if deck}
		<!-- Header discret -->
		<header class="absolute top-0 inset-x-0 px-3 py-1.5 flex items-center justify-between gap-2 text-[10px] z-20">
			<span class="font-mono text-slate-500 uppercase tracking-widest pointer-events-none truncate shrink min-w-0 hidden sm:inline">{deck.label}</span>
			<!-- Sélecteur de mode : Boutons / Mixte / Chat -->
			<div class="flex items-center gap-0.5 bg-slate-800/70 rounded-lg p-0.5 shrink-0">
				<button type="button" onclick={() => setMode('buttons')}
					class="px-2 py-0.5 rounded transition-colors {mode === 'buttons' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}">Boutons</button>
				<button type="button" onclick={() => setMode('mixed')}
					class="px-2 py-0.5 rounded transition-colors {mode === 'mixed' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}">Mixte</button>
				<button type="button" onclick={() => setMode('chat')}
					class="px-2 py-0.5 rounded transition-colors {mode === 'chat' ? 'bg-cyan-600 text-white' : 'text-slate-400 hover:text-white'}">Chat</button>
			</div>
			<div class="flex items-center gap-3 shrink-0">
				{#if fullscreenSupported}
					<button type="button" onclick={toggleFullscreen}
						class="text-slate-500 hover:text-cyan-300 transition-colors"
						aria-label={isFullscreen ? 'Quitter le plein écran' : 'Passer en plein écran'}
						title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran (masque la barre du navigateur)'}>
						<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
							{#if isFullscreen}
								<path stroke-linecap="round" stroke-linejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25"/>
							{:else}
								<path stroke-linecap="round" stroke-linejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15"/>
							{/if}
						</svg>
					</button>
				{/if}
				{#if wakeLockSupported}
					<button type="button" onclick={toggleWakeLock}
						class="inline-flex items-center gap-1 transition-colors {wakeLockActive ? 'text-cyan-300 hover:text-cyan-200' : 'text-slate-500 hover:text-slate-300'}"
						aria-label={wakeLockActive ? 'Écran maintenu allumé, cliquer pour libérer' : 'Écran libre, cliquer pour le garder allumé'}
						title={wakeLockActive ? 'Écran maintenu allumé' : 'Cliquer pour garder l\'écran allumé'}>
						<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
							{#if wakeLockActive}
								<path fill-rule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clip-rule="evenodd"/>
							{:else}
								<path fill-rule="evenodd" d="M3 8a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm.293 6.707a1 1 0 010-1.414L9 7.586l5.707 5.707a1 1 0 01-1.414 1.414L9 10.414l-4.293 4.293a1 1 0 01-1.414 0z" clip-rule="evenodd"/>
							{/if}
						</svg>
						<span>{wakeLockActive ? 'écran on' : 'écran off'}</span>
					</button>
				{/if}
				<span class="text-emerald-400 inline-flex items-center gap-1 pointer-events-none">
					<span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
					connecté
				</span>
			</div>
		</header>

		<!-- Toast -->
		{#if toast}
			<div class="absolute top-8 left-1/2 -translate-x-1/2 z-30 px-3.5 py-2 rounded-lg border text-xs font-medium shadow-2xl backdrop-blur transition-all duration-200
				{toast.ok ? 'border-emerald-500/60 bg-emerald-950/80 text-emerald-100' : 'border-rose-500/60 bg-rose-950/80 text-rose-100'}">
				<span class="mr-1">{toast.ok ? '✓' : '✕'}</span>{toast.text}
			</div>
		{/if}

		<!-- Zone boutons (réutilisée en mode boutons et mixte) -->
		{#snippet buttonsZone(d: Deck)}
			{@const page = d.layout.pages.find(p => p.id === currentPageId) ?? d.layout.pages[0]}
			{#if !page || page.buttons.length === 0}
				<div class="h-full grid place-items-center px-6">
					<div class="text-center space-y-2 text-slate-400">
						<div class="text-4xl">🎛️</div>
						<div class="text-sm">{page ? 'Page vide' : 'Deck vide'}</div>
						<div class="text-[11px] text-slate-500">Configure tes boutons depuis l'admin Nodyx.</div>
					</div>
				</div>
			{:else}
				{@const usedRows = Math.max(1, ...page.buttons.map(b => b.y + b.h))}
				<div class="h-full p-3 grid gap-2 content-start"
					style="grid-template-columns: repeat({d.layout.cols}, minmax(0, 1fr)); grid-template-rows: repeat({usedRows}, minmax(0, 1fr));">
					{#each page.buttons as b (b.id)}
						{@const g = gradientStyle(b.gradient)}
						<button type="button" onclick={() => press(b)} disabled={pressing !== null}
							class="relative rounded-2xl shadow-xl border border-white/10 overflow-hidden transition-transform duration-100 active:scale-95
								{g.class}
								{pressing === b.id ? 'ring-2 ring-white/60 scale-95' : ''}
								{pressing !== null && pressing !== b.id ? 'opacity-40' : ''}"
							style="grid-column: {b.x + 1} / span {b.w}; grid-row: {b.y + 1} / span {b.h}; {g.style}">
							<!-- Halo subtil en hover/active -->
							<span class="absolute inset-0 bg-gradient-to-tr from-white/0 via-white/0 to-white/20 pointer-events-none"></span>
							<!-- Loader pendant action -->
							{#if pressing === b.id}
								<span class="absolute top-1.5 right-1.5 w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
							{/if}
							<div class="relative h-full flex flex-col items-center justify-center gap-1 p-2 text-center">
								<div class="leading-none drop-shadow-md" style="font-family: 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif; font-size: {1.875 * (b.iconScale ?? 1)}rem">{b.icon}</div>
								<div class="text-[11px] font-semibold leading-tight text-white drop-shadow-md line-clamp-2">{b.label}</div>
							</div>
						</button>
					{/each}
				</div>
			{/if}
		{/snippet}

		<!-- Zone chat : iframe officielle Twitch (parent = domaine courant) -->
		{#snippet chatZone()}
			{#if chatEmbedUrl}
				<iframe src={chatEmbedUrl} title="Chat Twitch" class="w-full h-full block border-0 bg-slate-950"></iframe>
			{:else}
				<div class="h-full grid place-items-center px-6 text-center">
					<div class="space-y-2 text-slate-400">
						<div class="text-3xl">💬</div>
						<div class="text-sm">Chat indisponible</div>
						<div class="text-[11px] text-slate-500">Aucune chaîne Twitch connectée au Hub.</div>
					</div>
				</div>
			{/if}
		{/snippet}

		<!-- Contenu selon le mode, sous le header -->
		<div class="absolute inset-x-0 bottom-0 top-7">
			{#if mode === 'chat'}
				{@render chatZone()}
			{:else if mode === 'buttons'}
				{@render buttonsZone(deck)}
			{:else}
				<!-- Mixte : split géré en CSS. Portrait = vertical (boutons haut / chat bas),
				     paysage = horizontal (boutons gauche / chat droite). -->
				<div bind:this={splitBox} class="h-full flex flex-col landscape:flex-row">
					<div class="min-h-0 min-w-0 overflow-hidden" style="flex: {splitRatio} 1 0%;">
						{@render buttonsZone(deck)}
					</div>
					<div role="separator"
						onpointerdown={startDrag} onpointermove={onDrag} onpointerup={endDrag} onpointercancel={endDrag}
						class="shrink-0 touch-none flex items-center justify-center transition-colors
							h-2.5 cursor-row-resize landscape:h-auto landscape:w-2.5 landscape:cursor-col-resize
							{dragging ? 'bg-cyan-400' : 'bg-slate-700 hover:bg-cyan-500'}">
						<span class="rounded-full bg-white/60 w-10 h-0.5 landscape:w-0.5 landscape:h-10"></span>
					</div>
					<div class="min-h-0 min-w-0 overflow-hidden" style="flex: {1 - splitRatio} 1 0%;">
						{@render chatZone()}
					</div>
				</div>
			{/if}
		</div>

		<!-- Page dock : barre flottante chips en bas, visible quand >1 page et mode ≠ chat -->
		{#if deck.layout.pages.length > 1 && mode !== 'chat'}
			<nav class="absolute inset-x-0 bottom-0 z-20 pointer-events-none flex justify-center"
				style="padding-bottom: max(0.5rem, env(safe-area-inset-bottom));">
				<div class="pointer-events-auto inline-flex items-center gap-1 px-1.5 py-1.5 bg-slate-950/85 backdrop-blur-md border border-slate-700/70 rounded-full shadow-2xl ring-1 ring-white/5">
					{#each deck.layout.pages as p (p.id)}
						{@const active = p.id === currentPageId}
						{@const accent = p.color ?? '#22d3ee'}
						<button type="button" onclick={() => { currentPageId = p.id; vibrate(12) }}
							class="relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all
								{active ? 'text-white shadow-lg' : 'text-slate-400 hover:text-white'}"
							style={active ? `background: linear-gradient(135deg, ${accent}55, ${accent}22); box-shadow: 0 4px 16px ${accent}33;` : ''}>
							<span class="w-1.5 h-1.5 rounded-full" style="background: {accent};"></span>
							<span class="max-w-[90px] truncate">{p.name}</span>
							{#if active}
								<span class="absolute -bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full" style="background: {accent};"></span>
							{/if}
						</button>
					{/each}
				</div>
			</nav>
		{/if}
	{/if}
</div>

<style>
	:global(body) { overscroll-behavior: contain; }
</style>
