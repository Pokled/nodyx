<script lang="ts">
	import { onMount, onDestroy } from 'svelte'
	import { browser } from '$app/environment'
	import { apiFetch } from '$lib/api'
	import { t } from '$lib/i18n'

	const tFn = $derived($t)

	interface Props {
		config:   Record<string, unknown>
		instance: Record<string, unknown>
		user:     Record<string, unknown> | null
		title?:   string | null
	}

	let { config }: Props = $props()

	const rawChannel    = $derived((config.channel as string) ?? '')
	const layout        = $derived((config.layout as string) ?? 'video-only')
	const height        = $derived((config.height as number) ?? 378)
	const theme         = $derived((config.theme as string) ?? 'dark')
	const autoplay      = $derived((config.autoplay as boolean) ?? false)
	const muted         = $derived((config.muted as boolean) ?? true)
	const showHeader    = $derived((config.show_header as boolean) ?? true)
	const accent        = $derived((config.accent_color as string) ?? '#9146FF')
	const fallbackCat   = $derived((config.fallback_category as string) ?? '')
	const fallbackLang  = $derived((config.fallback_language as string) ?? 'any')

	// ── Parsing de la chaîne (pseudo brut OU URL twitch.tv/xyz) ─────────────────
	function parseChannel(raw: string): string {
		if (!raw) return ''
		const cleaned = raw.trim().replace(/^@/, '')
		const match = cleaned.match(/twitch\.tv\/([^/?#]+)/i)
		if (match) return match[1].toLowerCase()
		return cleaned.toLowerCase().replace(/[^a-z0-9_]/g, '')
	}

	const configuredChannel = $derived(parseChannel(rawChannel))
	const hasFallback       = $derived(!!fallbackCat.trim())

	// ── Parent domain requis par Twitch (lu dynamiquement côté client) ────────
	// On attend le mount avant de rendre l'iframe — sinon SSR génère parent=localhost
	// et Twitch bloque l'embed car le hostname réel ne match pas.
	let parentDomain = $state('')
	let mounted      = $state(false)

	// ── État dynamique alimenté par /api/v1/twitch/widget ─────────────────────
	interface StreamInfo {
		channel:    string
		title:      string
		viewers:    number
		game_name:  string
		language:   string
		thumbnail:  string
		started_at: string
	}
	interface WidgetData {
		configured:   boolean
		live_channel: string | null
		status:       'main-live' | 'fallback-live' | 'offline' | 'unconfigured'
		main:         StreamInfo | null
		fallback:     StreamInfo | null
	}
	let widgetData = $state<WidgetData | null>(null)
	let pollTimer:    ReturnType<typeof setInterval> | null = null
	let refreshTimer: ReturnType<typeof setInterval> | null = null

	// Tick qui s'incrémente toutes les 25 min pour forcer un reload de l'iframe.
	// Contourne le timeout "Are you still watching?" de Twitch (~30 min sur player muted idle).
	let refreshTick = $state(0)

	async function pollWidgetData() {
		if (!browser || !configuredChannel) return
		try {
			const params = new URLSearchParams({ channel: configuredChannel })
			if (fallbackCat.trim())    params.append('category', fallbackCat.trim())
			if (fallbackLang && fallbackLang !== 'any') params.append('language', fallbackLang)

			const res = await apiFetch(fetch, `/twitch/widget?${params.toString()}`)
			if (res.ok) widgetData = await res.json()
		} catch {
			// Silent — le widget continue en mode embed pur
		}
	}

	onMount(() => {
		if (!browser) return
		parentDomain = window.location.hostname
		mounted = true

		// Poll seulement si on a une chaîne configurée
		if (configuredChannel) {
			pollWidgetData()
			// Poll régulier seulement si un fallback est configuré (sinon embed pur suffit)
			if (hasFallback) {
				pollTimer = setInterval(pollWidgetData, 60_000)
			}
		}
	})

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer)
	})

	// ── Chaîne effective à embed : live_channel retourné, sinon configuredChannel ──
	const activeChannel = $derived(
		widgetData?.live_channel ?? configuredChannel
	)

	const isMainLive     = $derived(widgetData?.status === 'main-live')
	const isFallbackLive = $derived(widgetData?.status === 'fallback-live')
	const currentStream  = $derived(
		isFallbackLive ? widgetData?.fallback : widgetData?.main
	)

	// ── URLs embed ──
	const playerUrl = $derived.by(() => {
		if (!activeChannel) return ''
		const params = new URLSearchParams({
			channel:  activeChannel,
			parent:   parentDomain,
			autoplay: String(autoplay),
			muted:    String(muted),
		})
		return `https://player.twitch.tv/?${params.toString()}`
	})

	const chatUrl = $derived.by(() => {
		if (!activeChannel) return ''
		const darkParam = theme === 'dark' ? '&darkpopout' : ''
		return `https://www.twitch.tv/embed/${activeChannel}/chat?parent=${parentDomain}${darkParam}`
	})

	const showChat  = $derived(layout === 'video-chat' || layout === 'video-chat-bottom')
	const chatRight = $derived(layout === 'video-chat')

	let iframeLoaded = $state(false)
	function onIframeLoad() { iframeLoaded = true }

	// Reset skeleton si la chaîne active change (fallback swap)
	$effect(() => {
		void activeChannel
		iframeLoaded = false
	})

	function formatViewers(n: number): string {
		if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
		return String(n)
	}
</script>

{#if !configuredChannel}
	<!-- Empty state : aucune chaîne configurée -->
	<div class="relative flex flex-col items-center justify-center gap-3 px-6 py-12 text-center"
	     style="background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07)">
		<svg viewBox="0 0 24 24" class="w-8 h-8" style="color:{accent}" fill="currentColor" aria-hidden="true">
			<path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
		</svg>
		<p class="text-sm font-bold uppercase tracking-[.18em]" style="font-family:'Space Grotesk',sans-serif; color:#e2e8f0">
			Twitch Stream
		</p>
		<p class="text-xs max-w-xs" style="color:#6b7280">
			{tFn('widgets.twitch_configure')}
		</p>
	</div>

{:else}
	<div class="twitch-widget relative overflow-hidden"
	     class:is-live={isMainLive || isFallbackLive}
	     style="--accent:{accent}; background:rgba(255,255,255,.03); border:1px solid rgba(255,255,255,.07)">

		<!-- Gradient shine animée (purple Twitch → teal Nodyx) -->
		<div class="twitch-shine" aria-hidden="true"></div>

		{#if showHeader}
			<!-- Header : logo + pseudo + badge live + CTA -->
			<div class="relative flex items-center justify-between gap-3 px-4 py-2.5"
			     style="background:rgba(0,0,0,.35); border-bottom:1px solid rgba(255,255,255,.06); backdrop-filter:blur(12px)">

				<div class="flex items-center gap-2.5 min-w-0 flex-1">
					<!-- Twitch glyph -->
					<div class="relative shrink-0 flex items-center justify-center w-7 h-7"
					     style="background:{accent}1a; border:1px solid {accent}33">
						<svg viewBox="0 0 24 24" class="w-3.5 h-3.5" style="color:{accent}" fill="currentColor" aria-hidden="true">
							<path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>
						</svg>
					</div>

					<!-- Channel name + meta -->
					<div class="min-w-0">
						<div class="flex items-center gap-2">
							<p class="text-sm font-bold truncate" style="font-family:'Space Grotesk',sans-serif; color:#e2e8f0">
								{activeChannel}
							</p>

							{#if isMainLive || isFallbackLive}
								<!-- Badge LIVE pulsant -->
								<span class="flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[.22em] shrink-0"
								      style="background:#ef4444; color:#fff; font-family:'Space Grotesk',sans-serif">
									<span class="w-1.5 h-1.5 rounded-full opulse" style="background:#fff"></span>
									Live
								</span>
							{/if}
						</div>

						<p class="text-[9px] uppercase tracking-[.22em] font-bold truncate" style="color:#6b7280">
							{#if isFallbackLive && currentStream}
								Fallback · {currentStream.game_name} · {formatViewers(currentStream.viewers)} viewers
							{:else if isMainLive && currentStream}
								{currentStream.game_name} · {formatViewers(currentStream.viewers)} viewers
							{:else if widgetData?.status === 'offline'}
								Offline
							{:else}
								Twitch · Stream
							{/if}
						</p>
					</div>
				</div>

				<!-- CTA Open on Twitch -->
				<a href="https://www.twitch.tv/{activeChannel}"
				   target="_blank"
				   rel="noopener noreferrer"
				   class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.18em] transition-all twitch-cta"
				   style="font-family:'Space Grotesk',sans-serif; color:#e2e8f0; background:{accent}1a; border:1px solid {accent}55"
				   aria-label={tFn('widgets.twitch_open_channel', { channel: activeChannel })}>
					<span class="hidden sm:inline">{tFn('widgets.open')}</span>
					<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true">
						<path stroke-linecap="round" stroke-linejoin="round" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
					</svg>
				</a>
			</div>
		{/if}

		<!-- Bannière fallback : main offline, on montre un autre stream -->
		{#if isFallbackLive && widgetData?.main === null && configuredChannel !== activeChannel}
			<div class="relative flex items-center gap-2 px-4 py-1.5 text-[10px]"
			     style="background:rgba(145,70,255,.08); border-bottom:1px solid rgba(145,70,255,.2); color:var(--nx-accent-2-soft2)">
				<svg class="w-3 h-3 shrink-0" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/>
				</svg>
				<span class="truncate">
					<span style="color:#6b7280">{configuredChannel}</span> {tFn('widgets.twitch_offline_mid')} <span class="font-bold">{activeChannel}</span> {tFn('widgets.twitch_offline_end')}
				</span>
			</div>
		{/if}

		<!-- Player + chat -->
		<div class="relative flex flex-col"
		     class:md:flex-row={chatRight}
		     style="min-height:{height}px">

			<!-- Video iframe -->
			<div class="relative flex-1"
			     style="min-height:{height}px; background:#000">

				{#if !iframeLoaded}
					<!-- Skeleton loader pulse -->
					<div class="absolute inset-0 flex items-center justify-center"
					     style="background:linear-gradient(135deg, rgba(124,58,237,.08), rgba(14,116,144,.08))">
						<div class="flex flex-col items-center gap-3">
							<div class="w-8 h-8 rounded-full border-2 animate-spin"
							     style="border-color:rgba(145,70,255,.2); border-top-color:{accent}"></div>
							<span class="text-[10px] uppercase tracking-[.18em] font-bold" style="color:#6b7280; font-family:'Space Grotesk',sans-serif">
								Chargement du stream
							</span>
						</div>
					</div>
				{/if}

				{#if mounted && parentDomain}
					{#key activeChannel + parentDomain}
						<iframe
							src={playerUrl}
							title="Twitch player — {activeChannel}"
							allowfullscreen
							allow="autoplay; fullscreen; picture-in-picture"
							onload={onIframeLoad}
							class="w-full h-full absolute inset-0"
							style="border:0; opacity:{iframeLoaded ? 1 : 0}; transition:opacity .3s ease"
						></iframe>
					{/key}
				{/if}
			</div>

			<!-- Chat iframe (optional) -->
			{#if showChat}
				<div class="relative shrink-0 w-full"
				     class:md:w-80={chatRight}
				     class:md:border-l={chatRight}
				     class:border-t={!chatRight}
				     style="height:{chatRight ? `${height}px` : '280px'}; border-color:rgba(255,255,255,.06); background:#0d0d12">
					{#if mounted && parentDomain}
						{#key activeChannel + parentDomain}
							<iframe
								src={chatUrl}
								title="Twitch chat — {activeChannel}"
								class="w-full h-full"
								style="border:0"
							></iframe>
						{/key}
					{/if}
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	.twitch-widget {
		position: relative;
	}

	/* Gradient shine animée autour du widget — effet premium subtil */
	.twitch-shine {
		position: absolute;
		inset: -1px;
		pointer-events: none;
		z-index: 0;
		background: conic-gradient(
			from 0deg,
			transparent 0deg,
			var(--accent) 80deg,
			transparent 160deg,
			#0e7490 240deg,
			transparent 320deg,
			transparent 360deg
		);
		opacity: 0;
		animation: twitch-shine 8s linear infinite, twitch-fade-in 1s ease 0.5s forwards;
		mask: linear-gradient(#000, #000) content-box, linear-gradient(#000, #000);
		mask-composite: exclude;
		padding: 1px;
	}

	/* Quand en live, shine plus rapide + plus opaque */
	.twitch-widget.is-live .twitch-shine {
		animation: twitch-shine 4s linear infinite, twitch-fade-in-live 1s ease 0.5s forwards;
	}

	@keyframes twitch-shine {
		0%   { transform: rotate(0deg); }
		100% { transform: rotate(360deg); }
	}

	@keyframes twitch-fade-in {
		to { opacity: .35; }
	}

	@keyframes twitch-fade-in-live {
		to { opacity: .6; }
	}

	@keyframes opulse {
		0%   { box-shadow: 0 0 0 0 rgba(255,255,255,.7); }
		100% { box-shadow: 0 0 0 4px rgba(255,255,255,0); }
	}
	.opulse { animation: opulse 1.5s ease-out infinite; }

	/* CTA hover — subtile élévation */
	.twitch-cta:hover {
		background: color-mix(in srgb, var(--accent) 25%, transparent) !important;
		border-color: var(--accent) !important;
		transform: translateY(-1px);
	}

	.twitch-cta {
		transition: all .2s ease;
	}
</style>
