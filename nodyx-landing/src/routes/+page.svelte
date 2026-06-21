<script lang="ts">
	import { onMount } from 'svelte'
	import FederationMap from '$lib/FederationMap.svelte'
	import ChatDemo from '$lib/ChatDemo.svelte'

	// Lightbox state
	let lightbox = $state<{ src: string; alt: string } | null>(null)

	function openLightbox(src: string, alt: string) {
		lightbox = { src, alt }
	}
	function closeLightbox() {
		lightbox = null
	}

	$effect(() => {
		if (!lightbox) return
		function onKey(e: KeyboardEvent) {
			if (e.key === 'Escape') closeLightbox()
		}
		window.addEventListener('keydown', onKey)
		const prev = document.body.style.overflow
		document.body.style.overflow = 'hidden'
		return () => {
			window.removeEventListener('keydown', onKey)
			document.body.style.overflow = prev
		}
	})

	// Animated terminal output : types each line, blinking cursor at the end.
	const TERMINAL_LINES = [
		'> Fetching dependencies (Node 20, PostgreSQL 16, Redis 7, Caddy)...',
		'> Compiling Rust P2P tunnel...',
		'> Running 91 database migrations...',
		'> Generating instance secrets + JWT key...',
		'> Starting nodyx-core, nodyx-frontend, nodyx-turn...',
		'> ✓ Node deployed at https://yourcommunity.nodyx.org',
	]

	let visibleLines = $state(0)
	let typedChars   = $state(0)

	onMount(() => {
		let idx = 0, char = 0
		const tick = setInterval(() => {
			if (idx >= TERMINAL_LINES.length) { clearInterval(tick); return }
			const line = TERMINAL_LINES[idx]
			if (char >= line.length) {
				idx++; char = 0
				visibleLines = idx
				return
			}
			char += 2
			visibleLines = idx
			typedChars   = char
		}, 22)

		// Scroll reveal: fade-up sections + cards as they enter the viewport
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (e.isIntersecting) {
					e.target.classList.add('is-in')
					io.unobserve(e.target)
				}
			}
		}, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
		document.querySelectorAll('.reveal').forEach(el => io.observe(el))

		// Spotlight: mouse-following light on .spot cards
		function onSpot(e: PointerEvent) {
			const target = (e.target as HTMLElement).closest('.spot') as HTMLElement | null
			if (!target) return
			const r = target.getBoundingClientRect()
			target.style.setProperty('--mx', `${e.clientX - r.left}px`)
			target.style.setProperty('--my', `${e.clientY - r.top}px`)
		}
		document.addEventListener('pointermove', onSpot, { passive: true })

		return () => {
			clearInterval(tick)
			io.disconnect()
			document.removeEventListener('pointermove', onSpot)
		}
	})

	const STACK = [
		{ label: 'Backend',     value: 'Fastify v5 · TypeScript',          icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
		{ label: 'Frontend',    value: 'SvelteKit 5 · Tailwind v4',         icon: 'M12 18.5l4-4-4-4-4 4 4 4zM12 2v6M12 22v-6' },
		{ label: 'Database',    value: 'PostgreSQL 16 · Redis 7',           icon: 'M4 6c0-1.1 3.6-2 8-2s8 .9 8 2v12c0 1.1-3.6 2-8 2s-8-.9-8-2V6zM4 6c0 1.1 3.6 2 8 2s8-.9 8-2M4 12c0 1.1 3.6 2 8 2s8-.9 8-2' },
		{ label: 'Real-time',   value: 'Socket.IO · WebRTC P2P mesh',       icon: 'M5 13a4 4 0 014-4h6a4 4 0 014 4M3 17h18M12 9V3' },
		{ label: 'Voice relay', value: 'nodyx-turn (Rust, 2.9 MB)',         icon: 'M12 1v6m0 6v6M5.6 5.6l4.2 4.2m4.4 4.4l4.2 4.2M1 12h6m6 0h6M5.6 18.4l4.2-4.2m4.4-4.4l4.2-4.2' },
		{ label: 'P2P tunnel',  value: 'nodyx-relay (Rust TCP)',            icon: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3a14 14 0 010 18M12 3a14 14 0 000 18' },
		{ label: 'Auth',        value: 'Nodyx Signet ECDSA P-256 PWA',      icon: 'M12 1l3 7h7l-5.5 4 2 7-6.5-4-6.5 4 2-7L1 8h7z' },
		{ label: 'Moderation',  value: 'OctoGuard auto-mod (re2 ReDoS-safe)', icon: 'M12 2l9 4v6c0 5.55-3.84 10.74-9 12-5.16-1.26-9-6.45-9-12V6l9-4z' },
		{ label: 'E2E DMs',     value: 'ECDH P-256 · AES-GCM · ESY Barbare', icon: 'M12 11c-1.1 0-2 .9-2 2v2c0 1.1.9 2 2 2s2-.9 2-2v-2c0-1.1-.9-2-2-2zM6 11V7a6 6 0 1112 0v4' },
	]
</script>

<!-- ── HEADER ───────────────────────────────────────────────────────────── -->
<header class="sticky top-0 z-50 glass border-b border-white/8">
	<div class="max-w-[1280px] mx-auto px-4 md:px-16 h-16 flex items-center justify-between">
		<a href="https://nodyx.org" class="flex items-center gap-2.5 group">
			<img src="/logo.png?v=1" alt="Nodyx" class="w-8 h-8 object-contain group-hover:scale-110 transition-transform" />
			<span class="t-label text-on-surface font-semibold">NODYX</span>
		</a>
		<nav class="hidden md:flex items-center gap-1">
			<a href="#showcase"   class="t-label text-on-surface-variant hover:text-on-surface px-3 py-2 rounded transition-colors">Showcase</a>
			<a href="#why"        class="t-label text-on-surface-variant hover:text-on-surface px-3 py-2 rounded transition-colors">Why</a>
			<a href="#federation" class="t-label text-on-surface-variant hover:text-on-surface px-3 py-2 rounded transition-colors">Federation</a>
			<a href="#stack"      class="t-label text-on-surface-variant hover:text-on-surface px-3 py-2 rounded transition-colors">Stack</a>
			<a href="#install" class="t-label text-on-surface-variant hover:text-on-surface px-3 py-2 rounded transition-colors">Self-host</a>
			<a href="https://nodyx.dev" class="t-label text-on-surface-variant hover:text-on-surface px-3 py-2 rounded transition-colors">Documentation</a>
			<a href="https://github.com/Pokled/nodyx" class="t-label text-on-surface-variant hover:text-on-surface px-3 py-2 rounded transition-colors">GitHub</a>
		</nav>
		<a href="#install" class="btn-primary inline-flex items-center gap-2 px-4 py-2 rounded text-sm">
			<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M8 9l3 3-3 3m5 0h3"/></svg>
			Deploy Node
		</a>
	</div>
</header>

<main class="max-w-[1280px] mx-auto px-4 md:px-16 pt-16 md:pt-24 pb-24">

	<!-- ── HERO ─────────────────────────────────────────────────────────── -->
	<section class="text-center pt-12 md:pt-20 pb-16 relative">
		<!-- Hero background artwork — full viewport width, starts right under the sticky header -->
		<div class="absolute -top-16 md:-top-24 bottom-0 left-1/2 -translate-x-1/2 w-screen -z-10 pointer-events-none overflow-hidden">
			<img src="/bg-hero.png?v=1" alt="" fetchpriority="high" class="absolute inset-0 w-full h-full object-cover opacity-60" />
			<!-- Center vignette to preserve text contrast, edge + bottom blend into the page color -->
			<div class="absolute inset-0 bg-[radial-gradient(ellipse_70%_60%_at_50%_38%,transparent,rgba(3,20,39,0.55)_72%,#031427_100%)]"></div>
			<div class="absolute inset-x-0 bottom-0 h-48 bg-gradient-to-b from-transparent to-[#031427]"></div>
		</div>
		<div class="inline-flex items-center gap-2 chip mb-8">
			<span class="chip-dot pulse"></span>
			<span>v2.8 LIVE · STREAMER HUB · OCTOGUARD · AGPL-3.0</span>
		</div>

		<h1 class="t-display-m md:t-display text-on-surface max-w-4xl mx-auto">
			The network is<br/>
			<span class="text-secondary">the people.</span>
		</h1>

		<p class="t-body-lg text-on-surface-variant max-w-2xl mx-auto mt-8">
			The self-hosted community platform you actually own. Forum, chat, voice, P2P relay, collaborative canvas, homepage builder, all in one install. No silos. No analytics. No board of directors.
		</p>

		<div class="mt-10 flex flex-col sm:flex-row gap-4 items-center justify-center">
			<a href="#install" class="btn-primary inline-flex items-center gap-2 px-7 py-3 rounded text-sm">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
				Deploy your node
			</a>
			<a href="https://nodyx.org" class="btn-ghost inline-flex items-center gap-2 px-7 py-3 rounded text-sm">
				<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3"/></svg>
				Try the live demo
			</a>
		</div>

		<!-- Terminal mockup -->
		<div class="mt-16 max-w-3xl mx-auto text-left">
			<div class="term">
				<div class="flex items-center px-4 py-2.5 border-b border-white/10 bg-surface-container-high/40">
					<div class="flex gap-2">
						<div class="w-3 h-3 rounded-full bg-error/80"></div>
						<div class="w-3 h-3 rounded-full bg-secondary/80"></div>
						<div class="w-3 h-3 rounded-full bg-tertiary/80"></div>
					</div>
					<div class="mx-auto font-mono text-xs text-on-surface-variant/60 select-none">bash · nodyx-installer</div>
				</div>
				<div class="p-5 md:p-6 font-mono text-sm text-on-surface">
					<div class="flex items-center gap-3 mb-4">
						<span class="text-secondary">root@server:~#</span>
						<span class="select-all">curl -fsSL https://nodyx.org/install.sh | bash</span>
					</div>
					<div class="space-y-1 text-on-surface-variant/80 min-h-[170px]">
						{#each TERMINAL_LINES as line, i}
							{#if i < visibleLines}
								<div>{line}</div>
							{:else if i === visibleLines}
								<div>{line.slice(0, typedChars)}<span class="inline-block w-2 h-4 bg-secondary align-middle ml-0.5 animate-pulse"></span></div>
							{/if}
						{/each}
					</div>
				</div>
			</div>
		</div>

		<div class="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 t-label-sm text-on-surface-variant/70 uppercase">
			<span class="inline-flex items-center gap-2"><svg class="w-3.5 h-3.5 text-secondary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg> AGPL-3.0</span>
			<span class="inline-flex items-center gap-2"><svg class="w-3.5 h-3.5 text-secondary" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg> No Docker</span>
			<span class="inline-flex items-center gap-2"><svg class="w-3.5 h-3.5 text-secondary" fill="currentColor" viewBox="0 0 24 24"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg> Raspberry Pi ready</span>
			<span class="inline-flex items-center gap-2"><svg class="w-3.5 h-3.5 text-secondary" fill="currentColor" viewBox="0 0 24 24"><path d="M4 4h16v16H4V4zm2 2v12h12V6H6z"/></svg> Zero analytics</span>
		</div>
	</section>

	<!-- ── SHOWCASE ─────────────────────────────────────────────────────── -->
	<section id="showcase" class="py-20 md:py-28">
		<div class="text-center mb-12 reveal">
			<div class="t-label-sm uppercase text-secondary mb-4">Inside Nodyx</div>
			<h2 class="t-headline md:text-[40px] md:leading-[48px] text-on-surface font-semibold">See it in action.</h2>
			<p class="t-body-lg text-on-surface-variant mt-4 max-w-2xl mx-auto">Forum, real-time chat, voice channels, collaborative canvas, drag-and-drop homepage builder, widget store. All in one install, running on the demo right now.</p>
		</div>

		<!-- Hero shot: homepage builder -->
		<div class="relative group reveal reveal-d1">
			<div class="absolute -inset-px rounded-[14px] bg-gradient-to-br from-secondary/30 via-tertiary/20 to-transparent opacity-60 blur-md group-hover:opacity-90 transition-opacity"></div>
			<div class="relative card overflow-hidden">
				<div class="flex items-center px-4 py-2.5 border-b border-white/10 bg-surface-container-high/40">
					<div class="flex gap-2">
						<div class="w-2.5 h-2.5 rounded-full bg-error/70"></div>
						<div class="w-2.5 h-2.5 rounded-full bg-secondary/70"></div>
						<div class="w-2.5 h-2.5 rounded-full bg-tertiary/70"></div>
					</div>
					<div class="mx-auto font-mono text-xs text-on-surface-variant/60">nodyx.org · Homepage Builder</div>
				</div>
				<img src="/showcase-homepage.png?v=3" alt="Nodyx homepage with drag-and-drop builder, 11 layout zones, widgets" loading="eager" class="block w-full h-auto cursor-zoom-in" onclick={() => openLightbox('/showcase-homepage.png?v=3', 'Nodyx : Homepage with drag-and-drop builder')} />
			</div>
		</div>

		<!-- Feature grid: 4 specialized views -->
		<div class="mt-8 grid sm:grid-cols-2 lg:grid-cols-2 gap-6">
			<!-- Forum -->
			<div class="card spot overflow-hidden group">
				<div class="overflow-hidden border-b border-white/8 bg-surface-lowest">
					<img src="/showcase-forum.png?v=1" alt="Nodyx : Forum with categories, threads and rich editor" loading="lazy" class="block w-full h-auto cursor-zoom-in group-hover:scale-[1.02] transition-transform duration-500" onclick={() => openLightbox('/showcase-forum.png?v=1', 'Nodyx : Forum')} />
				</div>
				<div class="p-5">
					<div class="t-label-sm uppercase text-secondary/80 mb-1">Forum</div>
					<div class="t-headline-m text-on-surface mb-1">Indexed. Searchable. Yours.</div>
					<div class="t-body text-on-surface-variant">Full-text search, JSON-LD, canonical URLs. Your community knowledge becomes part of the open web again.</div>
				</div>
			</div>

			<!-- Chat -->
			<div class="card spot overflow-hidden group">
				<div class="overflow-hidden border-b border-white/8 bg-surface-lowest">
					<img src="/showcase-chat.png?v=1" alt="Nodyx : Real-time chat with replies, pins, reactions" loading="lazy" class="block w-full h-auto cursor-zoom-in group-hover:scale-[1.02] transition-transform duration-500" onclick={() => openLightbox('/showcase-chat.png?v=1', 'Nodyx : Real-time chat')} />
				</div>
				<div class="p-5">
					<div class="t-label-sm uppercase text-secondary/80 mb-1">Real-time chat</div>
					<div class="t-headline-m text-on-surface mb-1">Live, with everything you expect.</div>
					<div class="t-body text-on-surface-variant">Replies, pins, link previews, reactions, mentions. P2P typing indicators arrive in &lt; 5 ms via WebRTC DataChannels.</div>
				</div>
			</div>

			<!-- Voice -->
			<div class="card spot overflow-hidden group">
				<div class="overflow-hidden border-b border-white/8 bg-surface-lowest">
					<img src="/showcase-voice.png?v=1" alt="Nodyx : Voice channels with WebRTC P2P mesh" loading="lazy" class="block w-full h-auto cursor-zoom-in group-hover:scale-[1.02] transition-transform duration-500" onclick={() => openLightbox('/showcase-voice.png?v=1', 'Nodyx : Voice channels (P2P)')} />
				</div>
				<div class="p-5">
					<div class="t-label-sm uppercase text-secondary/80 mb-1">Voice channels</div>
					<div class="t-headline-m text-on-surface mb-1">P2P. No central relay.</div>
					<div class="t-body text-on-surface-variant">WebRTC mesh between peers. Audio never touches a third-party server. Rust STUN/TURN fallback for restrictive NATs.</div>
				</div>
			</div>

			<!-- Canvas -->
			<div class="card spot overflow-hidden group">
				<div class="overflow-hidden border-b border-white/8 bg-surface-lowest">
					<img src="/showcase-canvas.png?v=1" alt="NodyxCanvas : Collaborative whiteboard with CRDT sync" loading="lazy" class="block w-full h-auto cursor-zoom-in group-hover:scale-[1.02] transition-transform duration-500" onclick={() => openLightbox('/showcase-canvas.png?v=1', 'NodyxCanvas : Collaborative whiteboard')} />
				</div>
				<div class="p-5">
					<div class="t-label-sm uppercase text-secondary/80 mb-1">NodyxCanvas</div>
					<div class="t-headline-m text-on-surface mb-1">Whiteboard, in the voice channel.</div>
					<div class="t-body text-on-surface-variant">CRDT Last-Write-Wins sync. 11 drawing tools. Voice-aware cursors. Board-scoped chat. Persistent PostgreSQL snapshots.</div>
				</div>
			</div>
		</div>

		<!-- Widget store, full width strip -->
		<div class="mt-6 card overflow-hidden group">
			<div class="grid md:grid-cols-2 items-stretch">
				<div class="overflow-hidden border-r border-white/8 bg-surface-lowest">
					<img src="/showcase-widgets.png?v=1" alt="Nodyx : Widget Store with one-click .zip install" loading="lazy" class="block w-full h-full object-cover cursor-zoom-in group-hover:scale-[1.02] transition-transform duration-500" onclick={() => openLightbox('/showcase-widgets.png?v=1', 'Nodyx : Widget Store')} />
				</div>
				<div class="p-7 md:p-10 flex flex-col justify-center">
					<div class="t-label-sm uppercase text-secondary/80 mb-2">Widget Store + SDK</div>
					<div class="t-headline text-on-surface mb-3">Extend your community without a build chain.</div>
					<div class="t-body text-on-surface-variant">Drop a <code class="text-secondary">.zip</code> file in the admin panel. The widget is live in seconds. Build your own with vanilla Custom Elements, no React, no Vue, no npm. Each widget is sandboxed in its own Shadow DOM.</div>
					<div class="mt-5 flex flex-wrap gap-2">
						<span class="chip">11 layout zones</span>
						<span class="chip">.zip install</span>
						<span class="chip">Shadow DOM</span>
					</div>
				</div>
			</div>
		</div>

		<!-- Streamer Hub, full width strip -->
		<div class="mt-6 card overflow-hidden group">
			<div class="grid md:grid-cols-2 items-stretch">
				<div class="p-7 md:p-10 flex flex-col justify-center">
					<div class="t-label-sm uppercase text-secondary/80 mb-2">Streamer Hub · Twitch</div>
					<div class="t-headline text-on-surface mb-3">Run your whole live stream from your own server.</div>
					<div class="t-body text-on-surface-variant">A native Twitch bridge, a Soundboard your viewers fill from chat with <code class="text-secondary">!ns</code>, a multi-page mobile Stream Deck, and OBS browser-source overlays. No Streamlabs, no StreamElements, no monthly bots. Your OAuth tokens never leave your hardware.</div>
					<div class="mt-5 flex flex-wrap gap-2">
						<span class="chip">Soundboard</span>
						<span class="chip">Stream Deck</span>
						<span class="chip">OBS overlays</span>
						<span class="chip">Unified chat</span>
						<span class="chip">Viewer queue</span>
					</div>
				</div>
				<div class="relative overflow-hidden border-l border-white/8 bg-surface-lowest min-h-[240px] flex items-center justify-center p-8">
					<div class="absolute inset-0 bg-gradient-to-br from-secondary/20 via-tertiary/10 to-transparent"></div>
					<div class="relative w-full max-w-sm rounded-xl border border-white/10 bg-[#0a0e16] overflow-hidden font-mono text-xs shadow-2xl">
						<div class="flex items-center gap-1.5 px-3 py-2 border-b border-white/10">
							<span class="w-2 h-2 rounded-full bg-error/70"></span>
							<span class="w-2 h-2 rounded-full bg-secondary/70"></span>
							<span class="w-2 h-2 rounded-full bg-tertiary/70"></span>
							<span class="ml-2 text-on-surface-variant/50">twitch chat → nodyx</span>
						</div>
						<div class="p-4 leading-relaxed">
							<div class="text-on-surface-variant/70">viewer: <span class="text-on-surface">!ns ixion</span></div>
							<div class="text-secondary mt-1">nodyx: ✔ "Ixion theme" added to the queue</div>
							<div class="text-on-surface-variant/50 mt-3">obs overlays: alert · goal · timer · ticker</div>
							<div class="text-on-surface-variant/50">· leaderboard · clips · soundboard</div>
						</div>
					</div>
				</div>
			</div>
		</div>

	</section>

	<!-- ── WHY ──────────────────────────────────────────────────────────── -->
	<section id="why" class="py-20 md:py-28 relative">
		<!-- Mid-section background artwork — full viewport width -->
		<div class="absolute inset-y-0 left-1/2 -translate-x-1/2 w-screen -z-10 pointer-events-none overflow-hidden">
			<img src="/bg-mid.png?v=1" alt="" loading="lazy" class="absolute inset-0 w-full h-full object-cover opacity-40" />
			<!-- Center vignette + top/bottom fade into the page color -->
			<div class="absolute inset-0 bg-[radial-gradient(ellipse_80%_70%_at_50%_50%,transparent_0%,rgba(3,20,39,0.5)_75%,#031427_100%)]"></div>
			<div class="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-[#031427] to-transparent"></div>
			<div class="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-[#031427] to-transparent"></div>
		</div>
		<div class="max-w-3xl mx-auto text-center reveal">
			<div class="t-label-sm uppercase text-secondary mb-4">The problem</div>
			<h2 class="t-headline md:text-[40px] md:leading-[48px] text-on-surface font-semibold">
				Closed platforms ended up holding more conversations than the open web ever did.
			</h2>
			<p class="mt-6 t-body-lg text-on-surface-variant">
				Not by malice. By default. They were free, easy, and everyone was already there. But ten years of discussions, tutorials, and collective knowledge now sit behind login walls.
			</p>
			<p class="mt-6 text-2xl md:text-3xl font-semibold accent">
				You never owned any of it.
			</p>
		</div>

		<div class="mt-16 grid md:grid-cols-3 gap-6">
			<div class="card spot p-7 reveal">
				<div class="icon-wrap mb-5">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
				</div>
				<h3 class="t-headline-m text-on-surface mb-3">All formats. One install.</h3>
				<p class="t-body text-on-surface-variant">Forum, real-time chat, voice channels, P2P canvas, homepage builder. No stitching five tools together. Everything lives on the hardware you control.</p>
			</div>
			<div class="card spot p-7 reveal">
				<div class="icon-wrap indigo mb-5">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z"/></svg>
				</div>
				<h3 class="t-headline-m text-on-surface mb-3">You own everything.</h3>
				<p class="t-body text-on-surface-variant">AGPL-3.0. Self-hosted on your hardware. No cloud account, no proprietary lock-in, no surprise terms-of-service update from a corner office.</p>
			</div>
			<div class="card spot p-7 reveal">
				<div class="icon-wrap mb-5">
					<svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
				</div>
				<h3 class="t-headline-m text-on-surface mb-3">Runs anywhere.</h3>
				<p class="t-body text-on-surface-variant">VPS, home server, Raspberry Pi behind your router. Native Rust P2P relay means no domain, no open ports, no Cloudflare account required.</p>
			</div>
		</div>
	</section>

	<!-- ── FEDERATION ───────────────────────────────────────────────────── -->
	<section id="federation" class="py-20 md:py-28">
		<div class="text-center mb-14 reveal">
			<div class="t-label-sm uppercase text-secondary mb-4">The Gossip Protocol</div>
			<h2 class="t-headline md:text-[40px] md:leading-[48px] text-on-surface font-semibold">A network that breathes.</h2>
			<p class="t-body-lg text-on-surface-variant mt-4 max-w-2xl mx-auto">
				Every Nodyx instance is its own sovereign node. They discover each other, share community metadata and events through a lightweight gossip protocol. No central server holds the network together. If one goes dark, the others keep talking.
			</p>
		</div>

		<div class="reveal reveal-d1">
			<FederationMap />
		</div>

		<div class="mt-10 grid sm:grid-cols-3 gap-5 max-w-4xl mx-auto reveal reveal-d2">
			<div class="text-center">
				<div class="t-headline-m text-on-surface mb-1">No master</div>
				<div class="t-body text-on-surface-variant">No instance is privileged. The directory is a courtesy, not a dependency.</div>
			</div>
			<div class="text-center">
				<div class="t-headline-m text-on-surface mb-1">Cross-search</div>
				<div class="t-body text-on-surface-variant">Members of one instance can discover threads and events on any peer that opts in.</div>
			</div>
			<div class="text-center">
				<div class="t-headline-m text-on-surface mb-1">Resilient by design</div>
				<div class="t-body text-on-surface-variant">If <span class="font-mono text-secondary">nodyx.org</span> disappears tomorrow, the network keeps running on its members' hardware.</div>
			</div>
		</div>
	</section>

	<!-- ── LIVE CHAT DEMO ───────────────────────────────────────────────── -->
	<section id="live" class="py-20 md:py-28">
		<div class="text-center mb-14 reveal">
			<div class="t-label-sm uppercase text-secondary mb-4">Real-time, by design</div>
			<h2 class="t-headline md:text-[40px] md:leading-[48px] text-on-surface font-semibold">A chat that arrives before you blink.</h2>
			<p class="t-body-lg text-on-surface-variant mt-4 max-w-2xl mx-auto">
				WebRTC DataChannels between peers, Socket.IO as fallback. Typing indicators, reactions, link unfurls, replies, pins, all running on hardware you own.
			</p>
		</div>

		<div class="reveal reveal-d1">
			<ChatDemo />
		</div>
	</section>

	<!-- ── STACK ────────────────────────────────────────────────────────── -->
	<section id="stack" class="py-20 md:py-28">
		<div class="text-center mb-14 reveal">
			<div class="t-label-sm uppercase text-secondary mb-4">Under the hood</div>
			<h2 class="t-headline md:text-[40px] md:leading-[48px] text-on-surface font-semibold">Built honest. No magic.</h2>
			<p class="t-body-lg text-on-surface-variant mt-4 max-w-2xl mx-auto">A composed, transparent stack. Every layer is replaceable, every dependency is documented.</p>
		</div>

		<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
			{#each STACK as item}
				<div class="card spot p-5 flex items-start gap-4 reveal">
					<div class="icon-wrap shrink-0 w-9 h-9">
						<svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d={item.icon}/></svg>
					</div>
					<div class="min-w-0">
						<div class="t-label-sm uppercase text-secondary/80 mb-1">{item.label}</div>
						<div class="t-body text-on-surface">{item.value}</div>
					</div>
				</div>
			{/each}
		</div>
	</section>

	<!-- ── INSTALL ──────────────────────────────────────────────────────── -->
	<section id="install" class="py-20 md:py-28">
		<div class="max-w-3xl mx-auto card spot p-8 md:p-12 text-center reveal">
			<div class="t-label-sm uppercase text-secondary mb-4">One command. Your server.</div>
			<h2 class="t-headline md:text-[40px] md:leading-[48px] text-on-surface font-semibold">From zero to running community in 15 minutes.</h2>
			<p class="t-body text-on-surface-variant mt-5">Works on Ubuntu 22.04/24.04, Debian 11/12/13. Installs Node, PostgreSQL 16, Redis 7, Caddy with auto-HTTPS, PM2 and the Rust STUN/TURN server natively. No Docker required.</p>

			<div class="mt-8 inline-flex items-center gap-3 px-5 py-3 rounded bg-surface-lowest border border-white/10 font-mono text-sm text-on-surface">
				<span class="text-secondary select-none">$</span>
				<span class="select-all">curl -fsSL https://nodyx.org/install.sh | bash</span>
			</div>

			<div class="mt-8 flex flex-wrap items-center justify-center gap-6 t-label-sm uppercase text-on-surface-variant/60">
				<span class="inline-flex items-center gap-1.5"><span class="chip-dot" style="background: var(--color-success); box-shadow: 0 0 8px var(--color-success);"></span>Secrets auto-generated</span>
				<span class="inline-flex items-center gap-1.5"><span class="chip-dot" style="background: var(--color-success); box-shadow: 0 0 8px var(--color-success);"></span>91 migrations applied</span>
				<span class="inline-flex items-center gap-1.5"><span class="chip-dot" style="background: var(--color-success); box-shadow: 0 0 8px var(--color-success);"></span>HTTPS via Let's Encrypt</span>
			</div>
		</div>
	</section>

	<!-- ── PHILOSOPHY ───────────────────────────────────────────────────── -->
	<section class="py-24 md:py-32 text-center reveal">
		<blockquote class="t-headline md:text-[40px] md:leading-[52px] font-medium text-on-surface max-w-3xl mx-auto">
			"We made the internet to bring people together.<br/>
			<span class="accent">Not to divide them.</span>"
		</blockquote>
		<p class="mt-8 t-label uppercase text-on-surface-variant/60">The Nodyx Manifesto</p>

		<div class="mt-12 flex items-center justify-center gap-4">
			<a href="https://github.com/Pokled/nodyx" class="btn-ghost inline-flex items-center gap-2 px-6 py-2.5 rounded text-sm">
				<svg class="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M12 .3a12 12 0 00-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.5-1.4-1.3-1.8-1.3-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6 0-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 016 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.2 2.8 0 3.2.8.8 1.3 1.9 1.3 3.2 0 4.6-2.8 5.6-5.5 6 .5.4.9 1.1.9 2.3v3.3c0 .3.2.7.8.6A12 12 0 0012 .3"/></svg>
				View source
			</a>
		</div>
	</section>

</main>

<!-- ── FOOTER ───────────────────────────────────────────────────────────── -->
<footer class="bg-surface-lowest border-t border-white/8 mt-12">
	<div class="max-w-[1280px] mx-auto px-4 md:px-16 py-14 grid grid-cols-2 md:grid-cols-4 gap-8">
		<div class="col-span-2 md:col-span-1">
			<div class="flex items-center gap-2.5 mb-4">
				<img src="/logo.png?v=1" alt="Nodyx" class="w-7 h-7 object-contain" />
				<span class="t-label text-on-surface font-semibold">NODYX</span>
			</div>
			<p class="t-body text-on-surface-variant/80 max-w-xs">
				Sovereign tech for the open web. AGPL-3.0. Built solo, owned by everyone.
			</p>
			<p class="mt-6 t-label-sm uppercase text-on-surface-variant/40">"Fork us if we betray you."</p>
		</div>
		<div>
			<h4 class="t-label uppercase text-on-surface font-semibold mb-4">Project</h4>
			<ul class="space-y-3">
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://github.com/Pokled/nodyx">Source code</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://nodyx.dev">Documentation</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://nodyx.org">Live demo</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://github.com/Pokled/nodyx/blob/main/CHANGELOG.md">Changelog</a></li>
			</ul>
		</div>
		<div>
			<h4 class="t-label uppercase text-on-surface font-semibold mb-4">Community</h4>
			<ul class="space-y-3">
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://github.com/Pokled/nodyx/discussions">Discussions</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://github.com/Pokled/nodyx/issues">Issues</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://github.com/Pokled/nodyx/blob/main/CONTRIBUTORS.md">Nodyx Stars</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://ko-fi.com/Pokled">Support</a></li>
			</ul>
		</div>
		<div>
			<h4 class="t-label uppercase text-on-surface font-semibold mb-4">License & legal</h4>
			<ul class="space-y-3">
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://www.gnu.org/licenses/agpl-3.0">AGPL-3.0</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://github.com/Pokled/nodyx/blob/main/docs/en/MANIFESTO.md">Manifesto</a></li>
				<li><a class="t-body text-on-surface-variant hover:text-secondary transition-colors" href="https://nodyx.dev/why-nodyx">Why Nodyx</a></li>
			</ul>
		</div>
	</div>
	<div class="border-t border-white/5">
		<div class="max-w-[1280px] mx-auto px-4 md:px-16 py-6 t-label-sm uppercase text-on-surface-variant/40 text-center">
			Born February 18, 2026. The network is the people.
		</div>
	</div>
</footer>

<!-- ── LIGHTBOX ─────────────────────────────────────────────────────────── -->
{#if lightbox}
	<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
	<div class="lightbox" onclick={closeLightbox} role="dialog" aria-label="Image agrandie">
		<button class="lb-close" type="button" onclick={closeLightbox} aria-label="Fermer">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
		</button>
		<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_noninteractive_element_interactions -->
		<img src={lightbox.src} alt={lightbox.alt} class="lb-img" onclick={(e) => e.stopPropagation()} />
		<div class="lb-caption" onclick={(e) => e.stopPropagation()}>{lightbox.alt}</div>
	</div>
{/if}

<style>
	.lightbox {
		position: fixed;
		inset: 0;
		z-index: 1000;
		background: rgba(3, 20, 39, 0.88);
		backdrop-filter: blur(12px);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 32px;
		gap: 14px;
		cursor: zoom-out;
		animation: lb-fade 180ms ease-out;
	}
	.lb-img {
		max-width: min(95vw, 1600px);
		max-height: 82vh;
		width: auto;
		height: auto;
		object-fit: contain;
		border-radius: 8px;
		border: 1px solid rgba(255, 255, 255, 0.1);
		box-shadow: 0 24px 60px -16px rgba(0, 0, 0, 0.7), 0 0 80px -20px rgba(6, 182, 212, 0.25);
		cursor: default;
		animation: lb-zoom 220ms cubic-bezier(0.16, 1, 0.3, 1);
	}
	.lb-caption {
		font-size: 13px;
		color: #c6c6cd;
		font-family: 'Geist', system-ui, sans-serif;
		text-align: center;
		max-width: 600px;
		cursor: default;
	}
	.lb-close {
		position: absolute;
		top: 20px;
		right: 20px;
		width: 40px;
		height: 40px;
		border-radius: 50%;
		background: rgba(15, 23, 42, 0.7);
		border: 1px solid rgba(255, 255, 255, 0.15);
		color: #d3e4fe;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: background 180ms ease, border-color 180ms ease, transform 120ms ease;
	}
	.lb-close:hover {
		background: rgba(6, 182, 212, 0.15);
		border-color: rgba(6, 182, 212, 0.5);
	}
	.lb-close:active { transform: scale(0.92); }

	@keyframes lb-fade {
		from { opacity: 0; }
		to   { opacity: 1; }
	}
	@keyframes lb-zoom {
		from { opacity: 0; transform: scale(0.96); }
		to   { opacity: 1; transform: scale(1);    }
	}
</style>
