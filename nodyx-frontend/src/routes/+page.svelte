<script lang="ts">
	import type { PageData } from './$types';
	import { onMount, onDestroy } from 'svelte';

	let { data }: { data: PageData } = $props();

	const instance = $derived(data.instance);
	const threads  = $derived(data.threads);
	const articles = $derived(data.articles);

	function timeAgo(dateStr: string): string {
		if (!dateStr) return '';
		const diff = Date.now() - new Date(dateStr).getTime();
		const m = Math.floor(diff / 60000);
		const h = Math.floor(m / 60);
		const d = Math.floor(h / 24);
		if (m < 1)  return 'maintenant';
		if (m < 60) return `${m}min`;
		if (h < 24) return `${h}h`;
		return `${d}j`;
	}

	// ── Slideshow ──────────────────────────────────────────────────────────
	const slideArticles = $derived(articles.length > 0 ? articles : []);
	let slideIndex  = $state(0);
	let progressPct = $state(0);
	let slideTimer: ReturnType<typeof setInterval> | null = null;
	let progressTimer: ReturnType<typeof setInterval> | null = null;
	const SLIDE_MS = 6000;

	function slideTo(i: number) {
		slideIndex  = ((i % slideArticles.length) + slideArticles.length) % slideArticles.length;
		progressPct = 0;
	}
	function slideNext() { slideTo(slideIndex + 1); }
	function slidePrev() { slideTo(slideIndex - 1); }
	function startTimers() {
		if (slideArticles.length < 2) return;
		if (slideTimer)    clearInterval(slideTimer);
		if (progressTimer) clearInterval(progressTimer);
		progressPct = 0;
		slideTimer    = setInterval(slideNext, SLIDE_MS);
		progressTimer = setInterval(() => {
			progressPct = Math.min(progressPct + 100 / (SLIDE_MS / 100), 100);
		}, 100);
	}
	onMount(startTimers);
	onDestroy(() => {
		if (slideTimer)    clearInterval(slideTimer);
		if (progressTimer) clearInterval(progressTimer);
	});

	const recentThreads   = $derived(threads.slice(0, 5));
	const featuredThreads = $derived(threads.slice(0, 6));
	const heroArticle     = $derived(articles[0] ?? null);
	const restArticles    = $derived(articles.slice(1, 4));
	const heroLetter      = $derived(instance.name?.charAt(0).toUpperCase() ?? 'N');
</script>

<svelte:head>
	<title>{instance.name}</title>
	<meta name="description" content={instance.description} />
	<meta property="og:title" content={instance.name} />
	<meta property="og:description" content={instance.description} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;800&display=swap" rel="stylesheet" />
</svelte:head>

<style>
	:global(.hp-root) { font-family: 'Inter', sans-serif; }
	.sg  { font-family: 'Space Grotesk', sans-serif; }
	.mono { font-family: 'JetBrains Mono', 'Fira Code', monospace; }

	/* ── Surfaces ── */
	.s0  { background: #05050a; }
	.s1  { background: #0d0d12; }
	.s2  { background: #12121a; }
	.s3  { background: #1b1b24; }
	.b   { border-color: rgba(255,255,255,.05); }

	/* ── Gradient text ── */
	.gt {
		background: linear-gradient(135deg, #a78bfa 0%, #06b6d4 100%);
		-webkit-background-clip: text; background-clip: text;
		-webkit-text-fill-color: transparent; color: transparent;
	}
	.gt-v {
		background: linear-gradient(135deg, #a78bfa, #7c3aed);
		-webkit-background-clip: text; background-clip: text;
		-webkit-text-fill-color: transparent; color: transparent;
	}

	/* ── Decorative letter ── */
	.deco-letter {
		font-family: 'Space Grotesk', sans-serif;
		font-weight: 800;
		font-size: clamp(140px, 20vw, 280px);
		line-height: 1;
		background: linear-gradient(135deg, rgba(124,58,237,.5) 0%, rgba(6,182,212,.2) 50%, transparent 80%);
		-webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
		pointer-events: none; user-select: none;
	}

	/* ── Glass card ── */
	.glass {
		background: rgba(255,255,255,.035);
		border: 1px solid rgba(255,255,255,.07);
		backdrop-filter: blur(8px);
		transition: background .2s, border-color .2s;
	}
	.glass:hover { background: rgba(255,255,255,.06); border-color: rgba(124,58,237,.3); }

	/* ── Module tile ── */
	.tile { position: relative; overflow: hidden; }
	.tile::after {
		content: '';
		position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
		background: linear-gradient(90deg, #7c3aed, #06b6d4);
		transform: scaleX(0); transform-origin: left;
		transition: transform .3s ease;
	}
	.tile:hover::after { transform: scaleX(1); }

	/* ── Slide cross-fade ── */
	.sfade { animation: sfade .5s ease forwards; }
	@keyframes sfade {
		from { opacity: 0; transform: scale(1.04); }
		to   { opacity: 1; transform: scale(1); }
	}

	/* ── Thread hover bar ── */
	.trow { position: relative; }
	.trow::before {
		content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
		background: linear-gradient(to bottom, #7c3aed, #06b6d4);
		transform: scaleY(0); transform-origin: center;
		transition: transform .2s ease;
	}
	.trow:hover::before { transform: scaleY(1); }

	/* ── Stat glow ── */
	@keyframes sglow {
		0%,100% { text-shadow: 0 0 0 rgba(124,58,237,0); }
		50%      { text-shadow: 0 0 20px rgba(124,58,237,.5); }
	}
	.sglow { animation: sglow 4s ease-in-out infinite; }

	/* ── Online pulse ── */
	@keyframes opulse {
		0%   { box-shadow: 0 0 0 0 rgba(74,222,128,.5); }
		100% { box-shadow: 0 0 0 7px rgba(74,222,128,0); }
	}
	.opulse { animation: opulse 2s ease-out infinite; }

	/* ── Noise overlay ── */
	.noise::after {
		content: ''; position: absolute; inset: 0; pointer-events: none;
		background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.03'/%3E%3C/svg%3E");
		opacity: .4;
	}

	/* ── Scanline ── */
	.scanline::before {
		content: ''; position: absolute; inset: 0; pointer-events: none;
		background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,.04) 2px, rgba(0,0,0,.04) 4px);
	}

	/* ── Dot grid bg ── */
	.dotbg {
		background-color: #05050a;
		background-image:
			radial-gradient(circle at 15% 40%, rgba(124,58,237,.1) 0%, transparent 45%),
			radial-gradient(circle at 85% 15%, rgba(6,182,212,.07) 0%, transparent 35%),
			radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px);
		background-size: 100%, 100%, 28px 28px;
	}

	/* card accent bottom line on hover */
	.card-hover {
		position: relative;
		transition: border-color .25s;
	}
	.card-hover::after {
		content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 1px;
		background: linear-gradient(90deg, transparent, rgba(124,58,237,.5), transparent);
		opacity: 0; transition: opacity .3s;
	}
	.card-hover:hover::after { opacity: 1; }
</style>

<div class="dotbg min-h-full hp-root">

<!-- ═══════════════════════════════════════════════════════════════════
     HERO — communauté + stats
════════════════════════════════════════════════════════════════════════ -->
<section class="relative overflow-hidden noise" style="background: #0a0a0f; border-bottom: 1px solid rgba(255,255,255,.05); min-height: 220px">

	<!-- Banner bg -->
	{#if instance.banner_url}
		<img src={instance.banner_url} alt="" class="absolute inset-0 w-full h-full object-cover" style="opacity:.06" />
	{/if}

	<!-- Orbs -->
	<div class="absolute -top-40 -left-20 w-[500px] h-[500px] rounded-full pointer-events-none"
	     style="background: radial-gradient(circle, rgba(124,58,237,.14) 0%, transparent 65%)"></div>
	<div class="absolute -bottom-20 right-0 w-96 h-96 rounded-full pointer-events-none"
	     style="background: radial-gradient(circle, rgba(6,182,212,.08) 0%, transparent 65%)"></div>

	<!-- Decorative letter -->
	<div class="deco-letter absolute right-6 top-1/2 -translate-y-1/2 opacity-70 select-none pointer-events-none" aria-hidden="true">{heroLetter}</div>

	<div class="relative z-10 px-8 pt-6 pb-5 flex flex-col gap-4">

		<!-- Identity -->
		<div class="flex items-center gap-5">
			{#if instance.logo_url}
				<img src={instance.logo_url} alt={instance.name}
				     class="w-12 h-12 object-cover shrink-0" style="outline: 2px solid rgba(124,58,237,.5); outline-offset: 2px" />
			{:else}
				<div class="w-12 h-12 flex items-center justify-center shrink-0 sg text-xl font-black text-white"
				     style="background: linear-gradient(135deg, rgba(124,58,237,.4), rgba(6,182,212,.15)); border: 1px solid rgba(124,58,237,.3)">
					{heroLetter}
				</div>
			{/if}
			<div>
				<h1 class="sg font-extrabold leading-none mb-1" style="font-size: clamp(1.3rem,2.5vw,1.9rem)">
					<span class="gt">{instance.name}</span>
				</h1>
				{#if instance.description}
					<p class="text-sm max-w-lg leading-relaxed" style="color: #6b7280">{instance.description}</p>
				{/if}
			</div>
		</div>

		<!-- Stats row -->
		<div class="flex flex-wrap items-stretch gap-0.5">
			{#each [
				{ value: instance.member_count.toLocaleString('fr-FR'), label: 'Membres',  color: '#a78bfa', glow: true },
				{ value: String(instance.online_count),                  label: 'En ligne', color: '#4ade80', online: true },
				{ value: instance.thread_count.toLocaleString('fr-FR'), label: 'Sujets',   color: '#67e8f9', glow: false },
				{ value: instance.post_count.toLocaleString('fr-FR'),   label: 'Messages', color: '#94a3b8', glow: false },
			] as stat}
				<div class="flex flex-col items-center justify-center px-6 py-2 gap-0.5"
				     style="background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06)">
					<span class="sg font-black text-xl tabular-nums {stat.glow ? 'sglow' : ''}" style="color: {stat.color}">
						{#if stat.online}
							<span class="flex items-center gap-2">
								<span class="w-2 h-2 rounded-full opulse" style="background:#4ade80"></span>
								{stat.value}
							</span>
						{:else}
							{stat.value}
						{/if}
					</span>
					<span class="text-[9px] uppercase tracking-[.18em] font-bold" style="color: #374151">{stat.label}</span>
				</div>
			{/each}

			<!-- CTA -->
			<div class="flex items-center gap-2 ml-auto self-center pl-4">
				{#if data.user}
					<a href="/forum/{data.categories?.[0]?.slug ?? data.categories?.[0]?.id ?? ''}/new"
					   class="sg px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all"
					   style="background: linear-gradient(135deg, #7c3aed 0%, #0e7490 100%); border: 1px solid rgba(124,58,237,.4)">
						+ Nouveau sujet
					</a>
				{:else}
					<a href="/auth/login"
					   class="sg px-4 py-2.5 text-sm font-bold uppercase tracking-wider transition-all"
					   style="color: #9ca3af; border: 1px solid rgba(255,255,255,.1)">
						Connexion
					</a>
					<a href="/auth/register"
					   class="sg px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all"
					   style="background: linear-gradient(135deg, #7c3aed 0%, #0e7490 100%); border: 1px solid rgba(124,58,237,.4)">
						Rejoindre
					</a>
				{/if}
			</div>
		</div>
	</div>
</section>

<!-- ═══════════════════════════════════════════════════════════════════
     MODULES ROW — 4 quick tiles
════════════════════════════════════════════════════════════════════════ -->
<div class="grid grid-cols-2 lg:grid-cols-4 gap-px" style="background: rgba(255,255,255,.04); border-bottom: 1px solid rgba(255,255,255,.05)">

	<!-- Tile 1 — Dernière actualité -->
	{#if heroArticle}
	<a href="/forum/{heroArticle.categoryId}/{heroArticle.id}"
	   class="tile glass group flex flex-col gap-2.5 p-5 transition-all duration-200">
		<div class="flex items-center gap-2">
			<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="#a78bfa" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10l6 6v8a2 2 0 01-2 2z"/>
			</svg>
			<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #a78bfa">Actualités</span>
		</div>
		<p class="sg text-sm font-bold leading-snug line-clamp-2 group-hover:text-violet-200 transition-colors" style="color: #e2e8f0">{heroArticle.title}</p>
		<span class="text-[10px] mt-auto" style="color: #4b5563">{heroArticle.categoryName}</span>
	</a>
	{:else}
	<div class="tile glass flex flex-col gap-2.5 p-5">
		<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #a78bfa">Actualités</span>
		<p class="text-sm" style="color: #4b5563">Aucun article</p>
	</div>
	{/if}

	<!-- Tile 2 — Dernier thread -->
	{#if recentThreads[0]}
	<a href="/forum/{recentThreads[0].category_id}/{recentThreads[0].id}"
	   class="tile glass group flex flex-col gap-2.5 p-5 transition-all duration-200">
		<div class="flex items-center gap-2">
			<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="#67e8f9" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a2 2 0 01-2-2v-6a2 2 0 012-2h8z"/>
			</svg>
			<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #67e8f9">Forum</span>
		</div>
		<p class="sg text-sm font-bold leading-snug line-clamp-2 group-hover:text-cyan-200 transition-colors" style="color: #e2e8f0">{recentThreads[0].title}</p>
		<span class="text-[10px] mt-auto" style="color: #4b5563">{recentThreads[0].category_name}</span>
	</a>
	{:else}
	<a href="/forum" class="tile glass flex flex-col gap-2.5 p-5">
		<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #67e8f9">Forum</span>
		<p class="text-sm" style="color: #4b5563">Voir les discussions</p>
	</a>
	{/if}

	<!-- Tile 3 — Membres en ligne -->
	<div class="tile glass flex flex-col gap-2.5 p-5">
		<div class="flex items-center gap-2">
			<span class="w-2 h-2 rounded-full opulse" style="background:#4ade80"></span>
			<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #4ade80">En ligne</span>
		</div>
		<p class="sg font-black text-4xl tabular-nums" style="color: #fff">{instance.online_count}</p>
		<span class="text-[10px] mt-auto" style="color: #4b5563">{instance.member_count.toLocaleString('fr-FR')} membres au total</span>
	</div>

	<!-- Tile 4 — Chat -->
	<a href="/chat" class="tile glass group flex flex-col gap-2.5 p-5 transition-all duration-200">
		<div class="flex items-center gap-2">
			<svg class="w-3.5 h-3.5 shrink-0" fill="none" stroke="#fb923c" stroke-width="2" viewBox="0 0 24 24">
				<path stroke-linecap="round" stroke-linejoin="round" d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
			</svg>
			<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #fb923c">Chat live</span>
		</div>
		<p class="sg text-sm font-bold group-hover:text-orange-200 transition-colors" style="color: #e2e8f0">Rejoindre le salon</p>
		<span class="text-[10px] mt-auto" style="color: #4b5563">Discussion en temps réel</span>
	</a>
</div>

<!-- ═══════════════════════════════════════════════════════════════════
     SLIDESHOW  ×  ACTIVITY FEED
════════════════════════════════════════════════════════════════════════ -->
<div class="grid grid-cols-1 lg:grid-cols-[1fr_300px]" style="border-bottom: 1px solid rgba(255,255,255,.05); min-height: 420px">

	<!-- ── Slideshow ── -->
	<div class="relative overflow-hidden scanline" style="background: #0a0a0f; min-height: 420px; border-right: 1px solid rgba(255,255,255,.05)">
		{#if slideArticles.length > 0}
			{@const slide = slideArticles[slideIndex]}

			{#key slideIndex}
				{#if slide.imageUrl}
					<img src={slide.imageUrl} alt="" class="sfade absolute inset-0 w-full h-full object-cover" style="opacity:.5" />
				{:else}
					<div class="sfade absolute inset-0" style="background: linear-gradient(135deg, #12012c 0%, #020c1b 100%)"></div>
				{/if}
			{/key}

			<!-- Layered overlays -->
			<div class="absolute inset-0 pointer-events-none" style="background: linear-gradient(105deg, rgba(5,5,10,.95) 30%, rgba(5,5,10,.5) 70%, transparent 100%)"></div>
			<div class="absolute inset-0 pointer-events-none" style="background: linear-gradient(to top, rgba(5,5,10,.9) 15%, transparent 60%)"></div>

			<!-- Violet glow bottom-left -->
			<div class="absolute bottom-0 left-0 w-72 h-48 pointer-events-none"
			     style="background: radial-gradient(ellipse at bottom left, rgba(124,58,237,.2), transparent 70%)"></div>

			<div class="relative z-10 h-full flex flex-col justify-end p-8 pb-10">
				<!-- Category -->
				{#if slide.categoryName}
					<div class="flex items-center gap-3 mb-3">
						<span class="h-px w-10" style="background: linear-gradient(to right, #7c3aed, #06b6d4)"></span>
						<span class="sg text-[10px] font-black uppercase tracking-[.22em]" style="color: #a78bfa">{slide.categoryName}</span>
					</div>
				{/if}

				<!-- Title -->
				<h2 class="sg font-extrabold text-white leading-tight line-clamp-3 max-w-2xl mb-3"
				    style="font-size: clamp(1.3rem, 2.2vw, 1.9rem); text-shadow: 0 2px 30px rgba(0,0,0,.9)">
					{slide.title}
				</h2>

				{#if slide.excerpt}
					<p class="text-sm line-clamp-2 max-w-xl mb-5 leading-relaxed" style="color: #6b7280">{slide.excerpt}</p>
				{/if}

				<!-- Meta + CTA -->
				<div class="flex items-center gap-5">
					<div class="flex items-center gap-2.5">
						<div class="w-7 h-7 overflow-hidden shrink-0" style="background: rgba(124,58,237,.3); outline: 1.5px solid rgba(124,58,237,.4); outline-offset: 1px">
							{#if slide.authorAvatar}
								<img src={slide.authorAvatar} alt="" class="w-full h-full object-cover" />
							{:else}
								<span class="w-full h-full flex items-center justify-center text-[11px] font-bold text-white">
									{slide.authorUsername?.charAt(0).toUpperCase() ?? '?'}
								</span>
							{/if}
						</div>
						<span class="text-sm" style="color: #9ca3af">{slide.authorUsername}</span>
						<span style="color: #374151">·</span>
						<span class="text-sm" style="color: #6b7280">{timeAgo(slide.createdAt)}</span>
					</div>
					<a href="/forum/{slide.categoryId}/{slide.id}"
					   class="sg ml-auto group flex items-center gap-2 px-5 py-2.5 text-sm font-bold uppercase tracking-wider text-white transition-all"
					   style="background: linear-gradient(135deg, rgba(124,58,237,.55), rgba(6,182,212,.25)); border: 1px solid rgba(124,58,237,.45)">
						Lire l'article
						<svg class="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/>
						</svg>
					</a>
				</div>

				<!-- Progress bar + nav -->
				{#if slideArticles.length > 1}
					<div class="flex items-center gap-3 mt-7">
						{#each slideArticles as _, i}
							<button onclick={() => { slideTo(i); startTimers(); }}
							        class="relative h-px transition-all duration-300 {i === slideIndex ? 'w-14' : 'w-4 opacity-25 hover:opacity-50'}"
							        style="background: rgba(255,255,255,.15)"
							        aria-label="Slide {i+1}">
								{#if i === slideIndex}
									<span class="absolute top-[-1px] left-0 h-[3px] transition-none"
									      style="width:{progressPct}%; background: linear-gradient(to right, #7c3aed, #06b6d4)"></span>
								{/if}
							</button>
						{/each}
						<div class="ml-auto flex gap-1">
							<button onclick={() => { slidePrev(); startTimers(); }}
							        class="w-8 h-8 flex items-center justify-center transition-all"
							        style="border: 1px solid rgba(255,255,255,.08); color: #6b7280"
							        aria-label="Précédent"
							        onmouseenter={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(124,58,237,.5)'}
							        onmouseleave={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(255,255,255,.08)'}>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
							</button>
							<button onclick={() => { slideNext(); startTimers(); }}
							        class="w-8 h-8 flex items-center justify-center transition-all"
							        style="border: 1px solid rgba(255,255,255,.08); color: #6b7280"
							        aria-label="Suivant"
							        onmouseenter={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(124,58,237,.5)'}
							        onmouseleave={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(255,255,255,.08)'}>
								<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
							</button>
						</div>
					</div>
				{/if}
			</div>
		{:else}
			<div class="flex items-center justify-center h-full" style="color: #374151">Aucun article</div>
		{/if}
	</div>

	<!-- ── Activity Feed ── -->
	<div class="flex flex-col" style="background: #0d0d12">
		<div class="flex items-center justify-between px-5 py-3.5 shrink-0"
		     style="border-bottom: 1px solid rgba(255,255,255,.05)">
			<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #6b7280">Activité forum</span>
			<a href="/forum" class="sg text-[10px] font-bold uppercase tracking-wide transition-colors" style="color: #4b5563" onmouseenter={e => (e.target as HTMLElement).style.color='#a78bfa'} onmouseleave={e => (e.target as HTMLElement).style.color='#4b5563'}>
				tout voir
			</a>
		</div>

		<div class="flex-1 overflow-y-auto" style="divide-color: rgba(255,255,255,.04)">
			{#each recentThreads as thread, i}
			<a href="/forum/{thread.category_id}/{thread.id}"
			   class="trow flex items-start gap-3 px-5 py-4 transition-colors group"
			   style="border-bottom: 1px solid rgba(255,255,255,.04)"
			   onmouseenter={e => (e.currentTarget as HTMLElement).style.background='rgba(255,255,255,.025)'}
			   onmouseleave={e => (e.currentTarget as HTMLElement).style.background='transparent'}>
				<span class="sg text-[11px] font-black tabular-nums shrink-0 mt-0.5 w-5 text-right"
				      style="color: {i===0 ? '#a78bfa' : i===1 ? '#67e8f9' : '#374151'}">
					{String(i+1).padStart(2,'0')}
				</span>
				<div class="flex-1 min-w-0">
					<p class="text-xs font-semibold line-clamp-2 leading-snug group-hover:text-white transition-colors" style="color: #d1d5db">
						{thread.title}
					</p>
					<div class="flex items-center gap-2 mt-1.5">
						<div class="w-4 h-4 overflow-hidden shrink-0" style="background: rgba(124,58,237,.35)">
							{#if thread.author_avatar}
								<img src={thread.author_avatar} alt="" class="w-full h-full object-cover" />
							{:else}
								<span class="flex items-center justify-center w-full h-full text-[8px] font-bold text-white">{thread.author_username?.charAt(0).toUpperCase() ?? '?'}</span>
							{/if}
						</div>
						<span class="text-[10px]" style="color: #4b5563">{thread.author_username}</span>
						<span class="text-[10px] ml-auto" style="color: #374151">{timeAgo(thread.created_at)}</span>
					</div>
				</div>
				{#if (thread.post_count ?? 0) > 1}
					<span class="sg shrink-0 text-[10px] font-bold tabular-nums mt-0.5" style="color: #374151">{thread.post_count}</span>
				{/if}
			</a>
			{:else}
				<div class="flex items-center justify-center h-24" style="color: #374151; font-size: .75rem">Aucune activité</div>
			{/each}
		</div>

		<div class="px-5 py-3 shrink-0" style="border-top: 1px solid rgba(255,255,255,.05)">
			<a href="/forum"
			   class="sg flex items-center justify-center gap-2 w-full py-2.5 text-[10px] font-black uppercase tracking-widest transition-all"
			   style="color: #6b7280; border: 1px solid rgba(255,255,255,.06)"
			   onmouseenter={e => { (e.currentTarget as HTMLElement).style.color='#a78bfa'; (e.currentTarget as HTMLElement).style.borderColor='rgba(124,58,237,.25)'; }}
			   onmouseleave={e => { (e.currentTarget as HTMLElement).style.color='#6b7280'; (e.currentTarget as HTMLElement).style.borderColor='rgba(255,255,255,.06)'; }}>
				Voir le forum
				<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
			</a>
		</div>
	</div>
</div>

<!-- ═══════════════════════════════════════════════════════════════════
     FORUM THREADS GRID
════════════════════════════════════════════════════════════════════════ -->
{#if featuredThreads.length > 0}
<section class="px-6 py-8" style="border-bottom: 1px solid rgba(255,255,255,.05); background: #08080d">

	<div class="flex items-center gap-4 mb-6">
		<span class="sg text-[10px] font-black uppercase tracking-[.22em]" style="color: #67e8f9">Derniers sujets</span>
		<div class="flex-1 h-px" style="background: linear-gradient(to right, rgba(6,182,212,.2), transparent)"></div>
		<a href="/forum" class="sg text-[10px] font-bold uppercase tracking-widest transition-colors" style="color: #4b5563"
		   onmouseenter={e => (e.target as HTMLElement).style.color='#67e8f9'} onmouseleave={e => (e.target as HTMLElement).style.color='#4b5563'}>
			Tout voir →
		</a>
	</div>

	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
		{#each featuredThreads as thread}
		<a href="/forum/{thread.category_id}/{thread.id}"
		   class="card-hover group flex flex-col p-5 transition-all duration-250"
		   style="background: #12121a; border: 1px solid rgba(255,255,255,.06)"
		   onmouseenter={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(124,58,237,.25)'}
		   onmouseleave={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(255,255,255,.06)'}>

			<div class="flex items-start justify-between gap-2 mb-4">
				{#if thread.category_name}
					<span class="sg text-[9px] font-black uppercase tracking-widest px-2 py-0.5"
					      style="color: #a78bfa; background: rgba(124,58,237,.1); border: 1px solid rgba(124,58,237,.2)">
						{thread.category_name}
					</span>
				{/if}
				<div class="flex items-center gap-1 ml-auto shrink-0" style="color: #374151">
					<svg class="w-3 h-3" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
					</svg>
					<span class="sg text-[10px] font-bold">{thread.post_count ?? 0}</span>
				</div>
			</div>

			<h4 class="sg text-sm font-bold leading-snug line-clamp-3 flex-1 mb-5 group-hover:text-white transition-colors" style="color: #d1d5db">
				{thread.title}
			</h4>

			<div class="flex items-center gap-2 pt-4" style="border-top: 1px solid rgba(255,255,255,.05)">
				<div class="w-6 h-6 overflow-hidden shrink-0" style="background: rgba(124,58,237,.3); outline: 1px solid rgba(255,255,255,.07)">
					{#if thread.author_avatar}
						<img src={thread.author_avatar} alt="" class="w-full h-full object-cover" />
					{:else}
						<span class="flex items-center justify-center w-full h-full text-[9px] font-bold text-white">{thread.author_username?.charAt(0).toUpperCase() ?? '?'}</span>
					{/if}
				</div>
				<span class="text-[10px] truncate" style="color: #6b7280">{thread.author_username}</span>
				<span class="sg text-[10px] ml-auto shrink-0" style="color: #374151">{timeAgo(thread.created_at)}</span>
			</div>
		</a>
		{/each}
	</div>
</section>
{/if}

<!-- ═══════════════════════════════════════════════════════════════════
     ARTICLES
════════════════════════════════════════════════════════════════════════ -->
{#if articles.length > 0}
<section class="px-6 py-8" style="background: #0a0a0f">

	<div class="flex items-center gap-4 mb-6">
		<span class="sg text-[10px] font-black uppercase tracking-[.22em]" style="color: #a78bfa">Articles</span>
		<div class="flex-1 h-px" style="background: linear-gradient(to right, rgba(124,58,237,.2), transparent)"></div>
	</div>

	<!-- Hero article -->
	{#if heroArticle}
	<a href="/forum/{heroArticle.categoryId}/{heroArticle.id}"
	   class="card-hover group flex flex-col sm:flex-row overflow-hidden mb-3 transition-all duration-250"
	   style="background: #12121a; border: 1px solid rgba(255,255,255,.06)"
	   onmouseenter={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(124,58,237,.25)'}
	   onmouseleave={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(255,255,255,.06)'}>
		<div class="sm:w-64 h-44 sm:h-auto shrink-0 overflow-hidden relative">
			{#if heroArticle.imageUrl}
				<img src={heroArticle.imageUrl} alt={heroArticle.title}
				     class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" style="opacity:.7" />
			{:else}
				<div class="w-full h-full flex items-center justify-center" style="background: linear-gradient(135deg, #12012c, #020c1b)">
					<span class="deco-letter" style="font-size: 5rem">{heroLetter}</span>
				</div>
			{/if}
			<div class="absolute inset-0 hidden sm:block" style="background: linear-gradient(to right, transparent 50%, #12121a 100%)"></div>
		</div>
		<div class="flex-1 flex flex-col justify-between p-6">
			<div>
				{#if heroArticle.categoryName}
					<div class="flex items-center gap-2 mb-2">
						<span class="h-px w-6" style="background: #7c3aed"></span>
						<span class="sg text-[10px] font-black uppercase tracking-[.18em]" style="color: #a78bfa">{heroArticle.categoryName}</span>
					</div>
				{/if}
				<h3 class="sg text-xl font-extrabold leading-tight mb-2 group-hover:text-violet-200 transition-colors" style="color: #f1f5f9">{heroArticle.title}</h3>
				{#if heroArticle.excerpt}
					<p class="text-sm leading-relaxed line-clamp-2" style="color: #6b7280">{heroArticle.excerpt}</p>
				{/if}
			</div>
			<div class="flex items-center gap-3 mt-4 pt-4" style="border-top: 1px solid rgba(255,255,255,.05)">
				<span class="text-xs font-semibold" style="color: #a78bfa">{heroArticle.authorUsername}</span>
				<span style="color: #374151">·</span>
				<span class="text-xs" style="color: #4b5563">{timeAgo(heroArticle.createdAt)}</span>
				<span class="ml-auto sg text-xs font-bold flex items-center gap-1 group-hover:text-violet-300 transition-colors" style="color: #a78bfa">
					Lire
					<svg class="w-3 h-3 group-hover:translate-x-0.5 transition-transform" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
				</span>
			</div>
		</div>
	</a>
	{/if}

	<!-- Rest articles -->
	{#if restArticles.length > 0}
	<div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
		{#each restArticles as article}
		<a href="/forum/{article.categoryId}/{article.id}"
		   class="card-hover group flex gap-4 p-4 transition-all duration-250"
		   style="background: #12121a; border: 1px solid rgba(255,255,255,.06)"
		   onmouseenter={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(124,58,237,.2)'}
		   onmouseleave={e => (e.currentTarget as HTMLElement).style.borderColor='rgba(255,255,255,.06)'}>
			{#if article.imageUrl}
				<img src={article.imageUrl} alt="" class="w-20 h-14 object-cover shrink-0 group-hover:opacity-90 transition-opacity" style="opacity:.7" />
			{:else}
				<div class="w-20 h-14 shrink-0 flex items-center justify-center" style="background: rgba(124,58,237,.08); border: 1px solid rgba(255,255,255,.05)">
					<span class="sg text-xl font-black" style="color: rgba(124,58,237,.35)">{heroLetter}</span>
				</div>
			{/if}
			<div class="flex-1 min-w-0 flex flex-col justify-between">
				<p class="text-xs font-bold line-clamp-2 leading-snug group-hover:text-white transition-colors" style="color: #d1d5db">{article.title}</p>
				<div class="flex items-center gap-1.5 mt-2">
					<span class="text-[10px] font-semibold" style="color: #a78bfa">{article.authorUsername}</span>
					<span style="color: #374151">·</span>
					<span class="text-[10px]" style="color: #4b5563">{timeAgo(article.createdAt)}</span>
				</div>
			</div>
		</a>
		{/each}
	</div>
	{/if}
</section>
{/if}

<div class="h-8 lg:hidden"></div>
</div>
